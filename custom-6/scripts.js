// ============================================================
// LAN DISCOVERY SCANNER — Frontend Logic
// Custom 6 | jonathan-castro.com
// ============================================================

const API_BASE = 'https://api.jonathan-castro.com';
let authToken = null;
let currentScanId = null;
let pollInterval = null;
let elapsedInterval = null;
let elapsedSeconds = 0;
let scanResults = null;

// ============================================================
// AUTHENTICATION
// ============================================================

function showLoginModal() {
    document.getElementById('loginModal').classList.add('active');
    document.getElementById('email').focus();
}

function hideLoginModal() {
    document.getElementById('loginModal').classList.remove('active');
    document.getElementById('loginError').textContent = '';
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmit');

    submitBtn.querySelector('.btn-text').style.display = 'none';
    submitBtn.querySelector('.btn-loader').style.display = 'inline-block';
    submitBtn.disabled = true;
    errorEl.textContent = '';

    try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (!res.ok || data.error) {
            throw new Error(data.error || 'Authentication failed');
        }

        authToken = data.token;
        sessionStorage.setItem('lan_scanner_token', authToken);
        onAuthenticated(data.user?.display_name || email);
        hideLoginModal();
    } catch (err) {
        errorEl.textContent = err.message;
    } finally {
        submitBtn.querySelector('.btn-text').style.display = 'inline';
        submitBtn.querySelector('.btn-loader').style.display = 'none';
        submitBtn.disabled = false;
    }
}

function onAuthenticated(name) {
    authToken = authToken || sessionStorage.getItem('lan_scanner_token');
    document.getElementById('authOverlay').classList.add('hidden');
    document.getElementById('scanBtn').disabled = false;

    const badge = document.getElementById('connectionBadge');
    badge.querySelector('.conn-dot').className = 'conn-dot online';
    badge.querySelector('.conn-text').textContent = name || 'Authenticated';

    const authSection = document.getElementById('authSection');
    authSection.innerHTML = `
        <span style="color:var(--accent);font-size:0.8rem;font-family:var(--font-mono);">${name || 'Operator'}</span>
        <button class="btn btn-sm" onclick="logout()">Logout</button>
    `;
}

function logout() {
    authToken = null;
    sessionStorage.removeItem('lan_scanner_token');
    location.reload();
}

// Check for existing session on load
async function checkSession() {
    const token = sessionStorage.getItem('lan_scanner_token');
    if (!token) return;

    try {
        const res = await fetch(`${API_BASE}/api/auth/verify`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            authToken = token;
            onAuthenticated(data.user?.display_name || 'Operator');
        } else {
            sessionStorage.removeItem('lan_scanner_token');
        }
    } catch {
        // Silently fail — user will need to log in
    }
}

// ============================================================
// SCANNING
// ============================================================

async function startScan() {
    const target = document.getElementById('targetRange').value.trim();
    if (!target) {
        alert('Please enter a target IP range (e.g., 192.168.1.0/24)');
        return;
    }

    const scanType = document.querySelector('input[name="scanType"]:checked').value;

    // Reset UI
    resetResults();
    showProgress();
    elapsedSeconds = 0;
    updateElapsed();
    elapsedInterval = setInterval(() => {
        elapsedSeconds++;
        updateElapsed();
    }, 1000);

    addLog('info', `Initiating ${scanType} scan on ${target}...`);
    addLog('info', 'Sending scan request to server...');

    document.getElementById('scanBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'inline-flex';

    try {
        const res = await fetch(`${API_BASE}/api/lan-scan/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ target, scanType })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Scan request failed');
        }

        currentScanId = data.scanId;
        addLog('success', `Scan started — ID: ${currentScanId}`);
        addLog('info', `Scan profile: ${scanType} | Target: ${target}`);

        // Start polling for results
        pollInterval = setInterval(pollScanStatus, 2000);
    } catch (err) {
        addLog('error', `Failed to start scan: ${err.message}`);
        scanFinished();
    }
}

async function pollScanStatus() {
    if (!currentScanId) return;

    try {
        const res = await fetch(`${API_BASE}/api/lan-scan/status/${currentScanId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Status check failed');
        }

        // Update progress
        updateProgress(data);

        // Process any new log lines
        if (data.logs && data.logs.length > 0) {
            data.logs.forEach(log => addLog(log.level || 'info', log.message));
        }

        // Update live counters
        if (data.partial) {
            document.getElementById('hostsFound').textContent = data.partial.hostsFound || 0;
            document.getElementById('portsFound').textContent = data.partial.portsFound || 0;
            document.getElementById('vulnsFound').textContent = data.partial.vulnsFound || 0;
        }

        // Check if scan is complete
        if (data.status === 'complete') {
            addLog('success', 'Scan complete!');
            scanResults = data.results;
            renderResults(data.results);
            scanFinished();
        } else if (data.status === 'error') {
            addLog('error', `Scan failed: ${data.error}`);
            scanFinished();
        }
    } catch (err) {
        addLog('error', `Connection error: ${err.message}`);
        // Don't stop polling on transient errors
    }
}

async function stopScan() {
    if (!currentScanId) return;

    try {
        await fetch(`${API_BASE}/api/lan-scan/stop/${currentScanId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        addLog('warn', 'Scan aborted by user.');
    } catch {
        addLog('warn', 'Abort signal sent.');
    }

    scanFinished();
}

function scanFinished() {
    clearInterval(pollInterval);
    clearInterval(elapsedInterval);
    pollInterval = null;
    currentScanId = null;
    document.getElementById('scanBtn').style.display = 'inline-flex';
    document.getElementById('stopBtn').style.display = 'none';
}

// ============================================================
// PROGRESS & LOG
// ============================================================

function showProgress() {
    document.getElementById('progressPanel').style.display = 'block';
}

function updateProgress(data) {
    const pct = data.progress || 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPercent').textContent = Math.round(pct) + '%';
    if (data.phase) {
        document.getElementById('progressLabel').textContent = data.phase;
    }
}

function updateElapsed() {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    const text = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    document.getElementById('scanElapsed').textContent = text;
}

function addLog(level, message) {
    const body = document.getElementById('logBody');
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    line.className = `log-line ${level}`;
    line.textContent = `[${time}] ${message}`;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
}

function toggleLog() {
    const body = document.getElementById('logBody');
    const btn = document.querySelector('.log-toggle');
    body.classList.toggle('collapsed');
    btn.classList.toggle('collapsed');
}

// ============================================================
// RESULTS RENDERING
// ============================================================

function renderResults(results) {
    if (!results || !results.hosts || results.hosts.length === 0) {
        addLog('warn', 'No live hosts found in the target range.');
        return;
    }

    const hosts = results.hosts;
    const allVulns = results.vulnerabilities || [];
    const allPorts = [];

    // Collect all ports across hosts
    hosts.forEach(h => {
        (h.ports || []).forEach(p => {
            allPorts.push({ ...p, host: h.ip });
        });
    });

    // Summary
    document.getElementById('summaryPanel').style.display = 'block';
    document.getElementById('summaryHosts').textContent = hosts.length;
    document.getElementById('summaryPorts').textContent = allPorts.length;
    document.getElementById('summaryVulns').textContent = allVulns.length;
    document.getElementById('summaryTime').textContent = document.getElementById('scanElapsed').textContent;

    // Update progress counters too
    document.getElementById('hostsFound').textContent = hosts.length;
    document.getElementById('portsFound').textContent = allPorts.length;
    document.getElementById('vulnsFound').textContent = allVulns.length;

    // Network Map
    renderNetworkMap(hosts, allVulns);

    // Hosts Table
    renderHostsTable(hosts, allVulns);

    // Vulnerabilities
    if (allVulns.length > 0) {
        renderVulnerabilities(allVulns);
    }

    // Port Analysis
    if (allPorts.length > 0) {
        renderPortAnalysis(allPorts);
    }
}

function renderNetworkMap(hosts, vulns) {
    const panel = document.getElementById('networkMapPanel');
    const map = document.getElementById('networkMap');
    panel.style.display = 'block';
    map.innerHTML = '';

    hosts.forEach(host => {
        const hostVulns = vulns.filter(v => v.host === host.ip);
        const maxSev = getMaxSeverity(hostVulns);
        const statusClass = maxSev === 'critical' || maxSev === 'high' ? 'danger' : maxSev === 'medium' ? 'warn' : 'safe';
        const portCount = (host.ports || []).length;

        const node = document.createElement('div');
        node.className = `host-node ${statusClass}`;
        node.onclick = () => scrollToHost(host.ip);
        node.innerHTML = `
            <div class="host-node-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/>
                    <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
            </div>
            <div class="host-node-ip">${host.ip}</div>
            <div class="host-node-name">${host.hostname || 'unknown'}</div>
            <div class="host-node-ports">${portCount} port${portCount !== 1 ? 's' : ''} open</div>
        `;
        map.appendChild(node);
    });
}

function renderHostsTable(hosts, vulns) {
    const panel = document.getElementById('hostsPanel');
    const tbody = document.getElementById('hostsBody');
    panel.style.display = 'block';
    tbody.innerHTML = '';

    hosts.forEach(host => {
        const hostVulns = vulns.filter(v => v.host === host.ip);
        const portCount = (host.ports || []).length;
        const maxSev = getMaxSeverity(hostVulns);
        const portClass = portCount > 10 ? 'many' : portCount > 0 ? 'few' : 'none';

        const tr = document.createElement('tr');
        tr.id = `host-row-${host.ip.replace(/\./g, '-')}`;
        tr.innerHTML = `
            <td><span class="status-dot up"></span>Up</td>
            <td class="ip-cell">${host.ip}</td>
            <td class="hostname-cell">${host.hostname || '—'}</td>
            <td class="os-cell">${host.os || '—'}</td>
            <td><span class="port-count ${portClass}">${portCount}</span></td>
            <td>${hostVulns.length > 0 
                ? `<span class="vuln-badge ${maxSev}">${hostVulns.length} (${maxSev})</span>` 
                : '<span class="vuln-badge none">0</span>'}</td>
            <td><button class="btn btn-details" onclick="toggleHostDetails('${host.ip}')">View</button></td>
        `;
        tbody.appendChild(tr);

        // Hidden details row
        const detailTr = document.createElement('tr');
        detailTr.id = `host-detail-${host.ip.replace(/\./g, '-')}`;
        detailTr.style.display = 'none';
        detailTr.innerHTML = `
            <td colspan="7" style="padding:0;">
                <div style="padding:16px 24px;background:var(--bg-card);border-left:3px solid var(--accent);">
                    <div style="margin-bottom:12px;">
                        <strong style="color:var(--accent);font-size:0.85rem;">Open Ports on ${host.ip}</strong>
                    </div>
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr>
                                <th style="text-align:left;padding:6px 12px;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">Port</th>
                                <th style="text-align:left;padding:6px 12px;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">Protocol</th>
                                <th style="text-align:left;padding:6px 12px;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">Service</th>
                                <th style="text-align:left;padding:6px 12px;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">Version</th>
                                <th style="text-align:left;padding:6px 12px;font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">State</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(host.ports || []).map(p => `
                                <tr>
                                    <td style="padding:6px 12px;font-family:var(--font-mono);color:var(--accent);">${p.port}</td>
                                    <td style="padding:6px 12px;color:var(--text-secondary);">${p.protocol || 'tcp'}</td>
                                    <td style="padding:6px 12px;color:var(--text-primary);">${p.service || 'unknown'}</td>
                                    <td style="padding:6px 12px;color:var(--text-secondary);font-size:0.8rem;">${p.version || '—'}</td>
                                    <td style="padding:6px 12px;color:var(--accent);">${p.state || 'open'}</td>
                                </tr>
                            `).join('')}
                            ${(host.ports || []).length === 0 ? '<tr><td colspan="5" style="padding:12px;color:var(--text-muted);text-align:center;">No open ports found</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </td>
        `;
        tbody.appendChild(detailTr);
    });
}

function toggleHostDetails(ip) {
    const id = `host-detail-${ip.replace(/\./g, '-')}`;
    const row = document.getElementById(id);
    row.style.display = row.style.display === 'none' ? '' : 'none';
}

function scrollToHost(ip) {
    const id = `host-row-${ip.replace(/\./g, '-')}`;
    const row = document.getElementById(id);
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.style.background = 'rgba(0, 229, 160, 0.08)';
        setTimeout(() => row.style.background = '', 2000);
        // Also expand details
        toggleHostDetails(ip);
    }
}

function renderVulnerabilities(vulns) {
    const panel = document.getElementById('vulnsPanel');
    const list = document.getElementById('vulnsList');
    panel.style.display = 'block';
    list.innerHTML = '';

    // Sort by severity
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    vulns.sort((a, b) => (order[a.severity] || 4) - (order[b.severity] || 4));

    vulns.forEach(v => {
        const item = document.createElement('div');
        item.className = `vuln-item ${v.severity}`;
        item.dataset.severity = v.severity;
        item.innerHTML = `
            <span class="vuln-severity ${v.severity}">${v.severity}</span>
            <div class="vuln-content">
                <div class="vuln-title">${v.title}</div>
                <div class="vuln-desc">${v.description}</div>
                <div class="vuln-host">Host: ${v.host}${v.port ? ` : ${v.port}` : ''}</div>
                ${v.remediation ? `<div class="vuln-remediation">💡 ${v.remediation}</div>` : ''}
            </div>
        `;
        list.appendChild(item);
    });
}

function filterVulns(severity) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.filter-btn[data-severity="${severity}"]`).classList.add('active');

    document.querySelectorAll('.vuln-item').forEach(item => {
        item.style.display = (severity === 'all' || item.dataset.severity === severity) ? '' : 'none';
    });
}

function renderPortAnalysis(allPorts) {
    const panel = document.getElementById('portsPanel');
    const grid = document.getElementById('portGrid');
    panel.style.display = 'block';
    grid.innerHTML = '';

    // Group by port number
    const portMap = {};
    allPorts.forEach(p => {
        const key = p.port;
        if (!portMap[key]) {
            portMap[key] = { port: p.port, service: p.service, hosts: [] };
        }
        portMap[key].hosts.push(p.host);
    });

    Object.values(portMap)
        .sort((a, b) => b.hosts.length - a.hosts.length)
        .forEach(p => {
            const card = document.createElement('div');
            card.className = 'port-card';
            card.innerHTML = `
                <div class="port-card-header">
                    <span class="port-number">${p.port}</span>
                    <span class="port-service">${p.service || 'unknown'}</span>
                </div>
                <div class="port-hosts">Found on ${p.hosts.length} host${p.hosts.length !== 1 ? 's' : ''}</div>
                <div class="port-host-list">
                    ${p.hosts.map(h => `<span class="port-host-tag">${h}</span>`).join('')}
                </div>
            `;
            grid.appendChild(card);
        });
}

// ============================================================
// UTILITIES
// ============================================================

function getMaxSeverity(vulns) {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    for (const sev of order) {
        if (vulns.some(v => v.severity === sev)) return sev;
    }
    return 'none';
}

function resetResults() {
    document.getElementById('summaryPanel').style.display = 'none';
    document.getElementById('networkMapPanel').style.display = 'none';
    document.getElementById('hostsPanel').style.display = 'none';
    document.getElementById('vulnsPanel').style.display = 'none';
    document.getElementById('portsPanel').style.display = 'none';
    document.getElementById('hostsBody').innerHTML = '';
    document.getElementById('vulnsList').innerHTML = '';
    document.getElementById('portGrid').innerHTML = '';
    document.getElementById('networkMap').innerHTML = '';
    document.getElementById('logBody').innerHTML = '<div class="log-line init">[*] Waiting for scan to start...</div>';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('hostsFound').textContent = '0';
    document.getElementById('portsFound').textContent = '0';
    document.getElementById('vulnsFound').textContent = '0';
    scanResults = null;
}

function clearResults() {
    resetResults();
    document.getElementById('progressPanel').style.display = 'none';
}

function exportResults() {
    if (!scanResults || !scanResults.hosts) {
        alert('No results to export.');
        return;
    }

    let csv = 'IP Address,Hostname,OS,Port,Protocol,Service,Version,Vulnerabilities\n';

    scanResults.hosts.forEach(host => {
        if (host.ports && host.ports.length > 0) {
            host.ports.forEach(port => {
                const hostVulns = (scanResults.vulnerabilities || [])
                    .filter(v => v.host === host.ip && v.port == port.port)
                    .map(v => `${v.severity}: ${v.title}`)
                    .join(' | ');
                csv += `"${host.ip}","${host.hostname || ''}","${host.os || ''}",${port.port},"${port.protocol || 'tcp'}","${port.service || ''}","${port.version || ''}","${hostVulns}"\n`;
            });
        } else {
            csv += `"${host.ip}","${host.hostname || ''}","${host.os || ''}",,,,,\n`;
        }
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lan-scan-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});
