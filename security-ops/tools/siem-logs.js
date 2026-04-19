/* ============================================================
   SIEM LOG ANALYZER - SOCTools Module
   Jonathan Castro | Security Operations Center

   Ported from old custom-4 (357 HTML / 785 JS).
   IIFE-wrapped, uses data-siem-* attributes only (no IDs),
   all DOM queries scoped to panelEl, single delegated click
   listener. Mirrors the module pattern from lan-discovery.js,
   vuln-scan.js, and net-traffic.js.

   Auth: reuses SOCState.auth.token (Q1 option A). Inline
         overlay shown when not authenticated.
   Sources: file upload (drag/drop + picker) + demo data +
         re-analyze button (Q2 option A).
   Display: 50/page, all 6 time filters, 6-col table (Q3).
   Correlation: banner at top when correlation:found fires
         (Q4 option A), with link to filter table to those IPs.

   Publishes: SOCState.addSIEMEvent({severity,type,source,
              srcIp,message,timestamp}) per parsed event,
              dedup via publishedEventKeys Set.
   ============================================================ */
(function () {
    'use strict';

    // ---------- CONFIG ----------
    const API_BASE = 'https://api.jonathan-castro.com';
    const PAGE_SIZE = 50;
    const ALERT_FEED_CAP = 100;
    const TOP_SOURCE_IPS = 15;
    const TOP_BREAKDOWN = 10;
    const SEARCH_DEBOUNCE_MS = 300;
    const BRUTE_FORCE_THRESHOLD = 5;          // failures
    const BRUTE_FORCE_WINDOW_MS = 600000;     // 10 minutes
    const PORT_SCAN_THRESHOLD = 10;           // unique ports per IP
    const SUSPICIOUS_PORTS = new Set([
        '4444','5555','6666','1337','31337','8888',
        '9999','12345','3389','5900','5901','4443','2222'
    ]);
    const TIME_RANGE_MS = {
        '1h': 3600000, '6h': 21600000, '24h': 86400000,
        '7d': 604800000, '30d': 2592000000
    };
    const CHART_RANGE_MS = { '1h': 3600000, '24h': 86400000, '7d': 604800000 };
    const CHART_BUCKETS = { '1h': 12, '24h': 24, '7d': 28 };

    // ---------- MODULE STATE (per-init) ----------
    let panelEl = null;
    let rawLogs = [];
    let events = [];
    let filteredEvents = [];
    let currentPage = 1;
    let autoScroll = true;
    let sortField = 'timestamp';
    let sortDir = 'desc';
    let chartRange = '24h';
    let uploadedFiles = [];
    let publishedEventKeys = new Set();
    let correlatedIPs = new Set();
    let subscriptions = [];
    let searchDebounceTimer = null;
    let isAnalyzing = false;

    // ---------- DOM HELPERS (scoped to panelEl) ----------
    function $(sel)  { return panelEl ? panelEl.querySelector(sel)    : null; }
    function $$(sel) { return panelEl ? panelEl.querySelectorAll(sel) : []; }

    // ---------- AUTH UI CONTROL ----------
    function updateAuthUi() {
        const overlay = $('[data-siem=auth-overlay]');
        if (!overlay) return;
        const isAuthed = window.SOCState && window.SOCState.isAuthenticated();
        overlay.hidden = !!isAuthed;
    }

    // ---------- LOG HELPERS ----------
    function logLine(text, level) {
        const log = $('[data-siem=upload-status]');
        if (!log) return;
        log.textContent = text || '';
        log.dataset.level = level || 'info';
    }

    function setUploadProgress(pct, text) {
        const wrap = $('[data-siem=upload-progress]');
        const fill = $('[data-siem=upload-fill]');
        const txt  = $('[data-siem=upload-text]');
        if (!wrap || !fill || !txt) return;
        wrap.hidden = false;
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
        txt.textContent = text || '';
    }

    // ---------- FILE HANDLING ----------
    function handleDragOver(e) {
        e.preventDefault();
        const zone = $('[data-siem=upload-zone]');
        if (zone) zone.classList.add('is-drag-over');
    }

    function handleDragLeave() {
        const zone = $('[data-siem=upload-zone]');
        if (zone) zone.classList.remove('is-drag-over');
    }

    function handleDrop(e) {
        e.preventDefault();
        const zone = $('[data-siem=upload-zone]');
        if (zone) zone.classList.remove('is-drag-over');
        if (e.dataTransfer && e.dataTransfer.files) {
            handleFiles(e.dataTransfer.files);
        }
    }

    function handleFilePickerChange(e) {
        if (e.target && e.target.files) handleFiles(e.target.files);
    }

    async function handleFiles(files) {
        if (!files || files.length === 0) return;
        let totalParsed = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setUploadProgress((i / files.length) * 100,
                `Parsing ${file.name} (${i + 1}/${files.length})...`);
            try {
                const content = await readFile(file);
                const parsed = parseLogFile(content, file.name);
                rawLogs.push(...parsed);
                totalParsed += parsed.length;
                uploadedFiles.push(file.name);
            } catch (err) {
                console.error(`[SIEM] Error parsing ${file.name}:`, err);
            }
            setUploadProgress(((i + 1) / files.length) * 100,
                `Parsing ${file.name}...`);
        }
        setUploadProgress(100,
            `\u2713 Parsed ${totalParsed.toLocaleString()} entries from ${files.length} file(s)`);
        const analyzeBtn = $('[data-siem-action=analyze]');
        if (analyzeBtn) analyzeBtn.disabled = false;
        setTimeout(runAnalysis, 400);
    }

    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    // ---------- LOG PARSING ----------
    function parseLogFile(content, filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const trimmed = (content || '').trim();
        if (ext === 'json' || trimmed.startsWith('[') || trimmed.startsWith('{')) {
            return parseJSON(content, filename);
        }
        if (ext === 'csv') return parseCSV(content, filename);
        const lines = content.split('\n').filter(l => l.trim());
        return parseGenericLog(lines, filename);
    }

    function parseJSON(content, filename) {
        try {
            let data = JSON.parse(content);
            if (!Array.isArray(data)) data = [data];
            return data.map((entry, i) => normalizeLogEntry(entry, filename, i));
        } catch (e) {
            // Fallback: NDJSON (line-delimited JSON)
            const entries = [];
            content.split('\n').forEach((line, i) => {
                try {
                    if (line.trim()) {
                        entries.push(normalizeLogEntry(JSON.parse(line), filename, i));
                    }
                } catch (_) {}
            });
            return entries;
        }
    }

    function parseCSV(content, filename) {
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h =>
            h.trim().replace(/"/g, '').toLowerCase());
        const entries = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length === headers.length) {
                const obj = {};
                headers.forEach((h, idx) => { obj[h] = values[idx]; });
                entries.push(normalizeLogEntry(obj, filename, i));
            }
        }
        return entries;
    }

    function parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { inQuotes = !inQuotes; }
            else if (c === ',' && !inQuotes) {
                values.push(current.trim()); current = '';
            } else { current += c; }
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
        if (m) return {
            timestamp: parseSyslogDate(m[1]), hostname: m[2], process: m[3],
            pid: m[4] || '', message: m[5],
            source_ip: extractIP(m[5]), username: extractUsername(m[5]),
            raw: line, file: filename, line: lineNum
        };

        // ISO timestamp: 2026-04-18T12:34:56Z
        m = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[\.\d]*Z?)\s+(.+)$/);
        if (m) return {
            timestamp: new Date(m[1]), message: m[2],
            source_ip: extractIP(m[2]), username: extractUsername(m[2]),
            raw: line, file: filename, line: lineNum
        };

        // Windows Event Log CSV: 4/18/2026 12:34:56 PM
        m = line.match(/^(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s*,?\s*(.+)$/i);
        if (m) return {
            timestamp: new Date(m[1]), message: m[2],
            source_ip: extractIP(m[2]), username: extractUsername(m[2]),
            raw: line, file: filename, line: lineNum
        };

        // Firewall log (iptables/pfsense style)
        m = line.match(/(ALLOW|DENY|DROP|REJECT|BLOCK|ACCEPT|LOG)/i);
        if (m) {
            const src   = line.match(/SRC=(\d+\.\d+\.\d+\.\d+)/);
            const dst   = line.match(/DST=(\d+\.\d+\.\d+\.\d+)/);
            const proto = line.match(/PROTO=(\w+)/);
            const dpt   = line.match(/DPT=(\d+)/);
            return {
                timestamp: extractTimestamp(line) || new Date(),
                message: line,
                source_ip: src ? src[1] : extractIP(line),
                dest_ip: dst ? dst[1] : '',
                protocol: proto ? proto[1] : '',
                dest_port: dpt ? dpt[1] : '',
                action: m[1].toUpperCase(),
                raw: line, file: filename, line: lineNum
            };
        }

        // Fallback: any non-trivial line
        if (line.trim().length > 5) return {
            timestamp: extractTimestamp(line) || new Date(), message: line,
            source_ip: extractIP(line), username: extractUsername(line),
            raw: line, file: filename, line: lineNum
        };
        return null;
    }

    function normalizeLogEntry(obj, filename, lineNum) {
        return {
            timestamp: new Date(obj.timestamp || obj.date || obj.time
                || obj['@timestamp'] || obj.eventtime || Date.now()),
            hostname: obj.hostname || obj.host || obj.computer
                || obj.source || '',
            process: obj.process || obj.program || obj.service
                || obj.source_name || '',
            pid: obj.pid || obj.process_id || '',
            message: obj.message || obj.msg || obj.description
                || obj.event || obj.data || JSON.stringify(obj),
            source_ip: obj.source_ip || obj.src_ip || obj.src || obj.ip
                || obj.remote_addr || extractIP(obj.message || ''),
            dest_ip: obj.dest_ip || obj.dst_ip || obj.dst || '',
            dest_port: obj.dest_port || obj.dst_port || obj.dport || '',
            protocol: obj.protocol || obj.proto || '',
            username: obj.username || obj.user || obj.account
                || obj.account_name || extractUsername(obj.message || ''),
            event_id: obj.event_id || obj.eventid || obj.id || '',
            action: obj.action || obj.status || '',
            raw: JSON.stringify(obj), file: filename, line: lineNum
        };
    }

    // ---------- FIELD EXTRACTORS ----------
    function extractIP(str) {
        if (!str) return '';
        const m = String(str).match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
        return m ? m[1] : '';
    }

    function extractUsername(str) {
        if (!str) return '';
        const s = String(str);
        let m = s.match(/(?:user|username|account|login|for)\s*[=:]\s*['"]?(\S+?)['"]?(?:\s|,|$)/i);
        if (m) return m[1];
        m = s.match(/(?:user|account)\s+['"]?(\w+)['"]?/i);
        return m ? m[1] : '';
    }

    function extractTimestamp(str) {
        const patterns = [
            /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/,
            /(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})/,
            /(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/
        ];
        for (const p of patterns) {
            const m = String(str).match(p);
            if (m) {
                const d = new Date(m[1]);
                if (!isNaN(d)) return d;
            }
        }
        return null;
    }

    function parseSyslogDate(str) {
        const d = new Date(str + ' ' + new Date().getFullYear());
        return isNaN(d) ? new Date() : d;
    }

    // ---------- DETECTION ENGINE ----------
    function runAnalysis() {
        if (rawLogs.length === 0) return;
        if (isAnalyzing) return;
        isAnalyzing = true;
        events = [];

        try {
            // 1. Failed login attempts
            detectByPatterns([
                /failed\s+(password|login|auth)/i, /authentication\s+fail/i,
                /invalid\s+(user|password|credentials)/i, /login\s+failed/i,
                /access\s+denied/i, /incorrect\s+password/i,
                /pam_unix.*authentication\s+failure/i, /event_?id[=:]\s*4625/i
            ], 'failed_login', 'medium', 'Failed Login Attempt',
                log => `Failed login${log.username ? ' for ' + log.username : ''}${log.source_ip ? ' from ' + log.source_ip : ''}`);

            // 2. Brute force (specialized)
            detectBruteForce();

            // 3. Privilege escalation
            detectByPatterns([
                /privilege\s+escalat/i, /sudo.*COMMAND/, /su\s*:\s*.*\broot\b/,
                /changed\s+(role|group|privilege)/i,
                /added\s+to\s+(admin|root|sudo|wheel)/i,
                /event_?id[=:]\s*(4672|4728|4732|4756)/i,
                /special\s+privileges\s+assigned/i,
                /usermod.*-aG.*(sudo|root|admin|wheel)/i,
                /chmod\s+[u+]*s/i, /setuid|setgid/i
            ], 'privilege_escalation', 'critical', 'Privilege Escalation',
                log => `Privilege escalation activity${log.username ? ' by ' + log.username : ''}${log.source_ip ? ' from ' + log.source_ip : ''}`);

            // 4. Port scan (specialized)
            detectPortScans();

            // 5. Unusual traffic patterns
            detectByPatterns([
                /unusual\s+traffic/i, /anomal(y|ous)/i,
                /suspicious\s+(connection|traffic|activity)/i,
                /large\s+(data|transfer|upload)/i,
                /after\s+hours\s+access/i
            ], 'unusual_traffic', 'medium', 'Unusual Traffic Pattern',
                log => `Unusual traffic: ${(log.message || '').substring(0, 100)}`);

            // 6. Suspicious ports (specialized)
            detectSuspiciousPorts();

            // 7. Malware indicators
            detectByPatterns([
                /malware|virus|trojan|worm|ransomware|backdoor|rootkit|keylogger/i,
                /c2\s*(server|beacon|callback)/i,
                /command\s*and\s*control/i, /phishing/i,
                /suspicious\s*(file|executable|binary|script|download)/i,
                /powershell.*-enc|-encodedcommand/i,
                /base64.*exec|eval.*base64/i, /reverse\s*shell/i,
                /meterpreter|mimikatz|cobalt\s*strike/i
            ], 'malware_indicator', 'critical', 'Malware Indicator',
                log => `Potential malware indicator: ${(log.message || '').substring(0, 120)}`);

            // 8. Policy violations
            detectByPatterns([
                /policy\s+violat/i,
                /unauthorized\s+(access|user|connection|device)/i,
                /compliance\s+(fail|violat|breach)/i, /forbidden/i,
                /blocked\s+by\s+policy/i, /firewall.*denied/i,
                /ACL\s+denied/i, /cleartext\s+password/i, /unencrypted/i
            ], 'policy_violation', 'medium', 'Policy Violation',
                log => `Policy violation: ${(log.message || '').substring(0, 120)}`);

            // 9. Data exfiltration
            detectByPatterns([
                /exfiltrat/i, /data\s*(leak|breach|loss|theft)/i,
                /large\s+(?:file\s+)?(?:upload|transfer|copy)/i,
                /USB\s+(?:device|storage|drive)/i,
                /removable\s+media/i,
                /(?:upload|transfer).*(?:external|outside|cloud)/i,
                /bulk\s+download/i
            ], 'data_exfiltration', 'critical', 'Potential Data Exfiltration',
                log => `Data exfiltration indicator: ${(log.message || '').substring(0, 120)}`);

            // 10. Account lockout
            detectByPatterns([
                /account\s*(locked|lockout|disabled)/i,
                /too\s+many\s+(failed|login|auth)/i,
                /event_?id[=:]\s*4740/i, /maximum\s+.*attempts/i,
                /temporarily\s+locked/i
            ], 'account_lockout', 'high', 'Account Lockout',
                log => `Account lockout${log.username ? ' for ' + log.username : ''}`);

            // 11. Service anomaly
            detectByPatterns([
                /service\s*(stopped|crashed|failed|terminated|killed)/i,
                /segfault|segmentation\s+fault/i,
                /out\s+of\s+memory|OOM/i, /disk\s+(full|space)/i,
                /critical\s+error/i, /kernel\s+panic/i,
                /(?:daemon|process)\s+(?:died|crashed)/i
            ], 'service_anomaly', 'high', 'Service Anomaly',
                log => `Service anomaly: ${(log.message || '').substring(0, 120)}`);

            // 12. Root/admin access
            detectByPatterns([
                /(?:logged\s+in|session\s+opened).*\broot\b/i,
                /root\s+login/i, /administrator\s+login/i
            ], 'privilege_escalation', 'high', 'Root/Admin Access',
                log => `Root/admin access${log.source_ip ? ' from ' + log.source_ip : ''}`);

            // 13. SSH anomalies
            detectByPatterns([
                /ssh.*accepted\s+password.*root/i,
                /reverse\s+mapping.*POSSIBLE\s+BREAK/i,
                /Did\s+not\s+receive\s+identification/i,
                /Bad\s+protocol\s+version/i,
                /Connection\s+closed\s+by.*preauth/i
            ], 'unusual_traffic', 'high', 'SSH Anomaly',
                log => `SSH anomaly: ${(log.message || '').substring(0, 120)}`);

            // 14. SQL injection attempts
            detectByPatterns([
                /(?:union\s+select|select\s+.*from|drop\s+table|insert\s+into|delete\s+from)/i,
                /(?:or\s+1\s*=\s*1|'\s*or\s*'|"\s*or\s*")/i,
                /(?:exec\s*\(|execute\s+|xp_cmdshell)/i,
                /sql\s*injection/i
            ], 'malware_indicator', 'critical', 'SQL Injection Attempt',
                log => `SQL injection attempt${log.source_ip ? ' from ' + log.source_ip : ''}`);

            // 15. XSS attempts
            detectByPatterns([
                /<script[\s>]/i, /javascript\s*:/i,
                /on(?:error|load|click|mouseover)\s*=/i,
                /document\.cookie/i
            ], 'malware_indicator', 'high', 'XSS Attempt',
                log => `Cross-site scripting attempt${log.source_ip ? ' from ' + log.source_ip : ''}`);

            // 16. Directory traversal
            detectByPatterns([
                /\.\.\//i, /\.\.\\|\.\.\%5c/i,
                /\/etc\/passwd|\/etc\/shadow/i, /\/proc\/self/i,
                /%2e%2e/i
            ], 'malware_indicator', 'high', 'Directory Traversal Attempt',
                log => `Directory traversal attempt${log.source_ip ? ' from ' + log.source_ip : ''}`);

            // 17. DNS anomalies
            detectByPatterns([
                /dns\s*(?:tunnel|exfil|anomal)/i,
                /(?:query|lookup).*(?:suspicious|malicious)/i,
                /dns.*(?:amplification|flood)/i
            ], 'unusual_traffic', 'medium', 'DNS Anomaly',
                log => `DNS anomaly: ${(log.message || '').substring(0, 120)}`);

            events.sort((a, b) => b.timestamp - a.timestamp);

            publishToSOCState();
            applyFilters();
            renderSummaryCards();
            renderTimeline(chartRange);
            renderSourceIPs();
            renderRules();
            renderBreakdown();
            updateAnalyzeButtonLabel();
        } finally {
            isAnalyzing = false;
        }
    }

    // Generic pattern-based detection helper
    function detectByPatterns(patterns, type, severity, rule, descFn) {
        rawLogs.forEach(log => {
            for (const p of patterns) {
                if (p.test(log.message || '')) {
                    events.push({ ...log, type, severity, rule, description: descFn(log) });
                    break;
                }
            }
        });
    }

    // Brute force: 5+ failed logins from same IP within 10min window
    function detectBruteForce() {
        const failedByIP = {};
        rawLogs.forEach(log => {
            if (/failed|invalid|denied|incorrect|bad.*password|authentication.*fail/i.test(log.message || '')
                    && log.source_ip) {
                if (!failedByIP[log.source_ip]) failedByIP[log.source_ip] = [];
                failedByIP[log.source_ip].push(log);
            }
        });
        Object.entries(failedByIP).forEach(([ip, logs]) => {
            if (logs.length >= BRUTE_FORCE_THRESHOLD) {
                logs.sort((a, b) => a.timestamp - b.timestamp);
                for (let i = 0; i <= logs.length - BRUTE_FORCE_THRESHOLD; i++) {
                    const window = logs[i + BRUTE_FORCE_THRESHOLD - 1].timestamp - logs[i].timestamp;
                    if (window <= BRUTE_FORCE_WINDOW_MS) {
                        events.push({
                            timestamp: logs[i].timestamp, source_ip: ip,
                            type: 'brute_force', severity: 'critical',
                            rule: 'Brute Force Attack', username: logs[i].username,
                            description: `${logs.length} failed login attempts from ${ip} within ${Math.round(window / 60000)} minutes`,
                            message: `Brute force: ${logs.length} failures from ${ip}`,
                            raw: logs[i].raw, file: logs[i].file
                        });
                        break;
                    }
                }
            }
        });
    }

    // Port scan: 10+ unique destination ports from same source IP
    function detectPortScans() {
        const portsByIP = {};
        rawLogs.forEach(log => {
            if (log.dest_port && log.source_ip) {
                if (!portsByIP[log.source_ip]) portsByIP[log.source_ip] = new Set();
                portsByIP[log.source_ip].add(log.dest_port);
            }
        });
        Object.entries(portsByIP).forEach(([ip, ports]) => {
            if (ports.size >= PORT_SCAN_THRESHOLD) {
                events.push({
                    timestamp: new Date(), source_ip: ip,
                    type: 'port_scan', severity: 'high',
                    rule: 'Port Scan Detected',
                    description: `${ip} scanned ${ports.size} unique ports`,
                    message: `Port scan: ${ip} hit ports ${[...ports].slice(0, 10).join(', ')}${ports.size > 10 ? '...' : ''}`,
                    raw: '', file: ''
                });
            }
        });
    }

    // Suspicious ports: traffic to known malicious/uncommon ports
    function detectSuspiciousPorts() {
        rawLogs.forEach(log => {
            if (log.dest_port && SUSPICIOUS_PORTS.has(String(log.dest_port))) {
                events.push({
                    ...log, type: 'unusual_traffic', severity: 'high',
                    rule: 'Suspicious Port Activity',
                    description: `Traffic on suspicious port ${log.dest_port}${log.source_ip ? ' from ' + log.source_ip : ''}`
                });
            }
        });
    }

    function updateAnalyzeButtonLabel() {
        const btn = $('[data-siem-action=analyze]');
        if (!btn) return;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Re-Analyze (${rawLogs.length.toLocaleString()})`;
    }

    // ---------- FILTERS ----------
    function applyFilters() {
        const sevSel    = $('[data-siem-filter=severity]');
        const typeSel   = $('[data-siem-filter=type]');
        const timeSel   = $('[data-siem-filter=time]');
        const searchEl  = $('[data-siem-filter=search]');

        const severity  = sevSel    ? sevSel.value    : 'all';
        const type      = typeSel   ? typeSel.value   : 'all';
        const timeRange = timeSel   ? timeSel.value   : 'all';
        const search    = searchEl  ? searchEl.value.toLowerCase() : '';

        let filtered = events.slice();

        if (severity !== 'all') filtered = filtered.filter(e => e.severity === severity);
        if (type     !== 'all') filtered = filtered.filter(e => e.type === type);

        if (timeRange !== 'all') {
            const now = Date.now();
            const cutoff = now - (TIME_RANGE_MS[timeRange] || 0);
            filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= cutoff);
        }

        if (search) {
            filtered = filtered.filter(e =>
                String(e.source_ip || '').includes(search)
                || String(e.username || '').toLowerCase().includes(search)
                || String(e.message || '').toLowerCase().includes(search)
                || String(e.description || '').toLowerCase().includes(search)
                || String(e.event_id || '').includes(search));
        }

        filtered.sort((a, b) => {
            let aV = a[sortField];
            let bV = b[sortField];
            if (sortField === 'timestamp') {
                aV = new Date(aV || 0).getTime();
                bV = new Date(bV || 0).getTime();
            }
            if (typeof aV === 'string') {
                aV = aV.toLowerCase();
                bV = String(bV || '').toLowerCase();
            }
            if (aV === bV) return 0;
            return sortDir === 'asc' ? (aV > bV ? 1 : -1) : (aV < bV ? 1 : -1);
        });

        filteredEvents = filtered;
        currentPage = 1;
        renderAlertFeed();
        renderLogTable();
    }

    // ---------- RENDERING ----------
    function renderSummaryCards() {
        const counts = { critical: 0, high: 0, medium: 0, low: 0 };
        events.forEach(e => {
            if (counts[e.severity] !== undefined) counts[e.severity]++;
        });
        const set = (sel, val) => {
            const el = $(sel);
            if (el) el.textContent = val;
        };
        set('[data-siem=count-critical]', counts.critical);
        set('[data-siem=count-high]',     counts.high);
        set('[data-siem=count-medium]',   counts.medium);
        set('[data-siem=count-low]',      counts.low);
        set('[data-siem=count-total]',    rawLogs.length.toLocaleString());
    }

    function renderTimeline(range) {
        chartRange = range || '24h';
        const container = $('[data-siem=timeline]');
        if (!container) return;

        if (events.length === 0) {
            container.innerHTML = '<div class="siem-empty">Upload logs or load demo data to view timeline</div>';
            return;
        }

        const now = Date.now();
        const dur = CHART_RANGE_MS[chartRange] || 86400000;
        const bucketCount = CHART_BUCKETS[chartRange] || 24;
        const bucketSize = dur / bucketCount;
        const buckets = Array.from({ length: bucketCount },
            () => ({ critical: 0, high: 0, medium: 0, low: 0, total: 0 }));

        events.forEach(e => {
            const age = now - new Date(e.timestamp).getTime();
            if (age >= 0 && age <= dur) {
                const idx = Math.min(bucketCount - 1, Math.floor((dur - age) / bucketSize));
                if (buckets[idx]) {
                    if (buckets[idx][e.severity] !== undefined) buckets[idx][e.severity]++;
                    buckets[idx].total++;
                }
            }
        });

        const maxT = Math.max(1, ...buckets.map(b => b.total));
        const barsHTML = buckets.map((b, i) => {
            const h = Math.max(4, (b.total / maxT) * 200);
            const cls = b.critical > 0 ? 'is-critical'
                : b.high > 0     ? 'is-high'
                : b.medium > 0   ? 'is-medium'
                : b.total > 0    ? 'is-low'
                : 'is-empty';
            const time = new Date(now - dur + (i * bucketSize));
            const label = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `<div class="siem-timeline-bar ${cls}" style="height:${h}px"><div class="siem-bar-tooltip">${label}<br>C:${b.critical} H:${b.high} M:${b.medium} L:${b.low}</div></div>`;
        }).join('');

        const startLabel = new Date(now - dur).toLocaleDateString([],
            { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        container.innerHTML = `<div class="siem-timeline-bars">${barsHTML}</div><div class="siem-timeline-labels"><span>${startLabel}</span><span>Now</span></div>`;
    }

    function renderSourceIPs() {
        const container = $('[data-siem=source-list]');
        const badge     = $('[data-siem=unique-ips]');
        if (!container) return;

        const ipCounts = {};
        events.forEach(e => {
            if (e.source_ip) ipCounts[e.source_ip] = (ipCounts[e.source_ip] || 0) + 1;
        });
        const sorted = Object.entries(ipCounts).sort((a, b) => b[1] - a[1]).slice(0, TOP_SOURCE_IPS);
        if (badge) badge.textContent = `${Object.keys(ipCounts).length} unique`;

        if (sorted.length === 0) {
            container.innerHTML = '<div class="siem-empty">No source IPs detected</div>';
            return;
        }
        const maxC = sorted[0][1];
        container.innerHTML = sorted.map(([ip, count], i) => `
            <div class="siem-source-item${correlatedIPs.has(ip) ? ' is-correlated' : ''}">
                <span class="siem-source-rank">${i + 1}</span>
                <span class="siem-source-ip">${escapeHTML(ip)}</span>
                <span class="siem-source-count">${count}</span>
                <div class="siem-source-bar-bg"><div class="siem-source-bar-fill" style="width:${(count / maxC) * 100}%"></div></div>
            </div>
        `).join('');
    }

    function renderAlertFeed() {
        const container = $('[data-siem=alert-feed]');
        if (!container) return;
        const slice = filteredEvents.slice(0, ALERT_FEED_CAP);
        if (slice.length === 0) {
            container.innerHTML = '<div class="siem-empty">No alerts matching filters</div>';
            return;
        }
        container.innerHTML = slice.map(e => `
            <div class="siem-alert-item is-${e.severity}">
                <span class="siem-alert-time">${formatTime(e.timestamp)}</span>
                <div class="siem-alert-content">
                    <div class="siem-alert-type">${escapeHTML(String(e.rule || e.type || '').replace(/_/g, ' '))}</div>
                    <div class="siem-alert-msg">${escapeHTML(String(e.description || e.message || '').substring(0, 200))}</div>
                </div>
                <span class="siem-alert-sev sev-${e.severity}">${e.severity}</span>
            </div>
        `).join('');
        if (autoScroll) container.scrollTop = 0;
    }

    function renderRules() {
        const container = $('[data-siem=rules-list]');
        if (!container) return;
        const rc = {};
        events.forEach(e => {
            const r = e.rule || e.type || 'Unknown';
            rc[r] = (rc[r] || 0) + 1;
        });
        const sorted = Object.entries(rc).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0) {
            container.innerHTML = '<div class="siem-empty">No detections yet</div>';
            return;
        }
        container.innerHTML = sorted.map(([rule, count]) => `
            <div class="siem-rule-item">
                <span class="siem-rule-name">${escapeHTML(rule)}</span>
                <span class="siem-rule-count">${count}</span>
            </div>
        `).join('');
    }

    function renderBreakdown() {
        const container = $('[data-siem=breakdown]');
        if (!container) return;
        const tc = {};
        events.forEach(e => {
            const l = String(e.type || 'unknown')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
            tc[l] = (tc[l] || 0) + 1;
        });
        const sorted = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, TOP_BREAKDOWN);
        if (sorted.length === 0) {
            container.innerHTML = '<div class="siem-empty">Upload logs to view breakdown</div>';
            return;
        }
        const maxC = Math.max(1, sorted[0][1]);
        const palette = ['var(--sev-critical)', 'var(--sev-high)',
            'var(--sev-medium)', 'var(--ember)', 'var(--sev-low)',
            'var(--sev-info)', 'var(--chart-warn)', 'var(--chart-success)',
            'var(--ember-bright)', 'var(--ember-soft)'];
        container.innerHTML = `<div class="siem-breakdown-items">${sorted.map(([type, count], i) => `
            <div class="siem-breakdown-item">
                <div class="siem-breakdown-label"><span>${escapeHTML(type)}</span><span>${count}</span></div>
                <div class="siem-breakdown-bar-bg"><div class="siem-breakdown-bar-fill" style="width:${(count / maxC) * 100}%;background:${palette[i % palette.length]}"></div></div>
            </div>
        `).join('')}</div>`;
    }

    function renderLogTable() {
        const tbody    = $('[data-siem=log-tbody]');
        const emptyEl  = $('[data-siem=table-empty]');
        const countEl  = $('[data-siem=log-count]');
        const pageInfo = $('[data-siem=page-info]');
        const prevBtn  = $('[data-siem-action=prev-page]');
        const nextBtn  = $('[data-siem-action=next-page]');
        if (!tbody) return;

        const total = filteredEvents.length;
        const start = (currentPage - 1) * PAGE_SIZE;
        const end   = Math.min(start + PAGE_SIZE, total);
        const page  = filteredEvents.slice(start, end);

        if (countEl) countEl.textContent = `${total.toLocaleString()} entries`;

        if (page.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl)  emptyEl.hidden = false;
            if (prevBtn)  prevBtn.disabled = true;
            if (nextBtn)  nextBtn.disabled = true;
            if (pageInfo) pageInfo.textContent = 'Page 0';
            return;
        }
        if (emptyEl) emptyEl.hidden = true;

        tbody.innerHTML = page.map(e => `<tr>
            <td>${escapeHTML(formatTimestamp(e.timestamp))}</td>
            <td><span class="siem-sev-badge sev-${e.severity}">${e.severity}</span></td>
            <td>${escapeHTML(String(e.type || '').replace(/_/g, ' '))}</td>
            <td>${escapeHTML(e.source_ip || '-')}</td>
            <td>${escapeHTML(e.username || '-')}</td>
            <td title="${escapeHTML(e.description || e.message)}">${escapeHTML(String(e.description || e.message || '').substring(0, 120))}</td>
        </tr>`).join('');

        const totalPages = Math.ceil(total / PAGE_SIZE);
        if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        if (prevBtn)  prevBtn.disabled = currentPage <= 1;
        if (nextBtn)  nextBtn.disabled = currentPage >= totalPages;

        updateSortIndicators();
    }

    function updateSortIndicators() {
        $$('[data-siem-sort]').forEach(th => {
            const arrow = th.querySelector('[data-siem-sort-arrow]');
            if (!arrow) return;
            if (th.dataset.siemSort === sortField) {
                arrow.textContent = sortDir === 'asc' ? '\u25B2' : '\u25BC';
                th.classList.add('is-sorted');
            } else {
                arrow.textContent = '';
                th.classList.remove('is-sorted');
            }
        });
    }

    function changePage(dir) {
        const totalPages = Math.ceil(filteredEvents.length / PAGE_SIZE);
        currentPage = Math.max(1, Math.min(totalPages || 1, currentPage + dir));
        renderLogTable();
    }

    function handleSort(field) {
        if (sortField === field) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            sortField = field;
            sortDir = 'desc';
        }
        applyFilters();
    }

    // ---------- CORRELATION BANNER (Q4 option A) ----------
    function renderCorrelationBanner() {
        const banner = $('[data-siem=correlation-banner]');
        if (!banner) return;
        if (correlatedIPs.size === 0) {
            banner.hidden = true;
            banner.innerHTML = '';
            return;
        }
        const ipList = [...correlatedIPs];
        const previewCount = Math.min(3, ipList.length);
        const preview = ipList.slice(0, previewCount).map(ip => escapeHTML(ip)).join(', ');
        const more = ipList.length > previewCount ? ` +${ipList.length - previewCount} more` : '';
        banner.innerHTML = `
            <div class="siem-correlation-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="6" cy="6" r="3"/>
                    <circle cx="18" cy="18" r="3"/>
                    <path d="M8.5 8.5l7 7"/>
                </svg>
            </div>
            <div class="siem-correlation-body">
                <strong>${ipList.length} IP${ipList.length === 1 ? '' : 's'} correlated with NetMon traffic</strong>
                <span class="siem-correlation-preview">${preview}${more}</span>
            </div>
            <button type="button" class="siem-correlation-action" data-siem-action="filter-correlated">
                Filter table to these IPs
            </button>`;
        banner.hidden = false;
    }

    function filterToCorrelatedIPs() {
        if (correlatedIPs.size === 0) return;
        const searchEl = $('[data-siem-filter=search]');
        if (!searchEl) return;
        // Use the first correlated IP as the search query - the search field is a single string
        // and matches via String.includes(). One IP at a time keeps results clean.
        const firstIp = [...correlatedIPs][0];
        searchEl.value = firstIp;
        applyFilters();
        // Also flash the search field so user sees what happened
        searchEl.classList.add('is-flash');
        setTimeout(() => searchEl.classList.remove('is-flash'), 1200);
    }

    // ---------- DEMO DATA ----------
    function loadDemoData() {
        const logs = [];
        const now = Date.now();
        const ips = ['192.168.1.105', '10.0.0.200', '172.16.0.50',
            '203.0.113.42', '198.51.100.17', '45.33.32.156',
            '185.220.101.1', '91.134.10.45'];
        const users = ['admin', 'root', 'jcastro', 'svc_backup',
            'guest', 'test', 'administrator', 'www-data'];
        const hosts = ['web-srv-01', 'db-srv-02', 'fw-01',
            'mail-srv-01', 'dc-01', 'jonathan-castrodb'];

        // Brute force cluster (25 failures from one IP within 10min)
        for (let i = 0; i < 25; i++) {
            const t = new Date(now - Math.random() * 600000);
            logs.push({
                timestamp: t, hostname: hosts[5], process: 'sshd', pid: '12345',
                message: `Failed password for ${users[i % 3]} from ${ips[0]} port ${50000 + i} ssh2`,
                source_ip: ips[0], username: users[i % 3],
                raw: `sshd: Failed password from ${ips[0]}`,
                file: 'demo-auth.log', line: i
            });
        }

        // Scattered failed logins (40 across 24h from various IPs)
        for (let i = 0; i < 40; i++) {
            const t = new Date(now - Math.random() * 86400000);
            const ip = ips[Math.floor(Math.random() * ips.length)];
            const u = users[Math.floor(Math.random() * users.length)];
            logs.push({
                timestamp: t, hostname: hosts[Math.floor(Math.random() * hosts.length)],
                process: 'sshd',
                message: `Failed password for invalid user ${u} from ${ip} port ${40000 + Math.floor(Math.random() * 10000)} ssh2`,
                source_ip: ip, username: u,
                raw: `Failed password for ${u} from ${ip}`,
                file: 'demo-auth.log', line: 25 + i
            });
        }

        // Privilege escalation
        [3600000, 7200000, 18000000].forEach((offset, i) => {
            const t = new Date(now - offset);
            logs.push({
                timestamp: t, hostname: hosts[5], process: 'sudo',
                message: `jcastro : TTY=pts/0 ; PWD=/home/jcastro ; USER=root ; COMMAND=/bin/bash`,
                source_ip: '192.168.0.22', username: 'jcastro',
                raw: `sudo: jcastro -> root`, file: 'demo-auth.log', line: 70 + i
            });
        });
        logs.push({
            timestamp: new Date(now - 5400000), hostname: hosts[5], process: 'usermod',
            message: `usermod: user svc_backup added to group sudo by root`,
            source_ip: '', username: 'root',
            raw: `usermod added to sudo`, file: 'demo-auth.log', line: 75
        });

        // Port scan (30 unique destination ports)
        for (let p = 1; p <= 30; p++) {
            const t = new Date(now - 1800000 + p * 100);
            logs.push({
                timestamp: t, hostname: hosts[2], process: 'kernel',
                message: `DROP IN=eth0 OUT= SRC=${ips[3]} DST=192.168.0.22 PROTO=TCP SPT=45678 DPT=${p * 100}`,
                source_ip: ips[3], dest_ip: '192.168.0.22', dest_port: String(p * 100),
                protocol: 'TCP', action: 'DROP',
                raw: `DROP from ${ips[3]}`, file: 'demo-firewall.log', line: p
            });
        }

        // Suspicious ports (4444, 1337, 31337, 5555)
        ['4444', '1337', '31337', '5555'].forEach((port, i) => {
            const t = new Date(now - 43200000 + i * 3600000);
            logs.push({
                timestamp: t, hostname: hosts[2], process: 'kernel',
                message: `ALLOW IN=eth0 OUT=eth1 SRC=${ips[4]} DST=10.0.0.5 PROTO=TCP SPT=54321 DPT=${port}`,
                source_ip: ips[4], dest_ip: '10.0.0.5', dest_port: port,
                protocol: 'TCP', action: 'ALLOW',
                raw: `ALLOW suspicious port ${port}`,
                file: 'demo-firewall.log', line: 40 + i
            });
        });

        // Malware indicators
        logs.push({ timestamp: new Date(now - 10800000), hostname: hosts[0], process: 'apache2',
            message: `powershell -encodedcommand detected from ${ips[6]}`,
            source_ip: ips[6], raw: 'powershell encoded', file: 'demo-syslog.log', line: 100 });
        logs.push({ timestamp: new Date(now - 9000000), hostname: hosts[0], process: 'apache2',
            message: `suspicious file upload detected: reverse shell payload from ${ips[7]}`,
            source_ip: ips[7], raw: 'reverse shell', file: 'demo-syslog.log', line: 101 });

        // SQL injection / XSS / dir traversal
        logs.push({ timestamp: new Date(now - 7200000), hostname: hosts[0], process: 'apache2',
            message: `GET /login?user=admin' OR 1=1 -- from ${ips[5]}`,
            source_ip: ips[5], raw: 'sqli attempt', file: 'demo-syslog.log', line: 102 });
        logs.push({ timestamp: new Date(now - 7100000), hostname: hosts[0], process: 'apache2',
            message: `GET /products?id=1 UNION SELECT username,password FROM users from ${ips[5]}`,
            source_ip: ips[5], raw: 'sqli union', file: 'demo-syslog.log', line: 103 });
        logs.push({ timestamp: new Date(now - 6500000), hostname: hosts[0], process: 'apache2',
            message: `POST /comments body contained <script>document.cookie</script> from ${ips[5]}`,
            source_ip: ips[5], raw: 'xss attempt', file: 'demo-syslog.log', line: 104 });
        logs.push({ timestamp: new Date(now - 6000000), hostname: hosts[0], process: 'apache2',
            message: `GET /../../etc/passwd from ${ips[5]}`,
            source_ip: ips[5], raw: 'dir traversal', file: 'demo-syslog.log', line: 105 });

        // Account lockout
        logs.push({ timestamp: new Date(now - 2400000), hostname: hosts[4], process: 'security',
            message: `Account lockout: user admin - too many failed authentication attempts from ${ips[0]}`,
            source_ip: ips[0], username: 'admin', raw: 'account locked',
            file: 'demo-syslog.log', line: 110 });

        // Service anomalies
        logs.push({ timestamp: new Date(now - 14400000), hostname: hosts[1], process: 'mysqld',
            message: `Service stopped unexpectedly - segmentation fault in thread 42`,
            raw: 'mysqld segfault', file: 'demo-syslog.log', line: 115 });
        logs.push({ timestamp: new Date(now - 28800000), hostname: hosts[0], process: 'kernel',
            message: `Out of memory: Killed process 8734 (apache2) total-vm:2048000kB`,
            raw: 'OOM killed apache2', file: 'demo-syslog.log', line: 116 });

        // Data exfiltration
        logs.push({ timestamp: new Date(now - 4800000), hostname: hosts[1], process: 'audit',
            message: `Large file upload detected: user svc_backup transferred 2.4GB to external cloud storage`,
            username: 'svc_backup', raw: 'large upload exfil',
            file: 'demo-syslog.log', line: 120 });

        // Normal noise (200 entries)
        const normalMsgs = ['Session opened for user jcastro',
            'CRON job executed: /usr/local/bin/backup.sh',
            'Received SIGHUP; restarting',
            'Connection from 192.168.0.10 accepted',
            'Successful login for user jcastro from 192.168.0.10',
            'Package nginx updated to version 1.24.0-1',
            'SSL certificate renewed successfully',
            'Firewall rule updated: ALLOW 80/tcp',
            'System backup completed successfully',
            'DNS resolution successful', 'NTP synchronized',
            'Disk usage at 45%', 'Memory usage: 62%',
            'Load average: 0.32, 0.28, 0.25'];
        for (let i = 0; i < 200; i++) {
            const t = new Date(now - Math.random() * 86400000);
            logs.push({
                timestamp: t,
                hostname: hosts[Math.floor(Math.random() * hosts.length)],
                process: ['sshd', 'cron', 'systemd', 'nginx', 'kernel', 'apt'][Math.floor(Math.random() * 6)],
                message: normalMsgs[Math.floor(Math.random() * normalMsgs.length)],
                source_ip: ['192.168.0.10', '192.168.0.1', '10.0.0.1'][Math.floor(Math.random() * 3)],
                raw: `Normal log ${i}`, file: 'demo-syslog.log', line: 200 + i
            });
        }

        rawLogs = logs;
        uploadedFiles = ['demo-syslog.log', 'demo-auth.log', 'demo-firewall.log'];
        const analyzeBtn = $('[data-siem-action=analyze]');
        if (analyzeBtn) analyzeBtn.disabled = false;
        setUploadProgress(100, `\u2713 Loaded ${logs.length} demo log entries`);
        setTimeout(runAnalysis, 300);
    }

    // ---------- EXPORT ----------
    function exportAlerts() {
        if (filteredEvents.length === 0) return;
        const rows = ['Timestamp,Severity,Type,Rule,Source IP,Username,Description'];
        filteredEvents.forEach(e => {
            rows.push([
                csvCell(formatTimestamp(e.timestamp)),
                csvCell(e.severity || ''),
                csvCell(e.type || ''),
                csvCell(e.rule || ''),
                csvCell(e.source_ip || ''),
                csvCell(e.username || ''),
                csvCell(e.description || '')
            ].join(','));
        });
        downloadFile(rows.join('\r\n'), 'siem-alerts.csv', 'text/csv');
    }

    function exportLogsCSV() {
        if (filteredEvents.length === 0) return;
        const rows = ['Timestamp,Severity,Type,Source IP,Username,Message'];
        filteredEvents.forEach(e => {
            rows.push([
                csvCell(formatTimestamp(e.timestamp)),
                csvCell(e.severity || ''),
                csvCell(e.type || ''),
                csvCell(e.source_ip || ''),
                csvCell(e.username || ''),
                csvCell(String(e.message || '').substring(0, 500))
            ].join(','));
        });
        downloadFile(rows.join('\r\n'), 'siem-log-export.csv', 'text/csv');
    }

    function csvCell(val) {
        const s = String(val == null ? '' : val);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }

    function downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    }

    // ---------- SOCSTATE PUBLISH ----------
    function publishToSOCState() {
        if (!window.SOCState || typeof window.SOCState.addSIEMEvent !== 'function') return;
        let publishedCount = 0;
        events.forEach(e => {
            const key = eventKey(e);
            if (publishedEventKeys.has(key)) return;
            publishedEventKeys.add(key);
            window.SOCState.addSIEMEvent({
                severity:  e.severity,
                type:      e.type,
                source:    e.process || e.file || e.hostname || 'siem',
                srcIp:     e.source_ip || '',
                message:   e.description || e.message || '',
                timestamp: new Date(e.timestamp || Date.now()).getTime()
            });
            publishedCount++;
        });
        if (publishedCount > 0) {
            console.info(`[SIEM] Published ${publishedCount} new events to SOCState (total events: ${events.length})`);
        }
    }

    function eventKey(e) {
        const ts = e.timestamp instanceof Date
            ? e.timestamp.getTime()
            : new Date(e.timestamp || 0).getTime();
        return [
            ts, e.source_ip || '', e.type || '',
            (e.rule || e.description || e.message || '').slice(0, 64)
        ].join('|');
    }

    // Called when SOCState fires correlation:found - rebuild correlatedIPs
    // by intersecting NetMon networkAlerts srcIps with SIEM events srcIps.
    function recomputeCorrelations() {
        if (!window.SOCState) {
            renderCorrelationBanner();
            return;
        }
        const netIps = new Set();
        (window.SOCState.networkAlerts || []).forEach(a => {
            if (a && a.srcIp) netIps.add(a.srcIp);
        });
        const overlap = new Set();
        (window.SOCState.siemEvents || []).forEach(ev => {
            if (ev && ev.srcIp && netIps.has(ev.srcIp)) overlap.add(ev.srcIp);
        });
        correlatedIPs = overlap;
        renderCorrelationBanner();
        renderSourceIPs();
    }

    // ---------- UTILITIES ----------
    function formatTime(ts) {
        return new Date(ts).toLocaleTimeString([],
            { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatTimestamp(ts) {
        return new Date(ts).toLocaleString([],
            { month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function debounce(fn, ms) {
        return function (...args) {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => fn(...args), ms);
        };
    }

    function updateClock() {
        const el = $('[data-siem=clock]');
        if (el) el.textContent = new Date().toLocaleString([],
            { month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function toggleAutoScroll(buttonEl) {
        autoScroll = !autoScroll;
        if (buttonEl) {
            buttonEl.classList.toggle('is-active', autoScroll);
            buttonEl.setAttribute('aria-pressed', String(autoScroll));
        }
    }

    function setChartRange(range, buttonEl) {
        $$('[data-siem-chart-range]').forEach(b =>
            b.classList.toggle('is-active', b === buttonEl));
        renderTimeline(range);
    }

    function clearAll() {
        rawLogs = [];
        events = [];
        filteredEvents = [];
        uploadedFiles = [];
        publishedEventKeys = new Set();
        currentPage = 1;
        const wrap = $('[data-siem=upload-progress]');
        if (wrap) wrap.hidden = true;
        const fill = $('[data-siem=upload-fill]');
        if (fill) fill.style.width = '0%';
        const btn = $('[data-siem-action=analyze]');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze Logs`;
        }
        renderSummaryCards();
        renderTimeline(chartRange);
        renderSourceIPs();
        renderRules();
        renderBreakdown();
        renderAlertFeed();
        renderLogTable();
    }

    // ---------- INIT ----------
    let clockInterval = null;

    function init(rootEl) {
        // Clean up any previous instance (re-init on tab switch)
        subscriptions.forEach(unsub => { try { unsub(); } catch (_) {} });
        subscriptions = [];
        if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

        panelEl = rootEl;
        if (!panelEl) {
            console.warn('[SIEM] init() called without panelEl');
            return;
        }

        // Reset state for a clean re-init
        rawLogs = [];
        events = [];
        filteredEvents = [];
        currentPage = 1;
        autoScroll = true;
        sortField = 'timestamp';
        sortDir = 'desc';
        chartRange = '24h';
        uploadedFiles = [];
        publishedEventKeys = new Set();
        correlatedIPs = new Set();
        isAnalyzing = false;

        // Initial UI sync
        updateAuthUi();
        renderSummaryCards();
        renderTimeline(chartRange);
        renderSourceIPs();
        renderRules();
        renderBreakdown();
        renderAlertFeed();
        renderLogTable();
        recomputeCorrelations();

        // ---- Upload zone (drag/drop + file picker) ----
        const uploadZone = $('[data-siem=upload-zone]');
        const fileInput  = $('[data-siem=file-input]');
        if (uploadZone) {
            uploadZone.addEventListener('dragover',  handleDragOver);
            uploadZone.addEventListener('dragleave', handleDragLeave);
            uploadZone.addEventListener('drop',      handleDrop);
            uploadZone.addEventListener('click', e => {
                if (e.target === uploadZone || e.target.closest('[data-siem=upload-content]')) {
                    if (fileInput) fileInput.click();
                }
            });
        }
        if (fileInput) fileInput.addEventListener('change', handleFilePickerChange);

        // ---- Filter change/input listeners ----
        const sevSel   = $('[data-siem-filter=severity]');
        const typeSel  = $('[data-siem-filter=type]');
        const timeSel  = $('[data-siem-filter=time]');
        const searchEl = $('[data-siem-filter=search]');
        if (sevSel)   sevSel.addEventListener('change', applyFilters);
        if (typeSel)  typeSel.addEventListener('change', applyFilters);
        if (timeSel)  timeSel.addEventListener('change', applyFilters);
        if (searchEl) searchEl.addEventListener('input', debounce(applyFilters, SEARCH_DEBOUNCE_MS));

        // ---- Single delegated click listener (actions + chart range + sort) ----
        panelEl.addEventListener('click', e => {
            if (!panelEl.contains(e.target)) return;

            // Sortable column headers
            const sortTh = e.target.closest('[data-siem-sort]');
            if (sortTh && panelEl.contains(sortTh)) {
                handleSort(sortTh.dataset.siemSort);
                return;
            }

            // Chart range buttons
            const rangeBtn = e.target.closest('[data-siem-chart-range]');
            if (rangeBtn && panelEl.contains(rangeBtn)) {
                setChartRange(rangeBtn.dataset.siemChartRange, rangeBtn);
                return;
            }

            // Action buttons
            const actionBtn = e.target.closest('[data-siem-action]');
            if (!actionBtn || !panelEl.contains(actionBtn)) return;
            const action = actionBtn.dataset.siemAction;
            switch (action) {
                case 'analyze':
                case 'refresh':
                    if (rawLogs.length > 0) runAnalysis();
                    break;
                case 'load-demo':       loadDemoData(); break;
                case 'clear':           clearAll(); break;
                case 'autoscroll':      toggleAutoScroll(actionBtn); break;
                case 'export-alerts':   exportAlerts(); break;
                case 'export-logs':     exportLogsCSV(); break;
                case 'prev-page':       changePage(-1); break;
                case 'next-page':       changePage(1); break;
                case 'filter-correlated': filterToCorrelatedIPs(); break;
            }
        });

        // ---- SOCState subscriptions ----
        if (window.SOCState && typeof window.SOCState.subscribe === 'function') {
            subscriptions.push(window.SOCState.subscribe('auth:changed', updateAuthUi));
            subscriptions.push(window.SOCState.subscribe('correlation:found', recomputeCorrelations));
            subscriptions.push(window.SOCState.subscribe('network:alert', recomputeCorrelations));
            subscriptions.push(window.SOCState.subscribe('siem:event', recomputeCorrelations));
        }

        // ---- Clock ----
        updateClock();
        clockInterval = setInterval(updateClock, 1000);

        console.info('[SIEM] Log Analyzer ready');
    }

    // ---------- MODULE EXPORT ----------
    window.SOCTools = window.SOCTools || {};
    window.SOCTools.siemLogs = { init };
})();
