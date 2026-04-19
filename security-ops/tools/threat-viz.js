/* =============================================================
   ThreatViz - SOC Tools Module
   =============================================================
   Real-time threat intelligence dashboard. The "synthesis" view
   of the entire SOC: combines live backend threat data (events,
   attackers, geo, honeypot, blocklist) with cross-tool state
   pulled from window.SOCState (LAN scans, vuln scans, NetMon
   alerts, SIEM events).

   API endpoints (all on api.jonathan-castro.com, auth via Bearer):
     GET    /api/threat/stats
     GET    /api/threat/events?limit=50
     GET    /api/threat/attackers?limit=20|100  (also feeds map)
     GET    /api/threat/timeline                (24h hourly)
     GET    /api/threat/countries
     GET    /api/threat/honeypot?limit=100
     GET    /api/threat/usernames
     GET    /api/threat/passwords
     GET    /api/threat/blocklist
     GET    /api/threat/health
     POST   /api/threat/block { ip, reason }
     DELETE /api/threat/block/:ip

   Sub-tabs: Overview / Threat Map / Honeypot / Blocklist
   Markup attributes: data-viz-* ONLY (NO IDs)
   ============================================================= */

(function () {
    'use strict';

    // ============ CONFIG ============
    const API_BASE = 'https://api.jonathan-castro.com';
    const POLL_INTERVAL_MS = 10000;       // 10s for general data
    const MAP_POLL_INTERVAL_MS = 15000;   // 15s for map data
    const SERVER_COORDS = [29.7370, -95.5537]; // Houston TX 77042 (Westchase)

    const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    // Event type -> color (drives map markers, attack feed badges, legend)
    const EVENT_COLORS = {
        ssh_brute_force: '#ff1744',
        web_probe:       '#ff9100',
        ufw_block:       '#ffd600',
        honeypot:        '#b388ff',
        port_scan:       '#00e5ff',
        auth_failure:    '#ff6d00',
        DEFAULT:         '#00e5ff',
    };

    const EVENT_LABELS = {
        ssh_brute_force: 'SSH Brute Force',
        web_probe:       'Web Probe',
        ufw_block:       'UFW Block',
        honeypot:        'Honeypot',
        port_scan:       'Port Scan',
        auth_failure:    'Auth Failure',
    };

    // Sub-tabs (Q1A: 4 nested tabs inside the SOC ThreatViz panel)
    const SUB_TABS = ['overview', 'map', 'honeypot', 'blocklist'];

    // ============ MODULE STATE (per-init) ============
    let panelEl          = null;   // root .panel-viz element
    let pollTimer        = null;   // general poll setInterval handle
    let mapPollTimer     = null;   // map poll setInterval handle
    let leafletMap       = null;   // L.map instance (null until Threat Map opened)
    let serverMarker     = null;   // green pulsing dot at SERVER_COORDS
    let attackMarkers    = [];     // L.circleMarker per attacker
    let attackLines      = [];     // L.polyline per attacker -> server
    let eventTypeChart   = null;   // Chart.js horizontal bar (Overview)
    let timelineChart    = null;   // Chart.js line chart (Overview, 24h)
    let currentSubTab    = 'overview';
    let mapInitialized   = false;  // lazy init: only when Threat Map first opened
    let lastAttackersData = null;  // cached for re-render on correlation update
    let lastEventsData   = null;
    let correlatedIPs    = new Set(); // SOCState IPs that overlap attacker IPs
    let subscriptions    = [];     // SOCState event unsub functions
    let darkPopupStylesInjected = false;
    let isFetching       = false;  // re-entry guard for fetchAll

    // ============ DOM HELPERS (scoped to panelEl) ============
    function $(sel)  { return panelEl ? panelEl.querySelector(sel)    : null; }
    function $$(sel) { return panelEl ? panelEl.querySelectorAll(sel) : []; }

    function setText(sel, val) {
        const el = $(sel);
        if (el) el.textContent = (val === undefined || val === null) ? '--' : String(val);
    }

    // ============ UTILITIES ============
    function esc(s) {
        if (s === null || s === undefined) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function eventColor(type) {
        return EVENT_COLORS[type] || EVENT_COLORS.DEFAULT;
    }

    function eventLabel(type) {
        return EVENT_LABELS[type] || (type ? String(type).replace(/_/g, ' ') : 'Unknown');
    }

    function timeAgo(dateStr) {
        if (!dateStr) return '--';
        const t = new Date(dateStr).getTime();
        if (isNaN(t)) return '--';
        const diff = (Date.now() - t) / 1000;
        if (diff < 60)    return Math.floor(diff) + 's ago';
        if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }

    function shortTime(dateStr) {
        if (!dateStr) return '--';
        try {
            return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch { return '--'; }
    }

    function formatDate(dateStr) {
        if (!dateStr) return '--';
        try {
            return new Date(dateStr).toLocaleString([], {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
        } catch { return '--'; }
    }

    function countryFlag(code) {
        if (!code || code.length !== 2) return '🌐';
        const c = code.toUpperCase();
        return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
    }

    function severityRank(sev) {
        if (!sev) return 0;
        const s = String(sev).toLowerCase();
        if (s === 'critical') return 4;
        if (s === 'high')     return 3;
        if (s === 'medium')   return 2;
        if (s === 'low')      return 1;
        return 0;
    }

    function isValidIpString(ip) {
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(String(ip || ''));
    }

    // ============ API HELPER (uses SOCState.auth.token) ============
    async function api(path, options) {
        options = options || {};
        const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
        const token = (window.SOCState && typeof window.SOCState.getAuthToken === 'function')
            ? window.SOCState.getAuthToken()
            : null;
        if (token) headers['Authorization'] = 'Bearer ' + token;

        try {
            const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
            // For 4xx like 409 Conflict, parse the JSON so error messages bubble up.
            if (!res.ok) {
                try {
                    const errData = await res.json();
                    errData._httpStatus = res.status;
                    return errData;
                } catch {
                    return { _httpStatus: res.status, error: 'HTTP ' + res.status };
                }
            }
            return await res.json();
        } catch (err) {
            console.error('[ThreatViz] API error:', path, err);
            return null;
        }
    }

    // ============ AUTH UI (Q2A: reuse SOC auth, inline overlay) ============
    function isAuthed() {
        return !!(window.SOCState && typeof window.SOCState.isAuthenticated === 'function'
                  && window.SOCState.isAuthenticated());
    }

    function updateAuthUi() {
        const overlay = $('[data-viz=auth-overlay]');
        if (!overlay) return;
        const authed = isAuthed();
        overlay.hidden = authed;
        // When auth flips on, kick off polling. When it flips off, stop polling.
        if (authed) {
            startPolling();
        } else {
            stopPolling();
            // Also stop map polling and reset map state so re-login re-inits cleanly.
            stopMapPolling();
        }
    }

    // ============ CROSS-TOOL CORRELATION (Q4B: full integration) ============
    /*
     * Build a Set of "concerning IPs" from cross-tool SOCState data:
     *   - SOCState.scanResults: any host scanned with severity >= medium
     *   - SOCState.networkAlerts: any alert source IP
     *   - SOCState.siemEvents: any event source IP (medium+ severity)
     * Then intersect with the latest /api/threat/attackers IP list.
     * The intersection is correlatedIPs - those get .is-correlated styling
     * on map markers, attacker rows, and attack feed rows.
     */
    function buildConcerningIpsFromSOC() {
        const set = new Set();
        if (!window.SOCState) return set;

        // From vuln/lan scans (medium severity or worse)
        const scans = window.SOCState.scanResults || [];
        for (const s of scans) {
            if (severityRank(s.severity) >= 2 && isValidIpString(s.target)) {
                set.add(s.target);
            }
        }

        // From NetMon alerts (any source IP)
        const alerts = window.SOCState.networkAlerts || [];
        for (const a of alerts) {
            if (a.srcIp && isValidIpString(a.srcIp)) set.add(a.srcIp);
            if (a.dstIp && isValidIpString(a.dstIp)) set.add(a.dstIp);
        }

        // From SIEM events (medium+ severity, source IP)
        const events = window.SOCState.siemEvents || [];
        for (const e of events) {
            if (severityRank(e.severity) >= 2) {
                if (e.srcIp && isValidIpString(e.srcIp)) set.add(e.srcIp);
                if (e.sourceIp && isValidIpString(e.sourceIp)) set.add(e.sourceIp);
            }
        }
        return set;
    }

    function recomputeCorrelations() {
        const concerning = buildConcerningIpsFromSOC();
        const attackerIps = new Set();
        const list = (lastAttackersData && (lastAttackersData.attackers || lastAttackersData)) || [];
        for (const a of list) {
            if (a && a.ip) attackerIps.add(a.ip);
        }
        // Intersection
        const next = new Set();
        for (const ip of concerning) {
            if (attackerIps.has(ip)) next.add(ip);
        }
        const changed = next.size !== correlatedIPs.size
            || [...next].some(ip => !correlatedIPs.has(ip));
        correlatedIPs = next;

        if (changed) {
            // Re-render anything that visually depends on correlation status
            if (lastAttackersData) {
                renderTopAttackers(lastAttackersData);
                if (mapInitialized) renderMapData(lastAttackersData);
            }
            if (lastEventsData) renderRecentEvents(lastEventsData);
            renderCorrelationBadge();
        }
    }

    function renderCorrelationBadge() {
        // Display a count chip near the dashboard title showing # of cross-tool correlations
        const el = $('[data-viz=correlation-count]');
        if (!el) return;
        const n = correlatedIPs.size;
        if (n > 0) {
            el.hidden = false;
            el.textContent = n + ' cross-tool match' + (n === 1 ? '' : 'es');
        } else {
            el.hidden = true;
            el.textContent = '';
        }
    }

    // ============ SUB-TAB MANAGEMENT (Q1A: 4 nested tabs) ============
    function switchSubTab(name) {
        if (!SUB_TABS.includes(name) || name === currentSubTab) return;

        // Buttons: flip is-active + aria-selected
        $$('[data-viz-subtab]').forEach(btn => {
            const active = btn.getAttribute('data-viz-subtab') === name;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            btn.tabIndex = active ? 0 : -1;
        });

        // Panels: hidden attr toggle
        SUB_TABS.forEach(t => {
            const p = $('[data-viz-subpanel="' + t + '"]');
            if (p) p.hidden = (t !== name);
        });

        currentSubTab = name;

        // Lazy-init Leaflet map first time the Threat Map tab is opened
        if (name === 'map' && !mapInitialized && isAuthed()) {
            initMap();
            mapInitialized = true;
        }

        // If we just switched to a tab that needs fresh data, kick a fetch
        if (isAuthed() && (name === 'honeypot' || name === 'blocklist' || name === 'overview')) {
            fetchAll();
        }
    }

    // ============ POLLING ============
    function startPolling() {
        if (pollTimer) return; // already running
        fetchAll();
        pollTimer = setInterval(fetchAll, POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function startMapPolling() {
        if (mapPollTimer) return;
        fetchMapData();
        mapPollTimer = setInterval(fetchMapData, MAP_POLL_INTERVAL_MS);
    }

    function stopMapPolling() {
        if (mapPollTimer) {
            clearInterval(mapPollTimer);
            mapPollTimer = null;
        }
    }

    async function fetchAll() {
        if (!isAuthed()) return;
        if (isFetching) return;
        isFetching = true;
        try {
            // Always fetch the always-visible stuff (Overview cards + health)
            const [stats, events, attackers, countries, health] = await Promise.all([
                api('/api/threat/stats'),
                api('/api/threat/events?limit=50'),
                api('/api/threat/attackers?limit=20'),
                api('/api/threat/countries'),
                api('/api/threat/health'),
            ]);

            if (stats)     renderStats(stats);
            if (events)    { lastEventsData = events; renderRecentEvents(events); }
            if (attackers) {
                lastAttackersData = attackers;
                renderTopAttackers(attackers);
                if (mapInitialized) renderMapData(attackers);
            }
            if (countries) renderCountryGrid(countries);
            if (health)    renderHealth(health);

            recomputeCorrelations();

            const ts = new Date().toLocaleTimeString();
            setText('[data-viz=last-update]', 'Updated ' + ts);

            // Tab-specific fetches
            if (currentSubTab === 'overview') {
                const timeline = await api('/api/threat/timeline');
                if (timeline) renderTimelineChart(timeline);
                if (stats)    renderEventTypeChart(stats);
            }

            if (currentSubTab === 'honeypot') {
                const [hpEvents, usernames, passwords] = await Promise.all([
                    api('/api/threat/honeypot?limit=100'),
                    api('/api/threat/usernames'),
                    api('/api/threat/passwords'),
                ]);
                renderHoneypotStats(hpEvents, usernames, passwords);
                if (hpEvents) renderHoneypotFeed(hpEvents);
            }

            if (currentSubTab === 'blocklist') {
                const blocked = await api('/api/threat/blocklist');
                if (blocked) renderBlockedIPs(blocked);
            }
        } finally {
            isFetching = false;
        }
    }

    // ============ RENDER: STATS (6 cards) ============
    function renderStats(data) {
        if (!data) return;
        setText('[data-viz=stat-total-events]', data.total_events ?? 0);
        setText('[data-viz=stat-attackers]',   data.unique_ips ?? 0);
        setText('[data-viz=stat-countries]',   data.countries ?? 0);
        setText('[data-viz=stat-blocked]',     data.active_blocks ?? 0);

        // SSH attempts pulled from attack_types array
        const sshEntry = (data.attack_types || []).find(t => t.event_type === 'ssh_brute_force');
        setText('[data-viz=stat-ssh]', sshEntry ? sshEntry.count : 0);
        setText('[data-viz=stat-honeypot]', data.honeypot_events ?? 0);
    }

    // ============ RENDER: HEALTH BADGE ============
    function renderHealth(data) {
        const badge = $('[data-viz=health-badge]');
        const text  = $('[data-viz=health-text]');
        if (!badge || !text) return;
        if (data && data.status === 'ok' && (data.threat_events || 0) > 0) {
            badge.classList.remove('is-offline');
            badge.classList.add('is-online');
            text.textContent = 'Collector Active';
        } else {
            badge.classList.remove('is-online');
            badge.classList.add('is-offline');
            text.textContent = 'Collector Offline';
        }
    }

    // ============ RENDER: EVENT TYPE CHART (HORIZONTAL BAR per Q-bonus) ============
    function renderEventTypeChart(stats) {
        const canvas = $('[data-viz=event-type-canvas]');
        if (!canvas || typeof Chart === 'undefined') return;

        const typesArr = stats.attack_types || [];
        if (!typesArr.length) {
            // Clear chart if it was rendered before
            if (eventTypeChart) {
                eventTypeChart.data.labels = [];
                eventTypeChart.data.datasets[0].data = [];
                eventTypeChart.update('none');
            }
            return;
        }

        // Sort descending by count
        const sorted = [...typesArr].sort((a, b) => (b.count || 0) - (a.count || 0));
        const labels = sorted.map(t => eventLabel(t.event_type));
        const values = sorted.map(t => t.count);
        const colors = sorted.map(t => eventColor(t.event_type));

        if (eventTypeChart) {
            eventTypeChart.data.labels = labels;
            eventTypeChart.data.datasets[0].data = values;
            eventTypeChart.data.datasets[0].backgroundColor = colors.map(c => c + 'cc');
            eventTypeChart.data.datasets[0].borderColor     = colors;
            eventTypeChart.update('none');
            return;
        }

        eventTypeChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors.map(c => c + 'cc'),
                    borderColor: colors,
                    borderWidth: 1.5,
                    borderRadius: 4,
                    barThickness: 'flex',
                    maxBarThickness: 26,
                }],
            },
            options: {
                indexAxis: 'y',                  // horizontal bars
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { color: '#7a8294', font: { family: 'JetBrains Mono', size: 10 } },
                        grid:  { color: 'rgba(255,255,255,0.04)' },
                    },
                    y: {
                        ticks: { color: '#cbd1dc', font: { family: 'JetBrains Mono', size: 11 } },
                        grid:  { display: false },
                    },
                },
            },
        });
    }

    // ============ RENDER: TIMELINE CHART (24h line) ============
    function renderTimelineChart(data) {
        const canvas = $('[data-viz=timeline-canvas]');
        if (!canvas || typeof Chart === 'undefined') return;

        const entries = data.timeline || data.hourly || data || [];
        const labels  = entries.map(e => e.hour || e.label || '--');
        const values  = entries.map(e => e.count || e.events || 0);

        if (timelineChart) {
            timelineChart.data.labels = labels;
            timelineChart.data.datasets[0].data = values;
            timelineChart.update('none');
            return;
        }

        timelineChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Events',
                    data: values,
                    borderColor:    '#ff5722',
                    backgroundColor: 'rgba(255, 87, 34, 0.12)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 2,
                    pointBackgroundColor: '#ff5722',
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: { color: '#7a8294', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 45 },
                        grid:  { color: 'rgba(255,255,255,0.04)' },
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#7a8294', font: { family: 'JetBrains Mono', size: 10 } },
                        grid:  { color: 'rgba(255,255,255,0.04)' },
                    },
                },
                plugins: { legend: { display: false } },
            },
        });
    }


    // ============ RENDER: TOP ATTACKERS (with .is-correlated highlight) ============
    function renderTopAttackers(data) {
        const container = $('[data-viz=top-attackers]');
        if (!container) return;

        const attackers = (data && (data.attackers || data)) || [];
        if (!Array.isArray(attackers) || !attackers.length) {
            container.innerHTML = '<div class="viz-empty">No attacker profiles yet</div>';
            return;
        }

        container.innerHTML = attackers.map(a => {
            const ip      = a.ip || '--';
            const country = a.country_code || a.country || '';
            const flag    = countryFlag(country);
            const events  = a.total_attacks || a.total_events || 0;
            const isCorr  = correlatedIPs.has(ip);
            const corrTag = isCorr
                ? '<span class="viz-corr-tag" title="Cross-tool correlation: this IP also appears in your SOC tools">CORRELATED</span>'
                : '';
            return '<div class="viz-list-item' + (isCorr ? ' is-correlated' : '') + '">' +
                '<div class="viz-list-left">' +
                    '<span class="viz-flag">' + flag + '</span>' +
                    '<span class="viz-list-ip">' + esc(ip) + '</span>' +
                    '<span class="viz-list-loc">' + esc(a.city || a.country || '') + '</span>' +
                    corrTag +
                '</div>' +
                '<span class="viz-list-badge viz-sev-critical">' + events + ' attacks</span>' +
            '</div>';
        }).join('');
    }

    // ============ RENDER: RECENT EVENTS ============
    function renderRecentEvents(data) {
        const container = $('[data-viz=recent-events]');
        if (!container) return;

        const events = (data && (data.events || data)) || [];
        if (!Array.isArray(events) || !events.length) {
            container.innerHTML = '<div class="viz-empty">No events yet</div>';
            return;
        }

        container.innerHTML = events.slice(0, 30).map(e => {
            const type   = e.event_type || e.type;
            const color  = eventColor(type);
            const srcIp  = e.source_ip || e.ip || '';
            const isCorr = srcIp && correlatedIPs.has(srcIp);
            return '<div class="viz-event-item' + (isCorr ? ' is-correlated' : '') + '">' +
                '<div class="viz-event-dot" style="background:' + color + '"></div>' +
                '<div class="viz-event-info">' +
                    '<div class="viz-event-msg">' + esc(e.description || e.message || eventLabel(type)) + '</div>' +
                    '<div class="viz-event-meta">' +
                        '<span>' + esc(srcIp || '--') + '</span>' +
                        '<span>' + esc(eventLabel(type)) + '</span>' +
                        '<span>' + timeAgo(e.created_at || e.timestamp) + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // ============ RENDER: COUNTRY GRID ============
    function renderCountryGrid(data) {
        const container = $('[data-viz=country-grid]');
        if (!container) return;

        const countries = (data && (data.countries || data)) || [];
        if (!Array.isArray(countries) || !countries.length) {
            container.innerHTML = '<div class="viz-empty">No country data yet</div>';
            return;
        }

        const sorted = [...countries].sort((a, b) => (b.attacks || 0) - (a.attacks || 0));

        container.innerHTML = sorted.map(c => {
            const code    = c.country_code || '';
            const name    = c.country || code || '--';
            const attacks = c.attacks || 0;
            const ips     = c.unique_ips || 0;
            return '<div class="viz-country-tile" title="' + esc(ips) + ' unique IPs">' +
                '<span class="viz-country-flag">' + countryFlag(code) + '</span>' +
                '<span class="viz-country-name">' + esc(name) + '</span>' +
                '<span class="viz-country-count">' + attacks + '</span>' +
            '</div>';
        }).join('');
    }

    // ============ LEAFLET MAP ============
    function injectMapStyles() {
        if (darkPopupStylesInjected) return;
        const style = document.createElement('style');
        style.setAttribute('data-viz-style', 'leaflet-dark-popup');
        style.textContent = [
            '.viz-dark-popup .leaflet-popup-content-wrapper {',
            '  background: #111827 !important;',
            '  color: #e2e8f0 !important;',
            '  border-radius: 8px !important;',
            '  box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;',
            '  border: 1px solid rgba(255,255,255,0.06) !important;',
            '}',
            '.viz-dark-popup .leaflet-popup-tip {',
            '  background: #111827 !important;',
            '  border: 1px solid rgba(255,255,255,0.06) !important;',
            '}',
            '.viz-dark-popup .leaflet-popup-content { margin: 8px 12px !important; }',
            '.leaflet-container .leaflet-popup-close-button {',
            '  color: #8892a4 !important;',
            '  font-size: 18px !important;',
            '}',
        ].join('\n');
        document.head.appendChild(style);
        darkPopupStylesInjected = true;
    }

    function initMap() {
        const mapEl = $('[data-viz=map-container]');
        if (!mapEl || typeof L === 'undefined') return;

        // Tear down any prior instance just in case (re-init safety)
        if (leafletMap) {
            try { leafletMap.remove(); } catch (_) {}
            leafletMap = null;
        }

        leafletMap = L.map(mapEl, {
            center: [25, 0],
            zoom: 2,
            minZoom: 2,
            maxZoom: 10,
            zoomControl: true,
            attributionControl: false,
            worldCopyJump: true,
        });

        L.tileLayer(TILE_URL, { maxZoom: 19 }).addTo(leafletMap);

        // Server marker (green pulsing dot at SERVER_COORDS)
        const serverIcon = L.divIcon({
            className: 'viz-server-marker',
            html: '<div style="width:14px;height:14px;background:#00e676;border-radius:50%;border:2px solid #080b12;box-shadow:0 0 12px rgba(0,230,118,0.6)"></div>',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
        });
        serverMarker = L.marker(SERVER_COORDS, { icon: serverIcon })
            .addTo(leafletMap)
            .bindPopup('<b style="color:#00e676">Your Server</b><br>jonathan-castro.com', { className: 'viz-dark-popup' });

        injectMapStyles();

        // Render any data we already have, then start polling
        if (lastAttackersData) renderMapData(lastAttackersData);
        startMapPolling();
    }

    function destroyMap() {
        // Memory leak guard: tear down Leaflet instance + clear marker arrays
        stopMapPolling();
        attackMarkers.forEach(m => { try { leafletMap && leafletMap.removeLayer(m); } catch (_) {} });
        attackLines.forEach(l   => { try { leafletMap && leafletMap.removeLayer(l); } catch (_) {} });
        attackMarkers = [];
        attackLines   = [];
        if (serverMarker && leafletMap) {
            try { leafletMap.removeLayer(serverMarker); } catch (_) {}
        }
        serverMarker = null;
        if (leafletMap) {
            try { leafletMap.remove(); } catch (_) {}
            leafletMap = null;
        }
        mapInitialized = false;
    }

    async function fetchMapData() {
        if (!isAuthed()) return;
        const attackers = await api('/api/threat/attackers?limit=100');
        if (attackers) {
            lastAttackersData = attackers;
            renderMapData(attackers);
            // Map data updates may surface new correlations
            recomputeCorrelations();
        }
    }

    function renderMapData(data) {
        if (!leafletMap) return;

        // Clear previous markers + lines
        attackMarkers.forEach(m => { try { leafletMap.removeLayer(m); } catch (_) {} });
        attackLines.forEach(l   => { try { leafletMap.removeLayer(l); } catch (_) {} });
        attackMarkers = [];
        attackLines   = [];

        const geoArr = (data && (data.attackers || data)) || [];
        let liveCount = 0;
        let totalHits = 0;
        const countriesSet = new Set();

        geoArr.forEach(a => {
            const lat = parseFloat(a.latitude);
            const lng = parseFloat(a.longitude);
            if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;

            const events = a.total_attacks || a.total_events || 1;
            // Determine primary attack type from attack_types object
            let type = 'web_probe';
            if (a.attack_types && typeof a.attack_types === 'object') {
                const sorted = Object.entries(a.attack_types).sort((x, y) => y[1] - x[1]);
                if (sorted.length) type = sorted[0][0];
            }
            const color   = eventColor(type);
            const ip      = a.ip || '';
            const country = a.country_code || a.country || '';
            const isCorr  = ip && correlatedIPs.has(ip);

            if (country) countriesSet.add(country);
            liveCount++;
            totalHits += events;

            // Attacker marker (pulsing circle), correlated IPs get a brighter ember outer ring
            const radius = Math.min(4 + Math.log2(events + 1) * 3, 18);
            const marker = L.circleMarker([lat, lng], {
                radius,
                color:       isCorr ? '#ff8a3d' : color,
                fillColor:   color,
                fillOpacity: 0.35,
                weight:      isCorr ? 3 : 1.5,
                opacity:     isCorr ? 1 : 0.8,
                className:   isCorr ? 'viz-attack-marker is-correlated' : 'viz-attack-marker',
            }).addTo(leafletMap);

            const corrLine = isCorr
                ? '<div style="color:#ff8a3d;font-weight:700;margin-top:4px">⚡ Cross-tool correlation</div>'
                : '';
            marker.bindPopup(
                '<div style="font-family:monospace;font-size:12px;color:#e2e8f0;background:#111827;padding:8px;border-radius:6px;min-width:180px">' +
                    '<div style="color:' + color + ';font-weight:700;margin-bottom:4px">' + esc(ip) + '</div>' +
                    '<div>Type: ' + esc(eventLabel(type)) + '</div>' +
                    '<div>Country: ' + countryFlag(country) + ' ' + esc(a.country || '') + '</div>' +
                    '<div>City: ' + esc(a.city || '--') + '</div>' +
                    '<div>ISP: ' + esc(a.isp || '--') + '</div>' +
                    '<div>Attacks: ' + events + '</div>' +
                    '<div>Threat Score: ' + esc(a.threat_score || '--') + '</div>' +
                    corrLine +
                    '<div style="font-size:10px;color:#4a5568;margin-top:4px">Last seen: ' + timeAgo(a.last_seen) + '</div>' +
                '</div>',
                { className: 'viz-dark-popup' }
            );
            attackMarkers.push(marker);

            // Animated dashed line attacker -> server
            const line = L.polyline([[lat, lng], SERVER_COORDS], {
                color:     color,
                weight:    isCorr ? 2 : 1.5,
                opacity:   isCorr ? 0.7 : 0.4,
                dashArray: '8 4',
                className: 'viz-attack-line' + (isCorr ? ' is-correlated' : ''),
            }).addTo(leafletMap);
            attackLines.push(line);
        });

        setText('[data-viz=map-live-sources]', liveCount);
        setText('[data-viz=map-total-hits]',   totalHits);
        setText('[data-viz=map-countries]',    countriesSet.size);

        renderAttackFeed(geoArr);
    }

    // ============ RENDER: ATTACK FEED (below map) ============
    function renderAttackFeed(geoArr) {
        const container = $('[data-viz=attack-feed]');
        if (!container) return;

        if (!Array.isArray(geoArr) || !geoArr.length) {
            container.innerHTML = '<div class="viz-empty">No geo-located attacks yet</div>';
            return;
        }

        const sorted = [...geoArr].sort((a, b) => {
            const da = new Date(a.last_seen || 0).getTime();
            const db = new Date(b.last_seen || 0).getTime();
            return db - da;
        });

        container.innerHTML = sorted.slice(0, 25).map(a => {
            let type = 'web_probe';
            if (a.attack_types && typeof a.attack_types === 'object') {
                const s = Object.entries(a.attack_types).sort((x, y) => y[1] - x[1]);
                if (s.length) type = s[0][0];
            }
            const color   = eventColor(type);
            const ip      = a.ip || '--';
            const country = a.country_code || '';
            const isCorr  = a.ip && correlatedIPs.has(a.ip);
            return '<div class="viz-feed-item' + (isCorr ? ' is-correlated' : '') + '">' +
                '<span class="viz-feed-time">' + timeAgo(a.last_seen) + '</span>' +
                '<span class="viz-feed-badge" style="background:' + color + '20;color:' + color + '">' +
                    esc(eventLabel(type)) + '</span>' +
                '<span class="viz-feed-source">' + countryFlag(country) + ' ' + esc(ip) + '</span>' +
                '<span class="viz-feed-detail">' +
                    esc(a.city || a.country || '') +
                    (a.isp ? ' &mdash; ' + esc(a.isp) : '') +
                    ' &mdash; ' + (a.total_attacks || 1) + ' attacks' +
                '</span>' +
            '</div>';
        }).join('');
    }

    // ============ RENDER: HONEYPOT ============
    function renderHoneypotStats(hpData, usernamesData, passwordsData) {
        const events = (hpData && (hpData.events || hpData)) || [];
        const list   = Array.isArray(events) ? events : [];

        const uniqueUsers     = new Set(list.map(e => e.username_tried || e.username).filter(Boolean));
        const uniquePasswords = new Set(list.map(e => e.password_tried || e.password).filter(Boolean));
        const uniqueIPs       = new Set(list.map(e => e.source_ip || e.ip).filter(Boolean));

        setText('[data-viz=hp-total]',     list.length);
        setText('[data-viz=hp-users]',     uniqueUsers.size);
        setText('[data-viz=hp-passwords]', uniquePasswords.size);
        setText('[data-viz=hp-ips]',       uniqueIPs.size);

        // Top usernames
        renderHpRankList(
            $('[data-viz=hp-top-users]'),
            (usernamesData && (usernamesData.usernames || usernamesData)) || [],
            'username', 'username_tried', 'name',
            'var(--ember, #ff9100)'
        );

        // Top passwords
        renderHpRankList(
            $('[data-viz=hp-top-passwords]'),
            (passwordsData && (passwordsData.passwords || passwordsData)) || [],
            'password', 'password_tried', 'name',
            '#b388ff'
        );
    }

    function renderHpRankList(container, items, k1, k2, k3, color) {
        if (!container) return;
        const list = Array.isArray(items) ? items : [];
        if (!list.length) {
            container.innerHTML = '<div class="viz-empty">No data yet</div>';
            return;
        }
        const max = list[0]?.count || list[0]?.attempts || 1;
        container.innerHTML = list.map(item => {
            const name  = item[k1] || item[k2] || item[k3] || '--';
            const count = item.count || item.attempts || 0;
            const pct   = Math.max(2, Math.round((count / max) * 100));
            return '<div class="viz-rank-item">' +
                '<span class="viz-rank-name">' + esc(name) + '</span>' +
                '<div class="viz-rank-bar"><div class="viz-rank-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
                '<span class="viz-rank-count">' + count + '</span>' +
            '</div>';
        }).join('');
    }

    function renderHoneypotFeed(data) {
        const container = $('[data-viz=hp-feed]');
        if (!container) return;
        const events = (data && (data.events || data)) || [];
        if (!Array.isArray(events) || !events.length) {
            container.innerHTML = '<div class="viz-empty">No honeypot events captured yet. SSH brute force attempts will appear here once attackers try to log in.</div>';
            return;
        }
        container.innerHTML = events.map(e => {
            return '<div class="viz-hp-feed-item">' +
                '<span class="viz-hp-time">' + shortTime(e.created_at || e.timestamp) + '</span>' +
                '<span class="viz-hp-ip">'   + esc(e.source_ip || e.ip || '--') + '</span>' +
                '<span class="viz-hp-user">' + esc(e.username_tried || e.username || '--') + '</span>' +
                '<span class="viz-hp-pass">' + esc(e.password_tried || e.password || '--') + '</span>' +
            '</div>';
        }).join('');
    }

    // ============ RENDER: BLOCKED IPs TABLE ============
    function renderBlockedIPs(data) {
        // Backend may return any of these shapes
        let list;
        if (Array.isArray(data))                      list = data;
        else if (data && Array.isArray(data.blocked))   list = data.blocked;
        else if (data && Array.isArray(data.ips))       list = data.ips;
        else if (data && Array.isArray(data.blocklist)) list = data.blocklist;
        else                                            list = [];

        setText('[data-viz=blocked-count]', list.length + ' IPs');

        const tbody = $('[data-viz=blocked-tbody]');
        if (!tbody) return;

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="viz-empty">No manually blocked IPs</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(b => {
            const ip          = b.ip_address || b.ip || '--';
            // Backend returns full country names ("United Kingdom") in `country`
            // but flag function needs 2-letter ISO code. Use country_code for the
            // flag, country (full name) for the display label. Fall back gracefully.
            const countryCode = b.country_code || (b.country && b.country.length === 2 ? b.country : '');
            const countryName = b.country || b.country_code || '--';
            const reason      = b.reason || '--';
            const blockedAt   = formatDate(b.blocked_at || b.created_at);
            const source      = b.source || b.blocked_by || 'manual';
            return '<tr>' +
                '<td class="viz-blocked-ip">' + esc(ip) + '</td>' +
                '<td>' + countryFlag(countryCode) + ' ' + esc(countryName) + '</td>' +
                '<td>' + esc(reason) + '</td>' +
                '<td>' + blockedAt + '</td>' +
                '<td>' + esc(source) + '</td>' +
                '<td><button type="button" class="viz-btn viz-btn-unblock" data-viz-unblock="' + esc(ip) + '">Unblock</button></td>' +
            '</tr>';
        }).join('');
    }

    // ============ BLOCK / UNBLOCK ACTIONS ============
    async function blockIP() {
        const ipEl     = $('[data-viz=block-ip]');
        const reasonEl = $('[data-viz=block-reason]');
        const resultEl = $('[data-viz=block-result]');
        const btn      = $('[data-viz-action=block]');
        if (!ipEl || !resultEl || !btn) return;

        const ip     = (ipEl.value || '').trim();
        const reason = ((reasonEl && reasonEl.value) || '').trim();

        if (!ip) {
            resultEl.textContent = 'Please enter an IP address';
            resultEl.className = 'viz-block-result is-error';
            return;
        }
        if (!isValidIpString(ip)) {
            resultEl.textContent = 'Invalid IP format (expected: x.x.x.x)';
            resultEl.className = 'viz-block-result is-error';
            return;
        }

        // Q3=A: NO confirm dialog. Fire immediately after IP regex passes.
        btn.disabled = true;
        resultEl.textContent = 'Blocking...';
        resultEl.className = 'viz-block-result';

        const result = await api('/api/threat/block', {
            method: 'POST',
            body: JSON.stringify({ ip, reason: reason || 'Manual block from ThreatViz' }),
        });

        if (result && (result.success || result.blocked || result.status === 'ok')) {
            resultEl.textContent = '\u2713 ' + ip + ' blocked successfully';
            resultEl.className = 'viz-block-result is-success';
            ipEl.value = '';
            if (reasonEl) reasonEl.value = '';
            // Refresh blocklist
            const blocked = await api('/api/threat/blocklist');
            if (blocked) renderBlockedIPs(blocked);
        } else if (result && result._httpStatus === 409) {
            resultEl.textContent = result.error || (ip + ' is already blocked');
            resultEl.className = 'viz-block-result is-error';
        } else {
            resultEl.textContent = (result && result.error) || 'Failed to block IP';
            resultEl.className = 'viz-block-result is-error';
        }

        btn.disabled = false;
    }

    async function unblockIP(ip) {
        if (!ip) return;
        // Q3=A: confirm dialog before unblock (keeps old behavior)
        const ok = window.confirm('Unblock ' + ip + '? This will allow traffic from this IP again.');
        if (!ok) return;

        const result = await api('/api/threat/block/' + encodeURIComponent(ip), { method: 'DELETE' });

        if (result && (result.success || result.unblocked || result.status === 'ok')) {
            const blocked = await api('/api/threat/blocklist');
            if (blocked) renderBlockedIPs(blocked);
        } else {
            window.alert((result && (result.error || result.message)) || 'Failed to unblock IP');
        }
    }

    // ============ MANUAL REFRESH ============
    function manualRefresh() {
        if (!isAuthed()) return;
        // Spin the refresh icon if present
        const btn = $('[data-viz-action=refresh]');
        if (btn) {
            btn.classList.add('is-spinning');
            setTimeout(() => btn.classList.remove('is-spinning'), 600);
        }
        fetchAll();
        if (mapInitialized) fetchMapData();
    }

    // ============ TEARDOWN HELPERS ============
    function teardown() {
        stopPolling();
        stopMapPolling();
        destroyMap();
        // Tear down charts
        if (eventTypeChart) { try { eventTypeChart.destroy(); } catch (_) {} eventTypeChart = null; }
        if (timelineChart)  { try { timelineChart.destroy();  } catch (_) {} timelineChart  = null; }
        // Unsubscribe from SOCState events
        subscriptions.forEach(unsub => { try { unsub(); } catch (_) {} });
        subscriptions = [];
    }

    // ============ INIT ============
    function init(rootEl) {
        // Re-init safety: tear down anything from a previous mount
        teardown();

        panelEl = rootEl;
        if (!panelEl) {
            console.warn('[ThreatViz] init called with no panel element');
            return;
        }

        // Reset module state for clean slate
        currentSubTab     = 'overview';
        mapInitialized    = false;
        lastAttackersData = null;
        lastEventsData    = null;
        correlatedIPs     = new Set();

        // Inject Leaflet dark popup styles even if map isn't open yet
        injectMapStyles();

        // Sync default sub-tab visibility (Overview shown, others hidden)
        SUB_TABS.forEach(t => {
            const p = $('[data-viz-subpanel="' + t + '"]');
            if (p) p.hidden = (t !== 'overview');
        });
        $$('[data-viz-subtab]').forEach(btn => {
            const active = btn.getAttribute('data-viz-subtab') === 'overview';
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            btn.tabIndex = active ? 0 : -1;
        });

        // ============ DELEGATED CLICK LISTENER ============
        // ONE listener on panelEl handles all interactive elements via data-viz-* attrs
        panelEl.addEventListener('click', (ev) => {
            if (!panelEl.contains(ev.target)) return;

            // Sub-tab switch
            const subBtn = ev.target.closest('[data-viz-subtab]');
            if (subBtn && panelEl.contains(subBtn)) {
                ev.preventDefault();
                switchSubTab(subBtn.getAttribute('data-viz-subtab'));
                return;
            }

            // Unblock IP button (delegated, replaces old inline onclick)
            const unblockBtn = ev.target.closest('[data-viz-unblock]');
            if (unblockBtn && panelEl.contains(unblockBtn)) {
                ev.preventDefault();
                unblockIP(unblockBtn.getAttribute('data-viz-unblock'));
                return;
            }

            // Action buttons (block / refresh / logout-style actions)
            const actionBtn = ev.target.closest('[data-viz-action]');
            if (actionBtn && panelEl.contains(actionBtn)) {
                ev.preventDefault();
                const action = actionBtn.getAttribute('data-viz-action');
                if (action === 'block')   blockIP();
                else if (action === 'refresh') manualRefresh();
                return;
            }
        });

        // Enter-key shortcut on the Block IP input
        const ipInput = $('[data-viz=block-ip]');
        if (ipInput) {
            ipInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    blockIP();
                }
            });
        }

        // ============ SOCSTATE SUBSCRIPTIONS (Q4=B full integration) ============
        if (window.SOCState && typeof window.SOCState.subscribe === 'function') {
            // Auth flips drive the overlay + polling lifecycle
            subscriptions.push(window.SOCState.subscribe('auth:changed', () => {
                updateAuthUi();
            }));
            // Cross-tool events that may surface new correlations
            subscriptions.push(window.SOCState.subscribe('scan:completed', () => {
                recomputeCorrelations();
            }));
            subscriptions.push(window.SOCState.subscribe('network:alert', () => {
                recomputeCorrelations();
            }));
            subscriptions.push(window.SOCState.subscribe('siem:event', () => {
                recomputeCorrelations();
            }));
            subscriptions.push(window.SOCState.subscribe('correlation:found', () => {
                recomputeCorrelations();
            }));
        }


        // ============ INITIAL SYNC ============
        // Reflect current auth state immediately on mount. If already authed, this
        // call also kicks off polling via updateAuthUi -> startPolling.
        updateAuthUi();

        // Initial render of the correlation badge (likely 0 on first mount, but
        // covers the case where SOCState already has cross-tool data from prior
        // sessions persisted in localStorage)
        recomputeCorrelations();

        console.log('[ThreatViz] Threat Intelligence Dashboard ready');
    }

    // ============ MODULE EXPORT ============
    window.SOCTools = window.SOCTools || {};
    window.SOCTools.threatViz = { init: init, teardown: teardown };

})();
