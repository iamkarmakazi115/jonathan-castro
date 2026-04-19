/**
 * ============================================================
 * SOCState - Security Operations Center shared state bus
 * ============================================================
 * Single source of truth for the interconnected tools on the
 * /security-ops/ page (LAN Scanner, Vuln Scanner, Network
 * Monitor, SIEM Analyzer, ThreatViz).
 *
 * Tools publish state changes via SOCState.publish(event, data)
 * and react to other tools via SOCState.subscribe(event, cb).
 *
 * State is persisted to localStorage under a versioned key.
 * Old namespaces from the previous site are ignored - no
 * migration, no cleanup, zero collision risk.
 *
 * Events:
 *   hosts:updated       - LAN Scanner added a host
 *   scan:completed      - Vuln Scanner finished a scan
 *   network:alert       - Network Monitor flagged traffic
 *   siem:event          - SIEM ingested an event
 *   posture:changed     - posture recomputed
 *   correlation:found   - cross-tool IP match detected
 *   auth:changed        - SOC auth state changed (login/logout)
 * ============================================================
 */

(function () {
    'use strict';

    const STORAGE_KEY      = 'socState_v1';
    const AUTH_STORAGE_KEY = 'socAuth_v1';   // sessionStorage - tab-scoped
    const STORAGE_VERSION  = 1;
    const MAX_HOSTS        = 500;
    const MAX_SCANS        = 500;
    const MAX_ALERTS       = 500;
    const MAX_EVENTS       = 1000;
    const SAVE_DEBOUNCE_MS = 500;

    // ---- Utilities ----

    function uid() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    function nowMs() { return Date.now(); }

    function clampArray(arr, max) {
        if (arr.length > max) arr.splice(0, arr.length - max);
        return arr;
    }

    function isValidIp(ip) {
        if (typeof ip !== 'string') return false;
        const parts = ip.split('.');
        if (parts.length !== 4) return false;
        return parts.every(p => {
            const n = parseInt(p, 10);
            return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
        });
    }

    /**
     * @typedef {Object} Host
     * @property {string} ip          - IPv4 address
     * @property {string} [hostname]  - resolved hostname
     * @property {string} [os]        - detected OS
     * @property {string} [mac]       - MAC address
     * @property {number[]} [openPorts] - list of open ports
     * @property {number} lastSeen    - unix ms timestamp
     */

    /**
     * @typedef {Object} ScanResult
     * @property {string} target      - target IP
     * @property {number} timestamp
     * @property {number[]} openPorts
     * @property {string[]} cves      - CVE identifiers
     * @property {'low'|'medium'|'high'|'critical'} severity
     * @property {string} scanType    - e.g. 'tcp-syn', 'vuln', 'service'
     */

    /**
     * @typedef {Object} NetworkAlert
     * @property {number} timestamp
     * @property {string} srcIp
     * @property {string} [dstIp]
     * @property {string} protocol
     * @property {string} reason
     * @property {'low'|'medium'|'high'|'critical'} severity
     */

    /**
     * @typedef {Object} SIEMEvent
     * @property {number} timestamp
     * @property {'info'|'low'|'medium'|'high'|'critical'} severity
     * @property {string} type
     * @property {string} source
     * @property {string} [srcIp]
     * @property {string} message
     */

    // ---- SOCState ----

    const SOCState = {
        // Data
        discoveredHosts: [],
        scanResults: [],
        networkAlerts: [],
        siemEvents: [],
        threatGraph: { nodes: [], edges: [] },
        posture: {
            score: 100,
            hostCount: 0,
            vulnCount: 0,
            criticalVulnCount: 0,
            alertCount: 0,
            eventCount: 0,
            correlationCount: 0,
            lastUpdated: null
        },

        // Auth (session-scoped, NOT persisted to localStorage)
        auth: {
            token: null,       // JWT Bearer token
            user: null,        // { email, display_name }
            expiresAt: null    // unix ms or null for no known expiry
        },

        // Tool config — public client-side keys, intentionally exposed.
        // Centralized here so all SOC tools read from one place
        // and rotation is a single edit instead of grep-and-replace.
        config: {
            vulnApiKey: 'a45d9911f152bcb049d1687e0aaac73c107406006c982a39126c2c0c792c3b00'
        },

        // Meta
        _version: STORAGE_VERSION,
        _subscribers: {},
        _saveTimer: null,
        _ready: false,

        // ---- Pub/Sub ----

        subscribe(event, callback) {
            if (typeof callback !== 'function') return () => {};
            if (!this._subscribers[event]) this._subscribers[event] = [];
            this._subscribers[event].push(callback);
            return () => this.unsubscribe(event, callback);
        },

        unsubscribe(event, callback) {
            if (!this._subscribers[event]) return;
            this._subscribers[event] = this._subscribers[event].filter(cb => cb !== callback);
        },

        publish(event, data) {
            const subs = this._subscribers[event];
            if (!subs || !subs.length) return;
            subs.forEach(cb => {
                try { cb(data); }
                catch (e) { console.error(`[SOCState] subscriber error on "${event}":`, e); }
            });
        },

        // ---- Persistence ----

        save() {
            if (this._saveTimer) clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this._saveNow(), SAVE_DEBOUNCE_MS);
        },

        _saveNow() {
            try {
                const snapshot = {
                    version: STORAGE_VERSION,
                    savedAt: nowMs(),
                    discoveredHosts: this.discoveredHosts,
                    scanResults: this.scanResults,
                    networkAlerts: this.networkAlerts,
                    siemEvents: this.siemEvents,
                    threatGraph: this.threatGraph,
                    posture: this.posture
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
            } catch (e) {
                console.warn('[SOCState] save failed:', e);
            }
        },

        load() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return false;
                const snap = JSON.parse(raw);
                if (snap.version !== STORAGE_VERSION) {
                    console.info('[SOCState] version mismatch, starting fresh');
                    localStorage.removeItem(STORAGE_KEY);
                    return false;
                }
                this.discoveredHosts = snap.discoveredHosts || [];
                this.scanResults     = snap.scanResults     || [];
                this.networkAlerts   = snap.networkAlerts   || [];
                this.siemEvents      = snap.siemEvents      || [];
                this.threatGraph     = snap.threatGraph     || { nodes: [], edges: [] };
                this.posture         = snap.posture         || this.posture;
                return true;
            } catch (e) {
                console.warn('[SOCState] load failed, starting fresh:', e);
                localStorage.removeItem(STORAGE_KEY);
                return false;
            }
        },

        clear() {
            this.discoveredHosts = [];
            this.scanResults     = [];
            this.networkAlerts   = [];
            this.siemEvents      = [];
            this.threatGraph     = { nodes: [], edges: [] };
            localStorage.removeItem(STORAGE_KEY);
            this.computePosture();
            this.publish('hosts:updated', this.discoveredHosts);
        },

        // ---- Add helpers ----

        addHost(host) {
            if (!host || !isValidIp(host.ip)) {
                console.warn('[SOCState] addHost: invalid host:', host);
                return null;
            }
            const existing = this.discoveredHosts.find(h => h.ip === host.ip);
            const record = {
                id:        existing ? existing.id : uid(),
                ip:        host.ip,
                hostname:  host.hostname  || existing?.hostname  || null,
                os:        host.os        || existing?.os        || null,
                mac:       host.mac       || existing?.mac       || null,
                openPorts: host.openPorts || existing?.openPorts || [],
                lastSeen:  nowMs()
            };
            if (existing) Object.assign(existing, record);
            else this.discoveredHosts.push(record);
            clampArray(this.discoveredHosts, MAX_HOSTS);
            this.publish('hosts:updated', this.discoveredHosts);
            this.computePosture();
            this.save();
            return record;
        },

        addScanResult(result) {
            if (!result || !isValidIp(result.target)) {
                console.warn('[SOCState] addScanResult: invalid result:', result);
                return null;
            }
            const record = {
                id:        uid(),
                target:    result.target,
                timestamp: result.timestamp || nowMs(),
                openPorts: result.openPorts || [],
                cves:      result.cves      || [],
                severity:  result.severity  || 'low',
                scanType:  result.scanType  || 'vuln'
            };
            this.scanResults.push(record);
            clampArray(this.scanResults, MAX_SCANS);
            this._rebuildThreatGraph();
            this.publish('scan:completed', record);
            this.computePosture();
            this.save();
            return record;
        },

        addNetworkAlert(alert) {
            if (!alert || !isValidIp(alert.srcIp)) {
                console.warn('[SOCState] addNetworkAlert: invalid alert:', alert);
                return null;
            }
            const record = {
                id:        uid(),
                timestamp: alert.timestamp || nowMs(),
                srcIp:     alert.srcIp,
                dstIp:     alert.dstIp    || null,
                protocol:  alert.protocol || 'unknown',
                reason:    alert.reason   || 'flagged',
                severity:  alert.severity || 'medium'
            };
            this.networkAlerts.push(record);
            clampArray(this.networkAlerts, MAX_ALERTS);
            this.publish('network:alert', record);
            this._checkCorrelation(record.srcIp, 'network');
            this.computePosture();
            this.save();
            return record;
        },

        addSIEMEvent(event) {
            if (!event) {
                console.warn('[SOCState] addSIEMEvent: invalid event');
                return null;
            }
            const record = {
                id:        uid(),
                timestamp: event.timestamp || nowMs(),
                severity:  event.severity  || 'info',
                type:      event.type      || 'unknown',
                source:    event.source    || 'unknown',
                srcIp:     event.srcIp     || null,
                message:   event.message   || ''
            };
            this.siemEvents.push(record);
            clampArray(this.siemEvents, MAX_EVENTS);
            this.publish('siem:event', record);
            if (record.srcIp) this._checkCorrelation(record.srcIp, 'siem');
            this.computePosture();
            this.save();
            return record;
        },

        // ---- Cross-tool correlation ----

        _checkCorrelation(ip, origin) {
            if (!ip) return;
            const matchingAlerts = this.networkAlerts.filter(a => a.srcIp === ip);
            const matchingEvents = this.siemEvents.filter(e => e.srcIp === ip);
            if (matchingAlerts.length && matchingEvents.length) {
                this.publish('correlation:found', {
                    ip, origin,
                    networkAlerts: matchingAlerts,
                    siemEvents: matchingEvents,
                    timestamp: nowMs()
                });
            }
        },

        crossReferenceIP(ip) {
            if (!ip) return null;
            return {
                ip,
                host:          this.discoveredHosts.find(h => h.ip === ip) || null,
                scans:         this.scanResults.filter(s => s.target === ip),
                networkAlerts: this.networkAlerts.filter(a => a.srcIp === ip || a.dstIp === ip),
                siemEvents:    this.siemEvents.filter(e => e.srcIp === ip)
            };
        },

        // ---- Derived state ----

        _rebuildThreatGraph() {
            const nodes = [];
            const edges = [];
            const seen = new Set();
            this.discoveredHosts.forEach(h => {
                nodes.push({ id: h.ip, type: 'host', label: h.hostname || h.ip, severity: 'info' });
                seen.add(h.ip);
            });
            this.scanResults.forEach(s => {
                if (!seen.has(s.target)) {
                    nodes.push({ id: s.target, type: 'host', label: s.target, severity: 'info' });
                    seen.add(s.target);
                }
                (s.cves || []).forEach((cve, idx) => {
                    // Handle both string CVE IDs and rich CVE objects ({id, severity, title, ...})
                    const isObj  = cve && typeof cve === 'object';
                    const cveKey = isObj ? (cve.id || cve.title || `cve-${s.target}-${idx}`) : String(cve);
                    const label  = isObj ? (cve.id || cve.title || cveKey) : cveKey;
                    const sev    = isObj ? (cve.severity || s.severity || 'info') : (s.severity || 'info');
                    const cveId  = `cve:${cveKey}`;
                    if (!seen.has(cveId)) {
                        nodes.push({ id: cveId, type: 'cve', label: label, severity: sev });
                        seen.add(cveId);
                    }
                    edges.push({ from: s.target, to: cveId, type: 'has-vuln' });
                });
            });
            this.threatGraph = { nodes, edges };
        },

        computePosture() {
            const hostCount        = this.discoveredHosts.length;
            const vulnCount        = this.scanResults.reduce((n, s) => n + (s.cves?.length || 0), 0);
            const criticalVulnCount = this.scanResults.filter(s => s.severity === 'critical').length;
            const highVulnCount     = this.scanResults.filter(s => s.severity === 'high').length;
            const mediumVulnCount   = this.scanResults.filter(s => s.severity === 'medium').length;
            const alertCount        = this.networkAlerts.length;
            const eventCount        = this.siemEvents.length;
            const correlationCount  = this.networkAlerts.filter(a =>
                this.siemEvents.some(e => e.srcIp === a.srcIp)
            ).length;

            let score = 100;
            score -= criticalVulnCount * 8;
            score -= highVulnCount     * 4;
            score -= mediumVulnCount   * 1;
            score -= this.networkAlerts.filter(a => a.severity === 'critical').length * 5;
            score -= this.siemEvents.filter(e => e.severity === 'critical').length * 3;
            score -= correlationCount  * 6;
            score = Math.max(0, Math.min(100, Math.round(score)));

            this.posture = {
                score, hostCount, vulnCount, criticalVulnCount,
                alertCount, eventCount, correlationCount,
                lastUpdated: nowMs()
            };
            this.publish('posture:changed', this.posture);
            return this.posture;
        },

        getDiscoveredHostsForScanning() {
            return this.discoveredHosts
                .slice()
                .sort((a, b) => b.lastSeen - a.lastSeen)
                .map(h => ({
                    ip: h.ip,
                    hostname: h.hostname,
                    label: h.hostname ? `${h.hostname} (${h.ip})` : h.ip
                }));
        },

        // ---- Auth helpers ----

        setAuth(authData) {
            if (!authData || typeof authData.token !== 'string' || !authData.token) {
                console.warn('[SOCState] setAuth: invalid authData:', authData);
                return null;
            }
            this.auth = {
                token:     authData.token,
                user:      authData.user      || null,
                expiresAt: authData.expiresAt || null
            };
            this._saveAuth();
            this.publish('auth:changed', this.auth);
            return this.auth;
        },

        clearAuth() {
            this.auth = { token: null, user: null, expiresAt: null };
            try { sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch (e) {}
            this.publish('auth:changed', this.auth);
        },

        getAuthToken() {
            if (!this.auth || !this.auth.token) return null;
            if (this.auth.expiresAt && Date.now() > this.auth.expiresAt) {
                this.clearAuth();
                return null;
            }
            return this.auth.token;
        },

        isAuthenticated() {
            return !!this.getAuthToken();
        },

        _saveAuth() {
            try {
                sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(this.auth));
            } catch (e) {
                console.warn('[SOCState] _saveAuth failed:', e);
            }
        },

        _loadAuth() {
            try {
                const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
                if (!raw) return false;
                const snap = JSON.parse(raw);
                if (!snap || !snap.token) return false;
                if (snap.expiresAt && Date.now() > snap.expiresAt) {
                    sessionStorage.removeItem(AUTH_STORAGE_KEY);
                    return false;
                }
                this.auth = {
                    token:     snap.token,
                    user:      snap.user      || null,
                    expiresAt: snap.expiresAt || null
                };
                return true;
            } catch (e) {
                console.warn('[SOCState] _loadAuth failed:', e);
                try { sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch (err) {}
                return false;
            }
        },

        // ---- Init ----

        init() {
            if (this._ready) return;
            this.load();
            this._loadAuth();
            this._rebuildThreatGraph();
            this.computePosture();
            this._ready = true;
            this.publish('hosts:updated', this.discoveredHosts);
            if (this.auth && this.auth.token) {
                this.publish('auth:changed', this.auth);
            }
        }
    };

    // Expose globally and auto-init
    window.SOCState = SOCState;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => SOCState.init());
    } else {
        SOCState.init();
    }

    // CommonJS fallback for tooling / testing
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SOCState;
    }
})();
