/**
 * ============================================================
 * HOMELAB DASHBOARD - SCRIPTS
 * ============================================================
 * Connects to the monitoring API on api.jonathan-castro.com
 * and populates the dashboard with live server data.
 * 
 * Auto-refreshes every 30 seconds.
 * ============================================================
 */
 
(function () {
    'use strict';
 
    // ====== CONFIGURATION ======
    const CONFIG = {
        apiBase: 'https://api.jonathan-castro.com',
        monitorEndpoint: '/api/monitor',
        refreshInterval: 30000, // 30 seconds
        apiKey: null, // Monitor endpoint is public (read-only)
    };
 
    // ====== STATE ======
    let refreshTimer = null;
    let isFirstLoad = true;
    let consecutiveErrors = 0;
 
    // ====== DOM REFERENCES ======
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);
 
    // ====== GAUGE CIRCUMFERENCE ======
    const CIRCUMFERENCE = 2 * Math.PI * 52; // r=52
 
    // ====== INITIALIZATION ======
    document.addEventListener('DOMContentLoaded', () => {
        setupRefreshButton();
        fetchAndRender();
        startAutoRefresh();
    });
 
    function setupRefreshButton() {
        const btn = $('#refreshBtn');
        if (btn) {
            btn.addEventListener('click', () => {
                btn.classList.add('spinning');
                fetchAndRender().finally(() => {
                    setTimeout(() => btn.classList.remove('spinning'), 800);
                });
            });
        }
    }
 
    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(fetchAndRender, CONFIG.refreshInterval);
    }
 
    // ====== DATA FETCHING ======
    async function fetchAndRender() {
        try {
            const response = await fetch(`${CONFIG.apiBase}${CONFIG.monitorEndpoint}`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            });
 
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
 
            const data = await response.json();
 
            if (!data.success) {
                throw new Error(data.error || 'API returned unsuccessful response');
            }
 
            consecutiveErrors = 0;
            hideConnectionError();
            renderDashboard(data.data);
 
            // Update last-updated timestamp
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
            });
            const el = $('#lastUpdated');
            if (el) el.textContent = `Updated ${timeStr}`;
 
            isFirstLoad = false;
        } catch (err) {
            console.error('Dashboard fetch error:', err);
            consecutiveErrors++;
 
            if (consecutiveErrors >= 2) {
                showConnectionError(`Connection lost — retrying (${err.message})`);
            }
 
            // On first load failure, show demo/offline state
            if (isFirstLoad) {
                renderOfflineState();
                isFirstLoad = false;
            }
        }
    }
 
    // ====== RENDER FUNCTIONS ======
 
    function renderDashboard(data) {
        renderVitals(data);
        renderServices(data.services);
        renderSSL(data.ssl);
        renderSecurity(data.security);
        renderSystemInfo(data.system);
        renderNetwork(data.network);
        renderDatabase(data.database);
        renderLogs(data.logs);
        renderUptime(data.system);
 
        // Server status dot
        const dot = $('#serverStatusDot');
        if (dot) {
            dot.classList.remove('online', 'offline');
            dot.classList.add('online');
        }
    }
 
    function renderVitals(data) {
        // CPU
        if (data.cpu) {
            setGauge('cpu', data.cpu.usage_percent, `${data.cpu.cores} cores @ ${data.cpu.model_short || data.cpu.model || '--'}`);
        }
 
        // Memory
        if (data.memory) {
            const memPercent = data.memory.percent;
            const usedGB = (data.memory.used_bytes / 1073741824).toFixed(1);
            const totalGB = (data.memory.total_bytes / 1073741824).toFixed(1);
            setGauge('mem', memPercent, `${usedGB} / ${totalGB} GB`);
        }
 
        // Disk: System
        if (data.disks && data.disks.system) {
            const d = data.disks.system;
            setGauge('diskSys', d.percent, `${d.used_human} / ${d.total_human}`);
        }
 
        // Disk: Storage
        if (data.disks && data.disks.storage) {
            const d = data.disks.storage;
            setGauge('diskStor', d.percent, `${d.used_human} / ${d.total_human}`);
        }
    }
 
    function setGauge(prefix, percent, detailText) {
        const value = Math.round(percent);
        const gaugeEl = $(`#${prefix}Gauge`);
        const valueEl = $(`#${prefix}Value`);
        const detailEl = $(`#${prefix}Detail`);
        const cardEl = $(`#${prefix}Card`);
 
        if (valueEl) valueEl.textContent = value;
        if (detailEl) detailEl.textContent = detailText;
 
        if (gaugeEl) {
            const offset = CIRCUMFERENCE - (CIRCUMFERENCE * value / 100);
            gaugeEl.style.strokeDashoffset = offset;
 
            // Color thresholds
            gaugeEl.classList.remove('warning', 'critical');
            if (value >= 90) {
                gaugeEl.classList.add('critical');
            } else if (value >= 75) {
                gaugeEl.classList.add('warning');
            }
        }
 
        if (cardEl) {
            cardEl.classList.remove('warning', 'critical');
            if (value >= 90) {
                cardEl.classList.add('critical');
            } else if (value >= 75) {
                cardEl.classList.add('warning');
            }
        }
    }
 
    function renderServices(services) {
        const container = $('#serviceList');
        if (!container || !services) return;
 
        container.innerHTML = '';
 
        const serviceEntries = Array.isArray(services) ? services : Object.entries(services).map(([name, info]) => ({
            name,
            ...(typeof info === 'string' ? { status: info } : info),
        }));
 
        serviceEntries.forEach(svc => {
            const isRunning = svc.status === 'running' || svc.status === 'active' || svc.active === true;
            const row = document.createElement('div');
            row.className = 'service-row';
            row.innerHTML = `
                <span class="svc-dot ${isRunning ? 'running' : 'stopped'}"></span>
                <span class="svc-name">${escapeHtml(svc.name)}</span>
                <span class="svc-status ${isRunning ? 'running' : 'stopped'}">${isRunning ? 'Running' : 'Stopped'}</span>
            `;
            container.appendChild(row);
        });
    }
 
    function renderSSL(ssl) {
        if (!ssl) return;
 
        const lockEl = $('#sslLock');
        const issuerEl = $('#sslIssuer');
        const expiryEl = $('#sslExpiry');
        const daysEl = $('#sslDaysLeft');
        const fillEl = $('#sslDaysFill');
 
        if (issuerEl) issuerEl.textContent = ssl.issuer || '--';
        if (expiryEl) expiryEl.textContent = ssl.expiry_date || '--';
 
        const daysLeft = ssl.days_remaining != null ? ssl.days_remaining : -1;
 
        if (daysEl) daysEl.textContent = daysLeft >= 0 ? `${daysLeft} days left` : 'Unknown';
 
        // Lock icon color
        if (lockEl) {
            lockEl.classList.remove('valid', 'expiring', 'expired');
            if (daysLeft > 30) lockEl.classList.add('valid');
            else if (daysLeft > 7) lockEl.classList.add('expiring');
            else lockEl.classList.add('expired');
        }
 
        // Progress bar (Let's Encrypt = 90 day cycle)
        if (fillEl) {
            const totalDays = 90;
            const pct = Math.max(0, Math.min(100, (daysLeft / totalDays) * 100));
            fillEl.style.width = `${pct}%`;
            fillEl.classList.remove('expiring', 'expired');
            if (daysLeft <= 7) fillEl.classList.add('expired');
            else if (daysLeft <= 30) fillEl.classList.add('expiring');
        }
    }
 
    function renderSecurity(security) {
        if (!security) return;
 
        const ufwEl = $('#ufwStatus');
        const f2bEl = $('#f2bStatus');
        const bannedEl = $('#f2bBanned');
        const portsEl = $('#openPorts');
        const lastAttackEl = $('#lastAttack');
 
        if (ufwEl) {
            ufwEl.textContent = security.ufw_active ? 'Active' : 'Inactive';
            ufwEl.className = `sec-value ${security.ufw_active ? 'active' : 'inactive'}`;
        }
 
        if (f2bEl) {
            f2bEl.textContent = security.fail2ban_active ? 'Active' : 'Inactive';
            f2bEl.className = `sec-value ${security.fail2ban_active ? 'active' : 'inactive'}`;
        }
 
        if (bannedEl) {
            bannedEl.textContent = security.banned_ips != null ? security.banned_ips : '--';
        }
 
        if (portsEl) {
            portsEl.textContent = security.open_ports || '--';
        }
 
        if (lastAttackEl) {
            lastAttackEl.textContent = security.last_attack || '--';
        }
    }
 
    function renderSystemInfo(system) {
        if (!system) return;
 
        setText('#infoHostname', system.hostname);
        setText('#infoOS', system.os);
        setText('#infoKernel', system.kernel);
        setText('#infoCPU', system.cpu_model);
        setText('#infoCPUTemp', system.cpu_temp ? `${system.cpu_temp}°C` : 'N/A');
        setText('#infoLoad', system.load_avg);
        setText('#infoProcs', system.processes);
        setText('#infoIP', system.local_ip || '192.168.0.22');
    }
 
    function renderUptime(system) {
        if (!system || !system.uptime) return;
        const el = $('#uptimeValue');
        if (el) el.textContent = system.uptime;
    }
 
    function renderNetwork(network) {
        if (!network) return;
        setText('#netInterface', network.interface);
        setText('#netRX', network.rx_human);
        setText('#netTX', network.tx_human);
        setText('#netDNS', network.dns);
    }
 
    function renderDatabase(db) {
        if (!db) return;
 
        const statusEl = $('#dbStatus');
        if (statusEl) {
            statusEl.textContent = db.active ? 'Running' : 'Stopped';
            statusEl.className = `info-val ${db.active ? '' : ''}`;
            statusEl.style.color = db.active ? 'var(--accent-green)' : 'var(--accent-red)';
        }
 
        setText('#dbVersion', db.version);
        setText('#dbSize', db.size_human);
        setText('#dbTables', db.tables);
        setText('#dbConns', db.connections);
    }
 
    function renderLogs(logs) {
        const container = $('#logFeed');
        if (!container || !logs || !logs.length) return;
 
        container.innerHTML = '';
 
        logs.forEach(log => {
            const entry = document.createElement('div');
            const level = (log.level || 'info').toLowerCase();
            entry.className = `log-entry ${level}`;
            entry.innerHTML = `<span class="log-time">${escapeHtml(log.time || '--')}</span>${escapeHtml(log.message || '')}`;
            container.appendChild(entry);
        });
    }
 
    // ====== OFFLINE / ERROR STATE ======
 
    function renderOfflineState() {
        const dot = $('#serverStatusDot');
        if (dot) {
            dot.classList.remove('online');
            dot.classList.add('offline');
        }
 
        const el = $('#lastUpdated');
        if (el) el.textContent = 'Offline — unable to reach server';
 
        showConnectionError('Cannot connect to api.jonathan-castro.com — make sure the monitor API is running');
    }
 
    function showConnectionError(message) {
        let el = document.querySelector('.connection-error');
        if (!el) {
            el = document.createElement('div');
            el.className = 'connection-error';
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.classList.add('show');
    }
 
    function hideConnectionError() {
        const el = document.querySelector('.connection-error');
        if (el) el.classList.remove('show');
    }
 
    // ====== HELPERS ======
 
    function setText(selector, value) {
        const el = $(selector);
        if (el && value != null) el.textContent = String(value);
    }
 
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
 
})();
