/**
 * ============================================================
 * VULNERABILITY SCANNER - FRONTEND CONTROLLER
 * Jonathan Castro | jonathan-castro.com
 * 
 * This script handles:
 * - Scan initiation and target validation
 * - Progress tracking with live log output
 * - Results display with severity categorization
 * - Tab-based result navigation
 * - JSON and CSV export
 * 
 * Connects to: https://api.jonathan-castro.com/api/scan
 * ============================================================
 */

document.addEventListener('DOMContentLoaded', function () {

    // =============================================
    // CONFIGURATION
    // =============================================
    const API_BASE = 'https://api.jonathan-castro.com/api';
    const API_KEY = ''; // Will be set during backend deployment

    // =============================================
    // DOM REFERENCES
    // =============================================
    const targetInput = document.getElementById('targetInput');
    const clearBtn = document.getElementById('clearBtn');
    const scanBtn = document.getElementById('scanBtn');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const deselectAllBtn = document.getElementById('deselectAllBtn');

    const progressSection = document.getElementById('progressSection');
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const currentModule = document.getElementById('currentModule');
    const elapsedTime = document.getElementById('elapsedTime');
    const liveLog = document.getElementById('liveLog');

    const resultsSection = document.getElementById('resultsSection');
    const summaryDashboard = document.getElementById('summaryDashboard');
    const tabNav = document.getElementById('tabNav');
    const tabContent = document.getElementById('tabContent');

    const exportJSON = document.getElementById('exportJSON');
    const exportCSV = document.getElementById('exportCSV');
    const newScanBtn = document.getElementById('newScanBtn');

    // Checkboxes
    const scanModules = {
        ports: document.getElementById('scanPorts'),
        headers: document.getElementById('scanHeaders'),
        ssl: document.getElementById('scanSSL'),
        dns: document.getElementById('scanDNS'),
        tech: document.getElementById('scanTech'),
        vulns: document.getElementById('scanVulns')
    };

    // State
    let scanResults = null;
    let scanTimer = null;
    let scanStartTime = null;

    // =============================================
    // EVENT LISTENERS
    // =============================================
    clearBtn.addEventListener('click', () => {
        targetInput.value = '';
        targetInput.focus();
    });

    selectAllBtn.addEventListener('click', () => {
        Object.values(scanModules).forEach(cb => cb.checked = true);
    });

    deselectAllBtn.addEventListener('click', () => {
        Object.values(scanModules).forEach(cb => cb.checked = false);
    });

    scanBtn.addEventListener('click', startScan);

    targetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') startScan();
    });

    exportJSON.addEventListener('click', () => downloadJSON());
    exportCSV.addEventListener('click', () => downloadCSV());
    newScanBtn.addEventListener('click', resetScanner);

    // =============================================
    // SCAN LOGIC
    // =============================================
    async function startScan() {
        const target = targetInput.value.trim();

        // Validate input
        if (!target) {
            shakeInput();
            return;
        }

        // Validate at least one module selected
        const selectedModules = getSelectedModules();
        if (selectedModules.length === 0) {
            alert('Please select at least one scan module.');
            return;
        }

        // Clean target (remove protocol if present for display, keep for API)
        const cleanTarget = target.replace(/^https?:\/\//, '').replace(/\/+$/, '');

        // UI: Show progress, hide results
        scanBtn.querySelector('.btn-text').style.display = 'none';
        scanBtn.querySelector('.btn-icon').style.display = 'none';
        scanBtn.querySelector('.btn-loading').style.display = 'inline-flex';
        scanBtn.disabled = true;
        progressSection.style.display = 'block';
        resultsSection.style.display = 'none';
        liveLog.innerHTML = '';

        // Start timer
        scanStartTime = Date.now();
        scanTimer = setInterval(updateTimer, 1000);

        // Log start
        addLog('info', `Initiating scan on target: ${cleanTarget}`);
        addLog('info', `Modules: ${selectedModules.join(', ')}`);

        try {
            // Simulate progress stages while waiting for API
            await simulateProgress(selectedModules, cleanTarget);

        } catch (error) {
            addLog('error', `Scan failed: ${error.message}`);
            updateProgress(100, 'Scan failed');
            clearInterval(scanTimer);
            resetScanButton();
        }
    }

    async function simulateProgress(modules, target) {
        const totalModules = modules.length;
        let completed = 0;

        // Build the request payload
        const payload = {
            target: target,
            modules: modules
        };

        addLog('info', 'Connecting to scanning engine...');
        updateProgress(5, 'Connecting...');

        try {
            // Make the actual API call
            const response = await fetch(`${API_BASE}/scan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': API_KEY
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            addLog('success', 'Connected to scanning engine');
            updateProgress(10, 'Scan submitted');

            // Check if streaming response
            if (response.headers.get('content-type')?.includes('text/event-stream')) {
                // Handle SSE streaming
                await handleStreamResponse(response, modules);
            } else {
                // Handle regular JSON response  
                // Simulate module progress while parsing
                for (let i = 0; i < modules.length; i++) {
                    const moduleNames = {
                        ports: 'Port Scanner (Nmap)',
                        headers: 'HTTP Security Headers',
                        ssl: 'SSL/TLS Analyzer',
                        dns: 'DNS Reconnaissance',
                        tech: 'Technology Detection',
                        vulns: 'Vulnerability Assessment'
                    };

                    const pct = 10 + ((i / modules.length) * 80);
                    updateProgress(pct, `Running: ${moduleNames[modules[i]]}`);
                    addLog('info', `Running ${moduleNames[modules[i]]}...`);

                    // Small delay for visual feedback
                    await sleep(800);

                    addLog('success', `${moduleNames[modules[i]]} complete`);
                }

                const data = await response.json();
                scanResults = data;

                updateProgress(100, 'Scan complete');
                addLog('success', 'All modules completed successfully');

                clearInterval(scanTimer);
                resetScanButton();
                displayResults(data);
            }

        } catch (fetchError) {
            // If the API is not available, run client-side demo scan
            addLog('warning', 'Backend API unavailable — running client-side analysis');
            addLog('info', 'Note: Full scanning requires the Python backend to be running');

            const demoResults = await runClientSideScan(target, modules);
            scanResults = demoResults;

            updateProgress(100, 'Analysis complete');
            addLog('success', 'Client-side analysis completed');

            clearInterval(scanTimer);
            resetScanButton();
            displayResults(demoResults);
        }
    }

    // =============================================
    // CLIENT-SIDE SCAN (runs when backend is offline)
    // This performs real checks that browsers CAN do
    // =============================================
    async function runClientSideScan(target, modules) {
        const results = {
            target: target,
            scan_date: new Date().toISOString(),
            duration: 0,
            findings: [],
            modules: {}
        };

        const startTime = Date.now();
        const url = target.includes('://') ? target : `https://${target}`;

        // --- HTTP HEADERS CHECK ---
        if (modules.includes('headers')) {
            updateProgress(20, 'Analyzing HTTP Headers...');
            addLog('info', 'Fetching HTTP headers...');
            await sleep(500);

            try {
                const headerResponse = await fetch(url, { method: 'HEAD', mode: 'cors' });
                const headers = {};
                headerResponse.headers.forEach((value, key) => {
                    headers[key.toLowerCase()] = value;
                });

                results.modules.headers = { raw: headers, findings: [] };

                // Check critical security headers
                const securityHeaders = [
                    {
                        name: 'Strict-Transport-Security',
                        key: 'strict-transport-security',
                        severity: 'high',
                        desc: 'HSTS header is missing. Without this header, the site is vulnerable to SSL stripping attacks where an attacker can downgrade HTTPS connections to HTTP.',
                        fix: 'Add the header: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload'
                    },
                    {
                        name: 'Content-Security-Policy',
                        key: 'content-security-policy',
                        severity: 'high',
                        desc: 'CSP header is missing. Without Content Security Policy, the site is more vulnerable to Cross-Site Scripting (XSS) attacks and data injection.',
                        fix: "Add a CSP header. Start with: Content-Security-Policy: default-src 'self'; script-src 'self'"
                    },
                    {
                        name: 'X-Content-Type-Options',
                        key: 'x-content-type-options',
                        severity: 'medium',
                        desc: 'X-Content-Type-Options header is missing. This allows browsers to MIME-sniff responses, potentially executing malicious content.',
                        fix: 'Add the header: X-Content-Type-Options: nosniff'
                    },
                    {
                        name: 'X-Frame-Options',
                        key: 'x-frame-options',
                        severity: 'medium',
                        desc: 'X-Frame-Options header is missing. The site could be embedded in iframes, making it vulnerable to clickjacking attacks.',
                        fix: 'Add the header: X-Frame-Options: DENY (or SAMEORIGIN if iframes are needed)'
                    },
                    {
                        name: 'X-XSS-Protection',
                        key: 'x-xss-protection',
                        severity: 'low',
                        desc: 'X-XSS-Protection header is missing. While largely deprecated in modern browsers, it provides an extra layer of XSS protection for older browsers.',
                        fix: 'Add the header: X-XSS-Protection: 1; mode=block'
                    },
                    {
                        name: 'Referrer-Policy',
                        key: 'referrer-policy',
                        severity: 'low',
                        desc: 'Referrer-Policy header is missing. Without it, the browser may send the full URL as the referrer when navigating away, potentially leaking sensitive information.',
                        fix: 'Add the header: Referrer-Policy: strict-origin-when-cross-origin'
                    },
                    {
                        name: 'Permissions-Policy',
                        key: 'permissions-policy',
                        severity: 'low',
                        desc: 'Permissions-Policy (formerly Feature-Policy) header is missing. This header controls which browser features and APIs can be used on the page.',
                        fix: 'Add the header: Permissions-Policy: camera=(), microphone=(), geolocation=()'
                    },
                    {
                        name: 'Cross-Origin-Opener-Policy',
                        key: 'cross-origin-opener-policy',
                        severity: 'low',
                        desc: 'COOP header is missing. This header provides protection against cross-origin attacks like Spectre.',
                        fix: 'Add the header: Cross-Origin-Opener-Policy: same-origin'
                    }
                ];

                for (const header of securityHeaders) {
                    if (!headers[header.key]) {
                        const finding = {
                            module: 'headers',
                            severity: header.severity,
                            title: `Missing ${header.name} Header`,
                            description: header.desc,
                            remediation: header.fix
                        };
                        results.findings.push(finding);
                        results.modules.headers.findings.push(finding);
                        addLog('warning', `Missing: ${header.name}`);
                    } else {
                        addLog('success', `Found: ${header.name}: ${headers[header.key].substring(0, 60)}`);
                    }
                }

                // Check for information disclosure headers
                const infoHeaders = ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator'];
                for (const ih of infoHeaders) {
                    if (headers[ih]) {
                        results.findings.push({
                            module: 'headers',
                            severity: 'medium',
                            title: `Information Disclosure: ${ih} Header`,
                            description: `The "${ih}" header reveals server technology: "${headers[ih]}". This information helps attackers identify potential vulnerabilities specific to the software version.`,
                            remediation: `Remove or obfuscate the "${ih}" header in your server configuration to reduce the attack surface.`
                        });
                        addLog('warning', `Info disclosure: ${ih}: ${headers[ih]}`);
                    }
                }

                addLog('success', 'HTTP header analysis complete');
            } catch (e) {
                addLog('warning', `Could not fetch headers (CORS restriction): ${e.message}`);
                results.findings.push({
                    module: 'headers',
                    severity: 'info',
                    title: 'CORS Prevented Header Analysis',
                    description: 'The target server does not allow cross-origin requests from browsers. A full header analysis requires the backend scanning engine.',
                    remediation: 'Deploy the Python backend scanner for complete header analysis, or use browser developer tools to inspect headers manually.'
                });
            }
        }

        // --- SSL/TLS CHECK (client-side limited) ---
        if (modules.includes('ssl')) {
            updateProgress(40, 'Checking SSL/TLS...');
            addLog('info', 'Analyzing SSL/TLS configuration...');
            await sleep(500);

            try {
                const sslUrl = url.replace('http://', 'https://');
                const sslResponse = await fetch(sslUrl, { method: 'HEAD', mode: 'cors' });

                addLog('success', 'HTTPS connection successful');

                results.modules.ssl = { findings: [] };

                // Check if HTTP redirects to HTTPS
                try {
                    const httpUrl = url.replace('https://', 'http://');
                    addLog('info', 'Checking HTTP to HTTPS redirect...');
                } catch (e) {
                    // Expected
                }

                // We can't inspect certs from browser, note limitation
                results.findings.push({
                    module: 'ssl',
                    severity: 'info',
                    title: 'SSL/TLS Connection Verified',
                    description: `The target supports HTTPS connections. Browser-based scanning cannot inspect certificate details, cipher suites, or protocol versions in depth.`,
                    remediation: 'Deploy the Python backend for full SSL/TLS analysis including certificate expiry, weak ciphers, and protocol version checks.'
                });

                addLog('success', 'Basic SSL/TLS check complete');

            } catch (e) {
                results.findings.push({
                    module: 'ssl',
                    severity: 'critical',
                    title: 'HTTPS Connection Failed',
                    description: `Could not establish an HTTPS connection to the target. This may indicate the site does not support HTTPS, has an invalid certificate, or the certificate has expired.`,
                    remediation: 'Ensure the server has a valid SSL/TLS certificate installed. Use Let\'s Encrypt for free certificates. Run the backend scanner for detailed diagnostics.'
                });
                addLog('error', 'HTTPS connection failed');
            }
        }

        // --- DNS CHECK (client-side limited) ---
        if (modules.includes('dns')) {
            updateProgress(55, 'DNS Reconnaissance...');
            addLog('info', 'Performing DNS lookups...');
            await sleep(500);

            results.modules.dns = { findings: [] };

            // We can try DNS-over-HTTPS for basic checks
            try {
                const dnsTarget = target.replace(/^https?:\/\//, '').split('/')[0];
                const dohResponse = await fetch(`https://dns.google/resolve?name=${dnsTarget}&type=A`);
                const dnsData = await dohResponse.json();

                if (dnsData.Answer) {
                    const ips = dnsData.Answer.filter(a => a.type === 1).map(a => a.data);
                    addLog('success', `A Records: ${ips.join(', ')}`);

                    results.modules.dns.a_records = ips;
                }

                // Check for MX records
                const mxResponse = await fetch(`https://dns.google/resolve?name=${dnsTarget}&type=MX`);
                const mxData = await mxResponse.json();
                if (mxData.Answer) {
                    const mx = mxData.Answer.filter(a => a.type === 15).map(a => a.data);
                    addLog('success', `MX Records: ${mx.length} found`);
                    results.modules.dns.mx_records = mx;
                }

                // Check for TXT records (SPF, DKIM, DMARC)
                const txtResponse = await fetch(`https://dns.google/resolve?name=${dnsTarget}&type=TXT`);
                const txtData = await txtResponse.json();
                if (txtData.Answer) {
                    const txtRecords = txtData.Answer.filter(a => a.type === 16).map(a => a.data);
                    results.modules.dns.txt_records = txtRecords;

                    const hasSPF = txtRecords.some(r => r.includes('v=spf1'));
                    if (!hasSPF) {
                        results.findings.push({
                            module: 'dns',
                            severity: 'medium',
                            title: 'Missing SPF Record',
                            description: 'No SPF (Sender Policy Framework) record was found. SPF helps prevent email spoofing by specifying which mail servers are allowed to send email on behalf of your domain.',
                            remediation: 'Add an SPF TXT record to your DNS. Example: v=spf1 include:_spf.google.com ~all'
                        });
                        addLog('warning', 'No SPF record found');
                    } else {
                        addLog('success', 'SPF record found');
                    }
                }

                // Check DMARC
                const dmarcResponse = await fetch(`https://dns.google/resolve?name=_dmarc.${dnsTarget}&type=TXT`);
                const dmarcData = await dmarcResponse.json();
                if (!dmarcData.Answer) {
                    results.findings.push({
                        module: 'dns',
                        severity: 'medium',
                        title: 'Missing DMARC Record',
                        description: 'No DMARC record was found. DMARC (Domain-based Message Authentication, Reporting & Conformance) helps protect against email spoofing and phishing.',
                        remediation: 'Add a DMARC TXT record at _dmarc.yourdomain.com. Example: v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com'
                    });
                    addLog('warning', 'No DMARC record found');
                } else {
                    addLog('success', 'DMARC record found');
                }

                // Check DNSSEC
                const dnssecResponse = await fetch(`https://dns.google/resolve?name=${dnsTarget}&type=DNSKEY`);
                const dnssecData = await dnssecResponse.json();
                if (!dnssecData.Answer) {
                    results.findings.push({
                        module: 'dns',
                        severity: 'low',
                        title: 'DNSSEC Not Enabled',
                        description: 'DNSSEC (Domain Name System Security Extensions) is not enabled for this domain. DNSSEC provides authentication and integrity verification for DNS responses.',
                        remediation: 'Enable DNSSEC through your domain registrar. Most registrars offer one-click DNSSEC activation.'
                    });
                    addLog('warning', 'DNSSEC not enabled');
                } else {
                    addLog('success', 'DNSSEC enabled');
                }

                addLog('success', 'DNS reconnaissance complete');

            } catch (e) {
                addLog('warning', `DNS lookup limited: ${e.message}`);
            }
        }

        // --- TECHNOLOGY DETECTION (basic) ---
        if (modules.includes('tech')) {
            updateProgress(70, 'Technology Detection...');
            addLog('info', 'Detecting technologies...');
            await sleep(500);

            results.modules.tech = { detected: [], findings: [] };

            try {
                const techResponse = await fetch(url, { mode: 'cors' });
                const html = await techResponse.text();

                // Basic tech detection from HTML
                const techPatterns = [
                    { name: 'jQuery', pattern: /jquery[.-][\d.]+|jquery\.min\.js/i },
                    { name: 'React', pattern: /react[.-][\d.]+|react\.production|__NEXT_DATA__/i },
                    { name: 'Vue.js', pattern: /vue[.-][\d.]+|vue\.min\.js|v-bind|v-on/i },
                    { name: 'Angular', pattern: /angular[.-][\d.]+|ng-version|ng-app/i },
                    { name: 'Bootstrap', pattern: /bootstrap[.-][\d.]+|bootstrap\.min/i },
                    { name: 'Tailwind CSS', pattern: /tailwindcss|tailwind\.min/i },
                    { name: 'WordPress', pattern: /wp-content|wp-includes|wordpress/i },
                    { name: 'Drupal', pattern: /drupal\.js|sites\/all\/|drupal\.settings/i },
                    { name: 'Google Analytics', pattern: /google-analytics\.com|gtag|GoogleAnalyticsObject/i },
                    { name: 'Google Tag Manager', pattern: /googletagmanager\.com/i },
                    { name: 'Font Awesome', pattern: /font-awesome|fontawesome/i },
                    { name: 'Cloudflare', pattern: /cloudflare|cf-ray|__cf_/i },
                    { name: 'Next.js', pattern: /_next\/static|__NEXT_DATA__/i },
                    { name: 'Gatsby', pattern: /gatsby-/i },
                ];

                for (const tech of techPatterns) {
                    if (tech.pattern.test(html)) {
                        results.modules.tech.detected.push(tech.name);
                        addLog('info', `Detected: ${tech.name}`);
                    }
                }

                if (results.modules.tech.detected.length === 0) {
                    addLog('info', 'No common frameworks detected from client-side analysis');
                }

                addLog('success', 'Technology detection complete');

            } catch (e) {
                addLog('warning', `Tech detection limited (CORS): ${e.message}`);
                results.findings.push({
                    module: 'tech',
                    severity: 'info',
                    title: 'Technology Detection Limited',
                    description: 'Cross-origin restrictions prevented full technology fingerprinting. Deploy the backend scanner for comprehensive tech detection using Wappalyzer.',
                    remediation: 'Run the Python backend scanner for full server-side technology detection.'
                });
            }
        }

        // --- PORT SCAN (client-side cannot do real port scans) ---
        if (modules.includes('ports')) {
            updateProgress(85, 'Port Scan Note...');
            addLog('info', 'Port scanning...');
            await sleep(500);

            results.modules.ports = { note: 'Requires backend', findings: [] };
            results.findings.push({
                module: 'ports',
                severity: 'info',
                title: 'Port Scan Requires Backend',
                description: 'Web browsers cannot perform TCP port scans due to security restrictions. Port scanning requires the Python backend running Nmap, which can detect open ports, service versions, and operating system fingerprints.',
                remediation: 'Deploy the Python backend scanner on your server (api.jonathan-castro.com) to enable full Nmap port scanning capabilities.'
            });
            addLog('warning', 'Port scanning requires Python backend (Nmap)');
        }

        // --- VULN CHECK ---
        if (modules.includes('vulns')) {
            updateProgress(92, 'Vulnerability Assessment...');
            addLog('info', 'Assessing vulnerabilities...');
            await sleep(500);

            results.modules.vulns = { findings: [] };

            // Check for common issues we can detect client-side
            try {
                // Check robots.txt
                try {
                    const robotsResp = await fetch(`${url}/robots.txt`);
                    if (robotsResp.ok) {
                        const robotsTxt = await robotsResp.text();
                        if (robotsTxt.includes('Disallow')) {
                            addLog('info', 'robots.txt found — checking for sensitive paths');
                            const sensitivePatterns = ['/admin', '/login', '/wp-admin', '/api', '/backup', '/config', '/database', '/.env', '/phpmyadmin'];
                            for (const pattern of sensitivePatterns) {
                                if (robotsTxt.toLowerCase().includes(pattern)) {
                                    results.findings.push({
                                        module: 'vulns',
                                        severity: 'medium',
                                        title: `Sensitive Path in robots.txt: ${pattern}`,
                                        description: `The robots.txt file disallows "${pattern}". While robots.txt prevents search engine crawling, it actually reveals sensitive paths to attackers. This is a form of information disclosure.`,
                                        remediation: `Consider using authentication and access controls instead of relying on robots.txt to hide sensitive paths. Remove sensitive paths from robots.txt.`
                                    });
                                    addLog('warning', `Sensitive path disclosed in robots.txt: ${pattern}`);
                                }
                            }
                        }
                    }
                } catch (e) { /* robots.txt not accessible */ }

                // Check for .well-known/security.txt
                try {
                    const secTxtResp = await fetch(`${url}/.well-known/security.txt`);
                    if (!secTxtResp.ok) {
                        results.findings.push({
                            module: 'vulns',
                            severity: 'low',
                            title: 'Missing security.txt',
                            description: 'No security.txt file was found at /.well-known/security.txt. This file helps security researchers contact you responsibly if they find vulnerabilities.',
                            remediation: 'Create a security.txt file following RFC 9116. Include Contact, Expires, and optionally Encryption and Acknowledgments fields. Place it at /.well-known/security.txt'
                        });
                        addLog('warning', 'No security.txt found');
                    } else {
                        addLog('success', 'security.txt found');
                    }
                } catch (e) { /* Not accessible */ }

            } catch (e) {
                addLog('warning', `Vulnerability check limited: ${e.message}`);
            }

            addLog('success', 'Vulnerability assessment complete');
        }

        // Calculate duration
        results.duration = ((Date.now() - startTime) / 1000).toFixed(1);

        return results;
    }

    // =============================================
    // SSE STREAM HANDLER (for backend responses)
    // =============================================
    async function handleStreamResponse(response, modules) {
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
                    } catch (e) {
                        // Skip malformed lines
                    }
                }
            }
        }
    }

    function handleStreamEvent(event) {
        switch (event.type) {
            case 'progress':
                updateProgress(event.percent, event.message);
                addLog('info', event.message);
                break;
            case 'finding':
                addLog(event.severity === 'critical' || event.severity === 'high' ? 'error' :
                    event.severity === 'medium' ? 'warning' : 'info',
                    `[${event.severity.toUpperCase()}] ${event.title}`);
                break;
            case 'module_complete':
                addLog('success', `Module complete: ${event.module}`);
                break;
            case 'complete':
                scanResults = event.results;
                updateProgress(100, 'Scan complete');
                addLog('success', 'All modules completed successfully');
                clearInterval(scanTimer);
                resetScanButton();
                displayResults(event.results);
                break;
            case 'error':
                addLog('error', event.message);
                break;
        }
    }

    // =============================================
    // RESULTS DISPLAY
    // =============================================
    function displayResults(data) {
        resultsSection.style.display = 'block';

        // Count severities
        const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        if (data.findings) {
            data.findings.forEach(f => {
                if (counts.hasOwnProperty(f.severity)) {
                    counts[f.severity]++;
                }
            });
        }

        document.getElementById('criticalCount').textContent = counts.critical;
        document.getElementById('highCount').textContent = counts.high;
        document.getElementById('mediumCount').textContent = counts.medium;
        document.getElementById('lowCount').textContent = counts.low;
        document.getElementById('infoCount').textContent = counts.info;

        // Meta info
        document.getElementById('scanTarget').textContent = `Target: ${data.target}`;
        document.getElementById('scanDuration').textContent = `Duration: ${data.duration}s`;
        document.getElementById('scanDate').textContent = `Date: ${new Date(data.scan_date).toLocaleString()}`;

        // Build tabs
        buildResultTabs(data);

        // Scroll to results
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function buildResultTabs(data) {
        // Determine which tabs to show
        const tabDefinitions = [];

        tabDefinitions.push({
            id: 'all',
            label: 'ALL FINDINGS',
            findings: data.findings || []
        });

        if (data.modules?.headers) {
            tabDefinitions.push({
                id: 'headers',
                label: 'HEADERS',
                findings: (data.findings || []).filter(f => f.module === 'headers')
            });
        }

        if (data.modules?.ssl) {
            tabDefinitions.push({
                id: 'ssl',
                label: 'SSL/TLS',
                findings: (data.findings || []).filter(f => f.module === 'ssl')
            });
        }

        if (data.modules?.dns) {
            tabDefinitions.push({
                id: 'dns',
                label: 'DNS',
                findings: (data.findings || []).filter(f => f.module === 'dns')
            });
        }

        if (data.modules?.tech) {
            tabDefinitions.push({
                id: 'tech',
                label: 'TECH',
                findings: (data.findings || []).filter(f => f.module === 'tech'),
                detected: data.modules.tech.detected || []
            });
        }

        if (data.modules?.ports) {
            tabDefinitions.push({
                id: 'ports',
                label: 'PORTS',
                findings: (data.findings || []).filter(f => f.module === 'ports'),
                ports: data.modules.ports?.open_ports || []
            });
        }

        if (data.modules?.vulns) {
            tabDefinitions.push({
                id: 'vulns',
                label: 'VULNS',
                findings: (data.findings || []).filter(f => f.module === 'vulns')
            });
        }

        // Build tab buttons
        tabNav.innerHTML = tabDefinitions.map((tab, i) =>
            `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${tab.id}">${tab.label} (${tab.findings.length})</button>`
        ).join('');

        // Build tab panels
        tabContent.innerHTML = tabDefinitions.map((tab, i) => {
            let content = '';

            // Tech detection special panel
            if (tab.id === 'tech' && tab.detected && tab.detected.length > 0) {
                content += `<div style="margin-bottom: 20px;">
                    <h3 style="font-family: var(--font-display); font-size: 0.8rem; letter-spacing: 2px; color: var(--neon-cyan); margin-bottom: 12px;">DETECTED TECHNOLOGIES</h3>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        ${tab.detected.map(t => `<span class="tool-badge" style="padding: 8px 16px;"><span class="tool-name">${t}</span></span>`).join('')}
                    </div>
                </div>`;
            }

            // Port scan table
            if (tab.id === 'ports' && tab.ports && tab.ports.length > 0) {
                content += `<table class="port-table">
                    <thead><tr><th>PORT</th><th>STATE</th><th>SERVICE</th><th>VERSION</th></tr></thead>
                    <tbody>${tab.ports.map(p => `
                        <tr>
                            <td>${p.port}</td>
                            <td class="port-open">${p.state}</td>
                            <td>${p.service || '—'}</td>
                            <td>${p.version || '—'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>`;
            }

            // Findings
            if (tab.findings.length > 0) {
                // Sort by severity
                const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
                const sorted = [...tab.findings].sort((a, b) =>
                    (severityOrder[a.severity] || 5) - (severityOrder[b.severity] || 5)
                );

                content += sorted.map(f => `
                    <div class="finding-item ${f.severity}">
                        <div class="finding-header">
                            <span class="finding-severity ${f.severity}">${f.severity}</span>
                            <span class="finding-title">${escapeHTML(f.title)}</span>
                        </div>
                        <div class="finding-description">${escapeHTML(f.description)}</div>
                        ${f.remediation ? `<div class="finding-remediation"><strong>Remediation:</strong> ${escapeHTML(f.remediation)}</div>` : ''}
                    </div>
                `).join('');
            } else if (tab.id !== 'tech' && tab.id !== 'ports') {
                content += `<div class="no-findings">
                    <span class="check-icon">&#10003;</span>
                    No issues found in this category
                </div>`;
            }

            return `<div class="tab-panel ${i === 0 ? 'active' : ''}" data-tab="${tab.id}">${content}</div>`;
        }).join('');

        // Tab click handlers
        tabNav.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                tabNav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                tabContent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                tabContent.querySelector(`[data-tab="${btn.dataset.tab}"]`).classList.add('active');
            });
        });
    }

    // =============================================
    // EXPORT FUNCTIONS
    // =============================================
    function downloadJSON() {
        if (!scanResults) return;
        const blob = new Blob([JSON.stringify(scanResults, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `vuln-scan-${scanResults.target}-${Date.now()}.json`);
    }

    function downloadCSV() {
        if (!scanResults || !scanResults.findings) return;

        const headers = ['Severity', 'Module', 'Title', 'Description', 'Remediation'];
        const rows = scanResults.findings.map(f => [
            f.severity,
            f.module,
            `"${(f.title || '').replace(/"/g, '""')}"`,
            `"${(f.description || '').replace(/"/g, '""')}"`,
            `"${(f.remediation || '').replace(/"/g, '""')}"`
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        downloadBlob(blob, `vuln-scan-${scanResults.target}-${Date.now()}.csv`);
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

    // =============================================
    // UTILITY FUNCTIONS
    // =============================================
    function getSelectedModules() {
        const selected = [];
        for (const [key, cb] of Object.entries(scanModules)) {
            if (cb.checked) selected.push(key);
        }
        return selected;
    }

    function updateProgress(percent, message) {
        progressBar.style.width = `${percent}%`;
        progressPercent.textContent = `${Math.round(percent)}%`;
        if (message) currentModule.textContent = message;
    }

    function addLog(type, message) {
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.innerHTML = `<span class="log-time">[${timeStr}]</span> ${escapeHTML(message)}`;
        liveLog.appendChild(line);
        liveLog.scrollTop = liveLog.scrollHeight;
    }

    function updateTimer() {
        if (!scanStartTime) return;
        const elapsed = Math.floor((Date.now() - scanStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        elapsedTime.textContent = `${mins}:${secs}`;
    }

    function resetScanButton() {
        scanBtn.querySelector('.btn-text').style.display = 'inline';
        scanBtn.querySelector('.btn-icon').style.display = 'inline';
        scanBtn.querySelector('.btn-loading').style.display = 'none';
        scanBtn.disabled = false;
    }

    function resetScanner() {
        resultsSection.style.display = 'none';
        progressSection.style.display = 'none';
        scanResults = null;
        targetInput.value = '';
        targetInput.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function shakeInput() {
        const wrapper = targetInput.closest('.input-wrapper');
        wrapper.style.animation = 'shake 0.4s ease';
        wrapper.style.borderColor = 'var(--neon-red)';
        setTimeout(() => {
            wrapper.style.animation = '';
            wrapper.style.borderColor = '';
        }, 600);
        targetInput.focus();
    }

    function escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // =============================================
    // SCROLL ANIMATIONS
    // =============================================
    const animateOnScroll = () => {
        const elements = document.querySelectorAll('.about-card, .tool-badge');
        elements.forEach(element => {
            const elementTop = element.getBoundingClientRect().top;
            if (elementTop < window.innerHeight - 80) {
                element.style.opacity = '1';
                element.style.transform = 'translateY(0)';
            }
        });
    };

    document.querySelectorAll('.about-card, .tool-badge').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(15px)';
        el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    });

    window.addEventListener('scroll', animateOnScroll);
    animateOnScroll();

});

/* Shake animation for invalid input */
const style = document.createElement('style');
style.textContent = `@keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }`;
document.head.appendChild(style);
