/* ============================================================
 * HOMELAB DASHBOARD - SCRIPTS
 * ============================================================
 * Connects to api.jonathan-castro.com/api/monitor and populates
 * the dashboard with live server data. Auto-refreshes every 10s.
 *
 * Pattern: IIFE-wrapped, data-homelab-* attributes only (no IDs),
 * all queries scoped to .homelab-page. Matches SOC tool module
 * style. No SOCState integration - Homelab is standalone.
 *
 * Backend API contract:
 *   GET /api/monitor (public, no auth)
 *   returns { success, timestamp, data: {
 *     cpu, memory, disks, services, ssl, security,
 *     system, network, database, logs
 *   } }
 * ============================================================
 */

(function () {
    'use strict';

    // ============ CONFIG ============
    const API_BASE = 'https://api.jonathan-castro.com';
    const MONITOR_ENDPOINT = '/api/monitor';
    const POLL_INTERVAL_MS = 10000; // 10 seconds (Q1)
    const GAUGE_RADIUS = 52;
    const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
    const ERROR_THRESHOLD = 2;
    const WARN_PCT = 75;
    const CRITICAL_PCT = 90;
    const SSL_CYCLE_DAYS = 90; // Let's Encrypt renewal cycle

    // Log severity filter levels (Q6)
    const LOG_LEVELS = {
        all:      ['info', 'success', 'warning', 'error'],
        warnings: ['warning', 'error'],
        errors:   ['error']
    };

    // ============ MODULE STATE ============
    let pageRoot = null;
    let pollTimer = null;
    let isFirstLoad = true;
    let consecutiveErrors = 0;
    let currentLogFilter = 'all';
    let lastLogs = [];

    // ============ DOM HELPERS ============
    // All queries scoped to pageRoot (.homelab-page) using data-homelab
    // attribute keys. No IDs, no document-wide selectors.
    function $(attr) {
        if (!pageRoot) return null;
        return pageRoot.querySelector('[data-homelab="' + attr + '"]');
    }
    function $$(attr) {
        if (!pageRoot) return [];
        return pageRoot.querySelectorAll('[data-homelab="' + attr + '"]');
    }
    function setText(attr, value) {
        const el = $(attr);
        if (el && value != null) el.textContent = String(value);
    }
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    // ============ DATA FETCHING ============
    async function fetchAndRender() {
        try {
            const response = await fetch(API_BASE + MONITOR_ENDPOINT, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }

            const payload = await response.json();

            if (!payload.success) {
                throw new Error(payload.error || 'API returned unsuccessful response');
            }

            consecutiveErrors = 0;
            hideConnectionError();
            renderDashboard(payload.data);
            updateTimestamp();
            setStatusDot('online');

            isFirstLoad = false;
        } catch (err) {
            console.error('[Homelab] fetch error:', err);
            consecutiveErrors++;

            if (consecutiveErrors >= ERROR_THRESHOLD) {
                showConnectionError('Connection lost - retrying (' + err.message + ')');
            }

            if (isFirstLoad) {
                renderOfflineState();
                isFirstLoad = false;
            }
        }
    }

    function updateTimestamp() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
        setText('last-updated', 'Updated ' + timeStr);
    }

    function setStatusDot(state) {
        const dot = $('status-dot');
        if (!dot) return;
        dot.classList.remove('online', 'offline');
        dot.classList.add(state);
    }

    // ============ RENDERERS ============
    function renderDashboard(data) {
        if (!data) return;
        renderVitals(data);
        renderServices(data.services);
        renderSSL(data.ssl);
        renderSecurity(data.security);
        renderSystemInfo(data.system);
        renderUptime(data.system);
        renderNetwork(data.network);
        renderDatabase(data.database);
        renderLogs(data.logs);
    }

    function renderVitals(data) {
        // CPU
        if (data.cpu) {
            const modelShort = data.cpu.model_short || data.cpu.model || '--';
            const detail = (data.cpu.cores || '--') + ' cores @ ' + modelShort;
            setGauge('cpu', data.cpu.usage_percent, detail);
        }

        // Memory
        if (data.memory) {
            const usedGB = (data.memory.used_bytes / 1073741824).toFixed(1);
            const totalGB = (data.memory.total_bytes / 1073741824).toFixed(1);
            setGauge('mem', data.memory.percent, usedGB + ' / ' + totalGB + ' GB');
        }

        // System Disk
        if (data.disks && data.disks.system) {
            const d = data.disks.system;
            setGauge('disk-sys', d.percent, d.used_human + ' / ' + d.total_human);
        }

        // Storage Disk (Q5: drop hardcoded "1TB" label, use live total)
        if (data.disks && data.disks.storage) {
            const d = data.disks.storage;
            setGauge('disk-stor', d.percent, d.used_human + ' / ' + d.total_human);
            const labelEl = $('disk-stor-label');
            if (labelEl && d.total_human) {
                labelEl.textContent = 'STORAGE (' + d.total_human + ')';
            }
        }
    }

    function setGauge(prefix, percent, detailText) {
        const value = Math.round(Number(percent) || 0);
        const gaugeEl = $(prefix + '-gauge');
        const valueEl = $(prefix + '-value');
        const detailEl = $(prefix + '-detail');
        const cardEl = $(prefix + '-card');

        if (valueEl) valueEl.textContent = value;
        if (detailEl) detailEl.textContent = detailText;

        if (gaugeEl) {
            const clamped = Math.max(0, Math.min(100, value));
            const offset = GAUGE_CIRCUMFERENCE - (GAUGE_CIRCUMFERENCE * clamped / 100);
            gaugeEl.style.strokeDashoffset = offset;
            gaugeEl.classList.remove('warning', 'critical');
            if (value >= CRITICAL_PCT) gaugeEl.classList.add('critical');
            else if (value >= WARN_PCT) gaugeEl.classList.add('warning');
        }

        if (cardEl) {
            cardEl.classList.remove('warning', 'critical');
            if (value >= CRITICAL_PCT) cardEl.classList.add('critical');
            else if (value >= WARN_PCT) cardEl.classList.add('warning');
        }
    }

    function renderServices(services) {
        const container = $('service-list');
        if (!container || !services) return;

        // Backend returns array; be defensive for either shape
        const entries = Array.isArray(services)
            ? services
            : Object.entries(services).map(function (pair) {
                const name = pair[0];
                const info = pair[1];
                const merged = { name: name };
                if (typeof info === 'string') merged.status = info;
                else Object.assign(merged, info);
                return merged;
            });

        container.innerHTML = '';

        entries.forEach(function (svc) {
            const isRunning = svc.status === 'running' ||
                              svc.status === 'active' ||
                              svc.active === true;
            const row = document.createElement('div');
            row.className = 'service-row';
            row.innerHTML =
                '<span class="svc-dot ' + (isRunning ? 'running' : 'stopped') + '"></span>' +
                '<span class="svc-name">' + escapeHtml(svc.name) + '</span>' +
                '<span class="svc-status ' + (isRunning ? 'running' : 'stopped') + '">' +
                (isRunning ? 'Running' : 'Stopped') + '</span>';
            container.appendChild(row);
        });
    }

    function renderSSL(ssl) {
        if (!ssl) return;

        const lockEl = $('ssl-lock');
        const domainEl = $('ssl-domain');
        const issuerEl = $('ssl-issuer');
        const expiryEl = $('ssl-expiry');
        const daysEl = $('ssl-days-left');
        const fillEl = $('ssl-days-fill');

        if (domainEl && ssl.domain) domainEl.textContent = ssl.domain;
        if (issuerEl) issuerEl.textContent = ssl.issuer || '--';
        if (expiryEl) expiryEl.textContent = ssl.expiry_date || '--';

        const daysLeft = ssl.days_remaining != null ? ssl.days_remaining : -1;

        if (daysEl) {
            daysEl.textContent = daysLeft >= 0 ? (daysLeft + ' days left') : 'Unknown';
        }

        if (lockEl) {
            lockEl.classList.remove('valid', 'expiring', 'expired');
            if (daysLeft > 30) lockEl.classList.add('valid');
            else if (daysLeft > 7) lockEl.classList.add('expiring');
            else lockEl.classList.add('expired');
        }

        if (fillEl) {
            const pct = Math.max(0, Math.min(100, (daysLeft / SSL_CYCLE_DAYS) * 100));
            fillEl.style.width = pct + '%';
            fillEl.classList.remove('expiring', 'expired');
            if (daysLeft <= 7) fillEl.classList.add('expired');
            else if (daysLeft <= 30) fillEl.classList.add('expiring');
        }
    }

    function renderSecurity(security) {
        if (!security) return;

        const ufwEl = $('ufw-status');
        const f2bEl = $('f2b-status');
        const bannedEl = $('f2b-banned');
        const portsEl = $('open-ports');
        const lastAttackEl = $('last-attack');

        if (ufwEl) {
            ufwEl.textContent = security.ufw_active ? 'Active' : 'Inactive';
            ufwEl.classList.remove('active', 'inactive');
            ufwEl.classList.add(security.ufw_active ? 'active' : 'inactive');
        }
        if (f2bEl) {
            f2bEl.textContent = security.fail2ban_active ? 'Active' : 'Inactive';
            f2bEl.classList.remove('active', 'inactive');
            f2bEl.classList.add(security.fail2ban_active ? 'active' : 'inactive');
        }
        if (bannedEl) {
            bannedEl.textContent = security.banned_ips != null ? security.banned_ips : '--';
        }
        if (portsEl) portsEl.textContent = security.open_ports || '--';
        if (lastAttackEl) lastAttackEl.textContent = security.last_attack || '--';
    }

    function renderSystemInfo(system) {
        if (!system) return;
        setText('info-hostname', system.hostname);
        setText('info-os', system.os);
        setText('info-kernel', system.kernel);
        setText('info-cpu', system.cpu_model);
        setText('info-cpu-temp', system.cpu_temp ? (system.cpu_temp + '\u00B0C') : 'N/A');
        setText('info-load', system.load_avg);
        setText('info-procs', system.processes);
        setText('info-ip', system.local_ip || '192.168.0.22');
    }

    function renderUptime(system) {
        if (!system || !system.uptime) return;
        setText('uptime-value', system.uptime);
    }

    function renderNetwork(network) {
        if (!network) return;
        setText('net-interface', network.interface);
        setText('net-rx', network.rx_human);
        setText('net-tx', network.tx_human);
        setText('net-dns', network.dns);
    }

    function renderDatabase(db) {
        if (!db) return;
        const statusEl = $('db-status');
        if (statusEl) {
            statusEl.textContent = db.active ? 'Running' : 'Stopped';
            statusEl.classList.remove('active', 'inactive');
            statusEl.classList.add(db.active ? 'active' : 'inactive');
        }
        setText('db-version', db.version);
        setText('db-size', db.size_human);
        setText('db-tables', db.tables);
        setText('db-conns', db.connections);
    }

    // ============ LOGS WITH SEVERITY FILTER (Q6) ============
    function renderLogs(logs) {
        if (Array.isArray(logs)) {
            lastLogs = logs;
        }
        const container = $('log-feed');
        if (!container) return;

        const allowed = LOG_LEVELS[currentLogFilter] || LOG_LEVELS.all;
        const filtered = lastLogs.filter(function (log) {
            const level = (log.level || 'info').toLowerCase();
            return allowed.indexOf(level) !== -1;
        });

        container.innerHTML = '';

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'log-entry log-empty';
            if (currentLogFilter === 'all') {
                empty.textContent = 'No recent log entries.';
            } else if (currentLogFilter === 'errors') {
                empty.textContent = 'No errors in the current feed.';
            } else {
                empty.textContent = 'No warnings or errors in the current feed.';
            }
            container.appendChild(empty);
            return;
        }

        filtered.forEach(function (log) {
            const entry = document.createElement('div');
            const level = (log.level || 'info').toLowerCase();
            entry.className = 'log-entry ' + level;
            entry.innerHTML =
                '<span class="log-time">' + escapeHtml(log.time || '--') + '</span>' +
                escapeHtml(log.message || '');
            container.appendChild(entry);
        });
    }

    function setupLogFilterChips() {
        const chips = $$('log-filter');
        chips.forEach(function (chip) {
            chip.addEventListener('click', function () {
                const filter = chip.getAttribute('data-homelab-filter') || 'all';
                currentLogFilter = filter;
                chips.forEach(function (c) { c.classList.remove('is-active'); });
                chip.classList.add('is-active');
                renderLogs(lastLogs);
            });
        });
    }

    // ============ OFFLINE / ERROR STATE ============
    function renderOfflineState() {
        setStatusDot('offline');
        setText('last-updated', 'Offline - unable to reach server');
        showConnectionError('Cannot connect to api.jonathan-castro.com - make sure the monitor API is running');
    }

    function showConnectionError(message) {
        if (!pageRoot) return;
        let el = pageRoot.querySelector('.connection-error');
        if (!el) {
            el = document.createElement('div');
            el.className = 'connection-error';
            pageRoot.appendChild(el);
        }
        el.textContent = message;
        el.classList.add('show');
    }

    function hideConnectionError() {
        if (!pageRoot) return;
        const el = pageRoot.querySelector('.connection-error');
        if (el) el.classList.remove('show');
    }

    // ============ REFRESH CONTROL ============
    function setupRefreshButton() {
        const btn = $('refresh-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            btn.classList.add('spinning');
            fetchAndRender().finally(function () {
                setTimeout(function () { btn.classList.remove('spinning'); }, 800);
            });
        });
    }

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(fetchAndRender, POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    // ============ INIT ============
    function init() {
        pageRoot = document.querySelector('.homelab-page');
        if (!pageRoot) {
            console.warn('[Homelab] .homelab-page not found - aborting init');
            return;
        }

        // Footer reflects actual poll interval (not hardcoded)
        setText('refresh-interval', (POLL_INTERVAL_MS / 1000) + 's');

        setupRefreshButton();
        setupLogFilterChips();
        fetchAndRender();
        startPolling();

        console.log('[Homelab] Dashboard ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
