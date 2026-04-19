/*!
 * Security Operations Center — Page Controller
 * -------------------------------------------------------------
 * Wires up:
 *   1. Tab controller — WAI-ARIA tabs pattern (Arrow/Home/End,
 *      roving tabindex, aria-selected, hides inactive panels)
 *   2. Auth modal — open/close, form submit, ESC + backdrop,
 *      calls SOCState.setAuth() with the result of
 *      POST /api/auth/login (Step 3: real API, replaced the
 *      Step 2 stub)
 *   3. Posture subscriber — renders score + 5 metrics from
 *      SOCState.posture, re-renders on "posture:changed"
 *   4. Auth status subscriber — flips the dot + label + toggle
 *      button on "auth:changed"
 *   5. Tool bootstrap loop — iterates window.SOCTools and calls
 *      each module's init(panelEl); modules that aren't loaded
 *      yet (Step 3+ port one at a time) are silently skipped.
 *
 * Loaded AFTER /navigation.js and /shared.js. Assumes
 * window.SOCState exists and has auto-init'd.
 * -------------------------------------------------------------
 */
(function () {
    'use strict';

    // -------------------------------------------------------
    // Config
    // -------------------------------------------------------
    const API_BASE = 'https://api.jonathan-castro.com';
    const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour fallback if server omits expiresAt

    // -------------------------------------------------------
    // Small DOM helpers
    // -------------------------------------------------------
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    }

    function onReady(cb) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', cb, { once: true });
        } else {
            cb();
        }
    }

    function waitForSOCState(cb, attempts) {
        attempts = attempts == null ? 50 : attempts; // ~5s max at 100ms
        if (window.SOCState && typeof window.SOCState.subscribe === 'function') {
            cb(window.SOCState);
            return;
        }
        if (attempts <= 0) {
            console.error('[SOC] SOCState unavailable — shared.js failed to load?');
            return;
        }
        setTimeout(function () { waitForSOCState(cb, attempts - 1); }, 100);
    }

    // =======================================================
    // 1. TAB CONTROLLER — WAI-ARIA tabs pattern
    //    https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
    // =======================================================
    function initTabs() {
        const tablist = $('[role="tablist"]');
        if (!tablist) {
            console.warn('[SOC] initTabs: no [role="tablist"] found');
            return;
        }

        const tabs = $$('[role="tab"]', tablist);
        if (!tabs.length) return;

        function panelFor(tab) {
            return document.getElementById(tab.getAttribute('aria-controls'));
        }

        function activate(tab, setFocus) {
            tabs.forEach(function (t) {
                const selected = (t === tab);
                t.setAttribute('aria-selected', selected ? 'true' : 'false');
                t.setAttribute('tabindex', selected ? '0' : '-1');
                const panel = panelFor(t);
                if (panel) {
                    if (selected) panel.removeAttribute('hidden');
                    else panel.setAttribute('hidden', '');
                }
            });
            if (setFocus) tab.focus();
        }

        // Click to activate (no focus movement — matches APG "automatic activation")
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                activate(tab, false);
            });
        });

        // Keyboard: Arrow L/R wraps, Home/End jumps, Enter/Space activates
        tablist.addEventListener('keydown', function (e) {
            const currentIdx = tabs.indexOf(document.activeElement);
            if (currentIdx === -1) return;

            let targetIdx = -1;
            switch (e.key) {
                case 'ArrowRight':
                    targetIdx = (currentIdx + 1) % tabs.length;
                    break;
                case 'ArrowLeft':
                    targetIdx = (currentIdx - 1 + tabs.length) % tabs.length;
                    break;
                case 'Home':
                    targetIdx = 0;
                    break;
                case 'End':
                    targetIdx = tabs.length - 1;
                    break;
                case 'Enter':
                case ' ':
                    activate(tabs[currentIdx], false);
                    e.preventDefault();
                    return;
                default:
                    return;
            }

            if (targetIdx !== -1) {
                e.preventDefault();
                activate(tabs[targetIdx], true);
            }
        });
    }

    // =======================================================
    // 2. AUTH MODAL — open/close + submit
    //    STEP 2 STUB: form submit generates a stub token locally.
    //    STEP 3 (LAN port) will replace submit handler with a
    //    real POST /api/auth/login call.
    // =======================================================
    function initAuth(SOCState) {
        const modal       = $('#authModal');
        const toggleBtn   = $('#authToggleBtn');
        const closeBtn    = $('#authClose');
        const backdrop    = modal ? modal.querySelector('.auth-modal-backdrop') : null;
        const form        = $('#authForm');
        const emailInput  = $('#authEmail');
        const passInput   = $('#authPassword');
        const errorEl     = $('#authError');
        const submitBtn   = $('#authSubmit');

        if (!modal || !toggleBtn || !form) {
            console.warn('[SOC] initAuth: missing auth DOM nodes');
            return;
        }

        let lastFocused = null;

        function showError(msg) {
            if (!errorEl) return;
            errorEl.textContent = msg;
            errorEl.hidden = false;
        }
        function hideError() {
            if (!errorEl) return;
            errorEl.hidden = true;
            errorEl.textContent = '';
        }

        function openModal() {
            hideError();
            lastFocused = document.activeElement;
            modal.hidden = false;
            modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            // Defer focus so the input is actually in the DOM layout
            setTimeout(function () { if (emailInput) emailInput.focus(); }, 0);
        }

        function closeModal() {
            modal.hidden = true;
            modal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            if (lastFocused && typeof lastFocused.focus === 'function') {
                lastFocused.focus();
            }
        }

        // Toggle button: opens modal if logged out, logs out if logged in
        toggleBtn.addEventListener('click', function () {
            if (SOCState.isAuthenticated()) {
                SOCState.clearAuth();
            } else {
                openModal();
            }
        });

        if (closeBtn)  closeBtn.addEventListener('click', closeModal);
        if (backdrop)  backdrop.addEventListener('click', closeModal);

        // ESC to close while modal is open
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !modal.hidden) closeModal();
        });

        // Form submit — real POST /api/auth/login
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            hideError();

            const email = (emailInput && emailInput.value || '').trim();
            const pass  = (passInput  && passInput.value  || '');

            if (!email || !pass) {
                showError('Email and password are required.');
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                const txt = submitBtn.querySelector('.btn-text');
                if (txt) txt.textContent = 'Authenticating...';
            }

            try {
                const res = await fetch(API_BASE + '/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, password: pass })
                });
                let data = {};
                try { data = await res.json(); } catch (parseErr) { data = {}; }

                if (!res.ok || data.error) {
                    throw new Error(data.error || ('Authentication failed (HTTP ' + res.status + ')'));
                }
                if (!data.token) {
                    throw new Error('Server did not return a token.');
                }

                SOCState.setAuth({
                    token: data.token,
                    user: {
                        email: email,
                        display_name: (data.user && data.user.display_name) || null
                    },
                    expiresAt: data.expiresAt || (Date.now() + DEFAULT_SESSION_TTL_MS)
                });
                form.reset();
                closeModal();
            } catch (err) {
                console.error('[SOC] Login failed:', err);
                showError(err.message || 'Authentication failed. Try again.');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    const txt = submitBtn.querySelector('.btn-text');
                    if (txt) txt.textContent = 'Authenticate';
                }
            }
        });
    }

    // =======================================================
    // 3. POSTURE CARD SUBSCRIBER
    //    Renders score + 5 metrics. Re-renders on posture:changed.
    // =======================================================
    function initPosture(SOCState) {
        const scoreEl  = $('#postureScore');
        const hostsEl  = $('#metricHosts');
        const vulnsEl  = $('#metricVulns');
        const alertsEl = $('#metricAlerts');
        const eventsEl = $('#metricEvents');
        const corrEl   = $('#metricCorrelations');

        function render(p) {
            if (!p) return;
            if (scoreEl)  scoreEl.textContent  = (typeof p.score === 'number') ? p.score : '--';
            if (hostsEl)  hostsEl.textContent  = p.hostCount         || 0;
            if (vulnsEl)  vulnsEl.textContent  = p.vulnCount         || 0;
            if (alertsEl) alertsEl.textContent = p.alertCount        || 0;
            if (eventsEl) eventsEl.textContent = p.eventCount        || 0;
            if (corrEl)   corrEl.textContent   = p.correlationCount  || 0;
        }

        // Initial paint from whatever shared.js already computed
        if (SOCState.posture) render(SOCState.posture);

        // Live updates
        SOCState.subscribe('posture:changed', render);
    }

    // =======================================================
    // 4. AUTH STATUS SUBSCRIBER
    //    Flips the dot + label + toggle button on auth:changed.
    // =======================================================
    function initAuthStatus(SOCState) {
        const dot       = $('#authDot');
        const statusEl  = $('#authStatus');
        const toggleBtn = $('#authToggleBtn');

        function render(auth) {
            const loggedIn = !!(auth && auth.token && SOCState.isAuthenticated());
            if (dot) dot.setAttribute('data-state', loggedIn ? 'in' : 'out');

            if (statusEl) {
                if (loggedIn) {
                    const email = (auth.user && auth.user.email) ? auth.user.email : 'Authenticated';
                    statusEl.textContent = email;
                } else {
                    statusEl.textContent = 'Not authenticated';
                }
            }

            if (toggleBtn) {
                toggleBtn.textContent = loggedIn ? 'Log out' : 'Log in';
            }
        }

        // Initial paint
        render(SOCState.auth);

        // Live updates
        SOCState.subscribe('auth:changed', render);
    }

    // =======================================================
    // 5. TOOL BOOTSTRAP LOOP
    //    Map data-tool attribute on each tab to the matching
    //    window.SOCTools.<key> module. Missing modules are
    //    silently skipped so we can port tools one at a time
    //    in Step 3+ without touching this file.
    // =======================================================
    function initToolModules() {
        const tools = window.SOCTools || {};
        const tabs = $$('[role="tab"]');

        tabs.forEach(function (tab) {
            const key = tab.getAttribute('data-tool');
            if (!key) return;

            const panelId = tab.getAttribute('aria-controls');
            const panel   = panelId ? document.getElementById(panelId) : null;
            if (!panel) return;

            const mod = tools[key];
            if (!mod || typeof mod.init !== 'function') {
                // Module not ported yet — that's fine, placeholder stays visible.
                return;
            }

            try {
                mod.init(panel);
            } catch (err) {
                console.error('[SOC] Tool init failed for "' + key + '":', err);
            }
        });
    }

    // =======================================================
    // Bootstrap
    // =======================================================
    onReady(function () {
        // Tabs don't depend on SOCState — wire immediately.
        initTabs();

        // Everything else waits for shared.js to be ready.
        waitForSOCState(function (SOCState) {
            initPosture(SOCState);
            initAuthStatus(SOCState);
            initAuth(SOCState);
            initToolModules();
        });
    });
})();
