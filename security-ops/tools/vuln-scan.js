/*!
 * SOC Tool — Vulnerability Scanner
 * =============================================================
 * Ported from old custom-1 (2026-02-23 snapshot) into the
 * SOCTools module pattern. Scans web targets for HTTP header
 * misconfigurations, SSL/TLS issues, DNS hygiene, technology
 * fingerprints, open ports (backend Nmap), and known
 * vulnerabilities. Publishes scan results to window.SOCState
 * so ThreatViz + Posture + downstream tools can consume them.
 *
 * Exposed as: window.SOCTools.vulnScan = { init(panelEl) }
 *
 * API contract:
 *   POST https://api.jonathan-castro.com/api/scan
 *   Headers: Content-Type: application/json
 *            X-API-Key: <key from SOCState.config.vulnApiKey>
 *   Body:    { target, modules: ['ports','headers','ssl','dns','tech','vulns'] }
 *   Response:
 *     - JSON: { target, scan_date, duration, findings: [...], modules: {...} }
 *     - SSE (if Content-Type text/event-stream): progress, finding,
 *       module_complete, complete, error events
 *
 * Cross-tool integration:
 *   - Subscribes to SOCState 'hosts:updated' -> repopulates target
 *     dropdown with hosts discovered by LAN Scanner
 *   - On scan complete -> SOCState.addScanResult({ target, openPorts,
 *     cves, severity }) which fires 'scan:completed' for ThreatViz
 *     and triggers posture recompute
 *
 * Fallback:
 *   - If backend is unreachable, runs runClientSideScan() which uses
 *     browser-accessible APIs (DNS-over-HTTPS via dns.google, fetch
 *     HEAD for headers, robots.txt + security.txt checks, regex tech
 *     fingerprints from HTML). Port scanning is impossible client-side.
 * =============================================================
 */
(function () {
    'use strict';

    const API_BASE = 'https://api.jonathan-castro.com';

    const MODULE_NAMES = {
        ports:   'Port Scanner (Nmap)',
        headers: 'HTTP Security Headers',
        ssl:     'SSL/TLS Analyzer',
        dns:     'DNS Reconnaissance',
        tech:    'Technology Detection',
        vulns:   'Vulnerability Assessment'
    };

    const ALL_MODULES = ['ports', 'headers', 'ssl', 'dns', 'tech', 'vulns'];

    // Per-module state (one init call per page load)
    let panelEl       = null;
    let scanResults   = null;
    let scanTimer     = null;
    let scanStartTime = null;
    let hostsUnsub    = null;

    // -------------------------------------------------------
    // DOM helpers (all queries scoped to panelEl)
    // -------------------------------------------------------
    function q(sel)    { return panelEl ? panelEl.querySelector(sel) : null; }
    function qAll(sel) {
        if (!panelEl) return [];
        return Array.prototype.slice.call(panelEl.querySelectorAll(sel));
    }

    function getApiKey() {
        return (window.SOCState && window.SOCState.config && window.SOCState.config.vulnApiKey)
            ? window.SOCState.config.vulnApiKey
            : '';
    }

    // -------------------------------------------------------
    // Live log
    // -------------------------------------------------------
    function addLog(level, message) {
        const body = q('[data-vuln="log-body"]');
        if (!body) return;
        const t = new Date().toLocaleTimeString('en-US', { hour12: false });
        const line = document.createElement('div');
        line.className = 'vuln-log-line vuln-log-' + (level || 'info');
        line.textContent = '[' + t + '] ' + message;
        body.appendChild(line);
        body.scrollTop = body.scrollHeight;
    }

    function toggleLog() {
        const body = q('[data-vuln="log-body"]');
        const btn  = q('[data-vuln="log-toggle"]');
        if (!body) return;
        body.classList.toggle('collapsed');
        if (btn) btn.classList.toggle('collapsed');
    }

    // -------------------------------------------------------
    // Progress bar + elapsed timer
    // -------------------------------------------------------
    function showProgress() {
        const panel = q('[data-vuln="progress-panel"]');
        if (panel) panel.hidden = false;
    }

    function updateProgress(percent, message) {
        const pct = Math.min(100, Math.max(0, percent || 0));
        const fill = q('[data-vuln="progress-fill"]');
        const pctEl = q('[data-vuln="progress-percent"]');
        const label = q('[data-vuln="progress-label"]');
        if (fill)  fill.style.width = pct + '%';
        if (pctEl) pctEl.textContent = Math.round(pct) + '%';
        if (label && message) label.textContent = message;
    }

    function startElapsedTimer() {
        scanStartTime = Date.now();
        updateElapsed();
        scanTimer = setInterval(updateElapsed, 1000);
    }

    function stopElapsedTimer() {
        if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    }

    function updateElapsed() {
        if (!scanStartTime) return;
        const elapsed = Math.floor((Date.now() - scanStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        const el = q('[data-vuln="elapsed"]');
        if (el) el.textContent = mins + ':' + secs;
    }

    // -------------------------------------------------------
    // Module checkbox helpers
    // -------------------------------------------------------
    function getSelectedModules() {
        const out = [];
        ALL_MODULES.forEach(function (key) {
            const cb = q('[data-vuln-module="' + key + '"]');
            if (cb && cb.checked) out.push(key);
        });
        return out;
    }

    function setAllModules(checked) {
        ALL_MODULES.forEach(function (key) {
            const cb = q('[data-vuln-module="' + key + '"]');
            if (cb) cb.checked = !!checked;
        });
    }

    // -------------------------------------------------------
    // Target dropdown — populated from SOCState.discoveredHosts
    // Auto-picks first host when newly populated (per Q1 option A)
    // -------------------------------------------------------
    function refreshTargetDropdown() {
        const select = q('[data-vuln="target-select"]');
        if (!select) return;
        const hosts = (window.SOCState && window.SOCState.getDiscoveredHostsForScanning)
            ? window.SOCState.getDiscoveredHostsForScanning()
            : [];

        // Preserve current selection if still present in new list
        const previousValue = select.value;
        const previousStillValid = hosts.some(function (h) { return h.ip === previousValue; });

        // Rebuild options
        select.innerHTML = '';
        if (hosts.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No hosts discovered yet — run LAN scan or type manually';
            opt.disabled = true;
            opt.selected = true;
            select.appendChild(opt);
        } else {
            hosts.forEach(function (h, idx) {
                const opt = document.createElement('option');
                opt.value = h.ip;
                opt.textContent = h.label || h.ip;
                // Auto-pick first host (Q1 option A) ONLY if no previous valid selection
                if (idx === 0 && !previousStillValid) opt.selected = true;
                if (previousStillValid && h.ip === previousValue) opt.selected = true;
                select.appendChild(opt);
            });
            // If user has nothing typed in manual input, mirror selection there
            const targetInput = q('[data-vuln="target-input"]');
            if (targetInput && !targetInput.value.trim() && hosts[0]) {
                targetInput.value = hosts[0].ip;
            }
        }

        // Update helper notice visibility
        const notice = q('[data-vuln="dropdown-notice"]');
        if (notice) notice.hidden = hosts.length > 0;
    }

    function onTargetSelectChange() {
        const select = q('[data-vuln="target-select"]');
        const input  = q('[data-vuln="target-input"]');
        if (select && input && select.value) input.value = select.value;
    }

    // -------------------------------------------------------
    // Start scan
    // -------------------------------------------------------
    async function startScan() {
        const targetInput = q('[data-vuln="target-input"]');
        const rawTarget = (targetInput && targetInput.value || '').trim();
        if (!rawTarget) {
            shakeInput();
            addLog('error', 'Please enter or select a target.');
            return;
        }

        const selectedModules = getSelectedModules();
        if (selectedModules.length === 0) {
            addLog('error', 'Please select at least one scan module.');
            return;
        }

        // Strip protocol + trailing slashes for display, but keep raw for fetches
        const cleanTarget = rawTarget.replace(/^https?:\/\//, '').replace(/\/+$/, '');

        // UI state
        resetResults();
        showProgress();
        startElapsedTimer();
        const scanBtn = q('[data-vuln-action="scan"]');
        if (scanBtn) {
            scanBtn.disabled = true;
            scanBtn.dataset.busy = '1';
        }

        addLog('info', 'Initiating scan on target: ' + cleanTarget);
        addLog('info', 'Modules: ' + selectedModules.join(', '));
        updateProgress(5, 'Connecting...');

        try {
            const res = await fetch(API_BASE + '/api/scan', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': getApiKey()
                },
                body: JSON.stringify({ target: cleanTarget, modules: selectedModules })
            });

            if (!res.ok) {
                throw new Error('Server returned ' + res.status + ': ' + res.statusText);
            }

            addLog('success', 'Connected to scanning engine');
            updateProgress(10, 'Scan submitted');

            const ct = res.headers.get('content-type') || '';
            if (ct.includes('text/event-stream')) {
                await handleStreamResponse(res);
            } else {
                // Simulate per-module progress visually while we read the body
                for (let i = 0; i < selectedModules.length; i++) {
                    const pct = 10 + ((i / selectedModules.length) * 80);
                    updateProgress(pct, 'Running: ' + MODULE_NAMES[selectedModules[i]]);
                    addLog('info', 'Running ' + MODULE_NAMES[selectedModules[i]] + '...');
                    await sleep(400);
                    addLog('success', MODULE_NAMES[selectedModules[i]] + ' complete');
                }
                const data = await res.json();
                scanFinished(data);
            }
        } catch (err) {
            addLog('warn', 'Backend API unavailable — running client-side analysis');
            addLog('info', 'Note: Full scanning (Nmap, deep SSL, full headers) requires backend');
            try {
                const fallbackResults = await runClientSideScan(cleanTarget, selectedModules);
                scanFinished(fallbackResults);
            } catch (fbErr) {
                addLog('error', 'Client-side fallback also failed: ' + fbErr.message);
                updateProgress(100, 'Scan failed');
                stopElapsedTimer();
                resetScanButton();
            }
        }
    }

    function scanFinished(data) {
        scanResults = data;
        updateProgress(100, 'Scan complete');
        addLog('success', 'All modules completed successfully');
        stopElapsedTimer();
        resetScanButton();
        displayResults(data);
        publishToSOCState(data);
    }

    function resetScanButton() {
        const scanBtn = q('[data-vuln-action="scan"]');
        if (scanBtn) {
            scanBtn.disabled = false;
            delete scanBtn.dataset.busy;
        }
    }

    // -------------------------------------------------------
    // SSE stream handler (when backend responds with text/event-stream)
    // -------------------------------------------------------
    async function handleStreamResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        handleStreamEvent(data);
                    } catch (e) { /* skip malformed line */ }
                }
            }
        }
    }

    function handleStreamEvent(event) {
        switch (event.type) {
            case 'progress':
                updateProgress(event.percent, event.message);
                if (event.message) addLog('info', event.message);
                break;
            case 'finding':
                const lvl = (event.severity === 'critical' || event.severity === 'high') ? 'error'
                          : (event.severity === 'medium' ? 'warn' : 'info');
                addLog(lvl, '[' + (event.severity || 'info').toUpperCase() + '] ' + (event.title || ''));
                break;
            case 'module_complete':
                addLog('success', 'Module complete: ' + (event.module || ''));
                break;
            case 'complete':
                scanFinished(event.results);
                break;
            case 'error':
                addLog('error', event.message || 'Scan error');
                stopElapsedTimer();
                resetScanButton();
                break;
        }
    }

    // -------------------------------------------------------
    // Client-side fallback scan (runs when backend is offline)
    // Browsers can do real checks for headers/SSL/DNS/tech/vulns,
    // but cannot do TCP port scans (no raw socket access).
    // -------------------------------------------------------
    async function runClientSideScan(target, modules) {
        const results = {
            target:    target,
            scan_date: new Date().toISOString(),
            duration:  0,
            findings:  [],
            modules:   {}
        };
        const startTime = Date.now();
        const url = target.includes('://') ? target : 'https://' + target;
        const dnsTarget = target.replace(/^https?:\/\//, '').split('/')[0];

        // ---- HTTP HEADERS ----
        if (modules.includes('headers')) {
            updateProgress(20, 'Analyzing HTTP Headers...');
            addLog('info', 'Fetching HTTP headers...');
            await sleep(400);
            try {
                const headerResp = await fetch(url, { method: 'HEAD', mode: 'cors' });
                const headers = {};
                headerResp.headers.forEach(function (v, k) { headers[k.toLowerCase()] = v; });
                results.modules.headers = { raw: headers, findings: [] };

                const securityHeaders = [
                    { name: 'Strict-Transport-Security', key: 'strict-transport-security', sev: 'high',
                      desc: 'HSTS header missing. Site is vulnerable to SSL-stripping downgrade attacks.',
                      fix:  'Add: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload' },
                    { name: 'Content-Security-Policy', key: 'content-security-policy', sev: 'high',
                      desc: 'CSP missing. Site has weaker XSS / data-injection protections.',
                      fix:  "Add: Content-Security-Policy: default-src 'self'; script-src 'self'" },
                    { name: 'X-Content-Type-Options', key: 'x-content-type-options', sev: 'medium',
                      desc: 'X-Content-Type-Options missing. Browsers may MIME-sniff responses.',
                      fix:  'Add: X-Content-Type-Options: nosniff' },
                    { name: 'X-Frame-Options', key: 'x-frame-options', sev: 'medium',
                      desc: 'X-Frame-Options missing. Site is clickjacking-vulnerable in iframes.',
                      fix:  'Add: X-Frame-Options: DENY (or SAMEORIGIN)' },
                    { name: 'Referrer-Policy', key: 'referrer-policy', sev: 'low',
                      desc: 'Referrer-Policy missing. Full URLs may leak as referrers.',
                      fix:  'Add: Referrer-Policy: strict-origin-when-cross-origin' },
                    { name: 'Permissions-Policy', key: 'permissions-policy', sev: 'low',
                      desc: 'Permissions-Policy missing. Browser feature access not restricted.',
                      fix:  'Add: Permissions-Policy: camera=(), microphone=(), geolocation=()' }
                ];

                for (const h of securityHeaders) {
                    if (!headers[h.key]) {
                        const finding = { module: 'headers', severity: h.sev,
                            title: 'Missing ' + h.name + ' Header',
                            description: h.desc, remediation: h.fix };
                        results.findings.push(finding);
                        results.modules.headers.findings.push(finding);
                        addLog('warn', 'Missing: ' + h.name);
                    } else {
                        addLog('success', 'Found: ' + h.name);
                    }
                }
                addLog('success', 'HTTP header analysis complete');
            } catch (e) {
                addLog('warn', 'CORS prevented header fetch: ' + e.message);
                results.findings.push({ module: 'headers', severity: 'info',
                    title: 'CORS Prevented Header Analysis',
                    description: 'Target server does not allow cross-origin requests. Full header analysis requires backend.',
                    remediation: 'Deploy backend Python scanner for full header analysis.' });
            }
        }

        // ---- SSL/TLS (limited from browser) ----
        if (modules.includes('ssl')) {
            updateProgress(35, 'Checking SSL/TLS...');
            addLog('info', 'Analyzing SSL/TLS configuration...');
            await sleep(400);
            results.modules.ssl = { findings: [] };
            try {
                const sslUrl = url.replace(/^http:\/\//, 'https://');
                await fetch(sslUrl, { method: 'HEAD', mode: 'cors' });
                addLog('success', 'HTTPS connection successful');
                results.findings.push({ module: 'ssl', severity: 'info',
                    title: 'SSL/TLS Connection Verified',
                    description: 'Target supports HTTPS. Browser-based scanning cannot inspect certificate details, cipher suites, or protocol versions.',
                    remediation: 'Deploy backend for full SSL/TLS analysis (cert expiry, weak ciphers, protocol versions).' });
                addLog('success', 'Basic SSL/TLS check complete');
            } catch (e) {
                results.findings.push({ module: 'ssl', severity: 'critical',
                    title: 'HTTPS Connection Failed',
                    description: 'Could not establish HTTPS connection. Site may not support HTTPS, or cert is invalid/expired.',
                    remediation: 'Install valid SSL/TLS cert (Let\'s Encrypt is free). Run backend scanner for diagnostics.' });
                addLog('error', 'HTTPS connection failed');
            }
        }

        // ---- DNS (DNS-over-HTTPS) ----
        if (modules.includes('dns')) {
            updateProgress(50, 'DNS Reconnaissance...');
            addLog('info', 'Performing DNS lookups...');
            await sleep(400);
            results.modules.dns = { findings: [] };
            try {
                const aResp = await fetch('https://dns.google/resolve?name=' + encodeURIComponent(dnsTarget) + '&type=A');
                const aData = await aResp.json();
                if (aData.Answer) {
                    const ips = aData.Answer.filter(function (a) { return a.type === 1; }).map(function (a) { return a.data; });
                    results.modules.dns.a_records = ips;
                    addLog('success', 'A Records: ' + ips.join(', '));
                }

                const mxResp = await fetch('https://dns.google/resolve?name=' + encodeURIComponent(dnsTarget) + '&type=MX');
                const mxData = await mxResp.json();
                if (mxData.Answer) {
                    const mx = mxData.Answer.filter(function (a) { return a.type === 15; }).map(function (a) { return a.data; });
                    results.modules.dns.mx_records = mx;
                    addLog('success', 'MX Records: ' + mx.length + ' found');
                }

                const txtResp = await fetch('https://dns.google/resolve?name=' + encodeURIComponent(dnsTarget) + '&type=TXT');
                const txtData = await txtResp.json();
                let hasSPF = false;
                if (txtData.Answer) {
                    const txts = txtData.Answer.filter(function (a) { return a.type === 16; }).map(function (a) { return a.data; });
                    results.modules.dns.txt_records = txts;
                    hasSPF = txts.some(function (r) { return r.includes('v=spf1'); });
                }
                if (!hasSPF) {
                    results.findings.push({ module: 'dns', severity: 'medium',
                        title: 'Missing SPF Record',
                        description: 'No SPF record found. Domain is more vulnerable to email spoofing.',
                        remediation: 'Add SPF TXT: v=spf1 include:_spf.google.com ~all' });
                    addLog('warn', 'No SPF record');
                } else {
                    addLog('success', 'SPF record found');
                }

                const dmarcResp = await fetch('https://dns.google/resolve?name=_dmarc.' + encodeURIComponent(dnsTarget) + '&type=TXT');
                const dmarcData = await dmarcResp.json();
                if (!dmarcData.Answer) {
                    results.findings.push({ module: 'dns', severity: 'medium',
                        title: 'Missing DMARC Record',
                        description: 'No DMARC record. Domain spoofing protection is weaker.',
                        remediation: 'Add at _dmarc.<domain>: v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>' });
                    addLog('warn', 'No DMARC record');
                } else {
                    addLog('success', 'DMARC record found');
                }
                addLog('success', 'DNS reconnaissance complete');
            } catch (e) {
                addLog('warn', 'DNS lookup limited: ' + e.message);
            }
        }

        // ---- TECH DETECTION (regex on HTML body) ----
        if (modules.includes('tech')) {
            updateProgress(65, 'Technology Detection...');
            addLog('info', 'Detecting technologies...');
            await sleep(400);
            results.modules.tech = { detected: [], findings: [] };
            try {
                const techResp = await fetch(url, { mode: 'cors' });
                const html = await techResp.text();
                const techPatterns = [
                    { name: 'jQuery',           re: /jquery[.-][\d.]+|jquery\.min\.js/i },
                    { name: 'React',            re: /react[.-][\d.]+|react\.production|__NEXT_DATA__/i },
                    { name: 'Vue.js',           re: /vue[.-][\d.]+|vue\.min\.js|v-bind|v-on/i },
                    { name: 'Angular',          re: /angular[.-][\d.]+|ng-version|ng-app/i },
                    { name: 'Bootstrap',        re: /bootstrap[.-][\d.]+|bootstrap\.min/i },
                    { name: 'Tailwind CSS',     re: /tailwindcss|tailwind\.min/i },
                    { name: 'WordPress',        re: /wp-content|wp-includes|wordpress/i },
                    { name: 'Drupal',           re: /drupal\.js|sites\/all\/|drupal\.settings/i },
                    { name: 'Google Analytics', re: /google-analytics\.com|gtag|GoogleAnalyticsObject/i },
                    { name: 'Google Tag Manager', re: /googletagmanager\.com/i },
                    { name: 'Cloudflare',       re: /cloudflare|cf-ray|__cf_/i },
                    { name: 'Next.js',          re: /_next\/static|__NEXT_DATA__/i }
                ];
                techPatterns.forEach(function (t) {
                    if (t.re.test(html)) {
                        results.modules.tech.detected.push(t.name);
                        addLog('info', 'Detected: ' + t.name);
                    }
                });
                if (results.modules.tech.detected.length === 0) {
                    addLog('info', 'No common frameworks detected');
                }
                addLog('success', 'Technology detection complete');
            } catch (e) {
                addLog('warn', 'Tech detection limited (CORS): ' + e.message);
                results.findings.push({ module: 'tech', severity: 'info',
                    title: 'Technology Detection Limited',
                    description: 'CORS prevented fingerprinting. Backend has Wappalyzer for full detection.',
                    remediation: 'Run Python backend for comprehensive tech detection.' });
            }
        }

        // ---- PORTS (impossible from browser, note only) ----
        if (modules.includes('ports')) {
            updateProgress(80, 'Port Scan Note...');
            await sleep(300);
            results.modules.ports = { note: 'Requires backend', findings: [] };
            results.findings.push({ module: 'ports', severity: 'info',
                title: 'Port Scan Requires Backend',
                description: 'Browsers cannot perform TCP port scans (no raw socket access). Backend Nmap is required for port discovery, service detection, and OS fingerprinting.',
                remediation: 'Deploy Python backend at api.jonathan-castro.com to enable Nmap scans.' });
            addLog('warn', 'Port scanning requires Python backend (Nmap)');
        }

        // ---- VULN CHECK (robots.txt + security.txt heuristics) ----
        if (modules.includes('vulns')) {
            updateProgress(92, 'Vulnerability Assessment...');
            addLog('info', 'Assessing vulnerabilities...');
            await sleep(400);
            results.modules.vulns = { findings: [] };

            // robots.txt sensitive path disclosure
            try {
                const robotsResp = await fetch(url + '/robots.txt');
                if (robotsResp.ok) {
                    const robotsTxt = await robotsResp.text();
                    if (robotsTxt.includes('Disallow')) {
                        addLog('info', 'robots.txt found - checking for sensitive paths');
                        const sensitive = ['/admin', '/login', '/wp-admin', '/api', '/backup',
                                          '/config', '/database', '/.env', '/phpmyadmin'];
                        sensitive.forEach(function (p) {
                            if (robotsTxt.toLowerCase().includes(p)) {
                                results.findings.push({ module: 'vulns', severity: 'medium',
                                    title: 'Sensitive Path in robots.txt: ' + p,
                                    description: 'robots.txt disallows "' + p + '" — which actually advertises the path to attackers (information disclosure).',
                                    remediation: 'Use authentication/access controls instead of robots.txt to hide sensitive paths.' });
                                addLog('warn', 'Sensitive path disclosed: ' + p);
                            }
                        });
                    }
                }
            } catch (e) { /* robots.txt unreachable */ }

            // security.txt presence check
            try {
                const secResp = await fetch(url + '/.well-known/security.txt');
                if (!secResp.ok) {
                    results.findings.push({ module: 'vulns', severity: 'low',
                        title: 'Missing security.txt',
                        description: 'No security.txt at /.well-known/security.txt. RFC 9116 file helps researchers report vulns responsibly.',
                        remediation: 'Create /.well-known/security.txt with Contact, Expires fields per RFC 9116.' });
                    addLog('warn', 'No security.txt found');
                } else {
                    addLog('success', 'security.txt found');
                }
            } catch (e) { /* not accessible */ }

            addLog('success', 'Vulnerability assessment complete');
        }

        results.duration = ((Date.now() - startTime) / 1000).toFixed(1);
        return results;
    }

    // -------------------------------------------------------
    // Results display — summary cards + 6 collapsible sections
    // -------------------------------------------------------
    function displayResults(data) {
        if (!data) return;
        const summary = q('[data-vuln="summary-panel"]');
        const sections = q('[data-vuln="sections-panel"]');
        if (summary)  summary.hidden = false;
        if (sections) sections.hidden = false;

        // Severity counts
        const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        (data.findings || []).forEach(function (f) {
            if (counts.hasOwnProperty(f.severity)) counts[f.severity]++;
        });
        setText('[data-vuln="count-critical"]', counts.critical);
        setText('[data-vuln="count-high"]',     counts.high);
        setText('[data-vuln="count-medium"]',   counts.medium);
        setText('[data-vuln="count-low"]',      counts.low);
        setText('[data-vuln="count-info"]',     counts.info);

        // Meta
        setText('[data-vuln="meta-target"]',   'Target: ' + (data.target || '-'));
        setText('[data-vuln="meta-duration"]', 'Duration: ' + (data.duration || '0') + 's');
        setText('[data-vuln="meta-date"]',     'Date: ' + (data.scan_date ? new Date(data.scan_date).toLocaleString() : '-'));

        // Build sections
        renderSection('headers', data, function (panel) { renderHeadersBody(panel, data); });
        renderSection('ssl',     data, function (panel) { renderGenericFindings(panel, data, 'ssl'); });
        renderSection('dns',     data, function (panel) { renderDNSBody(panel, data); });
        renderSection('tech',    data, function (panel) { renderTechBody(panel, data); });
        renderSection('ports',   data, function (panel) { renderPortsBody(panel, data); });
        renderSection('vulns',   data, function (panel) { renderGenericFindings(panel, data, 'vulns'); });
    }

    function setText(sel, val) {
        const el = q(sel);
        if (el) el.textContent = val;
    }

    function renderSection(moduleKey, data, bodyRenderer) {
        const section = q('[data-vuln-section="' + moduleKey + '"]');
        if (!section) return;
        const moduleData = data.modules && data.modules[moduleKey];
        const findings = (data.findings || []).filter(function (f) { return f.module === moduleKey; });
        // Show section if EITHER the module ran AND produced data, OR there are
        // findings for this module (covers the CORS-fail case where the catch
        // block pushes a finding but never set results.modules.<key]).
        section.hidden = !moduleData && findings.length === 0;
        if (section.hidden) return;

        // Update count badge
        const badge = section.querySelector('[data-vuln-section-count]');
        if (badge) badge.textContent = findings.length;

        // Render body
        const body = section.querySelector('[data-vuln-section-body]');
        if (body) {
            body.innerHTML = '';
            bodyRenderer(body);
        }

        // Default: expanded after scan
        section.classList.remove('collapsed');
        const head = section.querySelector('[data-vuln-section-toggle]');
        if (head) head.setAttribute('aria-expanded', 'true');
    }

    function renderGenericFindings(body, data, moduleKey) {
        const findings = (data.findings || []).filter(function (f) { return f.module === moduleKey; });
        if (findings.length === 0) {
            body.innerHTML = '<div class="vuln-no-findings">No issues found in this category.</div>';
            return;
        }
        const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        findings.sort(function (a, b) { return (order[a.severity] || 5) - (order[b.severity] || 5); });
        body.innerHTML = findings.map(renderFindingCard).join('');
    }

    function renderFindingCard(f) {
        return '<div class="vuln-finding ' + escapeHtml(f.severity) + '">' +
               '<div class="vuln-finding-head">' +
                 '<span class="vuln-sev ' + escapeHtml(f.severity) + '">' + escapeHtml(f.severity) + '</span>' +
                 '<span class="vuln-finding-title">' + escapeHtml(f.title || '') + '</span>' +
               '</div>' +
               '<div class="vuln-finding-desc">' + escapeHtml(f.description || '') + '</div>' +
               (f.remediation
                 ? '<div class="vuln-finding-fix"><strong>Remediation:</strong> ' + escapeHtml(f.remediation) + '</div>'
                 : '') +
               '</div>';
    }

    function renderHeadersBody(body, data) {
        const findings = (data.findings || []).filter(function (f) { return f.module === 'headers'; });
        const raw = data.modules && data.modules.headers && data.modules.headers.raw;
        let html = '';
        if (raw && Object.keys(raw).length > 0) {
            html += '<div class="vuln-subsection-title">DETECTED HEADERS</div>' +
                    '<table class="vuln-kv-table"><tbody>' +
                    Object.keys(raw).sort().map(function (k) {
                        return '<tr><td class="vuln-kv-key">' + escapeHtml(k) + '</td>' +
                               '<td class="vuln-kv-val">' + escapeHtml(String(raw[k])) + '</td></tr>';
                    }).join('') +
                    '</tbody></table>';
        }
        if (findings.length > 0) {
            const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
            findings.sort(function (a, b) { return (order[a.severity] || 5) - (order[b.severity] || 5); });
            html += '<div class="vuln-subsection-title">FINDINGS</div>' + findings.map(renderFindingCard).join('');
        }
        if (html === '') html = '<div class="vuln-no-findings">No issues found in this category.</div>';
        body.innerHTML = html;
    }

    function renderDNSBody(body, data) {
        const dns = (data.modules && data.modules.dns) || {};
        const findings = (data.findings || []).filter(function (f) { return f.module === 'dns'; });
        let html = '';
        ['a_records', 'mx_records', 'txt_records'].forEach(function (key) {
            if (dns[key] && dns[key].length) {
                const label = key.replace('_', ' ').toUpperCase();
                html += '<div class="vuln-subsection-title">' + label + '</div>' +
                        '<ul class="vuln-record-list">' +
                        dns[key].map(function (r) { return '<li>' + escapeHtml(String(r)) + '</li>'; }).join('') +
                        '</ul>';
            }
        });
        if (findings.length > 0) {
            const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
            findings.sort(function (a, b) { return (order[a.severity] || 5) - (order[b.severity] || 5); });
            html += '<div class="vuln-subsection-title">FINDINGS</div>' + findings.map(renderFindingCard).join('');
        }
        if (html === '') html = '<div class="vuln-no-findings">No DNS data returned.</div>';
        body.innerHTML = html;
    }

    function renderTechBody(body, data) {
        const tech = (data.modules && data.modules.tech) || {};
        const detected = tech.detected || [];
        const findings = (data.findings || []).filter(function (f) { return f.module === 'tech'; });
        let html = '';
        if (detected.length > 0) {
            html += '<div class="vuln-subsection-title">DETECTED TECHNOLOGIES</div>' +
                    '<div class="vuln-tech-grid">' +
                    detected.map(function (t) { return '<span class="vuln-tech-badge">' + escapeHtml(t) + '</span>'; }).join('') +
                    '</div>';
        }
        if (findings.length > 0) {
            html += '<div class="vuln-subsection-title">FINDINGS</div>' + findings.map(renderFindingCard).join('');
        }
        if (html === '') html = '<div class="vuln-no-findings">No technologies fingerprinted.</div>';
        body.innerHTML = html;
    }

    function renderPortsBody(body, data) {
        const ports = (data.modules && data.modules.ports && data.modules.ports.open_ports) || [];
        const findings = (data.findings || []).filter(function (f) { return f.module === 'ports'; });
        let html = '';
        if (ports.length > 0) {
            html += '<div class="vuln-subsection-title">OPEN PORTS</div>' +
                    '<table class="vuln-port-table">' +
                    '<thead><tr><th>PORT</th><th>STATE</th><th>SERVICE</th><th>VERSION</th></tr></thead>' +
                    '<tbody>' +
                    ports.map(function (p) {
                        return '<tr>' +
                               '<td class="vuln-port-num">' + escapeHtml(String(p.port)) + '</td>' +
                               '<td class="vuln-port-state ' + escapeHtml(p.state || '') + '">' + escapeHtml(p.state || '-') + '</td>' +
                               '<td>' + escapeHtml(p.service || '-') + '</td>' +
                               '<td>' + escapeHtml(p.version || '-') + '</td>' +
                               '</tr>';
                    }).join('') +
                    '</tbody></table>';
        }
        if (findings.length > 0) {
            html += '<div class="vuln-subsection-title">FINDINGS</div>' + findings.map(renderFindingCard).join('');
        }
        if (html === '') html = '<div class="vuln-no-findings">No port data returned.</div>';
        body.innerHTML = html;
    }

    function toggleSection(moduleKey) {
        const section = q('[data-vuln-section="' + moduleKey + '"]');
        if (!section) return;
        section.classList.toggle('collapsed');
        const head = section.querySelector('[data-vuln-section-toggle]');
        if (head) head.setAttribute('aria-expanded', section.classList.contains('collapsed') ? 'false' : 'true');
    }

    // -------------------------------------------------------
    // Reset / clear
    // -------------------------------------------------------
    function resetResults() {
        ['progress-panel', 'summary-panel', 'sections-panel'].forEach(function (k) {
            const p = q('[data-vuln="' + k + '"]');
            if (p) p.hidden = true;
        });
        ALL_MODULES.forEach(function (k) {
            const sec = q('[data-vuln-section="' + k + '"]');
            if (sec) {
                sec.hidden = true;
                const body = sec.querySelector('[data-vuln-section-body]');
                if (body) body.innerHTML = '';
            }
        });
        ['critical', 'high', 'medium', 'low', 'info'].forEach(function (s) {
            const el = q('[data-vuln="count-' + s + '"]');
            if (el) el.textContent = '0';
        });
        const fill = q('[data-vuln="progress-fill"]');
        const pct  = q('[data-vuln="progress-percent"]');
        const lbl  = q('[data-vuln="progress-label"]');
        if (fill) fill.style.width = '0%';
        if (pct)  pct.textContent = '0%';
        if (lbl)  lbl.textContent = 'Initializing...';
        scanResults = null;
    }

    function clearAll() {
        resetResults();
        const body = q('[data-vuln="log-body"]');
        if (body) body.innerHTML = '';
        addLog('info', 'Results cleared.');
    }

    // -------------------------------------------------------
    // Export JSON / CSV
    // -------------------------------------------------------
    function exportJSON() {
        if (!scanResults) { addLog('warn', 'No scan results to export.'); return; }
        const blob = new Blob([JSON.stringify(scanResults, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'vuln-scan-' + safeFilename(scanResults.target) + '-' + Date.now() + '.json');
        addLog('success', 'Exported scan as JSON.');
    }

    function exportCSV() {
        if (!scanResults || !scanResults.findings) { addLog('warn', 'No scan results to export.'); return; }
        const rows = [['Severity', 'Module', 'Title', 'Description', 'Remediation']];
        scanResults.findings.forEach(function (f) {
            rows.push([f.severity || '', f.module || '', f.title || '', f.description || '', f.remediation || '']);
        });
        const csv = rows.map(function (r) {
            return r.map(function (cell) {
                const s = String(cell);
                return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, 'vuln-scan-' + safeFilename(scanResults.target) + '-' + Date.now() + '.csv');
        addLog('success', 'Exported ' + (rows.length - 1) + ' findings to CSV.');
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function safeFilename(s) {
        return String(s || 'target').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    }

    // -------------------------------------------------------
    // Publish to SOCState — feeds ThreatViz + Posture
    // -------------------------------------------------------
    function publishToSOCState(data) {
        if (!window.SOCState || !data) return;
        const targetIp = data.target;
        // Open ports (if backend provided them)
        const openPorts = (data.modules && data.modules.ports && data.modules.ports.open_ports)
            ? data.modules.ports.open_ports.map(function (p) { return p.port; })
            : [];
        // CVE objects (rich, shared.js _rebuildThreatGraph handles both shapes after Chat 7 hardening)
        const cves = (data.findings || []).map(function (f) {
            return {
                id:          f.id || (f.title ? f.title.slice(0, 80) : null),
                severity:    f.severity || 'info',
                title:       f.title || '',
                description: f.description || '',
                module:      f.module || ''
            };
        });
        // Max severity across all findings (drives posture score impact)
        const maxSev = getMaxSeverity(data.findings || []);

        SOCState.addScanResult({
            target:    targetIp,
            openPorts: openPorts,
            cves:      cves,
            severity:  maxSev,
            scanType:  'vuln'
        });
        addLog('success', 'Published scan: ' + cves.length + ' finding' + (cves.length !== 1 ? 's' : '') +
                          ' (' + maxSev + ') to SOCState.');
    }

    // -------------------------------------------------------
    // Utilities
    // -------------------------------------------------------
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getMaxSeverity(findings) {
        if (!findings || findings.length === 0) return 'low';
        const order = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
        let maxName = 'low';
        let maxVal  = -1;
        findings.forEach(function (f) {
            const val = (order[f.severity] != null) ? order[f.severity] : -1;
            if (val > maxVal) { maxVal = val; maxName = f.severity; }
        });
        return maxName;
    }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function shakeInput() {
        const input = q('[data-vuln="target-input"]');
        if (!input) return;
        input.classList.remove('vuln-shake');
        // Force reflow to restart animation
        void input.offsetWidth;
        input.classList.add('vuln-shake');
        input.focus();
    }

    // -------------------------------------------------------
    // init — called once by security-ops/scripts.js on page load
    // -------------------------------------------------------
    function init(el) {
        panelEl = el;
        if (!panelEl) return;

        // Delegated click handler — covers all data-vuln-action buttons
        panelEl.addEventListener('click', function (e) {
            const actionBtn = e.target.closest('[data-vuln-action]');
            if (actionBtn && panelEl.contains(actionBtn)) {
                const action = actionBtn.getAttribute('data-vuln-action');
                switch (action) {
                    case 'scan':           startScan();          break;
                    case 'clear':          clearAll();           break;
                    case 'export-json':    exportJSON();         break;
                    case 'export-csv':     exportCSV();          break;
                    case 'select-all':     setAllModules(true);  break;
                    case 'deselect-all':   setAllModules(false); break;
                    case 'log-toggle':     toggleLog();          break;
                }
                return;
            }

            // Section accordion toggles
            const sectionToggle = e.target.closest('[data-vuln-section-toggle]');
            if (sectionToggle && panelEl.contains(sectionToggle)) {
                const moduleKey = sectionToggle.getAttribute('data-vuln-section-toggle');
                if (moduleKey) toggleSection(moduleKey);
                return;
            }
        });

        // Target dropdown change -> mirror into manual input
        panelEl.addEventListener('change', function (e) {
            const select = e.target.closest('[data-vuln="target-select"]');
            if (select && panelEl.contains(select)) onTargetSelectChange();
        });

        // Enter key in target input fires scan
        const targetInput = q('[data-vuln="target-input"]');
        if (targetInput) {
            targetInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const scanBtn = q('[data-vuln-action="scan"]');
                    if (scanBtn && !scanBtn.disabled) scanBtn.click();
                }
            });
        }

        // Subscribe to LAN Scanner host updates -> repopulate dropdown
        if (window.SOCState && window.SOCState.subscribe) {
            hostsUnsub = SOCState.subscribe('hosts:updated', refreshTargetDropdown);
        }
        refreshTargetDropdown();   // initial paint with whatever's already there

        addLog('info', 'Vulnerability Scanner ready. Pick a discovered host or type a target.');
    }

    // -------------------------------------------------------
    // Module export
    // -------------------------------------------------------
    window.SOCTools = window.SOCTools || {};
    window.SOCTools.vulnScan = { init: init };
})();
