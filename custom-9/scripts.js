/* ============================================================
   THREATVIZ — Custom 9 Scripts
   ============================================================
   Real-Time Threat Intelligence Dashboard
   
   API Endpoints (from threat-monitor.js on api.jonathan-castro.com):
     GET /api/threat/stats         — Dashboard summary stats
     GET /api/threat/events        — Recent events (query: ?limit=&type=&severity=)
     GET /api/threat/events/timeline — Hourly event counts (24h)
     GET /api/threat/geo           — Attacker geo data with lat/lng
     GET /api/threat/attackers     — Top attacker profiles (query: ?limit=)
     GET /api/threat/honeypot      — Honeypot events (query: ?limit=)
     GET /api/threat/honeypot/stats — Honeypot summary (top users/passwords)
     GET /api/threat/blocked       — Currently blocked IPs
     POST /api/threat/block        — Block an IP { ip, reason }
     POST /api/threat/unblock      — Unblock an IP { ip }
     GET /api/threat/health        — Collector health check
   ============================================================ */

(function () {
    'use strict';

    // ============ CONFIG ============
    const API_BASE = 'https://api.jonathan-castro.com';
    const POLL_INTERVAL = 10000;     // 10 seconds
    const MAP_POLL_INTERVAL = 15000; // 15 seconds for map data
    const SERVER_COORDS = [29.76, -95.37]; // Houston TX (your server location)

    // ============ STATE ============
    let authToken = null;
    let pollTimer = null;
    let mapPollTimer = null;
    let leafletMap = null;
    let attackMarkers = [];
    let attackLines = [];
    let eventTypeChart = null;
    let timelineChart = null;
    let currentTab = 'overview';
    let mapInitialized = false;

    // ============ HELPERS ============
    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    function esc(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function setText(sel, val) {
        const el = $(sel);
        if (el) el.textContent = val ?? '--';
    }

    function timeAgo(dateStr) {
        if (!dateStr) return '--';
        const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
        if (diff < 60) return Math.floor(diff) + 's ago';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
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
                hour: '2-digit', minute: '2-digit'
            });
        } catch { return '--'; }
    }

    // Color for event types
    function eventColor(type) {
        const colors = {
            ssh_brute_force: '#ff1744',
            web_probe: '#ff9100',
            ufw_block: '#ffd600',
            honeypot: '#b388ff',
            port_scan: '#00e5ff',
            auth_failure: '#ff6d00',
        };
        return colors[type] || '#00e5ff';
    }

    function severityClass(sev) {
        if (!sev) return 'badge-low';
        const s = sev.toLowerCase();
        if (s === 'critical') return 'badge-critical';
        if (s === 'high') return 'badge-high';
        if (s === 'medium') return 'badge-medium';
        return 'badge-low';
    }

    function eventLabel(type) {
        const labels = {
            ssh_brute_force: 'SSH Brute Force',
            web_probe: 'Web Probe',
            ufw_block: 'UFW Block',
            honeypot: 'Honeypot',
            port_scan: 'Port Scan',
            auth_failure: 'Auth Failure',
        };
        return labels[type] || type || 'Unknown';
    }

    // Country code → flag emoji
    function countryFlag(code) {
        if (!code || code.length !== 2) return '🌐';
        const c = code.toUpperCase();
        return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
    }

    // ============ API HELPER ============
    async function api(path, options = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

        try {
            const res = await fetch(API_BASE + path, { ...options, headers });
            if (res.status === 401 || res.status === 403) {
                handleLogout();
                return null;
            }
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            console.error('API error:', path, err);
            return null;
        }
    }

    // ============ AUTH ============
    function initAuth() {
        const saved = localStorage.getItem('tv_token');
        if (saved) {
            authToken = saved;
            verifyToken();
        }

        $('#loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = $('#loginEmail').value.trim();
            const password = $('#loginPassword').value;
            const btn = $('#loginBtn');
            const errEl = $('#loginError');

            btn.querySelector('.btn-text').style.display = 'none';
            btn.querySelector('.btn-loader').style.display = 'inline-block';
            btn.disabled = true;
            errEl.textContent = '';

            try {
                const res = await fetch(API_BASE + '/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();

                if (res.ok && data.token) {
                    authToken = data.token;
                    localStorage.setItem('tv_token', authToken);
                    showDashboard();
                } else {
                    errEl.textContent = data.error || 'Authentication failed';
                }
            } catch (err) {
                errEl.textContent = 'Connection error. Check API server.';
            } finally {
                btn.querySelector('.btn-text').style.display = '';
                btn.querySelector('.btn-loader').style.display = 'none';
                btn.disabled = false;
            }
        });
    }

    async function verifyToken() {
        try {
            const res = await fetch(API_BASE + '/api/auth/verify', {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            if (res.ok) {
                showDashboard();
            } else {
                handleLogout();
            }
        } catch {
            handleLogout();
        }
    }

    function handleLogout() {
        authToken = null;
        localStorage.removeItem('tv_token');
        if (pollTimer) clearInterval(pollTimer);
        if (mapPollTimer) clearInterval(mapPollTimer);
        $('#loginOverlay').classList.remove('hidden');
        $('#dashboard').classList.add('hidden');
    }

    function showDashboard() {
        $('#loginOverlay').classList.add('hidden');
        $('#dashboard').classList.remove('hidden');
        startPolling();
    }

    // ============ TAB MANAGEMENT ============
    function initTabs() {
        $$('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                if (tab === currentTab) return;

                $$('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                $$('.tab-panel').forEach(p => p.classList.remove('active'));
                $(`#panel-${tab}`).classList.add('active');
                currentTab = tab;

                if (tab === 'map' && !mapInitialized) {
                    initMap();
                    mapInitialized = true;
                }
            });
        });
    }

    // ============ POLLING ============
    function startPolling() {
        fetchAll();
        pollTimer = setInterval(fetchAll, POLL_INTERVAL);
    }

    async function fetchAll() {
        const [stats, events, attackers, geo, health] = await Promise.all([
            api('/api/threat/stats'),
            api('/api/threat/events?limit=50'),
            api('/api/threat/attackers?limit=20'),
            api('/api/threat/geo'),
            api('/api/threat/health'),
        ]);

        if (stats) renderStats(stats);
        if (events) renderRecentEvents(events);
        if (attackers) renderTopAttackers(attackers);
        if (geo) {
            renderCountryGrid(geo);
            if (mapInitialized) renderMapData(geo);
        }
        if (health) renderHealth(health);

        // Update timestamp
        setText('#lastUpdate', 'Updated ' + new Date().toLocaleTimeString());

        // Fetch tab-specific data
        if (currentTab === 'overview') {
            const timeline = await api('/api/threat/events/timeline');
            if (timeline) renderTimelineChart(timeline);

            // Event type chart from stats
            if (stats) renderEventTypeChart(stats);
        }

        if (currentTab === 'honeypot') {
            const [hpEvents, hpStats] = await Promise.all([
                api('/api/threat/honeypot?limit=100'),
                api('/api/threat/honeypot/stats'),
            ]);
            if (hpEvents) renderHoneypotFeed(hpEvents);
            if (hpStats) renderHoneypotStats(hpStats);
        }

        if (currentTab === 'blocklist') {
            const blocked = await api('/api/threat/blocked');
            if (blocked) renderBlockedIPs(blocked);
        }
    }

    // ============ RENDER: STATS ============
    function renderStats(data) {
        setText('#statTotalEvents', data.total_events ?? 0);
        setText('#statAttackerProfiles', data.total_attackers ?? 0);
        setText('#statCountries', data.total_countries ?? 0);
        setText('#statBlockedIPs', data.blocked_ips ?? 0);
        setText('#statSSHAttempts', data.ssh_brute_force ?? data.event_types?.ssh_brute_force ?? 0);
        setText('#statHoneypotEvents', data.honeypot_events ?? data.total_honeypot ?? 0);
    }

    // ============ RENDER: HEALTH ============
    function renderHealth(data) {
        const badge = $('#collectorStatus');
        const text = $('#collectorStatusText');
        if (data.status === 'running' || data.collector_running) {
            badge.classList.remove('offline');
            text.textContent = 'Collector Active';
        } else {
            badge.classList.add('offline');
            text.textContent = 'Collector Offline';
        }
    }

    // ============ RENDER: EVENT TYPE CHART ============
    function renderEventTypeChart(stats) {
        const canvas = $('#eventTypeChart');
        if (!canvas) return;

        const types = stats.event_types || stats.by_type || {};
        const labels = Object.keys(types);
        const values = Object.values(types);
        const colors = labels.map(l => eventColor(l));

        if (eventTypeChart) {
            eventTypeChart.data.labels = labels.map(l => eventLabel(l));
            eventTypeChart.data.datasets[0].data = values;
            eventTypeChart.data.datasets[0].backgroundColor = colors.map(c => c + '40');
            eventTypeChart.data.datasets[0].borderColor = colors;
            eventTypeChart.update('none');
            return;
        }

        eventTypeChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: labels.map(l => eventLabel(l)),
                datasets: [{
                    data: values,
                    backgroundColor: colors.map(c => c + '40'),
                    borderColor: colors,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#8892a4',
                            font: { family: 'JetBrains Mono', size: 11 },
                            padding: 12,
                            usePointStyle: true,
                            pointStyleWidth: 10,
                        }
                    }
                },
                cutout: '60%',
            }
        });
    }

    // ============ RENDER: TIMELINE CHART ============
    function renderTimelineChart(data) {
        const canvas = $('#timelineChart');
        if (!canvas) return;

        const entries = data.timeline || data.hourly || data || [];
        const labels = entries.map(e => e.hour || e.label || '--');
        const values = entries.map(e => e.count || e.events || 0);

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
                    borderColor: '#ff1744',
                    backgroundColor: 'rgba(255, 23, 68, 0.1)',
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 2,
                    pointBackgroundColor: '#ff1744',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: { color: '#4a5568', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 45 },
                        grid: { color: 'rgba(255,255,255,0.04)' },
                    },
                    y: {
                        ticks: { color: '#4a5568', font: { family: 'JetBrains Mono', size: 10 } },
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        beginAtZero: true,
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    // ============ RENDER: TOP ATTACKERS ============
    function renderTopAttackers(data) {
        const container = $('#topAttackersList');
        if (!container) return;

        const attackers = data.attackers || data || [];
        if (!attackers.length) {
            container.innerHTML = '<div class="empty-state">No attacker profiles yet</div>';
            return;
        }

        container.innerHTML = attackers.map(a => {
            const flag = countryFlag(a.country_code || a.country);
            const events = a.total_events || a.event_count || 0;
            return `<div class="list-item">
                <div class="list-item-left">
                    <span style="font-size:1.1rem">${flag}</span>
                    <span class="list-ip">${esc(a.ip_address || a.ip)}</span>
                    <span class="list-country">${esc(a.country || a.country_code || '')}</span>
                </div>
                <span class="list-badge badge-critical">${events} events</span>
            </div>`;
        }).join('');
    }

    // ============ RENDER: RECENT EVENTS ============
    function renderRecentEvents(data) {
        const container = $('#recentEventsList');
        if (!container) return;

        const events = data.events || data || [];
        if (!events.length) {
            container.innerHTML = '<div class="empty-state">No events yet</div>';
            return;
        }

        container.innerHTML = events.slice(0, 30).map(e => {
            const color = eventColor(e.event_type || e.type);
            return `<div class="event-item">
                <div class="event-type-dot" style="background:${color}"></div>
                <div class="event-info">
                    <div class="event-msg">${esc(e.description || e.message || eventLabel(e.event_type || e.type))}</div>
                    <div class="event-meta">
                        <span>${esc(e.source_ip || e.ip || '--')}</span>
                        <span>${eventLabel(e.event_type || e.type)}</span>
                        <span>${timeAgo(e.created_at || e.timestamp)}</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    // ============ RENDER: COUNTRY GRID ============
    function renderCountryGrid(data) {
        const container = $('#countryGrid');
        if (!container) return;

        const countries = data.countries || data.by_country || [];
        if (!countries.length) {
            container.innerHTML = '<div class="empty-state">No country data yet</div>';
            return;
        }

        // Handle both array format and object format
        let countryArr;
        if (Array.isArray(countries)) {
            countryArr = countries;
        } else {
            countryArr = Object.entries(countries).map(([code, count]) => ({
                country_code: code, country: code, count
            }));
        }

        countryArr.sort((a, b) => (b.count || b.total_events || 0) - (a.count || a.total_events || 0));

        container.innerHTML = countryArr.map(c => {
            const code = c.country_code || c.code || c.country || '';
            const name = c.country_name || c.country || code;
            const count = c.count || c.total_events || 0;
            return `<div class="country-tile">
                <span class="country-flag">${countryFlag(code)}</span>
                <span class="country-name">${esc(name)}</span>
                <span class="country-count">${count}</span>
            </div>`;
        }).join('');
    }

    // ============ LEAFLET MAP ============
    function initMap() {
        leafletMap = L.map('threatMap', {
            center: [25, 0],
            zoom: 2,
            minZoom: 2,
            maxZoom: 10,
            zoomControl: true,
            attributionControl: false,
        });

        // Dark tile layer
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
        }).addTo(leafletMap);

        // Server marker
        const serverIcon = L.divIcon({
            className: 'server-marker',
            html: `<div style="width:14px;height:14px;background:#00e676;border-radius:50%;border:2px solid #080b12;box-shadow:0 0 12px rgba(0,230,118,0.6)"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
        });
        L.marker(SERVER_COORDS, { icon: serverIcon })
            .addTo(leafletMap)
            .bindPopup('<b style="color:#00e676">Your Server</b><br>jonathan-castrodb');

        // Start map polling
        fetchMapData();
        mapPollTimer = setInterval(fetchMapData, MAP_POLL_INTERVAL);
    }

    async function fetchMapData() {
        const geo = await api('/api/threat/geo');
        if (geo) renderMapData(geo);
    }

    function renderMapData(data) {
        if (!leafletMap) return;

        // Clear previous markers & lines
        attackMarkers.forEach(m => leafletMap.removeLayer(m));
        attackLines.forEach(l => leafletMap.removeLayer(l));
        attackMarkers = [];
        attackLines = [];

        const attackers = data.attackers || data.geo || data || [];
        let liveCount = 0;
        let totalHits = 0;
        const countriesSet = new Set();

        // Handle both array format
        const geoArr = Array.isArray(attackers) ? attackers : [];

        geoArr.forEach(a => {
            const lat = parseFloat(a.latitude || a.lat);
            const lng = parseFloat(a.longitude || a.lng || a.lon);
            if (isNaN(lat) || isNaN(lng)) return;

            const events = a.total_events || a.event_count || a.count || 1;
            const type = a.primary_type || a.event_type || 'web_probe';
            const color = eventColor(type);
            const ip = a.ip_address || a.ip || '';
            const country = a.country || a.country_code || '';

            if (country) countriesSet.add(country);
            liveCount++;
            totalHits += events;

            // Attacker marker (pulsing circle)
            const radius = Math.min(4 + Math.log2(events + 1) * 3, 18);
            const marker = L.circleMarker([lat, lng], {
                radius,
                color: color,
                fillColor: color,
                fillOpacity: 0.35,
                weight: 1.5,
                opacity: 0.8,
            }).addTo(leafletMap);

            marker.bindPopup(`
                <div style="font-family:monospace;font-size:12px;color:#e2e8f0;background:#111827;padding:8px;border-radius:6px;min-width:160px">
                    <div style="color:${color};font-weight:700;margin-bottom:4px">${esc(ip)}</div>
                    <div>Type: ${eventLabel(type)}</div>
                    <div>Country: ${countryFlag(country)} ${esc(country)}</div>
                    <div>Events: ${events}</div>
                    ${a.city ? '<div>City: ' + esc(a.city) + '</div>' : ''}
                </div>
            `, { className: 'dark-popup' });

            attackMarkers.push(marker);

            // Animated attack line from attacker → server
            const line = L.polyline([[lat, lng], SERVER_COORDS], {
                color: color,
                weight: 1.5,
                opacity: 0.4,
                dashArray: '8 4',
                className: 'attack-line',
            }).addTo(leafletMap);

            attackLines.push(line);
        });

        // Update map overlay stats
        setText('#mapLiveAttackers', liveCount);
        setText('#mapTotalHits', totalHits);
        setText('#mapCountries', countriesSet.size);

        // Update attack feed
        renderAttackFeed(geoArr);
    }

    // ============ RENDER: ATTACK FEED (below map) ============
    function renderAttackFeed(geoArr) {
        const container = $('#attackFeed');
        if (!container) return;

        if (!geoArr.length) {
            container.innerHTML = '<div class="empty-state">No geo-located attacks yet</div>';
            return;
        }

        // Sort by most recent
        const sorted = [...geoArr].sort((a, b) => {
            const da = new Date(a.last_seen || a.created_at || 0);
            const db = new Date(b.last_seen || b.created_at || 0);
            return db - da;
        });

        container.innerHTML = sorted.slice(0, 25).map(a => {
            const type = a.primary_type || a.event_type || 'web_probe';
            const color = eventColor(type);
            const ip = a.ip_address || a.ip || '--';
            const country = a.country || a.country_code || '';
            return `<div class="attack-feed-item">
                <span class="attack-time">${timeAgo(a.last_seen || a.created_at)}</span>
                <span class="attack-type-badge" style="background:${color}20;color:${color}">${eventLabel(type)}</span>
                <span class="attack-source">${countryFlag(country)} ${esc(ip)}</span>
                <span class="attack-detail">${esc(a.city || country || '')} — ${a.total_events || 1} events</span>
            </div>`;
        }).join('');
    }

    // ============ RENDER: HONEYPOT ============
    function renderHoneypotStats(data) {
        setText('#hpTotalAttempts', data.total_attempts || data.total || 0);
        setText('#hpUniqueUsers', data.unique_usernames || data.unique_users || 0);
        setText('#hpUniquePasswords', data.unique_passwords || 0);
        setText('#hpUniqueIPs', data.unique_ips || data.unique_attackers || 0);

        // Top Usernames
        const userContainer = $('#topUsernames');
        const users = data.top_usernames || data.usernames || [];
        if (userContainer && users.length) {
            const maxCount = users[0]?.count || users[0]?.attempts || 1;
            userContainer.innerHTML = users.map(u => {
                const name = u.username || u.name || '--';
                const count = u.count || u.attempts || 0;
                const pct = Math.round((count / maxCount) * 100);
                return `<div class="hp-rank-item">
                    <span class="hp-rank-name">${esc(name)}</span>
                    <div class="hp-rank-bar"><div class="hp-rank-bar-fill" style="width:${pct}%;background:var(--orange)"></div></div>
                    <span class="hp-rank-count">${count}</span>
                </div>`;
            }).join('');
        }

        // Top Passwords
        const passContainer = $('#topPasswords');
        const passwords = data.top_passwords || data.passwords || [];
        if (passContainer && passwords.length) {
            const maxCount = passwords[0]?.count || passwords[0]?.attempts || 1;
            passContainer.innerHTML = passwords.map(p => {
                const name = p.password || p.name || '--';
                const count = p.count || p.attempts || 0;
                const pct = Math.round((count / maxCount) * 100);
                return `<div class="hp-rank-item">
                    <span class="hp-rank-name">${esc(name)}</span>
                    <div class="hp-rank-bar"><div class="hp-rank-bar-fill" style="width:${pct}%;background:var(--purple)"></div></div>
                    <span class="hp-rank-count">${count}</span>
                </div>`;
            }).join('');
        }
    }

    function renderHoneypotFeed(data) {
        const container = $('#honeypotFeed');
        if (!container) return;

        const events = data.events || data || [];
        if (!events.length) {
            container.innerHTML = '<div class="empty-state">No honeypot events captured yet. SSH brute force attempts will appear here once attackers try to log in.</div>';
            return;
        }

        container.innerHTML = events.map(e => {
            return `<div class="hp-feed-item">
                <span class="hp-feed-time">${shortTime(e.created_at || e.timestamp)}</span>
                <span class="hp-feed-ip">${esc(e.source_ip || e.ip || '--')}</span>
                <span class="hp-feed-user">${esc(e.username_tried || e.username || '--')}</span>
                <span class="hp-feed-pass">${esc(e.password_tried || e.password || '--')}</span>
            </div>`;
        }).join('');
    }

    // ============ RENDER: BLOCKLIST ============
    function renderBlockedIPs(data) {
        const list = data.blocked || data.ips || data || [];
        setText('#blockedCount', list.length + ' IPs');

        const tbody = $('#blockedTableBody');
        if (!tbody) return;

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No manually blocked IPs</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(b => {
            const ip = b.ip_address || b.ip || '--';
            const country = b.country || b.country_code || '--';
            const reason = b.reason || '--';
            const blockedAt = formatDate(b.blocked_at || b.created_at);
            const source = b.source || b.blocked_by || 'manual';
            return `<tr>
                <td style="color:var(--red);font-weight:500">${esc(ip)}</td>
                <td>${countryFlag(country)} ${esc(country)}</td>
                <td>${esc(reason)}</td>
                <td>${blockedAt}</td>
                <td>${esc(source)}</td>
                <td><button class="action-btn unblock-btn" data-ip="${esc(ip)}" onclick="window._unblockIP('${esc(ip)}')">Unblock</button></td>
            </tr>`;
        }).join('');
    }

    // ============ BLOCK / UNBLOCK ACTIONS ============
    function initBlockActions() {
        $('#blockIPBtn').addEventListener('click', async () => {
            const ip = $('#blockIPInput').value.trim();
            const reason = $('#blockReasonInput').value.trim();
            const resultEl = $('#blockResult');

            if (!ip) {
                resultEl.textContent = 'Please enter an IP address';
                resultEl.className = 'block-result error';
                return;
            }

            // Simple IP validation
            const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
            if (!ipRegex.test(ip)) {
                resultEl.textContent = 'Invalid IP format';
                resultEl.className = 'block-result error';
                return;
            }

            const btn = $('#blockIPBtn');
            btn.disabled = true;
            resultEl.textContent = 'Blocking...';
            resultEl.className = 'block-result';

            const result = await api('/api/threat/block', {
                method: 'POST',
                body: JSON.stringify({ ip, reason: reason || 'Manual block from ThreatViz' }),
            });

            if (result && (result.success || result.blocked)) {
                resultEl.textContent = `✓ ${ip} blocked successfully`;
                resultEl.className = 'block-result success';
                $('#blockIPInput').value = '';
                $('#blockReasonInput').value = '';
                // Refresh blocklist
                const blocked = await api('/api/threat/blocked');
                if (blocked) renderBlockedIPs(blocked);
            } else {
                resultEl.textContent = result?.error || 'Failed to block IP';
                resultEl.className = 'block-result error';
            }

            btn.disabled = false;
        });
    }

    // Global unblock function (called from inline onclick)
    window._unblockIP = async function (ip) {
        if (!confirm(`Unblock ${ip}? This will allow traffic from this IP again.`)) return;

        const result = await api('/api/threat/unblock', {
            method: 'POST',
            body: JSON.stringify({ ip }),
        });

        if (result && (result.success || result.unblocked)) {
            const blocked = await api('/api/threat/blocked');
            if (blocked) renderBlockedIPs(blocked);
        } else {
            alert(result?.error || 'Failed to unblock IP');
        }
    };

    // ============ MISC CONTROLS ============
    function initControls() {
        // Refresh button
        $('#refreshBtn').addEventListener('click', () => {
            fetchAll();
            const btn = $('#refreshBtn');
            btn.style.transform = 'rotate(360deg)';
            btn.style.transition = 'transform 0.5s';
            setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
        });

        // Logout
        $('#logoutBtn').addEventListener('click', handleLogout);

        // Enter key on block input
        $('#blockIPInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') $('#blockIPBtn').click();
        });
    }

    // ============ DARK POPUP STYLES (for Leaflet) ============
    function injectMapStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .dark-popup .leaflet-popup-content-wrapper {
                background: #111827 !important;
                color: #e2e8f0 !important;
                border-radius: 8px !important;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
                border: 1px solid rgba(255,255,255,0.06) !important;
            }
            .dark-popup .leaflet-popup-tip {
                background: #111827 !important;
                border: 1px solid rgba(255,255,255,0.06) !important;
            }
            .dark-popup .leaflet-popup-content { margin: 0 !important; }
            .leaflet-popup-close-button {
                color: #8892a4 !important;
                font-size: 18px !important;
            }
        `;
        document.head.appendChild(style);
    }

    // ============ INIT ============
    function init() {
        initAuth();
        initTabs();
        initBlockActions();
        initControls();
        injectMapStyles();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
