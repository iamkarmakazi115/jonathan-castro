/* ==========================================================================
   TECH NEWS — site/tech-news/scripts.js

   Phase 7 port of old Custom 8 (tech_news). Ported 2026-04-19 (Chat 15).
   Source: site/temp_from_GitHub/custom-8/ (byte-identical to archive).

   Design decisions (see PROJECT_KNOWLEDGE.txt Chat 15 Step 3):
     Aesthetic       : C Hybrid — ember base + muted category accents
     Q1 Categories   : A — keep 4 as-is (AI / Cyber / MSFT / IT)
     Q2 Layout       : B — top horizontal tabs (like SOC/Homelab/Markets)
     Q3 Sub-grouping : B — single flat grid per cat, sorted pubDate desc
     Q4 Accent       : C — card tag dots + tab indicator + card hover tints
     Q5 Background   : B — simple grid texture (no particles)
     Q6 Refresh      : A — 5 min polling (match Markets)
     Q7 Read status  : B — dim clicked articles via localStorage + reset
     Q8 Search       : A — no search

   Pattern: mirrors site/markets/scripts.js (shipped Chat 14).
   IIFE + 'use strict', scoped to .tech-news-page body class.
   All DOM queries via data-tech-news-* attrs (no IDs except
   the shared #nav-placeholder hook).

   Backend: GET /api/news/feed?url=<rss> at api.jonathan-castro.com.
   ALLOWED_DOMAINS on server already covers all 24 feeds (Chat 15 Step 2).

   data-tech-news-* ATTRIBUTE INVENTORY (for HTML/CSS authoring):
     Singletons:
       data-tech-news="conn-error"        — connection error banner
       data-tech-news="last-updated"      — timestamp display in header
       data-tech-news="refresh-btn"       — manual refresh button
       data-tech-news="reset-read-btn"    — reset read status button
       data-tech-news="refresh-interval"  — footer auto-refresh display
       data-tech-news="tablist"           — tab strip container
     Per-tab (4 instances):
       data-tech-news-tab="ai|cybersecurity|microsoft|it"
       data-tech-news-panel="ai|cybersecurity|microsoft|it"
     Per-panel (inside each of the 4 panels):
       data-tech-news="article-grid"      — grid container
       data-tech-news="article-count"     — count display
       data-tech-news="panel-loading"     — loading state
       data-tech-news="panel-error"       — error state
       data-tech-news="panel-retry"       — retry button inside error state
     Root element:
       [data-tech-news-active-cat]        — set by JS, CSS keys off it
     Per-card (populated by renderer):
       data-tech-news-card                — article card
       data-article-link                  — article URL

   localStorage keys:
     tech_news_tab_v1   — last selected category (persists across sessions)
     tech_news_read_v1  — { articleLink: timestamp, ... } capped at 500
   ========================================================================== */

(function () {
    'use strict';

    // ═════════════════════════════════════════════════════════════════════
    //   CONFIG
    // ═════════════════════════════════════════════════════════════════════

    const API_BASE = 'https://api.jonathan-castro.com';
    const FEED_ENDPOINT = '/api/news/feed';

    const POLL_INTERVAL_MS = 300000;           // 5 min (Q6:A)
    const CACHE_TTL_MS = 300000;               // Matches poll
    const ARTICLE_CAP_PER_CAT = 24;            // Q3:B, bumped from old 18
    const DESCRIPTION_MAX_LEN = 160;
    const READ_LOG_MAX = 500;                  // Cap localStorage read-map
    const DEFAULT_CATEGORY = 'ai';
    const FETCH_TIMEOUT_MS = 15000;
    const REFRESH_SPIN_MS = 600;               // min visual spin duration

    const STORAGE_KEYS = {
        tab: 'tech_news_tab_v1',
        read: 'tech_news_read_v1'
    };

    const PAGE_SCOPE = '.tech-news-page';

    // ═════════════════════════════════════════════════════════════════════
    //   CATEGORIES
    //   4 categories × 6 feeds = 24 total. URLs match old Custom 8 exactly.
    // ═════════════════════════════════════════════════════════════════════

    const CATEGORIES = {
        ai: {
            title: 'Artificial Intelligence',
            subtitle: 'Latest AI developments, research & industry news',
            accentVar: '--tn-ai',
            feeds: [
                { name: 'MIT Tech Review', rss: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
                { name: 'VentureBeat AI',  rss: 'https://venturebeat.com/category/ai/feed/' },
                { name: 'The Verge AI',    rss: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
                { name: 'Ars Technica AI', rss: 'https://arstechnica.com/ai/feed/' },
                { name: 'TechCrunch AI',   rss: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
                { name: 'Wired AI',        rss: 'https://www.wired.com/feed/tag/ai/latest/rss' }
            ]
        },
        cybersecurity: {
            title: 'Cybersecurity',
            subtitle: 'Threats, vulnerabilities, breaches & security operations',
            accentVar: '--tn-cyber',
            feeds: [
                { name: 'The Hacker News',   rss: 'https://feeds.feedburner.com/TheHackersNews' },
                { name: 'Krebs on Security', rss: 'https://krebsonsecurity.com/feed/' },
                { name: 'BleepingComputer',  rss: 'https://www.bleepingcomputer.com/feed/' },
                { name: 'Dark Reading',      rss: 'https://www.darkreading.com/rss.xml' },
                { name: 'SecurityWeek',      rss: 'https://www.securityweek.com/feed/' },
                { name: 'Threatpost',        rss: 'https://threatpost.com/feed/' }
            ]
        },
        microsoft: {
            title: 'Microsoft',
            subtitle: 'Windows, Azure, Office 365, Copilot & enterprise news',
            accentVar: '--tn-msft',
            feeds: [
                { name: 'Windows Central',     rss: 'https://www.windowscentral.com/feed' },
                { name: 'Neowin',              rss: 'https://www.neowin.net/news/rss/' },
                { name: 'Azure Blog',          rss: 'https://azure.microsoft.com/en-us/blog/feed/' },
                { name: 'ZDNet Microsoft',     rss: 'https://www.zdnet.com/topic/microsoft/rss.xml' },
                { name: 'The Verge Microsoft', rss: 'https://www.theverge.com/rss/microsoft/index.xml' },
                { name: 'MS Power User',       rss: 'https://mspoweruser.com/feed/' }
            ]
        },
        it: {
            title: 'Information Technology',
            subtitle: 'Infrastructure, networking, DevOps & enterprise IT',
            accentVar: '--tn-it',
            feeds: [
                { name: 'Ars Technica', rss: 'https://feeds.arstechnica.com/arstechnica/index' },
                { name: 'InfoWorld',    rss: 'https://www.infoworld.com/feed/' },
                { name: 'The Register', rss: 'https://www.theregister.com/headlines.atom' },
                { name: 'TechRepublic', rss: 'https://www.techrepublic.com/rssfeeds/articles/' },
                { name: 'ZDNet',        rss: 'https://www.zdnet.com/news/rss.xml' },
                { name: 'ComputerWorld', rss: 'https://www.computerworld.com/feed/' }
            ]
        }
    };

    const CATEGORY_ORDER = ['ai', 'cybersecurity', 'microsoft', 'it'];

    // ═════════════════════════════════════════════════════════════════════
    //   MODULE STATE
    // ═════════════════════════════════════════════════════════════════════

    let currentCategory = DEFAULT_CATEGORY;
    let newsCache = Object.create(null);    // { catKey: { articles, timestamp } }
    let readMap = Object.create(null);      // { articleLink: timestamp }
    const isFetching = Object.create(null); // { catKey: bool } re-entry guard
    let pollTimer = null;
    let saveReadTimer = null;
    let rootEl = null;                      // .tech-news-page element

    // ═════════════════════════════════════════════════════════════════════
    //   DOM HELPERS
    // ═════════════════════════════════════════════════════════════════════

    function $(selector, context) {
        return (context || document).querySelector(selector);
    }

    function $$(selector, context) {
        return Array.from((context || document).querySelectorAll(selector));
    }

    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    function findPanel(catKey) {
        // Avoid querySelector attribute-value escaping by iterating
        return $$('[data-tech-news-panel]', rootEl)
            .find(el => el.getAttribute('data-tech-news-panel') === catKey) || null;
    }

    function findTab(catKey) {
        return $$('[data-tech-news-tab]', rootEl)
            .find(el => el.getAttribute('data-tech-news-tab') === catKey) || null;
    }

    // ═════════════════════════════════════════════════════════════════════
    //   FORMATTERS
    // ═════════════════════════════════════════════════════════════════════

    function escapeHTML(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function extractDomain(url) {
        if (!url) return '';
        try {
            const u = new URL(url);
            let host = u.hostname.toLowerCase().replace(/^www\./, '');
            if (host === 'feeds.feedburner.com') return 'feedburner';
            return host;
        } catch (e) {
            return '';
        }
    }

    function timeAgo(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        const now = Date.now();
        const diffMs = now - date.getTime();
        if (diffMs < 0) return 'Just now';
        const mins = Math.floor(diffMs / 60000);
        const hrs = Math.floor(mins / 60);
        const days = Math.floor(hrs / 24);
        if (mins < 2) return 'Just now';
        if (mins < 60) return mins + 'm ago';
        if (hrs < 24) return hrs + 'h ago';
        if (days < 7) return days + 'd ago';
        return date.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        });
    }

    function truncate(str, max) {
        if (!str) return '';
        const trimmed = String(str).trim();
        if (trimmed.length <= max) return trimmed;
        return trimmed.slice(0, max - 1).trimEnd() + '…';
    }

    function formatClockTime(date) {
        date = date || new Date();
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return hh + ':' + mm;
    }

    // ═════════════════════════════════════════════════════════════════════
    //   READ STATUS (Q7:B)
    // ═════════════════════════════════════════════════════════════════════

    function loadReadMap() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.read);
            if (!raw) return Object.create(null);
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                // Copy into a null-proto object to avoid prototype pollution
                const out = Object.create(null);
                for (const k of Object.keys(parsed)) {
                    const v = parsed[k];
                    if (typeof v === 'number' && isFinite(v)) {
                        out[k] = v;
                    }
                }
                return out;
            }
        } catch (e) {
            console.warn('[TechNews] Failed to parse read map:', e.message);
        }
        return Object.create(null);
    }

    function saveReadMap() {
        if (saveReadTimer) clearTimeout(saveReadTimer);
        saveReadTimer = setTimeout(flushReadMap, 250);
    }

    function flushReadMap() {
        saveReadTimer = null;
        try {
            const entries = Object.entries(readMap);
            // Cap to READ_LOG_MAX most recent
            if (entries.length > READ_LOG_MAX) {
                entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
                const trimmed = entries.slice(0, READ_LOG_MAX);
                readMap = Object.create(null);
                for (const [link, ts] of trimmed) {
                    readMap[link] = ts;
                }
            }
            localStorage.setItem(STORAGE_KEYS.read, JSON.stringify(readMap));
        } catch (e) {
            console.warn('[TechNews] Failed to save read map:', e.message);
        }
    }

    function isRead(link) {
        return !!(link && readMap[link]);
    }

    function markRead(link) {
        if (!link) return;
        readMap[link] = Date.now();
        saveReadMap();
    }

    function resetReadMap() {
        readMap = Object.create(null);
        try {
            localStorage.removeItem(STORAGE_KEYS.read);
        } catch (e) {
            console.warn('[TechNews] Failed to clear read map:', e.message);
        }
        // Remove is-read class from all currently-rendered cards
        $$('.tn-card.is-read', rootEl).forEach(c => c.classList.remove('is-read'));
    }

    // ═════════════════════════════════════════════════════════════════════
    //   TAB PERSISTENCE
    // ═════════════════════════════════════════════════════════════════════

    function loadSavedTab() {
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.tab);
            if (saved && CATEGORIES[saved]) return saved;
        } catch (e) { /* ignore */ }
        return DEFAULT_CATEGORY;
    }

    function saveTab(catKey) {
        try {
            localStorage.setItem(STORAGE_KEYS.tab, catKey);
        } catch (e) { /* ignore */ }
    }

    // ═════════════════════════════════════════════════════════════════════
    //   API WRAPPER
    // ═════════════════════════════════════════════════════════════════════

    async function fetchFeed(rssUrl) {
        const proxyUrl = API_BASE + FEED_ENDPOINT + '?url=' + encodeURIComponent(rssUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const resp = await fetch(proxyUrl, { signal: controller.signal });
            if (!resp.ok) {
                console.warn('[TechNews] Feed proxy ' + resp.status + ' for ' + rssUrl);
                return [];
            }
            const data = await resp.json();
            if (data && data.status === 'ok' && Array.isArray(data.items)) {
                return data.items;
            }
            return [];
        } catch (e) {
            if (e && e.name === 'AbortError') {
                console.warn('[TechNews] Feed timeout for ' + rssUrl);
            } else {
                console.warn('[TechNews] Feed error for ' + rssUrl + ':', e && e.message);
            }
            return [];
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    //   CACHE
    // ═════════════════════════════════════════════════════════════════════

    function getCached(catKey) {
        const entry = newsCache[catKey];
        if (!entry) return null;
        if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
        return entry;
    }

    function setCached(catKey, articles) {
        newsCache[catKey] = {
            articles: articles,
            timestamp: Date.now()
        };
    }

    function invalidateCache(catKey) {
        if (catKey) {
            delete newsCache[catKey];
        } else {
            newsCache = Object.create(null);
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    //   TAB CONTROLLER (WAI-ARIA tabs pattern)
    // ═════════════════════════════════════════════════════════════════════

    function initTabs() {
        const tabs = $$('[data-tech-news-tab]', rootEl);
        const tablist = $('[data-tech-news="tablist"]', rootEl);
        if (!tabs.length || !tablist) {
            console.warn('[TechNews] No tabs or tablist found');
            return;
        }

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const catKey = tab.getAttribute('data-tech-news-tab');
                if (catKey && catKey !== currentCategory) {
                    setActiveTab(catKey);
                }
            });
        });

        tablist.addEventListener('keydown', (e) => {
            const target = e.target;
            if (!target || !target.hasAttribute || !target.hasAttribute('data-tech-news-tab')) {
                return;
            }
            const idx = CATEGORY_ORDER.indexOf(currentCategory);
            if (idx < 0) return;
            let nextIdx = idx;
            if (e.key === 'ArrowRight') {
                nextIdx = (idx + 1) % CATEGORY_ORDER.length;
                e.preventDefault();
            } else if (e.key === 'ArrowLeft') {
                nextIdx = (idx - 1 + CATEGORY_ORDER.length) % CATEGORY_ORDER.length;
                e.preventDefault();
            } else if (e.key === 'Home') {
                nextIdx = 0;
                e.preventDefault();
            } else if (e.key === 'End') {
                nextIdx = CATEGORY_ORDER.length - 1;
                e.preventDefault();
            } else {
                return;
            }
            const nextKey = CATEGORY_ORDER[nextIdx];
            setActiveTab(nextKey, { focus: true });
        });
    }

    function setActiveTab(catKey, options) {
        options = options || {};
        if (!CATEGORIES[catKey]) return;
        currentCategory = catKey;
        saveTab(catKey);

        // Update tab buttons
        $$('[data-tech-news-tab]', rootEl).forEach(tab => {
            const key = tab.getAttribute('data-tech-news-tab');
            const isActive = key === catKey;
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            tab.setAttribute('tabindex', isActive ? '0' : '-1');
            tab.classList.toggle('is-active', isActive);
            if (isActive && options.focus) {
                tab.focus();
            }
        });

        // Update panels (only active panel visible)
        $$('[data-tech-news-panel]', rootEl).forEach(panel => {
            const key = panel.getAttribute('data-tech-news-panel');
            if (key === catKey) {
                panel.removeAttribute('hidden');
            } else {
                panel.setAttribute('hidden', '');
            }
        });

        // Category hint for CSS
        if (rootEl) rootEl.setAttribute('data-tech-news-active-cat', catKey);

        // Update header subtitle/title for current cat if those elements exist
        updateCategoryHeader(catKey);

        // Load the category
        loadCategory(catKey);
    }

    function updateCategoryHeader(catKey) {
        const cat = CATEGORIES[catKey];
        if (!cat) return;
        const titleEl = $('[data-tech-news="category-title"]', rootEl);
        const subtitleEl = $('[data-tech-news="category-subtitle"]', rootEl);
        if (titleEl) titleEl.textContent = cat.title;
        if (subtitleEl) subtitleEl.textContent = cat.subtitle;
    }

    // ═════════════════════════════════════════════════════════════════════
    //   ARTICLE LOADER
    // ═════════════════════════════════════════════════════════════════════

    async function loadCategory(catKey, forceRefresh) {
        if (!CATEGORIES[catKey]) return;
        if (isFetching[catKey]) return;

        const panel = findPanel(catKey);
        if (!panel) {
            console.warn('[TechNews] Panel not found for category:', catKey);
            return;
        }

        // Cache hit path
        if (!forceRefresh) {
            const cached = getCached(catKey);
            if (cached) {
                renderArticles(panel, cached.articles, catKey);
                updateLastUpdated(cached.timestamp);
                return;
            }
        }

        isFetching[catKey] = true;
        setPanelState(panel, 'loading');

        const cat = CATEGORIES[catKey];
        const promises = cat.feeds.map(feed => fetchFeed(feed.rss).then(items => {
            return items.map(item => ({
                title: item.title || 'Untitled',
                link: item.link || '',
                description: item.description || '',
                pubDate: item.pubDate || '',
                sourceName: feed.name
            }));
        }));

        try {
            const results = await Promise.allSettled(promises);
            const merged = [];
            let failedCount = 0;
            results.forEach(r => {
                if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                    merged.push(...r.value);
                } else {
                    failedCount++;
                }
            });

            // Dedupe by link (falsy links kept as-is since they're rare)
            const seen = new Set();
            const deduped = [];
            for (const a of merged) {
                if (a.link) {
                    if (seen.has(a.link)) continue;
                    seen.add(a.link);
                }
                deduped.push(a);
            }

            // Sort by pubDate desc
            deduped.sort((a, b) => {
                const da = new Date(a.pubDate).getTime() || 0;
                const db = new Date(b.pubDate).getTime() || 0;
                return db - da;
            });

            // Cap per category
            const capped = deduped.slice(0, ARTICLE_CAP_PER_CAT);

            setCached(catKey, capped);

            if (capped.length === 0) {
                setPanelState(panel, 'error');
                if (failedCount === cat.feeds.length) {
                    showConnectionError(true);
                }
            } else {
                renderArticles(panel, capped, catKey);
                if (failedCount < cat.feeds.length) {
                    showConnectionError(false);
                }
            }

            updateLastUpdated(Date.now());
        } catch (e) {
            console.error('[TechNews] loadCategory error:', e);
            setPanelState(panel, 'error');
        } finally {
            isFetching[catKey] = false;
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    //   RENDERER
    // ═════════════════════════════════════════════════════════════════════

    function renderArticles(panel, articles, catKey) {
        const grid = $('[data-tech-news="article-grid"]', panel);
        const countEl = $('[data-tech-news="article-count"]', panel);
        if (!grid) return;

        if (!articles.length) {
            setPanelState(panel, 'error');
            return;
        }

        const html = articles.map((a, i) => renderCard(a, catKey, i)).join('');
        grid.innerHTML = html;

        if (countEl) {
            countEl.textContent = articles.length + ' article' + (articles.length === 1 ? '' : 's');
        }

        setPanelState(panel, 'ready');
    }

    function renderCard(article, catKey, idx) {
        const readClass = isRead(article.link) ? ' is-read' : '';
        // Stagger animation up to card 16, then flat 400ms
        const delay = Math.min(idx * 25, 400);
        const safeTitle = escapeHTML(article.title || 'Untitled');
        const safeDesc = escapeHTML(truncate(article.description || '', DESCRIPTION_MAX_LEN));
        const safeSource = escapeHTML(article.sourceName || '');
        const safeDomain = escapeHTML(extractDomain(article.link) || '');
        const dateStr = escapeHTML(timeAgo(article.pubDate));
        const href = escapeHTML(article.link || '#');
        const aria = safeTitle + (safeSource ? ' — ' + safeSource : '');

        return '' +
          '<article class="tn-card' + readClass + '" ' +
                   'data-tech-news-card data-article-link="' + href + '" ' +
                   'style="animation-delay:' + delay + 'ms;" ' +
                   'tabindex="0" ' +
                   'role="link" ' +
                   'aria-label="' + aria + '">' +
            '<div class="tn-card-tag">' +
              '<span class="tn-tag-dot" aria-hidden="true"></span>' +
              '<span class="tn-tag-label">' + safeSource + '</span>' +
            '</div>' +
            '<h3 class="tn-card-title">' + safeTitle + '</h3>' +
            (safeDesc
              ? '<p class="tn-card-desc">' + safeDesc + '</p>'
              : '') +
            '<div class="tn-card-footer">' +
              '<span class="tn-card-date">' + dateStr + '</span>' +
              (safeDomain
                ? '<span class="tn-card-domain">' + safeDomain + '</span>'
                : '<span class="tn-card-domain"></span>') +
              '<svg class="tn-card-link-icon" viewBox="0 0 24 24" aria-hidden="true" ' +
                   'fill="none" stroke="currentColor" stroke-width="2" ' +
                   'stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
                '<polyline points="15 3 21 3 21 9"/>' +
                '<line x1="10" y1="14" x2="21" y2="3"/>' +
              '</svg>' +
            '</div>' +
          '</article>';
    }

    function setPanelState(panel, state) {
        // states: loading | ready | error
        const loading = $('[data-tech-news="panel-loading"]', panel);
        const errorEl = $('[data-tech-news="panel-error"]', panel);
        const grid = $('[data-tech-news="article-grid"]', panel);

        if (loading) loading.toggleAttribute('hidden', state !== 'loading');
        if (errorEl) errorEl.toggleAttribute('hidden', state !== 'error');
        if (grid) grid.toggleAttribute('hidden', state !== 'ready');
    }

    function showConnectionError(show) {
        const banner = $('[data-tech-news="conn-error"]', rootEl);
        if (!banner) return;
        if (show) banner.removeAttribute('hidden');
        else banner.setAttribute('hidden', '');
    }

    function updateLastUpdated(timestamp) {
        const el = $('[data-tech-news="last-updated"]', rootEl);
        if (!el) return;
        const date = new Date(timestamp);
        el.textContent = 'Updated ' + formatClockTime(date);
        if (el.setAttribute) el.setAttribute('datetime', date.toISOString());
    }

    // ═════════════════════════════════════════════════════════════════════
    //   CARD CLICK DELEGATION
    // ═════════════════════════════════════════════════════════════════════

    function initCardClicks() {
        if (!rootEl) return;

        rootEl.addEventListener('click', (e) => {
            const card = e.target.closest && e.target.closest('[data-tech-news-card]');
            if (!card) return;
            activateCard(card);
        });

        rootEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest && e.target.closest('[data-tech-news-card]');
            if (!card) return;
            e.preventDefault();
            activateCard(card);
        });
    }

    function activateCard(card) {
        const link = card.getAttribute('data-article-link');
        if (!link || link === '#') return;
        // Open first so popup blockers that require direct user gesture work
        window.open(link, '_blank', 'noopener,noreferrer');
        markRead(link);
        card.classList.add('is-read');
    }

    // ═════════════════════════════════════════════════════════════════════
    //   REFRESH / RESET / RETRY CONTROLS
    // ═════════════════════════════════════════════════════════════════════

    function initControls() {
        const refreshBtn = $('[data-tech-news="refresh-btn"]', rootEl);
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                if (refreshBtn.classList.contains('is-spinning')) return;
                refreshBtn.classList.add('is-spinning');
                invalidateCache(currentCategory);
                const started = Date.now();
                loadCategory(currentCategory, true).finally(() => {
                    const elapsed = Date.now() - started;
                    const wait = Math.max(0, REFRESH_SPIN_MS - elapsed);
                    setTimeout(() => refreshBtn.classList.remove('is-spinning'), wait);
                });
            });
        }

        const resetBtn = $('[data-tech-news="reset-read-btn"]', rootEl);
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const count = Object.keys(readMap).length;
                if (count === 0) {
                    notifyReadStatus('No read articles to reset.');
                    return;
                }
                const ok = confirm(
                    'Reset read status for ' + count + ' article' +
                    (count === 1 ? '' : 's') + '?\n\nThis cannot be undone.'
                );
                if (ok) {
                    resetReadMap();
                    notifyReadStatus('Read status reset.');
                }
            });
        }

        // Retry buttons inside panel error states (delegated)
        if (rootEl) {
            rootEl.addEventListener('click', (e) => {
                const retry = e.target.closest && e.target.closest('[data-tech-news="panel-retry"]');
                if (!retry) return;
                e.preventDefault();
                invalidateCache(currentCategory);
                loadCategory(currentCategory, true);
            });
        }

        // Refresh interval display in footer
        const intervalEl = $('[data-tech-news="refresh-interval"]', rootEl);
        if (intervalEl) {
            const mins = Math.round(POLL_INTERVAL_MS / 60000);
            intervalEl.textContent = mins + ' min';
        }
    }

    function notifyReadStatus(msg) {
        const statusEl = $('[data-tech-news="reset-status"]', rootEl);
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.classList.add('is-visible');
        setTimeout(() => {
            statusEl.classList.remove('is-visible');
        }, 2500);
    }

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => {
            // Only poll the currently-visible category to save API calls
            invalidateCache(currentCategory);
            loadCategory(currentCategory, true);
        }, POLL_INTERVAL_MS);
    }

    // ═════════════════════════════════════════════════════════════════════
    //   INIT
    // ═════════════════════════════════════════════════════════════════════

    function init() {
        rootEl = document.querySelector(PAGE_SCOPE);
        if (!rootEl) {
            console.warn('[TechNews] Root ' + PAGE_SCOPE + ' element not found, aborting init');
            return;
        }

        // Load persisted state
        readMap = loadReadMap();
        const savedTab = loadSavedTab();
        currentCategory = savedTab;

        // Wire up UI
        initTabs();
        initCardClicks();
        initControls();

        // Activate the saved tab (this also triggers loadCategory for it)
        setActiveTab(savedTab);

        // Kick the poll loop
        startPolling();

        console.info(
            '[TechNews] Dashboard ready — cat=' + savedTab +
            ', feeds=' + getTotalFeedCount() +
            ', poll=' + (POLL_INTERVAL_MS / 60000) + 'm'
        );
    }

    function getTotalFeedCount() {
        return CATEGORY_ORDER.reduce((n, k) => n + CATEGORIES[k].feeds.length, 0);
    }

    // Kick off
    onReady(init);

    // Flush pending read-map saves on unload so we never lose "last click"
    window.addEventListener('beforeunload', () => {
        if (saveReadTimer) {
            clearTimeout(saveReadTimer);
            try {
                localStorage.setItem(STORAGE_KEYS.read, JSON.stringify(readMap));
            } catch (e) { /* ignore */ }
        }
    });

})();
