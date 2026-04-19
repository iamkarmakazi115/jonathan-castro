/* =============================================================================
   NETWORK TRAFFIC MONITOR (NetMon) - SOC Tools Module
   =============================================================================
   Polls GET https://api.jonathan-castro.com/api/netmonitor/state every 2s
   and renders: status badge, summary cards, traffic chart (Chart.js),
   protocol breakdown, threat-intel info, top talkers (sortable table),
   alerts list (severity-filtered), and live packets feed.

   - No auth required (public endpoint)
   - Single global "Pause Polling" toggle freezes the entire dashboard
   - Backend alerts deduped by hash(timestamp+src_ip+title), only NEW
     alerts publish to SOCState.addNetworkAlert (which fires
     network:alert and triggers correlation:found if same IP appears
     in SIEM events later).
   - Theme palette: ember (inbound) + chart-warn amber (outbound),
     read live from CSS custom properties via getComputedStyle.

   Pattern mirrors lan-discovery.js / vuln-scan.js: IIFE, 'use strict',
   data-net-* attributes only (NO IDs - prevents cross-tool selector
   collisions), all queries scoped to panelEl, single delegated click
   listener via closest() + panelEl.contains() guard.

   Module export: window.SOCTools.netTraffic = { init }
   ============================================================================= */

(function () {
    'use strict';

    // ---------- CONFIG ----------
    const API_URL = 'https://api.jonathan-castro.com/api/netmonitor/state';
    const POLL_INTERVAL_MS = 2000;
    const MAX_PACKET_LINES = 50;
    const TOP_TALKER_PORTS_VISIBLE = 6;

    // ---------- MODULE STATE (per-init) ----------
    let panelEl = null;        // root tab panel for this tool
    let pollTimer = null;      // setInterval handle
    let chart = null;          // Chart.js instance
    let isPaused = false;      // global pause-polling flag
    let alertFilter = 'all';   // 'all' | 'critical' | 'high' | 'medium'
    let lastData = null;       // last successful fetch (for re-render on filter/sort)

    // Top Talkers sort state - default: packets descending
    let sortKey = 'packets';   // 'ip'|'packets'|'bytes_in'|'bytes_out'|'connections'|'status'
    let sortDir = 'desc';      // 'asc' | 'desc'

    // Dedupe set for alerts already published to SOCState
    const publishedAlertKeys = new Set();

    // ---------- DOM HELPERS (scoped to panelEl) ----------
    function $(sel)  { return panelEl ? panelEl.querySelector(sel)    : null; }
    function $$(sel) { return panelEl ? panelEl.querySelectorAll(sel) : []; }

    // ---------- THEME COLOR READER ----------
    // Read CSS custom properties live so the chart inherits the ember/dark
    // theme tokens. Falls back to safe defaults if the var is missing.
    function themeColor(varName, fallback) {
        const root = document.documentElement;
        const val = getComputedStyle(root).getPropertyValue(varName).trim();
        return val || fallback;
    }

    // ---------- POLLING ----------
    function startPolling() {
        stopPolling(); // safety: clear any pre-existing timer
        fetchData();   // immediate first fetch (don't wait 2s for first render)
        pollTimer = setInterval(fetchData, POLL_INTERVAL_MS);
        updatePauseButton();
    }

    function stopPolling() {
        if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        updatePauseButton();
    }

    async function fetchData() {
        if (isPaused) return; // belt-and-suspenders: bail even if timer still running
        try {
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            lastData = data;
            updateDashboard(data);
        } catch (err) {
            updateStatus(false, err.message || 'Connection error');
        }
    }

    // ---------- DASHBOARD UPDATE DISPATCHER ----------
    function updateDashboard(data) {
        if (data.error) {
            updateStatus(false, data.error);
            return;
        }
        updateStatus(true);
        updateHeader(data);
        updateSummary(data.summary);
        updateChart(data.traffic_timeline);
        updateProtocols(data.protocol_breakdown);
        updateThreatInfo(data);
        updateTopTalkers(data.top_talkers);
        updateAlerts(data.alerts);
        updatePackets(data.recent_packets);
    }

    // ---------- STATUS BADGE ----------
    function updateStatus(online, errMsg) {
        const badge = $('[data-net="status-badge"]');
        const text  = $('[data-net="status-text"]');
        if (!badge || !text) return;
        if (online) {
            badge.classList.add('is-online');
            badge.classList.remove('is-offline');
            text.textContent = 'MONITORING';
        } else {
            badge.classList.remove('is-online');
            badge.classList.add('is-offline');
            text.textContent = errMsg || 'OFFLINE';
        }
    }

    // ---------- HEADER META (server IP, interface, uptime) ----------
    function updateHeader(data) {
        const ipEl    = $('[data-net="server-ip"]');
        const ifaceEl = $('[data-net="interface"]');
        const upEl    = $('[data-net="uptime"]');
        if (ipEl)    ipEl.textContent    = data.server_ip || '—';
        if (ifaceEl) ifaceEl.textContent = data.interface || '—';
        if (upEl)    upEl.textContent    = formatUptime(data.uptime_seconds || 0);
    }

    // ---------- SUMMARY CARDS ----------
    function updateSummary(summary) {
        if (!summary) return;
        setText('[data-net="total-packets"]',   formatNumber(summary.total_packets));
        setText('[data-net="total-bytes-in"]',  formatBytes(summary.total_bytes_in));
        setText('[data-net="total-bytes-out"]', formatBytes(summary.total_bytes_out));
        setText('[data-net="unique-ips"]',      formatNumber(summary.unique_ips));
        setText('[data-net="alert-count"]',     formatNumber(summary.alerts_total || 0));

        const alertCard = $('[data-net="alert-card"]');
        if (alertCard) {
            alertCard.classList.toggle('has-critical', (summary.alerts_critical || 0) > 0);
        }

        const breakdown = $('[data-net="alert-breakdown"]');
        if (breakdown) {
            const parts = [];
            if (summary.alerts_critical > 0) parts.push(summary.alerts_critical + ' crit');
            if (summary.alerts_high     > 0) parts.push(summary.alerts_high     + ' high');
            breakdown.textContent = parts.join(' · ');
        }
    }

    function setText(sel, value) {
        const el = $(sel);
        if (el) el.textContent = value;
    }

    // ---------- TRAFFIC CHART (Chart.js) ----------
    function initChart() {
        const canvas = $('[data-net="traffic-chart"]');
        if (!canvas || typeof Chart === 'undefined') return;

        // Destroy previous instance if init() runs twice (e.g. tab re-init)
        if (chart) {
            chart.destroy();
            chart = null;
        }

        // Theme tokens (read live so chart inherits ember/dark palette)
        const ember     = themeColor('--ember',       '#ff7a3d');
        const emberSoft = themeColor('--ember-soft',  'rgba(255,122,61,0.10)');
        const warn      = themeColor('--chart-warn',  '#f5b342');
        const warnSoft  = 'rgba(245, 179, 66, 0.08)';
        const text      = themeColor('--text',        '#e6edf6');
        const textMuted = themeColor('--text-muted',  '#8899b4');
        const border    = themeColor('--border',      'rgba(30,45,74,0.4)');
        const bgEl      = themeColor('--bg-elevated', '#151d2e');

        chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Packets/sec (in)',
                        data: [],
                        borderColor: ember,
                        backgroundColor: emberSoft,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHitRadius: 10
                    },
                    {
                        label: 'KB/sec (out)',
                        data: [],
                        borderColor: warn,
                        backgroundColor: warnSoft,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: textMuted,
                            font: { family: "'JetBrains Mono', monospace", size: 11 },
                            boxWidth: 12,
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: bgEl,
                        borderColor: border,
                        borderWidth: 1,
                        titleColor: text,
                        bodyColor: textMuted,
                        titleFont: { family: "'JetBrains Mono', monospace" },
                        bodyFont:  { family: "'JetBrains Mono', monospace" }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: textMuted,
                            font: { family: "'JetBrains Mono', monospace", size: 10 },
                            maxTicksLimit: 10,
                            maxRotation: 0
                        },
                        grid: { color: 'rgba(30, 45, 74, 0.3)' }
                    },
                    y: {
                        position: 'left',
                        ticks: { color: ember, font: { family: "'JetBrains Mono', monospace", size: 10 } },
                        grid:  { color: 'rgba(30, 45, 74, 0.3)' },
                        title: { display: true, text: 'Packets', color: ember,
                                 font: { family: "'JetBrains Mono', monospace", size: 10 } }
                    },
                    y1: {
                        position: 'right',
                        ticks: { color: warn, font: { family: "'JetBrains Mono', monospace", size: 10 } },
                        grid:  { drawOnChartArea: false },
                        title: { display: true, text: 'KB/sec', color: warn,
                                 font: { family: "'JetBrains Mono', monospace", size: 10 } }
                    }
                }
            }
        });
    }

    function updateChart(timeline) {
        if (!chart || !timeline || timeline.length === 0) return;
        chart.data.labels = timeline.map(t => {
            const d = new Date(t.timestamp * 1000);
            return d.toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' });
        });
        chart.data.datasets[0].data = timeline.map(t => t.packets);
        chart.data.datasets[1].data = timeline.map(t => Math.round(t.bytes / 1024 * 10) / 10);
        chart.update('none');
    }

    // ---------- PROTOCOL BREAKDOWN ----------
    function updateProtocols(protocols) {
        const container = $('[data-net="protocol-bars"]');
        if (!container) return;
        if (!protocols) {
            container.innerHTML = '<div class="net-empty">Waiting for data...</div>';
            return;
        }
        const total = Object.values(protocols).reduce((a, b) => a + b, 0);
        if (total === 0) {
            container.innerHTML = '<div class="net-empty">Waiting for data...</div>';
            return;
        }
        const ordered = Object.entries(protocols).sort((a, b) => b[1] - a[1]);
        container.innerHTML = ordered.map(([proto, count]) => {
            const pct = ((count / total) * 100).toFixed(1);
            const cssClass = proto.toLowerCase().replace(/[^a-z0-9]/g, '');
            return `
                <div class="net-proto-item">
                    <div class="net-proto-label">
                        <span class="net-proto-name">${escapeHtml(proto)}</span>
                        <span class="net-proto-count">${formatNumber(count)} (${pct}%)</span>
                    </div>
                    <div class="net-proto-track">
                        <div class="net-proto-fill ${cssClass}" style="width:${pct}%"></div>
                    </div>
                </div>`;
        }).join('');
    }

    // ---------- THREAT INTEL INFO ----------
    function updateThreatInfo(data) {
        const container = $('[data-net="threat-info"]');
        if (!container) return;
        const updated = data.threat_intel_updated;
        const updatedDisplay = (!updated || updated === 'never') ? 'Never' : formatTimeAgo(updated);
        container.innerHTML = `
            <div class="net-threat-stat">
                <span class="net-threat-label">Known Threats Loaded</span>
                <span class="net-threat-value">${formatNumber(data.threat_intel_loaded || 0)}</span>
            </div>
            <div class="net-threat-stat">
                <span class="net-threat-label">Last Updated</span>
                <span class="net-threat-value">${escapeHtml(updatedDisplay)}</span>
            </div>
            <div class="net-threat-stat">
                <span class="net-threat-label">Active Connections</span>
                <span class="net-threat-value">${formatNumber((data.summary && data.summary.active_connections) || 0)}</span>
            </div>`;
    }

    // ---------- TOP TALKERS (sortable table per Q3) ----------
    // Status ordering for sort: malicious > suspicious > safe (numeric ranks)
    const STATUS_RANK = { malicious: 3, suspicious: 2, safe: 1 };

    function statusOf(t) {
        if (t.is_malicious) return 'malicious';
        if ((t.packets || 0) > 200 || (t.connections || 0) > 15) return 'suspicious';
        return 'safe';
    }

    function compareTalkers(a, b) {
        const dirMul = sortDir === 'asc' ? 1 : -1;
        let aVal, bVal;
        switch (sortKey) {
            case 'ip':
                aVal = ipToNum(a.ip || ''); bVal = ipToNum(b.ip || '');
                break;
            case 'bytes_in':    aVal = a.bytes_in    || 0; bVal = b.bytes_in    || 0; break;
            case 'bytes_out':   aVal = a.bytes_out   || 0; bVal = b.bytes_out   || 0; break;
            case 'connections': aVal = a.connections || 0; bVal = b.connections || 0; break;
            case 'status':
                aVal = STATUS_RANK[statusOf(a)] || 0;
                bVal = STATUS_RANK[statusOf(b)] || 0;
                break;
            case 'packets':
            default:            aVal = a.packets     || 0; bVal = b.packets     || 0; break;
        }
        if (aVal < bVal) return -1 * dirMul;
        if (aVal > bVal) return  1 * dirMul;
        return 0;
    }

    function ipToNum(ip) {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4 || parts.some(isNaN)) return 0;
        return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
    }

    function updateTopTalkers(talkers) {
        const tbody  = $('[data-net="talkers-body"]');
        const countEl = $('[data-net="talker-count"]');
        if (!tbody) return;

        if (!talkers || talkers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="net-empty">Waiting for data...</td></tr>';
            if (countEl) countEl.textContent = '0 IPs tracked';
            updateSortIndicators();
            return;
        }
        if (countEl) countEl.textContent = talkers.length + ' IPs tracked';

        // Copy + sort (don't mutate the data passed in)
        const sorted = talkers.slice().sort(compareTalkers);

        tbody.innerHTML = sorted.map(t => {
            // Type badge
            let typeBadge;
            if (t.is_whitelisted)  typeBadge = '<span class="net-type-badge whitelisted">safe</span>';
            else if (t.is_private) typeBadge = '<span class="net-type-badge private">private</span>';
            else                   typeBadge = '<span class="net-type-badge public">public</span>';

            // Status tag
            const status = statusOf(t);
            const statusTag = `<span class="net-status-tag ${status}">${status === 'malicious' ? 'threat' : status === 'suspicious' ? 'watch' : 'ok'}</span>`;

            // Ports list (truncate to TOP_TALKER_PORTS_VISIBLE, +N more)
            const allPorts = Array.isArray(t.ports) ? t.ports : [];
            const ports = allPorts.slice(0, TOP_TALKER_PORTS_VISIBLE).join(', ') || '—';
            const moreCount = allPorts.length - TOP_TALKER_PORTS_VISIBLE;
            const portsDisplay = moreCount > 0 ? `${ports} +${moreCount}` : ports;

            return `
                <tr>
                    <td><span class="net-ip-badge">${escapeHtml(t.ip || '—')}</span></td>
                    <td>${typeBadge}</td>
                    <td>${formatNumber(t.packets || 0)}</td>
                    <td>${formatBytes(t.bytes_in  || 0)}</td>
                    <td>${formatBytes(t.bytes_out || 0)}</td>
                    <td>${formatNumber(t.connections || 0)}</td>
                    <td><span class="net-ports-list">${escapeHtml(portsDisplay)}</span></td>
                    <td>${statusTag}</td>
                </tr>`;
        }).join('');

        updateSortIndicators();
    }

    function updateSortIndicators() {
        $$('[data-net-sort]').forEach(th => {
            const key = th.getAttribute('data-net-sort');
            const arrow = th.querySelector('[data-net-sort-arrow]');
            if (!arrow) return;
            if (key === sortKey) {
                arrow.textContent = sortDir === 'asc' ? '▲' : '▼';
                th.classList.add('is-sorted');
            } else {
                arrow.textContent = '';
                th.classList.remove('is-sorted');
            }
        });
    }

    function handleSortClick(th) {
        const key = th.getAttribute('data-net-sort');
        if (!key) return;
        if (key === sortKey) {
            sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
        } else {
            sortKey = key;
            // New column: default desc for numeric, asc for text (ip)
            sortDir = (key === 'ip') ? 'asc' : 'desc';
        }
        // Re-render just the talkers from cached data without refetching
        if (lastData && lastData.top_talkers) updateTopTalkers(lastData.top_talkers);
    }

    // ---------- ALERTS (severity filter + SOCState publish) ----------
    // Dedupe key: stable hash of timestamp+src_ip+title+severity so the same
    // backend alert doesn't get republished every 2s poll.
    function alertKey(a) {
        return [
            a.timestamp || '',
            a.src_ip    || '',
            a.title     || '',
            a.severity  || ''
        ].join('|');
    }

    function updateAlerts(alerts) {
        const container = $('[data-net="alerts-list"]');
        if (!container) return;

        if (!alerts || alerts.length === 0) {
            container.innerHTML = '<div class="net-empty">No alerts yet — monitoring...</div>';
            return;
        }

        // Publish NEW alerts to SOCState (only if they have a valid srcIp and
        // haven't been published before). addNetworkAlert validates srcIp
        // format via isValidIp - alerts without it are UI-only.
        if (window.SOCState && typeof window.SOCState.addNetworkAlert === 'function') {
            alerts.forEach(a => {
                const key = alertKey(a);
                if (publishedAlertKeys.has(key)) return;
                publishedAlertKeys.add(key);
                if (!a.src_ip) return; // UI-only, no correlation possible
                window.SOCState.addNetworkAlert({
                    timestamp: a.timestamp ? Date.parse(a.timestamp) || undefined : undefined,
                    srcIp:     a.src_ip,
                    dstIp:     a.dst_ip || null,
                    protocol:  a.protocol || 'unknown',
                    reason:    (a.title || 'flagged') + (a.details ? ': ' + a.details : ''),
                    severity:  a.severity || 'medium'
                });
            });
        }

        // Apply severity filter (All / Critical / High / Medium)
        let filtered = alerts;
        if (alertFilter !== 'all') {
            filtered = alerts.filter(a => a.severity === alertFilter);
        }

        if (filtered.length === 0) {
            container.innerHTML = `<div class="net-empty">No ${escapeHtml(alertFilter)} alerts.</div>`;
            return;
        }

        // Newest first
        const ordered = filtered.slice().reverse();

        container.innerHTML = ordered.map(a => {
            const sev = (a.severity || 'info').toLowerCase();
            return `
                <div class="net-alert-item ${sev}">
                    <span class="net-alert-severity">${escapeHtml(sev)}</span>
                    <div class="net-alert-body">
                        <div class="net-alert-title">${escapeHtml(a.title || 'Alert')}</div>
                        <div class="net-alert-details">${escapeHtml(a.details || '')}</div>
                        <div class="net-alert-time">${escapeHtml(formatTimeAgo(a.timestamp))}</div>
                    </div>
                </div>`;
        }).join('');
    }

    // ---------- LIVE PACKETS FEED ----------
    // NOTE: packets are display-only (firehose volume too high for SOCState).
    function updatePackets(pkts) {
        const feed = $('[data-net="packets-feed"]');
        if (!feed) return;
        if (!pkts || pkts.length === 0) {
            feed.innerHTML = '<div class="net-empty">Waiting for packets...</div>';
            return;
        }

        // Newest first, capped at MAX_PACKET_LINES
        const recent = pkts.slice().reverse().slice(0, MAX_PACKET_LINES);

        feed.innerHTML = recent.map(p => {
            let timeStr = '';
            try {
                timeStr = new Date(p.timestamp).toLocaleTimeString('en-US', {
                    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
                });
            } catch (_) { timeStr = ''; }
            const proto     = p.protocol  || 'OTHER';
            const direction = p.direction || 'inbound';
            const arrow     = direction === 'inbound' ? '↓' : '↑';
            const size      = (p.length > 0) ? formatBytes(p.length) : '';
            const service   = p.service || '';
            const protoCls  = proto.toLowerCase().replace(/[^a-z0-9]/g, '');

            return `
                <div class="net-packet-line">
                    <span class="net-packet-time">${escapeHtml(timeStr)}</span>
                    <span class="net-packet-proto ${protoCls}">${escapeHtml(proto)}</span>
                    <span class="net-packet-direction ${escapeHtml(direction)}">${arrow}</span>
                    <span class="net-packet-addrs">${escapeHtml(p.src_ip || '')}:${escapeHtml(String(p.src_port || ''))} → ${escapeHtml(p.dst_ip || '')}:${escapeHtml(String(p.dst_port || ''))}</span>
                    <span class="net-packet-size">${escapeHtml(size)}</span>
                    <span class="net-packet-service">${escapeHtml(service)}</span>
                </div>`;
        }).join('');
    }

    // ---------- PAUSE POLLING TOGGLE ----------
    function togglePause() {
        isPaused = !isPaused;
        if (isPaused) {
            stopPolling();
        } else {
            startPolling();
        }
        updatePauseButton();
    }

    function updatePauseButton() {
        const btn = $('[data-net-action="toggle-pause"]');
        if (!btn) return;
        const label = btn.querySelector('[data-net="pause-label"]');
        btn.classList.toggle('is-paused', isPaused);
        btn.setAttribute('aria-pressed', isPaused ? 'true' : 'false');
        if (label) label.textContent = isPaused ? 'PAUSED' : 'Live';
        btn.title = isPaused ? 'Resume polling' : 'Pause polling';
    }

    // ---------- FILTER BUTTONS (severity) ----------
    function setFilter(value) {
        alertFilter = value;
        $$('[data-net-filter]').forEach(b => {
            b.classList.toggle('is-active', b.getAttribute('data-net-filter') === value);
        });
        if (lastData && lastData.alerts) updateAlerts(lastData.alerts);
    }

    // ---------- UTILITY FUNCTIONS ----------
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
        const val = bytes / Math.pow(1024, i);
        return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function formatNumber(num) {
        if (num === null || num === undefined) return '0';
        try { return Number(num).toLocaleString(); }
        catch (_) { return String(num); }
    }

    function formatUptime(seconds) {
        if (!seconds || seconds < 0) return '—';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function formatTimeAgo(isoString) {
        if (!isoString || isoString === 'never') return 'Never';
        try {
            const date = new Date(isoString);
            const now = new Date();
            const diff = Math.floor((now - date) / 1000);
            if (isNaN(diff)) return String(isoString);
            if (diff < 5)     return 'Just now';
            if (diff < 60)    return diff + 's ago';
            if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
            if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
            return Math.floor(diff / 86400) + 'd ago';
        } catch (_) {
            return String(isoString);
        }
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // ---------- INIT (called by scripts.js initToolModules when tab mounts) ----------
    function init(rootEl) {
        panelEl = rootEl;
        if (!panelEl) {
            console.warn('[NetTraffic] init called with no panel element');
            return;
        }

        // Reset state (supports re-init on tab switch)
        isPaused = false;
        alertFilter = 'all';
        sortKey = 'packets';
        sortDir = 'desc';
        lastData = null;
        publishedAlertKeys.clear();

        // Chart.js presence check
        if (typeof Chart === 'undefined') {
            console.warn('[NetTraffic] Chart.js not loaded - chart will not render');
        }

        initChart();

        // Single delegated click listener (matches lan-discovery.js / vuln-scan.js pattern)
        panelEl.addEventListener('click', (ev) => {
            if (!panelEl.contains(ev.target)) return;

            // Pause toggle
            const pauseBtn = ev.target.closest('[data-net-action="toggle-pause"]');
            if (pauseBtn && panelEl.contains(pauseBtn)) {
                togglePause();
                return;
            }

            // Severity filter buttons
            const filterBtn = ev.target.closest('[data-net-filter]');
            if (filterBtn && panelEl.contains(filterBtn)) {
                setFilter(filterBtn.getAttribute('data-net-filter'));
                return;
            }

            // Sortable column headers
            const sortTh = ev.target.closest('[data-net-sort]');
            if (sortTh && panelEl.contains(sortTh)) {
                handleSortClick(sortTh);
                return;
            }
        });

        // Initial indicator render + start polling
        updateSortIndicators();
        updatePauseButton();
        startPolling();

        console.log('[NetTraffic] ready - polling ' + API_URL + ' every ' + POLL_INTERVAL_MS + 'ms');
    }

    // ---------- MODULE EXPORT ----------
    window.SOCTools = window.SOCTools || {};
    window.SOCTools.netTraffic = { init };

})();
