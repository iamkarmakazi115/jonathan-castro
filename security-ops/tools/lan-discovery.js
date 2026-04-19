/*!
 * SOC Tool — LAN Discovery Scanner
 * =============================================================
 * Ported from old custom-6 (2026-02-23 snapshot) into the
 * SOCTools module pattern. Publishes discovered hosts +
 * scan results to window.SOCState so downstream tools
 * (Vuln Scan, ThreatViz) can consume them.
 *
 * Exposed as: window.SOCTools.lanDiscovery = { init(panelEl) }
 *
 * Scan lifecycle:
 *   start  -> POST /api/lan-scan/start   { target, scanType }
 *   poll   -> GET  /api/lan-scan/status/{scanId}    every 2s
 *   stop   -> POST /api/lan-scan/stop/{scanId}
 *
 * Cross-tool publishes on scan completion:
 *   - SOCState.addHost({ ip, hostname, os, mac, openPorts })
 *   - SOCState.addScanResult({ target, openPorts, cves, ... })
 * =============================================================
 */
(function () {
    'use strict';

    const API_BASE = 'https://api.jonathan-castro.com';
    const POLL_INTERVAL_MS = 2000;

    // Per-module state (one init call per page load)
    let panelEl        = null;
    let currentScanId  = null;
    let pollTimer      = null;
    let elapsedTimer   = null;
    let elapsedSeconds = 0;
    let scanResults    = null;
    let authUnsub      = null;

    // -------------------------------------------------------
    // DOM helpers (all queries scoped to panelEl)
    // -------------------------------------------------------
    function q(sel)    { return panelEl ? panelEl.querySelector(sel) : null; }
    function qAll(sel) {
        if (!panelEl) return [];
        return Array.prototype.slice.call(panelEl.querySelectorAll(sel));
    }

    function getToken() {
        return (window.SOCState && window.SOCState.getAuthToken) ? window.SOCState.getAuthToken() : null;
    }

    function authHeaders() {
        const token = getToken();
        const h = { 'Content-Type': 'application/json' };
        if (token) h['Authorization'] = 'Bearer ' + token;
        return h;
    }

    // -------------------------------------------------------
    // Auth overlay + button enable/disable
    // -------------------------------------------------------
    function updateAuthUi() {
        const loggedIn = !!(window.SOCState && window.SOCState.isAuthenticated());
        const overlay  = q('.lan-auth-overlay');
        const scanBtn  = q('[data-lan-action="scan"]');
        if (overlay) overlay.hidden = loggedIn;
        if (scanBtn) {
            scanBtn.disabled = !loggedIn;
            scanBtn.title = loggedIn ? '' : 'Log in to start a scan';
        }
    }

    // -------------------------------------------------------
    // Live log
    // -------------------------------------------------------
    function addLog(level, message) {
        const body = q('[data-lan="log-body"]');
        if (!body) return;
        const line = document.createElement('div');
        const t = new Date().toLocaleTimeString('en-US', { hour12: false });
        line.className = 'lan-log-line lan-log-' + (level || 'info');
        line.textContent = '[' + t + '] ' + message;
        body.appendChild(line);
        body.scrollTop = body.scrollHeight;
    }

    function toggleLog() {
        const body = q('[data-lan="log-body"]');
        const btn  = q('[data-lan="log-toggle"]');
        if (!body) return;
        body.classList.toggle('collapsed');
        if (btn) btn.classList.toggle('collapsed');
    }

    // -------------------------------------------------------
    // Progress bar + stats
    // -------------------------------------------------------
    function showProgress() {
        const panel = q('[data-lan="progress-panel"]');
        if (panel) panel.hidden = false;
    }

    function updateProgress(data) {
        const pct = Math.min(100, Math.max(0, data.progress || 0));
        const fill = q('[data-lan="progress-fill"]');
        const pctEl = q('[data-lan="progress-percent"]');
        const label = q('[data-lan="progress-label"]');
        if (fill)  fill.style.width = pct + '%';
        if (pctEl) pctEl.textContent = Math.round(pct) + '%';
        if (label && data.phase) label.textContent = data.phase;
    }

    function updateElapsed() {
        const mins = Math.floor(elapsedSeconds / 60);
        const secs = elapsedSeconds % 60;
        const text = mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
        const el = q('[data-lan="elapsed"]');
        if (el) el.textContent = text;
    }

    // -------------------------------------------------------
    // Start scan
    // -------------------------------------------------------
    async function startScan() {
        if (!getToken()) {
            addLog('error', 'Not authenticated. Log in to start a scan.');
            return;
        }
        const targetInput = q('[data-lan="target"]');
        const target = (targetInput && targetInput.value || '').trim();
        if (!target) {
            addLog('error', 'Please enter a target range (e.g. 192.168.1.0/24).');
            if (targetInput) targetInput.focus();
            return;
        }
        const scanTypeInput = q('input[name="lan-scanType"]:checked');
        const scanType = scanTypeInput ? scanTypeInput.value : 'discovery';

        resetResults();
        showProgress();
        elapsedSeconds = 0;
        updateElapsed();
        elapsedTimer = setInterval(function () {
            elapsedSeconds++;
            updateElapsed();
        }, 1000);

        addLog('info', 'Initiating ' + scanType + ' scan on ' + target + '...');
        addLog('info', 'Sending scan request to server...');

        const scanBtn = q('[data-lan-action="scan"]');
        const stopBtn = q('[data-lan-action="stop"]');
        if (scanBtn) scanBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-flex';

        try {
            const res = await fetch(API_BASE + '/api/lan-scan/start', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ target: target, scanType: scanType })
            });
            let data = {}; try { data = await res.json(); } catch (e) { data = {}; }
            if (!res.ok) throw new Error(data.error || 'Scan request failed (HTTP ' + res.status + ')');

            currentScanId = data.scanId;
            addLog('success', 'Scan started - ID: ' + currentScanId);
            addLog('info', 'Profile: ' + scanType + ' | Target: ' + target);
            pollTimer = setInterval(pollScanStatus, POLL_INTERVAL_MS);
        } catch (err) {
            addLog('error', 'Failed to start scan: ' + err.message);
            scanFinished();
        }
    }

    // -------------------------------------------------------
    // Poll scan status
    // -------------------------------------------------------
    async function pollScanStatus() {
        if (!currentScanId) return;
        try {
            const res = await fetch(API_BASE + '/api/lan-scan/status/' + encodeURIComponent(currentScanId), {
                headers: authHeaders()
            });
            let data = {}; try { data = await res.json(); } catch (e) { data = {}; }
            if (!res.ok) throw new Error(data.error || 'Status check failed (HTTP ' + res.status + ')');

            updateProgress(data);

            if (data.logs && data.logs.length > 0) {
                data.logs.forEach(function (log) { addLog(log.level || 'info', log.message); });
            }
            if (data.partial) {
                const h = q('[data-lan="hosts-found"]');
                const p = q('[data-lan="ports-found"]');
                const v = q('[data-lan="vulns-found"]');
                if (h) h.textContent = data.partial.hostsFound || 0;
                if (p) p.textContent = data.partial.portsFound || 0;
                if (v) v.textContent = data.partial.vulnsFound || 0;
            }
            if (data.status === 'complete') {
                addLog('success', 'Scan complete!');
                scanResults = data.results;
                renderResults(data.results);
                publishToSOCState(data.results);
                scanFinished();
            } else if (data.status === 'error') {
                addLog('error', 'Scan failed: ' + (data.error || 'unknown error'));
                scanFinished();
            }
        } catch (err) {
            // Transient network hiccups are silent; scan keeps polling.
            // Hard failures would have thrown before reaching here
            // repeatedly, so we just swallow single misses.
        }
    }

    // -------------------------------------------------------
    // Stop scan
    // -------------------------------------------------------
    async function stopScan() {
        if (!currentScanId) return;
        try {
            await fetch(API_BASE + '/api/lan-scan/stop/' + encodeURIComponent(currentScanId), {
                method: 'POST',
                headers: authHeaders()
            });
            addLog('warn', 'Scan aborted by user.');
        } catch (err) {
            addLog('warn', 'Abort signal sent (response not confirmed).');
        }
        scanFinished();
    }

    function scanFinished() {
        if (pollTimer)    { clearInterval(pollTimer);    pollTimer = null; }
        if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
        currentScanId = null;
        const scanBtn = q('[data-lan-action="scan"]');
        const stopBtn = q('[data-lan-action="stop"]');
        if (scanBtn) scanBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
    }

    // -------------------------------------------------------
    // Results rendering - top-level coordinator
    // -------------------------------------------------------
    function renderResults(results) {
        if (!results) return;
        const hosts = results.hosts || [];
        const allVulns = results.vulnerabilities || [];
        const skipped = results.skipped || [];
        const allPorts = [];
        hosts.forEach(function (h) {
            (h.ports || []).forEach(function (p) {
                allPorts.push(Object.assign({}, p, { host: h.ip }));
            });
        });

        // Summary cards
        const summary = q('[data-lan="summary-panel"]');
        if (summary) summary.hidden = false;
        const setText = function (sel, val) { const el = q(sel); if (el) el.textContent = val; };
        setText('[data-lan="sum-hosts"]', hosts.length);
        setText('[data-lan="sum-ports"]', allPorts.length);
        setText('[data-lan="sum-vulns"]', allVulns.length);
        const elapsedEl = q('[data-lan="elapsed"]');
        setText('[data-lan="sum-time"]',  elapsedEl ? elapsedEl.textContent : '0s');
        setText('[data-lan="hosts-found"]', hosts.length);
        setText('[data-lan="ports-found"]', allPorts.length);
        setText('[data-lan="vulns-found"]', allVulns.length);

        if (hosts.length > 0)    renderNetworkMap(hosts, allVulns);
        if (hosts.length > 0)    renderHostsTable(hosts, allVulns);
        if (allVulns.length > 0) renderVulnerabilities(allVulns);
        if (allPorts.length > 0) renderPortAnalysis(allPorts);
        if (skipped.length > 0)  renderSkippedHosts(skipped);

        if (hosts.length === 0 && skipped.length === 0) {
            addLog('warn', 'No live hosts found in the target range.');
        }
    }

    // -------------------------------------------------------
    // Network map (host node grid)
    // -------------------------------------------------------
    function renderNetworkMap(hosts, vulns) {
        const panel = q('[data-lan="map-panel"]');
        const map   = q('[data-lan="map"]');
        if (!panel || !map) return;
        panel.hidden = false;
        map.innerHTML = '';

        hosts.forEach(function (host) {
            const hostVulns = vulns.filter(function (v) { return v.host === host.ip; });
            const maxSev = getMaxSeverity(hostVulns);
            const statusClass =
                (maxSev === 'critical' || maxSev === 'high') ? 'danger' :
                (maxSev === 'medium') ? 'warn' : 'safe';
            const portCount = (host.ports || []).length;

            const node = document.createElement('button');
            node.type = 'button';
            node.className = 'lan-host-node ' + statusClass;
            node.setAttribute('data-host-ip', host.ip);
            node.innerHTML =
                '<div class="lan-host-ip">' + escapeHtml(host.ip) + '</div>' +
                '<div class="lan-host-name">' + escapeHtml(host.hostname || 'unknown') + '</div>' +
                '<div class="lan-host-ports">' + portCount + ' port' + (portCount !== 1 ? 's' : '') + ' open</div>';
            node.addEventListener('click', function () { scrollToHost(host.ip); });
            map.appendChild(node);
        });
    }

    // -------------------------------------------------------
    // Hosts table
    // -------------------------------------------------------
    function renderHostsTable(hosts, vulns) {
        const panel = q('[data-lan="hosts-panel"]');
        const tbody = q('[data-lan="hosts-body"]');
        if (!panel || !tbody) return;
        panel.hidden = false;
        tbody.innerHTML = '';

        hosts.forEach(function (host) {
            const hostVulns = vulns.filter(function (v) { return v.host === host.ip; });
            const portCount = (host.ports || []).length;
            const maxSev = getMaxSeverity(hostVulns);
            const portClass = portCount > 10 ? 'many' : portCount > 0 ? 'few' : 'none';
            const idSafe = host.ip.replace(/\./g, '-');

            const tr = document.createElement('tr');
            tr.id = 'lan-host-row-' + idSafe;
            tr.innerHTML =
                '<td><span class="lan-status-dot up"></span>Up</td>' +
                '<td class="lan-ip-cell">' + escapeHtml(host.ip) + '</td>' +
                '<td>' + escapeHtml(host.hostname || '-') + '</td>' +
                '<td>' + escapeHtml(host.os || '-') + '</td>' +
                '<td><span class="lan-port-count ' + portClass + '">' + portCount + '</span></td>' +
                '<td>' + (hostVulns.length > 0
                    ? '<span class="lan-vuln-badge ' + maxSev + '">' + hostVulns.length + ' (' + maxSev + ')</span>'
                    : '<span class="lan-vuln-badge none">0</span>') + '</td>' +
                '<td><button type="button" class="btn btn-ghost btn-sm" data-toggle-host="' + escapeHtml(host.ip) + '">View</button></td>';
            tbody.appendChild(tr);

            const detailTr = document.createElement('tr');
            detailTr.id = 'lan-host-detail-' + idSafe;
            detailTr.hidden = true;
            detailTr.innerHTML =
                '<td colspan="7" class="lan-host-detail-cell">' +
                '<div class="lan-host-detail">' +
                '<div class="lan-host-detail-title">Open ports on ' + escapeHtml(host.ip) + '</div>' +
                (((host.ports || []).length === 0)
                    ? '<div class="lan-host-detail-empty">No open ports found</div>'
                    : '<table class="lan-ports-inner">' +
                        '<thead><tr><th>Port</th><th>Protocol</th><th>Service</th><th>Version</th><th>State</th></tr></thead>' +
                        '<tbody>' + (host.ports || []).map(function (p) {
                            return '<tr>' +
                                '<td class="lan-port-num">' + escapeHtml(String(p.port)) + '</td>' +
                                '<td>' + escapeHtml(p.protocol || 'tcp') + '</td>' +
                                '<td>' + escapeHtml(p.service || 'unknown') + '</td>' +
                                '<td>' + escapeHtml(p.version || '-') + '</td>' +
                                '<td class="lan-port-state">' + escapeHtml(p.state || 'open') + '</td>' +
                            '</tr>';
                        }).join('') + '</tbody></table>') +
                '</div></td>';
            tbody.appendChild(detailTr);
        });
    }

    function toggleHostDetails(ip) {
        const id = 'lan-host-detail-' + ip.replace(/\./g, '-');
        const row = panelEl ? panelEl.querySelector('#' + id) : null;
        if (row) row.hidden = !row.hidden;
    }

    function scrollToHost(ip) {
        const id = 'lan-host-row-' + ip.replace(/\./g, '-');
        const row = panelEl ? panelEl.querySelector('#' + id) : null;
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('lan-flash');
        setTimeout(function () { row.classList.remove('lan-flash'); }, 1800);
        toggleHostDetails(ip);
    }

    // -------------------------------------------------------
    // Vulnerability list + severity filter
    // -------------------------------------------------------
    function renderVulnerabilities(vulns) {
        const panel = q('[data-lan="vulns-panel"]');
        const list  = q('[data-lan="vulns-list"]');
        if (!panel || !list) return;
        panel.hidden = false;
        list.innerHTML = '';

        const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        vulns.sort(function (a, b) { return (order[a.severity] || 4) - (order[b.severity] || 4); });

        vulns.forEach(function (v) {
            const item = document.createElement('div');
            item.className = 'lan-vuln-item ' + v.severity;
            item.dataset.severity = v.severity;
            item.innerHTML =
                '<span class="lan-vuln-sev ' + v.severity + '">' + escapeHtml(v.severity) + '</span>' +
                '<div class="lan-vuln-body">' +
                '<div class="lan-vuln-title">' + escapeHtml(v.title || '') + '</div>' +
                '<div class="lan-vuln-desc">' + escapeHtml(v.description || '') + '</div>' +
                '<div class="lan-vuln-host">Host: ' + escapeHtml(v.host || '') +
                    (v.port ? ' : ' + escapeHtml(String(v.port)) : '') + '</div>' +
                (v.remediation
                    ? '<div class="lan-vuln-remediation">' + escapeHtml(v.remediation) + '</div>'
                    : '') +
                '</div>';
            list.appendChild(item);
        });
    }

    function filterVulns(severity) {
        qAll('[data-lan-filter]').forEach(function (b) { b.classList.remove('active'); });
        const activeBtn = q('[data-lan-filter="' + severity + '"]');
        if (activeBtn) activeBtn.classList.add('active');
        qAll('.lan-vuln-item').forEach(function (item) {
            item.style.display = (severity === 'all' || item.dataset.severity === severity) ? '' : 'none';
        });
    }

    // -------------------------------------------------------
    // Port analysis (service-grouped summary cards)
    // -------------------------------------------------------
    function renderPortAnalysis(allPorts) {
        const panel = q('[data-lan="ports-panel"]');
        const list  = q('[data-lan="ports-list"]');
        if (!panel || !list) return;
        panel.hidden = false;
        list.innerHTML = '';

        // Group ports by service name
        const byService = {};
        allPorts.forEach(function (p) {
            const key = p.service || 'unknown';
            if (!byService[key]) byService[key] = [];
            byService[key].push(p);
        });

        Object.keys(byService).sort().forEach(function (service) {
            const items = byService[service];
            const card = document.createElement('div');
            card.className = 'lan-port-card';
            card.innerHTML =
                '<div class="lan-port-card-head">' +
                    '<span class="lan-port-card-title">' + escapeHtml(service) + '</span>' +
                    '<span class="lan-port-card-count">' + items.length + '</span>' +
                '</div>' +
                '<div class="lan-port-card-hosts">' +
                    items.slice(0, 6).map(function (p) {
                        return '<span class="lan-port-card-host">' +
                            escapeHtml(p.host) + ':' + escapeHtml(String(p.port)) +
                        '</span>';
                    }).join('') +
                    (items.length > 6
                        ? '<span class="lan-port-card-more">+' + (items.length - 6) + ' more</span>'
                        : '') +
                '</div>';
            list.appendChild(card);
        });
    }

    // -------------------------------------------------------
    // Skipped hosts panel
    // -------------------------------------------------------
    function renderSkippedHosts(skipped) {
        const panel = q('[data-lan="skipped-panel"]');
        const list  = q('[data-lan="skipped-list"]');
        if (!panel || !list) return;
        panel.hidden = false;
        list.innerHTML = '';

        skipped.forEach(function (s) {
            const item = document.createElement('div');
            item.className = 'lan-skipped-item';
            item.innerHTML =
                '<span class="lan-skipped-ip">' + escapeHtml(s.ip || '') + '</span>' +
                '<span class="lan-skipped-reason">' + escapeHtml(s.reason || 'unknown') + '</span>';
            list.appendChild(item);
        });
    }

    // -------------------------------------------------------
    // CSV export (per-port row, one row per open port per host)
    // -------------------------------------------------------
    function exportCSV() {
        if (!scanResults || !scanResults.hosts || scanResults.hosts.length === 0) {
            addLog('warn', 'No scan results to export.');
            return;
        }

        const rows = [['IP', 'Hostname', 'OS', 'MAC', 'Port', 'Protocol', 'Service', 'Version', 'State']];
        scanResults.hosts.forEach(function (h) {
            if (!h.ports || h.ports.length === 0) {
                rows.push([h.ip, h.hostname || '', h.os || '', h.mac || '', '', '', '', '', '']);
            } else {
                h.ports.forEach(function (p) {
                    rows.push([
                        h.ip, h.hostname || '', h.os || '', h.mac || '',
                        p.port || '', p.protocol || '', p.service || '',
                        p.version || '', p.state || ''
                    ]);
                });
            }
        });

        const csv = rows.map(function (r) {
            return r.map(function (cell) {
                const s = String(cell);
                return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\r\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'lan-scan-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLog('success', 'Exported ' + (rows.length - 1) + ' rows to CSV.');
    }

    // -------------------------------------------------------
    // Reset / clear
    // -------------------------------------------------------
    function resetResults() {
        // Hide all result-display panels
        ['progress-panel', 'summary-panel', 'map-panel',
         'hosts-panel', 'vulns-panel', 'ports-panel', 'skipped-panel']
            .forEach(function (k) {
                const p = q('[data-lan="' + k + '"]');
                if (p) p.hidden = true;
            });
        // Empty result containers
        ['map', 'hosts-body', 'vulns-list', 'ports-list', 'skipped-list']
            .forEach(function (k) {
                const el = q('[data-lan="' + k + '"]');
                if (el) el.innerHTML = '';
            });
        // Zero counters
        ['hosts-found', 'ports-found', 'vulns-found'].forEach(function (k) {
            const el = q('[data-lan="' + k + '"]');
            if (el) el.textContent = '0';
        });
        // Reset progress UI
        const fill  = q('[data-lan="progress-fill"]');
        const pct   = q('[data-lan="progress-percent"]');
        const label = q('[data-lan="progress-label"]');
        if (fill)  fill.style.width = '0%';
        if (pct)   pct.textContent = '0%';
        if (label) label.textContent = 'Initializing...';
        scanResults = null;
    }

    function clearResults() {
        resetResults();
        const body = q('[data-lan="log-body"]');
        if (body) body.innerHTML = '';
        addLog('info', 'Results cleared.');
    }

    // -------------------------------------------------------
    // Publish to SOCState — feeds Vuln Scan + ThreatViz + Posture
    // -------------------------------------------------------
    function publishToSOCState(results) {
        if (!window.SOCState || !results) return;
        const hosts = results.hosts || [];
        const vulns = results.vulnerabilities || [];

        hosts.forEach(function (h) {
            // Add to discoveredHosts (dedupes by IP internally).
            // Fires hosts:updated which Vuln Scan subscribes to.
            SOCState.addHost({
                ip:       h.ip,
                hostname: h.hostname || '',
                mac:      h.mac || '',
                os:       h.os || '',
                openPorts: (h.ports || []).map(function (p) {
                    return {
                        port:     p.port,
                        protocol: p.protocol || 'tcp',
                        service:  p.service || '',
                        version:  p.version || '',
                        state:    p.state || 'open'
                    };
                })
            });

            // Per-host scan result with CVEs/ports. Fires scan:completed
            // which ThreatViz subscribes to; shared.js auto-rebuilds
            // threatGraph and recomputes posture.
            const hostVulns = vulns.filter(function (v) { return v.host === h.ip; });
            SOCState.addScanResult({
                target:    h.ip,
                openPorts: (h.ports || []).map(function (p) { return p.port; }),
                cves: hostVulns.map(function (v) {
                    return {
                        id:          v.cve || v.id || null,
                        severity:    v.severity || 'info',
                        title:       v.title || '',
                        description: v.description || ''
                    };
                })
            });
        });

        const hc = hosts.length, vc = vulns.length;
        addLog('success',
            'Published ' + hc + ' host' + (hc !== 1 ? 's' : '') +
            ' and ' + vc + ' vulnerabilit' + (vc !== 1 ? 'ies' : 'y') +
            ' to SOCState.');
    }

    // -------------------------------------------------------
    // Utilities (hoisted — called from render fns above)
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

    function getMaxSeverity(vulns) {
        if (!vulns || vulns.length === 0) return 'none';
        const order = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
        let maxName = 'none';
        let maxVal  = -1;
        vulns.forEach(function (v) {
            const val = (order[v.severity] != null) ? order[v.severity] : -1;
            if (val > maxVal) { maxVal = val; maxName = v.severity; }
        });
        return maxName;
    }

    // -------------------------------------------------------
    // init — called once by security-ops/scripts.js on page load
    // -------------------------------------------------------
    function init(el) {
        panelEl = el;
        if (!panelEl) return;

        // Delegated click handler catches all button actions inside the panel.
        // Covers [data-lan-action], [data-toggle-host], [data-lan-filter].
        panelEl.addEventListener('click', function (e) {
            const actionBtn = e.target.closest('[data-lan-action]');
            if (actionBtn && panelEl.contains(actionBtn)) {
                const action = actionBtn.getAttribute('data-lan-action');
                switch (action) {
                    case 'scan':       startScan();      break;
                    case 'stop':       stopScan();       break;
                    case 'clear':      clearResults();   break;
                    case 'export':     exportCSV();      break;
                    case 'log-toggle': toggleLog();      break;
                }
                return;
            }

            const toggleBtn = e.target.closest('[data-toggle-host]');
            if (toggleBtn && panelEl.contains(toggleBtn)) {
                toggleHostDetails(toggleBtn.getAttribute('data-toggle-host'));
                return;
            }

            const filterBtn = e.target.closest('[data-lan-filter]');
            if (filterBtn && panelEl.contains(filterBtn)) {
                filterVulns(filterBtn.getAttribute('data-lan-filter'));
                return;
            }
        });

        // Enter key in target input = click scan
        const targetInput = q('[data-lan="target"]');
        if (targetInput) {
            targetInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const scanBtn = q('[data-lan-action="scan"]');
                    if (scanBtn && !scanBtn.disabled) scanBtn.click();
                }
            });
        }

        // React to SOC-wide auth state changes
        if (window.SOCState && window.SOCState.subscribe) {
            authUnsub = window.SOCState.subscribe('auth:changed', updateAuthUi);
        }
        updateAuthUi();

        addLog('info', 'LAN Discovery ready. Log in and enter a target range to begin.');
    }

    // -------------------------------------------------------
    // Module export
    // -------------------------------------------------------
    window.SOCTools = window.SOCTools || {};
    window.SOCTools.lanDiscovery = { init: init };
})();
