/* ============================================================
   NETWORK TRAFFIC MONITOR — Custom 5 Scripts
   ============================================================
   Polls the API every 2 seconds and updates all dashboard
   components in real time. Uses Chart.js for the traffic graph.
   ============================================================ */

// ---- CONFIGURATION ----
const API_BASE = 'https://api.jonathan-castro.com/api/netmonitor';
const POLL_INTERVAL = 2000; // 2 seconds

// ---- STATE ----
let trafficChart = null;
let packetsPaused = false;
let alertFilter = 'all';
let previousPacketCount = 0;
let pollTimer = null;

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initChart();
    initControls();
    startPolling();
});

// ============================================================
// CHART SETUP
// ============================================================

function initChart() {
    const ctx = document.getElementById('trafficChart');
    if (!ctx) return;

    trafficChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Packets/sec',
                    data: [],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHitRadius: 10,
                },
                {
                    label: 'KB/sec',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.06)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHitRadius: 10,
                    yAxisID: 'y1',
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
                        color: '#8899b4',
                        font: { family: "'JetBrains Mono', monospace", size: 11 },
                        boxWidth: 12,
                        padding: 15,
                    }
                },
                tooltip: {
                    backgroundColor: '#151d2e',
                    borderColor: '#1e2d4a',
                    borderWidth: 1,
                    titleColor: '#e2e8f0',
                    bodyColor: '#8899b4',
                    titleFont: { family: "'JetBrains Mono', monospace" },
                    bodyFont: { family: "'JetBrains Mono', monospace" },
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#4a5a78',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                        maxTicksLimit: 10,
                        maxRotation: 0,
                    },
                    grid: { color: 'rgba(30, 45, 74, 0.3)' }
                },
                y: {
                    position: 'left',
                    ticks: {
                        color: '#3b82f6',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                    },
                    grid: { color: 'rgba(30, 45, 74, 0.3)' },
                    title: {
                        display: true,
                        text: 'Packets',
                        color: '#3b82f6',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                    }
                },
                y1: {
                    position: 'right',
                    ticks: {
                        color: '#10b981',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                    },
                    grid: { drawOnChartArea: false },
                    title: {
                        display: true,
                        text: 'KB/sec',
                        color: '#10b981',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                    }
                }
            }
        }
    });
}

// ============================================================
// CONTROLS
// ============================================================

function initControls() {
    // Pause button
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            packetsPaused = !packetsPaused;
            pauseBtn.classList.toggle('active', packetsPaused);
            pauseBtn.title = packetsPaused ? 'Resume' : 'Pause';
        });
    }

    // Alert filter buttons
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            alertFilter = btn.dataset.filter;
        });
    });
}

// ============================================================
// POLLING
// ============================================================

function startPolling() {
    fetchData();
    pollTimer = setInterval(fetchData, POLL_INTERVAL);
}

async function fetchData() {
    try {
        const response = await fetch(`${API_BASE}/state`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        updateDashboard(data);
    } catch (err) {
        updateStatus(false, err.message);
    }
}

// ============================================================
// DASHBOARD UPDATE
// ============================================================

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

    if (!packetsPaused) {
        updatePackets(data.recent_packets);
    }
}

// ---- STATUS ----
function updateStatus(online, error) {
    const badge = document.getElementById('statusBadge');
    const text = badge.querySelector('.status-text');

    if (online) {
        badge.classList.add('online');
        text.textContent = 'MONITORING';
    } else {
        badge.classList.remove('online');
        text.textContent = error || 'OFFLINE';
    }
}

// ---- HEADER META ----
function updateHeader(data) {
    const serverIp = document.getElementById('serverIp');
    const iface = document.getElementById('interfaceName');
    const uptime = document.getElementById('uptime');

    if (serverIp) serverIp.textContent = data.server_ip || '—';
    if (iface) iface.textContent = data.interface || '—';
    if (uptime) uptime.textContent = formatUptime(data.uptime_seconds || 0);
}

// ---- SUMMARY CARDS ----
function updateSummary(summary) {
    if (!summary) return;

    animateValue('totalPackets', summary.total_packets);
    document.getElementById('totalBytesIn').textContent = formatBytes(summary.total_bytes_in);
    document.getElementById('totalBytesOut').textContent = formatBytes(summary.total_bytes_out);
    animateValue('uniqueIps', summary.unique_ips);

    const alertCountEl = document.getElementById('alertCount');
    const alertCard = document.getElementById('alertCard');
    const breakdown = document.getElementById('alertBreakdown');

    alertCountEl.textContent = summary.alerts_total || 0;

    if (summary.alerts_critical > 0) {
        alertCard.classList.add('has-critical');
    } else {
        alertCard.classList.remove('has-critical');
    }

    if (breakdown) {
        let parts = [];
        if (summary.alerts_critical > 0) parts.push(`${summary.alerts_critical} crit`);
        if (summary.alerts_high > 0) parts.push(`${summary.alerts_high} high`);
        breakdown.textContent = parts.join(' · ');
    }
}

// ---- TRAFFIC CHART ----
function updateChart(timeline) {
    if (!trafficChart || !timeline || timeline.length === 0) return;

    const labels = timeline.map(t => {
        const d = new Date(t.timestamp * 1000);
        return d.toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' });
    });

    const packetData = timeline.map(t => t.packets);
    const byteData = timeline.map(t => Math.round(t.bytes / 1024 * 10) / 10); // KB

    trafficChart.data.labels = labels;
    trafficChart.data.datasets[0].data = packetData;
    trafficChart.data.datasets[1].data = byteData;
    trafficChart.update('none');
}

// ---- PROTOCOL BARS ----
function updateProtocols(protocols) {
    const container = document.getElementById('protocolBars');
    if (!container || !protocols) return;

    const total = Object.values(protocols).reduce((a, b) => a + b, 0);
    if (total === 0) {
        container.innerHTML = '<div class="empty-state">Waiting for data...</div>';
        return;
    }

    const ordered = Object.entries(protocols).sort((a, b) => b[1] - a[1]);

    container.innerHTML = ordered.map(([proto, count]) => {
        const pct = ((count / total) * 100).toFixed(1);
        const cssClass = proto.toLowerCase();
        return `
            <div class="protocol-bar-item">
                <div class="protocol-bar-label">
                    <span class="name">${proto}</span>
                    <span class="count">${formatNumber(count)} (${pct}%)</span>
                </div>
                <div class="protocol-bar-track">
                    <div class="protocol-bar-fill ${cssClass}" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

// ---- THREAT INTEL ----
function updateThreatInfo(data) {
    const container = document.getElementById('threatInfo');
    if (!container) return;

    container.innerHTML = `
        <div class="threat-stat">
            <span class="label">Known Threats Loaded</span>
            <span class="value">${formatNumber(data.threat_intel_loaded || 0)}</span>
        </div>
        <div class="threat-stat">
            <span class="label">Last Updated</span>
            <span class="value">${data.threat_intel_updated === 'never' ? 'Never' : formatTimeAgo(data.threat_intel_updated)}</span>
        </div>
        <div class="threat-stat">
            <span class="label">Active Connections</span>
            <span class="value">${formatNumber(data.summary?.active_connections || 0)}</span>
        </div>
    `;
}

// ---- TOP TALKERS TABLE ----
function updateTopTalkers(talkers) {
    const tbody = document.getElementById('talkersBody');
    const countEl = document.getElementById('talkerCount');
    if (!tbody) return;

    if (!talkers || talkers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Waiting for data...</td></tr>';
        if (countEl) countEl.textContent = '0 IPs tracked';
        return;
    }

    if (countEl) countEl.textContent = `${talkers.length} IPs tracked`;

    tbody.innerHTML = talkers.map(t => {
        // Determine type badge
        let typeBadge;
        if (t.is_whitelisted) typeBadge = '<span class="type-badge whitelisted">safe</span>';
        else if (t.is_private) typeBadge = '<span class="type-badge private">private</span>';
        else typeBadge = '<span class="type-badge public">public</span>';

        // Determine status
        let statusTag;
        if (t.is_malicious) statusTag = '<span class="status-tag malicious">threat</span>';
        else if (t.packets > 200 || t.connections > 15) statusTag = '<span class="status-tag suspicious">watch</span>';
        else statusTag = '<span class="status-tag safe">ok</span>';

        // Ports list
        const ports = t.ports?.slice(0, 6).map(p => p).join(', ') || '—';
        const moreCount = (t.ports?.length || 0) - 6;
        const portsDisplay = moreCount > 0 ? `${ports} +${moreCount}` : ports;

        return `
            <tr>
                <td><span class="ip-badge">${t.ip}</span></td>
                <td>${typeBadge}</td>
                <td>${formatNumber(t.packets)}</td>
                <td>${formatBytes(t.bytes_in)}</td>
                <td>${formatBytes(t.bytes_out)}</td>
                <td>${t.connections}</td>
                <td><span class="ports-list">${portsDisplay}</span></td>
                <td>${statusTag}</td>
            </tr>
        `;
    }).join('');
}

// ---- ALERTS LIST ----
function updateAlerts(alerts) {
    const container = document.getElementById('alertsList');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
        container.innerHTML = '<div class="empty-state">No alerts yet — monitoring...</div>';
        return;
    }

    // Apply filter
    let filtered = alerts;
    if (alertFilter !== 'all') {
        filtered = alerts.filter(a => a.severity === alertFilter);
    }

    // Show newest first
    filtered = [...filtered].reverse();

    container.innerHTML = filtered.map(a => `
        <div class="alert-item ${a.severity}">
            <span class="alert-severity">${a.severity}</span>
            <div class="alert-content">
                <div class="alert-title">${escapeHtml(a.title)}</div>
                <div class="alert-details">${escapeHtml(a.details)}</div>
                <div class="alert-time">${formatTimeAgo(a.timestamp)}</div>
            </div>
        </div>
    `).join('');
}

// ---- LIVE PACKETS ----
function updatePackets(pkts) {
    const feed = document.getElementById('packetsFeed');
    if (!feed || !pkts || pkts.length === 0) return;

    // Show newest first, limit to 50
    const recent = [...pkts].reverse().slice(0, 50);

    feed.innerHTML = recent.map(p => {
        const time = new Date(p.timestamp).toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const proto = p.protocol || 'OTHER';
        const direction = p.direction || 'inbound';
        const arrow = direction === 'inbound' ? '↓' : '↑';
        const size = p.length > 0 ? formatBytes(p.length) : '';
        const service = p.service || '';

        return `
            <div class="packet-line">
                <span class="packet-time">${time}</span>
                <span class="packet-proto ${proto.toLowerCase()}">${proto}</span>
                <span class="packet-direction ${direction}">${arrow}</span>
                <span class="packet-addrs">${p.src_ip}:${p.src_port} → ${p.dst_ip}:${p.dst_port}</span>
                <span class="packet-size">${size}</span>
                <span class="packet-service">${service}</span>
            </div>
        `;
    }).join('');
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
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

        if (diff < 5) return 'Just now';
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    } catch {
        return isoString;
    }
}

function animateValue(elementId, newValue) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = formatNumber(newValue);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
