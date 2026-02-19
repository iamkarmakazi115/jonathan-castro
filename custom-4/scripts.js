/* ============================================================
   SIEM LOG ANALYZER - SCRIPTS
   Jonathan Castro | Custom 4
   
   Handles: JWT auth, file upload, log parsing (multiple formats),
   security detection engine (25+ rules), dashboard rendering,
   charts, alerts, tables, and export.
   ============================================================ */

const API_BASE = 'https://api.jonathan-castro.com';

// ============================================================
// STATE
// ============================================================
const state = {
    token: null,
    rawLogs: [],
    events: [],
    filteredEvents: [],
    currentPage: 1,
    pageSize: 50,
    autoScroll: true,
    sortField: 'timestamp',
    sortDir: 'desc',
    uploadedFiles: []
};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const savedToken = sessionStorage.getItem('siem_token');
    if (savedToken) { state.token = savedToken; showDashboard(); }

    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // File upload
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', e => handleFiles(e.target.files));

    // Filters
    document.getElementById('filterSeverity').addEventListener('change', applyFilters);
    document.getElementById('filterType').addEventListener('change', applyFilters);
    document.getElementById('filterTime').addEventListener('change', applyFilters);
    document.getElementById('filterSearch').addEventListener('input', debounce(applyFilters, 300));

    document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
    document.getElementById('refreshBtn').addEventListener('click', () => { if (state.rawLogs.length > 0) runAnalysis(); });
    document.getElementById('loadDemoBtn').addEventListener('click', loadDemoData);

    document.getElementById('alertAutoScroll').addEventListener('click', e => {
        state.autoScroll = !state.autoScroll;
        e.target.classList.toggle('active', state.autoScroll);
    });

    document.getElementById('exportAlerts').addEventListener('click', exportAlerts);
    document.getElementById('exportLogs').addEventListener('click', exportLogsCSV);
    document.getElementById('prevPage').addEventListener('click', () => changePage(-1));
    document.getElementById('nextPage').addEventListener('click', () => changePage(1));

    document.querySelectorAll('.log-table thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => handleSort(th.dataset.sort));
    });

    document.querySelectorAll('[data-chart-range]').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('[data-chart-range]').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderTimeline(e.target.dataset.chartRange);
        });
    });

    updateClock();
    setInterval(updateClock, 1000);
});

// ============================================================
// AUTHENTICATION
// ============================================================
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');
    const btnText = document.querySelector('.btn-text');
    const btnLoader = document.querySelector('.btn-loader');

    errorEl.style.display = 'none';
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline-block';

    try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok && data.token) {
            state.token = data.token;
            sessionStorage.setItem('siem_token', data.token);
            showDashboard();
        } else {
            errorEl.textContent = data.error || 'Invalid credentials';
            errorEl.style.display = 'block';
        }
    } catch (err) {
        errorEl.textContent = 'Connection failed. Check server status.';
        errorEl.style.display = 'block';
    } finally {
        btnText.style.display = 'inline';
        btnLoader.style.display = 'none';
    }
}

function handleLogout() {
    state.token = null;
    sessionStorage.removeItem('siem_token');
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
}

function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
}

// ============================================================
// FILE HANDLING & PARSING
// ============================================================
async function handleFiles(files) {
    if (!files || files.length === 0) return;
    const progressEl = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const uploadContent = document.querySelector('.upload-content');

    progressEl.style.display = 'block';
    uploadContent.style.opacity = '0.5';
    let totalParsed = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        progressText.textContent = `Parsing ${file.name} (${i + 1}/${files.length})...`;
        progressFill.style.width = `${((i) / files.length) * 100}%`;
        try {
            const content = await readFile(file);
            const parsed = parseLogFile(content, file.name);
            state.rawLogs.push(...parsed);
            totalParsed += parsed.length;
            state.uploadedFiles.push(file.name);
        } catch (err) { console.error(`Error parsing ${file.name}:`, err); }
        progressFill.style.width = `${((i + 1) / files.length) * 100}%`;
    }

    progressText.textContent = `✓ Parsed ${totalParsed.toLocaleString()} log entries from ${files.length} file(s)`;
    progressFill.style.width = '100%';
    uploadContent.style.opacity = '1';
    document.getElementById('analyzeBtn').disabled = false;
    setTimeout(() => runAnalysis(), 500);
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

function parseLogFile(content, filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const lines = content.split('\n').filter(l => l.trim());
    if (ext === 'json' || content.trim().startsWith('[') || content.trim().startsWith('{')) return parseJSON(content, filename);
    if (ext === 'csv') return parseCSV(content, filename);
    return parseGenericLog(lines, filename);
}

function parseJSON(content, filename) {
    try {
        let data = JSON.parse(content);
        if (!Array.isArray(data)) data = [data];
        return data.map((entry, i) => normalizeLogEntry(entry, filename, i));
    } catch {
        const entries = [];
        content.split('\n').forEach((line, i) => {
            try { if (line.trim()) entries.push(normalizeLogEntry(JSON.parse(line), filename, i)); } catch {}
        });
        return entries;
    }
}

function parseCSV(content, filename) {
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
    const entries = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === headers.length) {
            const obj = {};
            headers.forEach((h, idx) => obj[h] = values[idx]);
            entries.push(normalizeLogEntry(obj, filename, i));
        }
    }
    return entries;
}

function parseCSVLine(line) {
    const values = []; let current = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuotes = !inQuotes;
        else if (line[i] === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
        else current += line[i];
    }
    values.push(current.trim());
    return values;
}

function parseGenericLog(lines, filename) {
    const entries = [];
    for (let i = 0; i < lines.length; i++) {
        const entry = parseLogLine(lines[i], filename, i);
        if (entry) entries.push(entry);
    }
    return entries;
}

function parseLogLine(line, filename, lineNum) {
    // Syslog: Month Day HH:MM:SS hostname process[pid]: message
    let m = line.match(/^(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s*(.+)$/);
    if (m) return { timestamp: parseSyslogDate(m[1]), hostname: m[2], process: m[3], pid: m[4]||'', message: m[5], source_ip: extractIP(m[5]), username: extractUsername(m[5]), raw: line, file: filename, line: lineNum };

    // ISO timestamp
    m = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[\.\d]*Z?)\s+(.+)$/);
    if (m) return { timestamp: new Date(m[1]), message: m[2], source_ip: extractIP(m[2]), username: extractUsername(m[2]), raw: line, file: filename, line: lineNum };

    // Windows Event Log CSV
    m = line.match(/^(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s*,?\s*(.+)$/i);
    if (m) return { timestamp: new Date(m[1]), message: m[2], source_ip: extractIP(m[2]), username: extractUsername(m[2]), raw: line, file: filename, line: lineNum };

    // Firewall log
    m = line.match(/(ALLOW|DENY|DROP|REJECT|BLOCK|ACCEPT|LOG)/i);
    if (m) {
        const src = line.match(/SRC=(\d+\.\d+\.\d+\.\d+)/);
        const dst = line.match(/DST=(\d+\.\d+\.\d+\.\d+)/);
        const proto = line.match(/PROTO=(\w+)/);
        const dpt = line.match(/DPT=(\d+)/);
        return { timestamp: extractTimestamp(line)||new Date(), message: line, source_ip: src?src[1]:extractIP(line), dest_ip: dst?dst[1]:'', protocol: proto?proto[1]:'', dest_port: dpt?dpt[1]:'', action: m[1].toUpperCase(), raw: line, file: filename, line: lineNum };
    }

    // Fallback
    if (line.trim().length > 5) return { timestamp: extractTimestamp(line)||new Date(), message: line, source_ip: extractIP(line), username: extractUsername(line), raw: line, file: filename, line: lineNum };
    return null;
}

function normalizeLogEntry(obj, filename, lineNum) {
    return {
        timestamp: new Date(obj.timestamp||obj.date||obj.time||obj['@timestamp']||obj.eventtime||Date.now()),
        hostname: obj.hostname||obj.host||obj.computer||obj.source||'',
        process: obj.process||obj.program||obj.service||obj.source_name||'',
        pid: obj.pid||obj.process_id||'',
        message: obj.message||obj.msg||obj.description||obj.event||obj.data||JSON.stringify(obj),
        source_ip: obj.source_ip||obj.src_ip||obj.src||obj.ip||obj.remote_addr||extractIP(obj.message||''),
        dest_ip: obj.dest_ip||obj.dst_ip||obj.dst||'',
        dest_port: obj.dest_port||obj.dst_port||obj.dport||'',
        protocol: obj.protocol||obj.proto||'',
        username: obj.username||obj.user||obj.account||obj.account_name||extractUsername(obj.message||''),
        event_id: obj.event_id||obj.eventid||obj.id||'',
        action: obj.action||obj.status||'',
        raw: JSON.stringify(obj), file: filename, line: lineNum
    };
}

// ============================================================
// FIELD EXTRACTORS
// ============================================================
function extractIP(str) { if (!str) return ''; const m = str.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/); return m?m[1]:''; }

function extractUsername(str) {
    if (!str) return '';
    let m = str.match(/(?:user|username|account|login|for)\s*[=:]\s*['"]?(\S+?)['"]?(?:\s|,|$)/i);
    if (m) return m[1];
    m = str.match(/(?:user|account)\s+['"]?(\w+)['"]?/i);
    return m?m[1]:'';
}

function extractTimestamp(str) {
    for (const p of [/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/, /(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})/, /(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/]) {
        const m = str.match(p);
        if (m) { const d = new Date(m[1]); if (!isNaN(d)) return d; }
    }
    return null;
}

function parseSyslogDate(str) { const d = new Date(str + ' ' + new Date().getFullYear()); return isNaN(d) ? new Date() : d; }

// ============================================================
// SECURITY DETECTION ENGINE
// ============================================================
function runAnalysis() {
    if (state.rawLogs.length === 0) return;
    state.events = [];

    detectByPatterns(
        [/failed\s+(password|login|auth)/i, /authentication\s+fail/i, /invalid\s+(user|password|credentials)/i, /login\s+failed/i, /access\s+denied/i, /incorrect\s+password/i, /pam_unix.*authentication\s+failure/i, /event_?id[=:]\s*4625/i],
        'failed_login', 'medium', 'Failed Login Attempt',
        log => `Failed login${log.username?' for '+log.username:''}${log.source_ip?' from '+log.source_ip:''}`
    );

    detectBruteForce();

    detectByPatterns(
        [/privilege\s+escalat/i, /sudo.*COMMAND/, /su\s*:\s*.*\broot\b/, /changed\s+(role|group|privilege)/i, /added\s+to\s+(admin|root|sudo|wheel)/i, /event_?id[=:]\s*(4672|4728|4732|4756)/i, /special\s+privileges\s+assigned/i, /usermod.*-aG.*(sudo|root|admin|wheel)/i, /chmod\s+[u+]*s/i, /setuid|setgid/i],
        'privilege_escalation', 'critical', 'Privilege Escalation',
        log => `Privilege escalation activity${log.username?' by '+log.username:''}${log.source_ip?' from '+log.source_ip:''}`
    );

    detectPortScans();

    detectByPatterns(
        [/unusual\s+traffic/i, /anomal(y|ous)/i, /suspicious\s+(connection|traffic|activity)/i, /large\s+(data|transfer|upload)/i, /after\s+hours\s+access/i],
        'unusual_traffic', 'medium', 'Unusual Traffic Pattern',
        log => `Unusual traffic: ${log.message.substring(0, 100)}`
    );

    detectSuspiciousPorts();

    detectByPatterns(
        [/malware|virus|trojan|worm|ransomware|backdoor|rootkit|keylogger/i, /c2\s*(server|beacon|callback)/i, /command\s*and\s*control/i, /phishing/i, /suspicious\s*(file|executable|binary|script|download)/i, /powershell.*-enc|-encodedcommand/i, /base64.*exec|eval.*base64/i, /reverse\s*shell/i, /meterpreter|mimikatz|cobalt\s*strike/i],
        'malware_indicator', 'critical', 'Malware Indicator',
        log => `Potential malware indicator: ${log.message.substring(0, 120)}`
    );

    detectByPatterns(
        [/policy\s+violat/i, /unauthorized\s+(access|user|connection|device)/i, /compliance\s+(fail|violat|breach)/i, /forbidden/i, /blocked\s+by\s+policy/i, /firewall.*denied/i, /ACL\s+denied/i, /cleartext\s+password/i, /unencrypted/i],
        'policy_violation', 'medium', 'Policy Violation',
        log => `Policy violation: ${log.message.substring(0, 120)}`
    );

    detectByPatterns(
        [/exfiltrat/i, /data\s*(leak|breach|loss|theft)/i, /large\s+(?:file\s+)?(?:upload|transfer|copy)/i, /USB\s+(?:device|storage|drive)/i, /removable\s+media/i, /(?:upload|transfer).*(?:external|outside|cloud)/i, /bulk\s+download/i],
        'data_exfiltration', 'critical', 'Potential Data Exfiltration',
        log => `Data exfiltration indicator: ${log.message.substring(0, 120)}`
    );

    detectByPatterns(
        [/account\s*(locked|lockout|disabled)/i, /too\s+many\s+(failed|login|auth)/i, /event_?id[=:]\s*4740/i, /maximum\s+.*attempts/i, /temporarily\s+locked/i],
        'account_lockout', 'high', 'Account Lockout',
        log => `Account lockout${log.username?' for '+log.username:''}`
    );

    detectByPatterns(
        [/service\s*(stopped|crashed|failed|terminated|killed)/i, /segfault|segmentation\s+fault/i, /out\s+of\s+memory|OOM/i, /disk\s+(full|space)/i, /critical\s+error/i, /kernel\s+panic/i, /(?:daemon|process)\s+(?:died|crashed)/i],
        'service_anomaly', 'high', 'Service Anomaly',
        log => `Service anomaly: ${log.message.substring(0, 120)}`
    );

    detectByPatterns(
        [/(?:logged\s+in|session\s+opened).*\broot\b/i, /root\s+login/i, /administrator\s+login/i],
        'privilege_escalation', 'high', 'Root/Admin Access',
        log => `Root/admin access${log.source_ip?' from '+log.source_ip:''}`
    );

    detectByPatterns(
        [/ssh.*accepted\s+password.*root/i, /reverse\s+mapping.*POSSIBLE\s+BREAK/i, /Did\s+not\s+receive\s+identification/i, /Bad\s+protocol\s+version/i, /Connection\s+closed\s+by.*preauth/i],
        'unusual_traffic', 'high', 'SSH Anomaly',
        log => `SSH anomaly: ${log.message.substring(0, 120)}`
    );

    detectByPatterns(
        [/(?:union\s+select|select\s+.*from|drop\s+table|insert\s+into|delete\s+from)/i, /(?:or\s+1\s*=\s*1|'\s*or\s*'|"\s*or\s*")/i, /(?:exec\s*\(|execute\s+|xp_cmdshell)/i, /sql\s*injection/i],
        'malware_indicator', 'critical', 'SQL Injection Attempt',
        log => `SQL injection attempt${log.source_ip?' from '+log.source_ip:''}`
    );

    detectByPatterns(
        [/<script[\s>]/i, /javascript\s*:/i, /on(?:error|load|click|mouseover)\s*=/i, /document\.cookie/i],
        'malware_indicator', 'high', 'XSS Attempt',
        log => `Cross-site scripting attempt${log.source_ip?' from '+log.source_ip:''}`
    );

    detectByPatterns(
        [/\.\.\//i, /\.\.\\|\.\.\%5c/i, /\/etc\/passwd|\/etc\/shadow/i, /\/proc\/self/i, /%2e%2e/i],
        'malware_indicator', 'high', 'Directory Traversal Attempt',
        log => `Directory traversal attempt${log.source_ip?' from '+log.source_ip:''}`
    );

    detectByPatterns(
        [/dns\s*(?:tunnel|exfil|anomal)/i, /(?:query|lookup).*(?:suspicious|malicious)/i, /dns.*(?:amplification|flood)/i],
        'unusual_traffic', 'medium', 'DNS Anomaly',
        log => `DNS anomaly: ${log.message.substring(0, 120)}`
    );

    state.events.sort((a, b) => b.timestamp - a.timestamp);
    applyFilters();
    renderSummaryCards();
    renderTimeline('24h');
    renderSourceIPs();
    renderRules();
    renderBreakdown();

    const btn = document.getElementById('analyzeBtn');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Re-Analyze (${state.rawLogs.length.toLocaleString()})`;
}

// Generic pattern-based detection helper
function detectByPatterns(patterns, type, severity, rule, descFn) {
    state.rawLogs.forEach(log => {
        for (const p of patterns) {
            if (p.test(log.message || '')) {
                state.events.push({ ...log, type, severity, rule, description: descFn(log) });
                break;
            }
        }
    });
}

// Brute force detection (clustered failed logins)
function detectBruteForce() {
    const failedByIP = {};
    state.rawLogs.forEach(log => {
        if (/failed|invalid|denied|incorrect|bad.*password|authentication.*fail/i.test(log.message) && log.source_ip) {
            if (!failedByIP[log.source_ip]) failedByIP[log.source_ip] = [];
            failedByIP[log.source_ip].push(log);
        }
    });
    Object.entries(failedByIP).forEach(([ip, logs]) => {
        if (logs.length >= 5) {
            logs.sort((a, b) => a.timestamp - b.timestamp);
            for (let i = 0; i <= logs.length - 5; i++) {
                const window = logs[i + 4].timestamp - logs[i].timestamp;
                if (window <= 600000) {
                    state.events.push({
                        timestamp: logs[i].timestamp, source_ip: ip, type: 'brute_force', severity: 'critical',
                        rule: 'Brute Force Attack', username: logs[i].username,
                        description: `${logs.length} failed login attempts from ${ip} within ${Math.round(window/60000)} minutes`,
                        message: `Brute force: ${logs.length} failures from ${ip}`, raw: logs[i].raw, file: logs[i].file
                    });
                    break;
                }
            }
        }
    });
}

// Port scan detection
function detectPortScans() {
    const portsByIP = {};
    state.rawLogs.forEach(log => {
        if (log.dest_port && log.source_ip) {
            if (!portsByIP[log.source_ip]) portsByIP[log.source_ip] = new Set();
            portsByIP[log.source_ip].add(log.dest_port);
        }
    });
    Object.entries(portsByIP).forEach(([ip, ports]) => {
        if (ports.size >= 10) {
            state.events.push({
                timestamp: new Date(), source_ip: ip, type: 'port_scan', severity: 'high',
                rule: 'Port Scan Detected',
                description: `${ip} scanned ${ports.size} unique ports`,
                message: `Port scan: ${ip} hit ports ${[...ports].slice(0,10).join(', ')}${ports.size>10?'...':''}`,
                raw: '', file: ''
            });
        }
    });
}

// Suspicious port detection
function detectSuspiciousPorts() {
    const suspPorts = new Set(['4444','5555','6666','1337','31337','8888','9999','12345','3389','5900','5901','4443','2222']);
    state.rawLogs.forEach(log => {
        if (log.dest_port && suspPorts.has(log.dest_port)) {
            state.events.push({
                ...log, type: 'unusual_traffic', severity: 'high', rule: 'Suspicious Port Activity',
                description: `Traffic on suspicious port ${log.dest_port}${log.source_ip?' from '+log.source_ip:''}`
            });
        }
    });
}

// ============================================================
// FILTERS
// ============================================================
function applyFilters() {
    const severity = document.getElementById('filterSeverity').value;
    const type = document.getElementById('filterType').value;
    const timeRange = document.getElementById('filterTime').value;
    const search = document.getElementById('filterSearch').value.toLowerCase();

    let filtered = [...state.events];
    if (severity !== 'all') filtered = filtered.filter(e => e.severity === severity);
    if (type !== 'all') filtered = filtered.filter(e => e.type === type);
    if (timeRange !== 'all') {
        const now = Date.now();
        const ms = { '1h':3600000, '6h':21600000, '24h':86400000, '7d':604800000, '30d':2592000000 };
        const cutoff = now - (ms[timeRange]||0);
        filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= cutoff);
    }
    if (search) {
        filtered = filtered.filter(e =>
            (e.source_ip||'').includes(search) || (e.username||'').toLowerCase().includes(search) ||
            (e.message||'').toLowerCase().includes(search) || (e.description||'').toLowerCase().includes(search) ||
            String(e.event_id||'').includes(search)
        );
    }

    filtered.sort((a, b) => {
        let aV = a[state.sortField]||'', bV = b[state.sortField]||'';
        if (state.sortField === 'timestamp') { aV = new Date(aV).getTime(); bV = new Date(bV).getTime(); }
        if (typeof aV === 'string') { aV = aV.toLowerCase(); bV = bV.toLowerCase(); }
        return state.sortDir === 'asc' ? (aV>bV?1:-1) : (aV<bV?1:-1);
    });

    state.filteredEvents = filtered;
    state.currentPage = 1;
    renderAlertFeed();
    renderLogTable();
}

// ============================================================
// RENDERING
// ============================================================
function renderSummaryCards() {
    const counts = { critical:0, high:0, medium:0, low:0 };
    state.events.forEach(e => { if (counts[e.severity] !== undefined) counts[e.severity]++; });
    document.getElementById('criticalCount').textContent = counts.critical;
    document.getElementById('highCount').textContent = counts.high;
    document.getElementById('mediumCount').textContent = counts.medium;
    document.getElementById('lowCount').textContent = counts.low;
    document.getElementById('totalEvents').textContent = state.rawLogs.length.toLocaleString();
}

function renderTimeline(range) {
    const container = document.getElementById('timelineChart');
    if (state.events.length === 0) { container.innerHTML = '<div class="chart-placeholder">Upload logs to view timeline</div>'; return; }

    const now = Date.now();
    const dur = { '1h':3600000, '24h':86400000, '7d':604800000 }[range] || 86400000;
    const bucketCount = range==='1h'?12 : range==='24h'?24 : 28;
    const bucketSize = dur / bucketCount;
    const buckets = Array.from({length:bucketCount}, ()=>({critical:0,high:0,medium:0,low:0,total:0}));

    state.events.forEach(e => {
        const age = now - new Date(e.timestamp).getTime();
        if (age >= 0 && age <= dur) {
            const idx = Math.min(bucketCount-1, Math.floor((dur-age)/bucketSize));
            if (buckets[idx]) { buckets[idx][e.severity]++; buckets[idx].total++; }
        }
    });

    const maxT = Math.max(1, ...buckets.map(b=>b.total));
    const barsHTML = buckets.map((b, i) => {
        const h = Math.max(4, (b.total/maxT)*200);
        const color = b.critical>0?'var(--critical)':b.high>0?'var(--high)':b.medium>0?'var(--medium)':b.total>0?'var(--low)':'var(--border-color)';
        const time = new Date(now-dur+(i*bucketSize));
        const label = time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        return `<div class="timeline-bar" style="height:${h}px;background:${color}"><div class="bar-tooltip">${label}<br>C:${b.critical} H:${b.high} M:${b.medium} L:${b.low}</div></div>`;
    }).join('');

    const startLabel = new Date(now-dur).toLocaleDateString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    container.innerHTML = `<div class="timeline-bars">${barsHTML}</div><div class="timeline-labels"><span>${startLabel}</span><span>Now</span></div>`;
}

function renderSourceIPs() {
    const container = document.getElementById('sourceList');
    const ipCounts = {};
    state.events.forEach(e => { if (e.source_ip) ipCounts[e.source_ip] = (ipCounts[e.source_ip]||0)+1; });
    const sorted = Object.entries(ipCounts).sort((a,b)=>b[1]-a[1]).slice(0,15);
    document.getElementById('uniqueIPs').textContent = `${Object.keys(ipCounts).length} unique`;

    if (sorted.length === 0) { container.innerHTML = '<div class="chart-placeholder">No source IPs detected</div>'; return; }
    const maxC = sorted[0][1];
    container.innerHTML = sorted.map(([ip,count],i)=>`
        <div class="source-item"><span class="source-rank">${i+1}</span><span class="source-ip">${ip}</span><span class="source-count">${count}</span>
        <div class="source-bar-bg"><div class="source-bar-fill" style="width:${(count/maxC)*100}%"></div></div></div>
    `).join('');
}

function renderAlertFeed() {
    const container = document.getElementById('alertFeed');
    const events = state.filteredEvents.slice(0, 100);
    if (events.length === 0) { container.innerHTML = '<div class="chart-placeholder">No alerts matching filters</div>'; return; }
    container.innerHTML = events.map(e=>`
        <div class="alert-item severity-${e.severity}"><span class="alert-time">${formatTime(e.timestamp)}</span>
        <div class="alert-content"><div class="alert-type">${(e.rule||e.type).replace(/_/g,' ')}</div>
        <div class="alert-msg">${escapeHTML(e.description||e.message).substring(0,200)}</div></div>
        <span class="alert-severity sev-${e.severity}">${e.severity}</span></div>
    `).join('');
    if (state.autoScroll) container.scrollTop = 0;
}

function renderRules() {
    const container = document.getElementById('rulesList');
    const rc = {};
    state.events.forEach(e => { const r = e.rule||e.type; rc[r]=(rc[r]||0)+1; });
    const sorted = Object.entries(rc).sort((a,b)=>b[1]-a[1]);
    if (sorted.length === 0) { container.innerHTML = '<div class="chart-placeholder">No detections yet</div>'; return; }
    container.innerHTML = sorted.map(([rule,count])=>`<div class="rule-item"><span class="rule-name">${rule}</span><span class="rule-count">${count}</span></div>`).join('');
}

function renderBreakdown() {
    const container = document.getElementById('breakdownChart');
    const tc = {};
    state.events.forEach(e => { const l = (e.type||'unknown').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); tc[l]=(tc[l]||0)+1; });
    const sorted = Object.entries(tc).sort((a,b)=>b[1]-a[1]).slice(0,10);
    if (sorted.length === 0) { container.innerHTML = '<div class="chart-placeholder">Upload logs to view breakdown</div>'; return; }
    const maxC = Math.max(1, sorted[0][1]);
    const colors = ['var(--critical)','var(--high)','var(--medium)','var(--page-accent)','var(--low)','var(--info)','#9b59b6','#2ecc71','#e67e22','#3498db'];
    container.innerHTML = `<div class="breakdown-items">${sorted.map(([type,count],i)=>`
        <div class="breakdown-item"><div class="breakdown-label"><span>${type}</span><span>${count}</span></div>
        <div class="breakdown-bar-bg"><div class="breakdown-bar-fill" style="width:${(count/maxC)*100}%;background:${colors[i%colors.length]}"></div></div></div>
    `).join('')}</div>`;
}

function renderLogTable() {
    const tbody = document.getElementById('logTableBody');
    const emptyEl = document.getElementById('tableEmpty');
    const total = state.filteredEvents.length;
    const start = (state.currentPage-1)*state.pageSize;
    const end = Math.min(start+state.pageSize, total);
    const page = state.filteredEvents.slice(start, end);

    document.getElementById('logCount').textContent = `${total.toLocaleString()} entries`;
    if (page.length === 0) {
        tbody.innerHTML = ''; emptyEl.style.display = 'block';
        document.getElementById('prevPage').disabled = true;
        document.getElementById('nextPage').disabled = true;
        document.getElementById('pageInfo').textContent = 'Page 0'; return;
    }
    emptyEl.style.display = 'none';
    tbody.innerHTML = page.map(e=>`<tr>
        <td>${formatTimestamp(e.timestamp)}</td>
        <td><span class="sev-badge sev-${e.severity}">${e.severity}</span></td>
        <td>${(e.type||'').replace(/_/g,' ')}</td>
        <td>${escapeHTML(e.source_ip||'-')}</td>
        <td>${escapeHTML(e.username||'-')}</td>
        <td title="${escapeHTML(e.description||e.message)}">${escapeHTML((e.description||e.message||'').substring(0,120))}</td>
    </tr>`).join('');

    const totalPages = Math.ceil(total/state.pageSize);
    document.getElementById('pageInfo').textContent = `Page ${state.currentPage} of ${totalPages}`;
    document.getElementById('prevPage').disabled = state.currentPage <= 1;
    document.getElementById('nextPage').disabled = state.currentPage >= totalPages;
}

// ============================================================
// DEMO DATA GENERATOR
// ============================================================
function loadDemoData() {
    const logs = [];
    const now = Date.now();
    const ips = ['192.168.1.105','10.0.0.200','172.16.0.50','203.0.113.42','198.51.100.17','45.33.32.156','185.220.101.1','91.134.10.45'];
    const users = ['admin','root','jcastro','svc_backup','guest','test','administrator','www-data'];
    const hosts = ['web-srv-01','db-srv-02','fw-01','mail-srv-01','dc-01','jonathan-castrodb'];

    // Brute force cluster
    for (let i = 0; i < 25; i++) {
        const t = new Date(now - Math.random()*600000);
        logs.push({ timestamp:t, hostname:hosts[5], process:'sshd', pid:'12345', message:`Failed password for ${users[i%3]} from ${ips[0]} port ${50000+i} ssh2`, source_ip:ips[0], username:users[i%3], raw:`sshd: Failed password from ${ips[0]}`, file:'demo-auth.log', line:i });
    }

    // Scattered failed logins
    for (let i = 0; i < 40; i++) {
        const t = new Date(now - Math.random()*86400000);
        const ip = ips[Math.floor(Math.random()*ips.length)], u = users[Math.floor(Math.random()*users.length)];
        logs.push({ timestamp:t, hostname:hosts[Math.floor(Math.random()*hosts.length)], process:'sshd', message:`Failed password for invalid user ${u} from ${ip} port ${40000+Math.floor(Math.random()*10000)} ssh2`, source_ip:ip, username:u, raw:`Failed password for ${u} from ${ip}`, file:'demo-auth.log', line:25+i });
    }

    // Privilege escalation
    [3600000, 7200000, 18000000].forEach((offset, i) => {
        const t = new Date(now - offset);
        logs.push({ timestamp:t, hostname:hosts[5], process:'sudo', message:`jcastro : TTY=pts/0 ; PWD=/home/jcastro ; USER=root ; COMMAND=/bin/bash`, source_ip:'192.168.0.50', username:'jcastro', raw:`sudo: jcastro -> root`, file:'demo-auth.log', line:70+i });
    });
    logs.push({ timestamp:new Date(now-5400000), hostname:hosts[5], process:'usermod', message:`usermod: user svc_backup added to group sudo by root`, source_ip:'', username:'root', raw:`usermod added to sudo`, file:'demo-auth.log', line:75 });

    // Port scan
    for (let p = 1; p <= 30; p++) {
        const t = new Date(now - 1800000 + p*100);
        logs.push({ timestamp:t, hostname:hosts[2], process:'kernel', message:`DROP IN=eth0 OUT= SRC=${ips[3]} DST=192.168.0.50 PROTO=TCP SPT=45678 DPT=${p*100}`, source_ip:ips[3], dest_ip:'192.168.0.50', dest_port:String(p*100), protocol:'TCP', action:'DROP', raw:`DROP from ${ips[3]}`, file:'demo-firewall.log', line:p });
    }

    // Suspicious ports
    ['4444','1337','31337','5555'].forEach((port, i) => {
        const t = new Date(now - 43200000 + i*3600000);
        logs.push({ timestamp:t, hostname:hosts[2], process:'kernel', message:`ALLOW IN=eth0 OUT=eth1 SRC=${ips[4]} DST=10.0.0.5 PROTO=TCP SPT=54321 DPT=${port}`, source_ip:ips[4], dest_ip:'10.0.0.5', dest_port:port, protocol:'TCP', action:'ALLOW', raw:`ALLOW suspicious port ${port}`, file:'demo-firewall.log', line:40+i });
    });

    // Malware indicators
    logs.push({ timestamp:new Date(now-10800000), hostname:hosts[0], process:'apache2', message:`powershell -encodedcommand detected from ${ips[6]}`, source_ip:ips[6], raw:'powershell encoded', file:'demo-syslog.log', line:100 });
    logs.push({ timestamp:new Date(now-9000000), hostname:hosts[0], process:'apache2', message:`suspicious file upload detected: reverse shell payload from ${ips[7]}`, source_ip:ips[7], raw:'reverse shell', file:'demo-syslog.log', line:101 });

    // SQL injection & XSS
    logs.push({ timestamp:new Date(now-7200000), hostname:hosts[0], process:'apache2', message:`GET /login?user=admin' OR 1=1 -- from ${ips[5]}`, source_ip:ips[5], raw:'sqli attempt', file:'demo-syslog.log', line:102 });
    logs.push({ timestamp:new Date(now-7100000), hostname:hosts[0], process:'apache2', message:`GET /products?id=1 UNION SELECT username,password FROM users from ${ips[5]}`, source_ip:ips[5], raw:'sqli union', file:'demo-syslog.log', line:103 });
    logs.push({ timestamp:new Date(now-6500000), hostname:hosts[0], process:'apache2', message:`POST /comments body contained <script>document.cookie</script> from ${ips[5]}`, source_ip:ips[5], raw:'xss attempt', file:'demo-syslog.log', line:104 });
    logs.push({ timestamp:new Date(now-6000000), hostname:hosts[0], process:'apache2', message:`GET /../../etc/passwd from ${ips[5]}`, source_ip:ips[5], raw:'dir traversal', file:'demo-syslog.log', line:105 });

    // Account lockout
    logs.push({ timestamp:new Date(now-2400000), hostname:hosts[4], process:'security', message:`Account lockout: user admin - too many failed authentication attempts from ${ips[0]}`, source_ip:ips[0], username:'admin', raw:'account locked', file:'demo-syslog.log', line:110 });

    // Service anomalies
    logs.push({ timestamp:new Date(now-14400000), hostname:hosts[1], process:'mysqld', message:`Service stopped unexpectedly - segmentation fault in thread 42`, raw:'mysqld segfault', file:'demo-syslog.log', line:115 });
    logs.push({ timestamp:new Date(now-28800000), hostname:hosts[0], process:'kernel', message:`Out of memory: Killed process 8734 (apache2) total-vm:2048000kB`, raw:'OOM killed apache2', file:'demo-syslog.log', line:116 });

    // Data exfiltration
    logs.push({ timestamp:new Date(now-4800000), hostname:hosts[1], process:'audit', message:`Large file upload detected: user svc_backup transferred 2.4GB to external cloud storage`, username:'svc_backup', raw:'large upload exfil', file:'demo-syslog.log', line:120 });

    // Normal noise
    const normalMsgs = ['Session opened for user jcastro','CRON job executed: /usr/local/bin/backup.sh','Received SIGHUP; restarting','Connection from 192.168.0.10 accepted','Successful login for user jcastro from 192.168.0.10','Package nginx updated to version 1.24.0-1','SSL certificate renewed successfully','Firewall rule updated: ALLOW 80/tcp','System backup completed successfully','DNS resolution successful','NTP synchronized','Disk usage at 45%','Memory usage: 62%','Load average: 0.32, 0.28, 0.25'];
    for (let i = 0; i < 200; i++) {
        const t = new Date(now - Math.random()*86400000);
        logs.push({ timestamp:t, hostname:hosts[Math.floor(Math.random()*hosts.length)], process:['sshd','cron','systemd','nginx','kernel','apt'][Math.floor(Math.random()*6)], message:normalMsgs[Math.floor(Math.random()*normalMsgs.length)], source_ip:['192.168.0.10','192.168.0.1','10.0.0.1'][Math.floor(Math.random()*3)], raw:`Normal log ${i}`, file:'demo-syslog.log', line:200+i });
    }

    state.rawLogs = logs;
    state.uploadedFiles = ['demo-syslog.log','demo-auth.log','demo-firewall.log'];
    document.getElementById('analyzeBtn').disabled = false;
    document.getElementById('uploadProgress').style.display = 'block';
    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('progressText').textContent = `✓ Loaded ${logs.length} demo log entries`;
    setTimeout(() => runAnalysis(), 300);
}

// ============================================================
// EXPORT
// ============================================================
function exportAlerts() {
    const csv = ['Timestamp,Severity,Type,Rule,Source IP,Username,Description',
        ...state.filteredEvents.map(e=>`"${formatTimestamp(e.timestamp)}","${e.severity}","${e.type}","${e.rule||''}","${e.source_ip||''}","${e.username||''}","${(e.description||'').replace(/"/g,'""')}"`)
    ].join('\n');
    downloadFile(csv, 'siem-alerts.csv', 'text/csv');
}

function exportLogsCSV() {
    const csv = ['Timestamp,Severity,Type,Source IP,Username,Message',
        ...state.filteredEvents.map(e=>`"${formatTimestamp(e.timestamp)}","${e.severity}","${e.type}","${e.source_ip||''}","${e.username||''}","${(e.message||'').replace(/"/g,'""').substring(0,500)}"`)
    ].join('\n');
    downloadFile(csv, 'siem-log-export.csv', 'text/csv');
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

// ============================================================
// UTILITIES
// ============================================================
function formatTime(ts) { return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function formatTimestamp(ts) { return new Date(ts).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}); }

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str||'';
    return div.innerHTML;
}

function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); }; }

function changePage(dir) {
    const totalPages = Math.ceil(state.filteredEvents.length / state.pageSize);
    state.currentPage = Math.max(1, Math.min(totalPages, state.currentPage + dir));
    renderLogTable();
}

function handleSort(field) {
    if (state.sortField === field) { state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; }
    else { state.sortField = field; state.sortDir = 'desc'; }
    applyFilters();
}

function updateClock() {
    const el = document.getElementById('dashTime');
    if (el) el.textContent = new Date().toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
