// ============================================================
// Markets page — scripts.js
// Jonathan Castro Portfolio | REBUILD v2 Phase 6 (Chat 13)
// ------------------------------------------------------------
// Two tabs: Stocks + Market News.
// Backend: https://api.jonathan-castro.com/api/finance/{quote,chart}
//          https://api.jonathan-castro.com/api/news/feed?url=<rss>
// Scope:   .markets-page  (all queries scoped to this root)
// Attrs:   data-markets-*  (no IDs, except #nav-placeholder)
// Persist: localStorage keys markets_watchlist_v1, markets_tab_v1
// Design Q locks (Chat 13):
//   Q1 tabs         = horizontal top tabs
//   Q2 default tab  = last-selected (localStorage), seed Stocks
//   Q3 refresh      = 30s polling (Stocks tab only)
//   Q4 chart lib    = Chart.js
//   Q5 stocks       = 20 default + user add/remove (watchlist)
//   Q6 crypto       = DROPPED (no crypto tab)
//   Q7 layout       = tables only, desktop-only
//   Q8 API shape    = short field names (price/change/volume/etc)
// ============================================================

(function () {
    'use strict';

    // ============================================================
    // CONFIG
    // ============================================================
    var API_BASE = 'https://api.jonathan-castro.com';
    var POLL_INTERVAL_MS = 30 * 1000;        // Q3: 30s
    var NEWS_POLL_INTERVAL_MS = 5 * 60 * 1000; // news: 5 min
    var WATCHLIST_MAX = 50;

    var INDICES = [
        { symbol: '^GSPC', name: 'S&P 500',     short: 'SPX' },
        { symbol: '^DJI',  name: 'Dow Jones',   short: 'DOW' },
        { symbol: '^IXIC', name: 'NASDAQ',      short: 'NDX' },
        { symbol: '^RUT',  name: 'Russell 2000', short: 'RUT' }
    ];

    var DEFAULT_WATCHLIST = [
        'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA',
        'META', 'TSLA', 'AMD',   'NFLX', 'JPM',
        'V',    'WMT',  'DIS',   'PYPL', 'INTC',
        'BA',   'CRM',  'UBER',  'COIN', 'PLTR'
    ];

    // Q2 clarify: minimal 4 ranges
    var CHART_RANGES = [
        { label: '1D', range: '1d',  interval: '5m'  },
        { label: '1M', range: '1mo', interval: '1d'  },
        { label: '1Y', range: '1y',  interval: '1wk' },
        { label: '5Y', range: '5y',  interval: '1mo' }
    ];

    // News sources — all use feeds.finance.yahoo.com, the one domain
    // confirmed whitelisted in the server-side news-proxy.js.
    // To add Bloomberg/Reuters/MarketWatch etc, those domains must
    // be added to ALLOWED_DOMAINS in /var/www/api/news-proxy.js first.
    var NEWS_SOURCES = [
        { id: 'sp500',  name: 'S&P 500 News', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US' },
        { id: 'dow',    name: 'Dow Jones',    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^DJI&region=US&lang=en-US'  },
        { id: 'nasdaq', name: 'NASDAQ',       url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^IXIC&region=US&lang=en-US' },
        { id: 'aapl',   name: 'Apple (AAPL)', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL&region=US&lang=en-US'  },
        { id: 'tsla',   name: 'Tesla (TSLA)', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=TSLA&region=US&lang=en-US'  }
    ];

    var WATCHLIST_KEY = 'markets_watchlist_v1';
    var TAB_KEY       = 'markets_tab_v1';

    // ============================================================
    // MODULE STATE
    // ============================================================
    var pageRoot = null;
    var stocksPollTimer = null;
    var newsPollTimer = null;
    var currentTab = 'stocks';
    var featuredChart = null;
    var currentFeaturedSymbol = null;
    var currentFeaturedName = null;
    var currentFeaturedRange = '1D';
    var watchlist = DEFAULT_WATCHLIST.slice();
    var newsFilter = 'all';
    var newsArticles = [];
    var deadNewsSources = new Set();
    var lastStockData = new Map();
    var lastIndexData = new Map();
    var isFetchingStocks = false;
    var isFetchingNews = false;

    // ============================================================
    // DOM HELPERS
    // ============================================================
    function $(key)  { return pageRoot.querySelector('[data-markets="' + key + '"]'); }
    function $$(key) { return pageRoot.querySelectorAll('[data-markets="' + key + '"]'); }
    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    // ============================================================
    // FORMATTERS
    // ============================================================
    function formatCurrency(n, decimals) {
        if (decimals == null) decimals = 2;
        if (n == null || isNaN(n)) return '--';
        return '$' + Number(n).toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }
    function formatNumber(n, decimals) {
        if (decimals == null) decimals = 2;
        if (n == null || isNaN(n)) return '--';
        return Number(n).toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }
    function formatCompact(n) {
        if (n == null || isNaN(n)) return '--';
        if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
        if (n >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
        if (n >= 1e6)  return (n / 1e6).toFixed(2)  + 'M';
        if (n >= 1e3)  return (n / 1e3).toFixed(1)  + 'K';
        return String(Math.round(n));
    }
    function formatPercent(n) {
        if (n == null || isNaN(n)) return '--';
        var sign = n >= 0 ? '+' : '';
        return sign + n.toFixed(2) + '%';
    }
    function formatChange(n) {
        if (n == null || isNaN(n)) return '--';
        var sign = n >= 0 ? '+' : '';
        return sign + n.toFixed(2);
    }
    function changeClass(n) {
        if (n == null || isNaN(n)) return '';
        if (n > 0) return 'is-up';
        if (n < 0) return 'is-down';
        return '';
    }
    function changeArrow(n) {
        if (n == null || isNaN(n)) return '';
        if (n > 0) return '▲';
        if (n < 0) return '▼';
        return '—';
    }
    function timeAgo(dateStr) {
        var d = new Date(dateStr).getTime();
        if (isNaN(d)) return '';
        var diff = Math.floor((Date.now() - d) / 1000);
        if (diff < 60)    return diff + 's ago';
        if (diff < 3600)  return Math.floor(diff / 60)    + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600)  + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }
    function isValidSymbol(s) {
        return typeof s === 'string' && /^[A-Z]{1,5}$/.test(s);
    }
    function isIntradayRange(label) {
        return label === '1D';
    }

    // ============================================================
    // API WRAPPERS
    // ============================================================
    async function apiGetQuote(symbols) {
        if (!symbols || symbols.length === 0) return [];
        var url = API_BASE + '/api/finance/quote?symbols=' +
                  encodeURIComponent(symbols.join(','));
        var resp = await fetch(url);
        if (!resp.ok) throw new Error('quote HTTP ' + resp.status);
        var data = await resp.json();
        return (data && data.quotes) || [];
    }
    async function apiGetChart(symbol, range, interval) {
        var url = API_BASE + '/api/finance/chart?symbol=' +
                  encodeURIComponent(symbol) +
                  '&range=' + encodeURIComponent(range) +
                  '&interval=' + encodeURIComponent(interval);
        var resp = await fetch(url);
        if (!resp.ok) throw new Error('chart HTTP ' + resp.status);
        return resp.json();
    }
    async function apiGetFeed(feedUrl) {
        var url = API_BASE + '/api/news/feed?url=' +
                  encodeURIComponent(feedUrl);
        var resp = await fetch(url);
        if (!resp.ok) throw new Error('feed HTTP ' + resp.status);
        return resp.json();
    }
    // Layer 1 (Chat 14): verify a symbol exists before committing.
    // Single-symbol /quote call — if Yahoo returns a matching quote,
    // the symbol is real. If it 400s, returns empty, or returns a
    // different symbol, treat as bogus. Swallow errors and return
    // false so the caller doesn't crash on network blips.
    async function apiVerifySymbol(sym) {
        try {
            var quotes = await apiGetQuote([sym]);
            if (!Array.isArray(quotes) || quotes.length === 0) return false;
            return quotes.some(function (q) {
                return q && q.symbol && q.symbol.toUpperCase() === sym.toUpperCase();
            });
        } catch (e) {
            return false;
        }
    }

    // ============================================================
    // WATCHLIST (Q5 option B)
    // ============================================================
    function loadWatchlist() {
        try {
            var raw = localStorage.getItem(WATCHLIST_KEY);
            if (!raw) { watchlist = DEFAULT_WATCHLIST.slice(); return; }
            var arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                watchlist = arr.filter(isValidSymbol).slice(0, WATCHLIST_MAX);
                if (watchlist.length === 0) watchlist = DEFAULT_WATCHLIST.slice();
            } else {
                watchlist = DEFAULT_WATCHLIST.slice();
            }
        } catch (e) {
            watchlist = DEFAULT_WATCHLIST.slice();
        }
    }
    function saveWatchlist() {
        try {
            localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
        } catch (e) {
            console.warn('[Markets] save watchlist failed:', e);
        }
    }
    // Pure validation — format / dedupe / capacity. No mutation.
    // Used by doAdd (Layer 1) and by addSymbol below.
    function validateSymbol(sym) {
        sym = String(sym || '').trim().toUpperCase();
        if (!isValidSymbol(sym)) {
            return { ok: false, msg: 'Invalid — use 1–5 uppercase letters' };
        }
        if (watchlist.indexOf(sym) !== -1) {
            return { ok: false, msg: sym + ' already in watchlist' };
        }
        if (watchlist.length >= WATCHLIST_MAX) {
            return { ok: false, msg: 'Watchlist full (max ' + WATCHLIST_MAX + ')' };
        }
        return { ok: true, symbol: sym };
    }
    // Commit a pre-validated symbol to the watchlist + persist.
    function commitSymbol(sym) {
        watchlist.push(sym);
        saveWatchlist();
    }
    // Atomic validate + commit (no API check). Retained for backward
    // compatibility. Prefer validateSymbol + apiVerifySymbol + commitSymbol
    // pipeline in doAdd (Layer 1) which rejects bogus tickers up front.
    function addSymbol(sym) {
        var r = validateSymbol(sym);
        if (r.ok) commitSymbol(r.symbol);
        return r;
    }
    function removeSymbol(sym) {
        var idx = watchlist.indexOf(sym);
        if (idx === -1) return;
        watchlist.splice(idx, 1);
        saveWatchlist();
    }
    function resetWatchlist() {
        watchlist = DEFAULT_WATCHLIST.slice();
        saveWatchlist();
    }

    // ============================================================
    // TABS (Q1: horizontal top tabs, Q2: last-selected in localStorage)
    // ============================================================
    function initTabs() {
        var buttons = pageRoot.querySelectorAll('[data-markets-tab]');
        buttons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                switchTab(btn.getAttribute('data-markets-tab'));
            });
            btn.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    switchTab(btn.getAttribute('data-markets-tab'));
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    var all = Array.from(buttons);
                    var idx = all.indexOf(btn);
                    var next = e.key === 'ArrowRight'
                        ? (idx + 1) % all.length
                        : (idx - 1 + all.length) % all.length;
                    all[next].focus();
                    switchTab(all[next].getAttribute('data-markets-tab'));
                }
            });
        });

        // Restore last-selected (Q2 option C)
        var saved = 'stocks';
        try { saved = localStorage.getItem(TAB_KEY) || 'stocks'; } catch (e) {}
        if (saved !== 'stocks' && saved !== 'news') saved = 'stocks';
        switchTab(saved, true);
    }
    function switchTab(name, isInit) {
        if (name !== 'stocks' && name !== 'news') name = 'stocks';
        currentTab = name;

        pageRoot.querySelectorAll('[data-markets-tab]').forEach(function (btn) {
            var on = btn.getAttribute('data-markets-tab') === name;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.setAttribute('tabindex', on ? '0' : '-1');
        });
        pageRoot.querySelectorAll('[data-markets-panel]').forEach(function (panel) {
            panel.hidden = panel.getAttribute('data-markets-panel') !== name;
        });

        try { localStorage.setItem(TAB_KEY, name); } catch (e) {}

        if (name === 'stocks') {
            stopNewsPoll();
            startStocksPoll();
            fetchStocks();
        } else {
            stopStocksPoll();
            startNewsPoll();
            if (isInit || newsArticles.length === 0) fetchNews();
        }
    }

    // ============================================================
    // STOCKS TAB — fetch & render
    // ============================================================
    // Layer 2 self-healing (Chat 14): Yahoo's batch /quote endpoint
    // returns 400 if ANY symbol in the list is bogus — one rotten
    // apple poisons the whole batch, wiping every row to dashes.
    // On batch failure, fall back to per-symbol requests via
    // Promise.allSettled, collect the good quotes, auto-remove the
    // bad symbols from localStorage, and notify the user once.
    async function fetchWatchlistResilient() {
        if (!watchlist || watchlist.length === 0) return [];
        try {
            return await apiGetQuote(watchlist);
        } catch (batchErr) {
            console.warn('[Markets] batch watchlist failed — trying per-symbol:', batchErr);
            var snapshot = watchlist.slice();
            var results = await Promise.allSettled(snapshot.map(function (sym) {
                return apiGetQuote([sym]).then(function (arr) {
                    if (!Array.isArray(arr) || arr.length === 0) {
                        throw new Error('empty response for ' + sym);
                    }
                    return arr[0];
                });
            }));
            var goodQuotes = [];
            var badSymbols = [];
            results.forEach(function (r, i) {
                if (r.status === 'fulfilled') goodQuotes.push(r.value);
                else badSymbols.push(snapshot[i]);
            });
            if (badSymbols.length > 0) {
                badSymbols.forEach(function (sym) { removeSymbol(sym); });
                notifyBadSymbolsRemoved(badSymbols);
                console.warn('[Markets] auto-removed invalid symbols:', badSymbols);
            }
            return goodQuotes;
        }
    }

    function notifyBadSymbolsRemoved(symbols) {
        var statusEl = $('add-status');
        if (!statusEl) return;
        var msg = 'Removed invalid symbol' +
                  (symbols.length > 1 ? 's' : '') + ': ' + symbols.join(', ');
        statusEl.textContent = msg;
        statusEl.className = 'watchlist-status is-error';
        setTimeout(function () {
            if (statusEl.textContent === msg) {
                statusEl.textContent = '';
                statusEl.className = 'watchlist-status';
            }
        }, 4500);
    }

    async function fetchStocks() {
        if (isFetchingStocks) return;
        isFetchingStocks = true;
        try {
            var results = await Promise.all([
                apiGetQuote(INDICES.map(function (i) { return i.symbol; })).catch(function (e) {
                    console.warn('[Markets] indices fetch failed:', e);
                    return [];
                }),
                fetchWatchlistResilient().catch(function (e) {
                    console.warn('[Markets] resilient watchlist failed:', e);
                    return [];
                })
            ]);
            renderIndices(results[0]);
            renderWatchlistTable(results[1]);
            setLastUpdated();
            clearConnectionError();
        } catch (e) {
            console.error('[Markets] fetchStocks error:', e);
            showConnectionError();
        } finally {
            isFetchingStocks = false;
        }
    }

    function renderIndices(quotes) {
        var map = new Map();
        (quotes || []).forEach(function (q) { map.set(q.symbol, q); });
        INDICES.forEach(function (idx) {
            var card = pageRoot.querySelector(
                '[data-markets-index="' + cssEscape(idx.symbol) + '"]'
            );
            if (!card) return;
            var q = map.get(idx.symbol);
            var valueEl  = card.querySelector('[data-markets-index-value]');
            var changeEl = card.querySelector('[data-markets-index-change]');
            if (!q) {
                if (valueEl)  valueEl.textContent  = '--';
                if (changeEl) changeEl.textContent = '--';
                card.classList.remove('is-up', 'is-down');
                return;
            }
            lastIndexData.set(idx.symbol, q);
            if (valueEl)  valueEl.textContent  = formatNumber(q.price, 2);
            if (changeEl) changeEl.textContent =
                changeArrow(q.change) + ' ' +
                formatChange(q.change) + ' (' +
                formatPercent(q.changePercent) + ')';
            card.classList.remove('is-up', 'is-down');
            if (q.change > 0) card.classList.add('is-up');
            else if (q.change < 0) card.classList.add('is-down');
        });
    }

    function renderWatchlistTable(quotes) {
        var tbody = $('stocks-tbody');
        if (!tbody) return;
        var map = new Map();
        (quotes || []).forEach(function (q) { map.set(q.symbol, q); });

        if (watchlist.length === 0) {
            tbody.innerHTML =
                '<tr class="stocks-empty-row">' +
                  '<td colspan="9" class="stocks-empty">' +
                    'No symbols in watchlist. Add one above or reset to defaults.' +
                  '</td>' +
                '</tr>';
            updateWatchlistCount();
            return;
        }

        var rows = watchlist.map(function (sym) {
            var q = map.get(sym);
            var removeBtn =
                '<button type="button" class="stocks-remove-btn" ' +
                  'data-markets-remove="' + esc(sym) + '" ' +
                  'aria-label="Remove ' + esc(sym) + '">×</button>';
            if (!q) {
                return '<tr class="stocks-row" data-markets-row-symbol="' + esc(sym) + '">' +
                    '<td class="stocks-cell-sym"><strong>' + esc(sym) + '</strong></td>' +
                    '<td class="stocks-cell-name stocks-cell-dim">—</td>' +
                    '<td>--</td><td>--</td><td>--</td><td>--</td><td>--</td><td>--</td>' +
                    '<td class="stocks-cell-remove">' + removeBtn + '</td>' +
                '</tr>';
            }
            lastStockData.set(sym, q);
            var cls = changeClass(q.change);
            return '<tr class="stocks-row ' + cls + '" data-markets-row-symbol="' + esc(sym) + '">' +
                '<td class="stocks-cell-sym"><strong>' + esc(q.symbol) + '</strong></td>' +
                '<td class="stocks-cell-name">' + esc(q.shortName || '') + '</td>' +
                '<td class="stocks-cell-price">' + formatCurrency(q.price) + '</td>' +
                '<td class="stocks-cell-change ' + cls + '">' +
                    changeArrow(q.change) + ' ' + formatChange(q.change) +
                '</td>' +
                '<td class="stocks-cell-pct ' + cls + '">' + formatPercent(q.changePercent) + '</td>' +
                '<td>' + formatCompact(q.volume) + '</td>' +
                '<td>' + formatCurrency(q.high) + '</td>' +
                '<td>' + formatCurrency(q.low) + '</td>' +
                '<td class="stocks-cell-remove">' + removeBtn + '</td>' +
            '</tr>';
        });
        tbody.innerHTML = rows.join('');
        updateWatchlistCount();
    }

    function updateWatchlistCount() {
        var el = $('watchlist-count');
        if (el) el.textContent = watchlist.length + ' / ' + WATCHLIST_MAX;
    }

    // ============================================================
    // WATCHLIST CONTROLS
    // ============================================================
    function initWatchlistControls() {
        var addInput = $('add-input');
        var addBtn   = $('add-btn');
        var resetBtn = $('reset-btn');
        var statusEl = $('add-status');
        var tbody    = $('stocks-tbody');

        var flash = function (msg, cls) {
            if (!statusEl) return;
            statusEl.textContent = msg;
            statusEl.className = 'watchlist-status ' + (cls || '');
            setTimeout(function () {
                if (statusEl.textContent === msg) {
                    statusEl.textContent = '';
                    statusEl.className = 'watchlist-status';
                }
            }, 2500);
        };

        var shake = function () {
            if (!addInput || !addInput.classList) return;
            addInput.classList.add('is-shake');
            setTimeout(function () { addInput.classList.remove('is-shake'); }, 450);
        };

        // Layer 1 (Chat 14): pre-validate with Yahoo before committing.
        // Prevents bogus symbols from poisoning the next batch /quote
        // call (which 400s if ANY symbol is invalid, wiping every row).
        // isAdding guards against double-submit while verify is in-flight.
        var isAdding = false;
        var doAdd = async function () {
            if (isAdding) return;
            if (!addInput) return;
            var v = addInput.value.trim().toUpperCase();
            if (!v) return;

            // Client-side: format / dedupe / capacity
            var v1 = validateSymbol(v);
            if (!v1.ok) { flash(v1.msg, 'is-error'); shake(); return; }

            // Server-side: does Yahoo actually know this symbol?
            isAdding = true;
            flash('Checking ' + v + '…', '');
            if (addBtn) addBtn.disabled = true;
            try {
                var valid = await apiVerifySymbol(v);
                if (!valid) {
                    flash('Symbol not found: ' + v, 'is-error');
                    shake();
                    return;
                }
                commitSymbol(v);
                addInput.value = '';
                flash('Added ' + v, 'is-ok');
                fetchStocks();
            } catch (e) {
                console.warn('[Markets] verify ' + v + ' failed:', e);
                flash('Could not verify ' + v + ' (check connection)', 'is-error');
                shake();
            } finally {
                isAdding = false;
                if (addBtn) addBtn.disabled = false;
            }
        };

        if (addBtn)   addBtn.addEventListener('click', doAdd);
        if (addInput) {
            addInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
            });
            addInput.addEventListener('input', function () {
                var v = addInput.value;
                var up = v.toUpperCase();
                if (v !== up) addInput.value = up;
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                if (!confirm('Reset watchlist to the 20 default symbols?')) return;
                resetWatchlist();
                fetchStocks();
                flash('Watchlist reset to defaults', 'is-ok');
            });
        }

        // Delegated: remove button + row click (open chart)
        if (tbody) {
            tbody.addEventListener('click', function (e) {
                var rem = e.target.closest('[data-markets-remove]');
                if (rem) {
                    e.stopPropagation();
                    var sym = rem.getAttribute('data-markets-remove');
                    removeSymbol(sym);
                    fetchStocks();
                    // If featured chart was showing this symbol, close it
                    if (currentFeaturedSymbol === sym) closeFeaturedChart();
                    return;
                }
                var row = e.target.closest('[data-markets-row-symbol]');
                if (row) {
                    var rsym = row.getAttribute('data-markets-row-symbol');
                    var q = lastStockData.get(rsym);
                    var name = q ? (q.shortName || rsym) : rsym;
                    loadFeaturedChart(rsym, name, currentFeaturedRange || '1D');
                }
            });
        }
    }

    // ============================================================
    // FEATURED CHART (Q4: Chart.js)
    // ============================================================
    async function loadFeaturedChart(symbol, name, rangeLabel) {
        var panel = $('featured');
        if (!panel) return;
        panel.hidden = false;

        var def = CHART_RANGES.find(function (r) { return r.label === rangeLabel; }) || CHART_RANGES[0];
        currentFeaturedSymbol = symbol;
        currentFeaturedName   = name;
        currentFeaturedRange  = def.label;

        var symEl  = $('featured-symbol');
        var nameEl = $('featured-name');
        if (symEl)  symEl.textContent  = symbol;
        if (nameEl) nameEl.textContent = name;

        pageRoot.querySelectorAll('[data-markets-range]').forEach(function (b) {
            b.classList.toggle('is-active', b.getAttribute('data-markets-range') === def.label);
        });

        var errEl = $('featured-chart-err');
        if (errEl) errEl.hidden = true;

        setFeaturedLoading(true);
        try {
            var data = await apiGetChart(symbol, def.range, def.interval);
            renderFeaturedChart(data);
        } catch (e) {
            console.warn('[Markets] featured chart failed:', e);
            if (errEl) {
                errEl.textContent = 'Chart data unavailable for ' + symbol + ' (' + def.label + ')';
                errEl.hidden = false;
            }
            if (featuredChart) { featuredChart.destroy(); featuredChart = null; }
        } finally {
            setFeaturedLoading(false);
        }

        // Scroll chart into view gently
        if (typeof panel.scrollIntoView === 'function') {
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function setFeaturedLoading(isLoading) {
        var el = $('featured-loading');
        if (el) el.hidden = !isLoading;
    }

    function renderFeaturedChart(payload) {
        var canvas = $('featured-canvas');
        if (!canvas || typeof Chart === 'undefined') {
            console.warn('[Markets] Chart.js not loaded');
            return;
        }
        var result     = (payload && payload.chart) || payload || {};
        var meta       = result.meta || {};
        var timestamps = result.timestamp || [];
        var quoteArr   = (result.indicators && result.indicators.quote) || [];
        var quote      = quoteArr[0] || {};
        var closes     = (quote.close || []).map(function (v) { return v == null ? null : v; });

        // Build labels
        var isIntra = isIntradayRange(currentFeaturedRange);
        var labels = timestamps.map(function (ts) {
            var d = new Date(ts * 1000);
            if (isIntra) {
                return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            }
            return d.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric',
                year: (currentFeaturedRange === '5Y' ? 'numeric' : '2-digit')
            });
        });

        // Price header (use meta + chartPreviousClose for up-to-date comparison)
        var livePrice = (meta.regularMarketPrice != null) ? meta.regularMarketPrice
                       : (closes.length ? closes[closes.length - 1] : null);
        var prevClose = (meta.chartPreviousClose != null) ? meta.chartPreviousClose
                       : (meta.previousClose != null ? meta.previousClose : null);
        var chg = (livePrice != null && prevClose != null) ? (livePrice - prevClose) : null;
        var pct = (chg != null && prevClose) ? (chg / prevClose) * 100 : null;

        var priceEl  = $('featured-price');
        var changeEl = $('featured-change');
        var nameEl   = $('featured-name');
        if (priceEl)  priceEl.textContent  = formatCurrency(livePrice);
        if (changeEl) {
            changeEl.textContent =
                changeArrow(chg) + ' ' + formatChange(chg) + ' (' + formatPercent(pct) + ')';
            changeEl.className = 'featured-change ' + changeClass(chg);
        }
        if (nameEl && meta.longName) nameEl.textContent = meta.longName;

        // Color by change direction
        var up = (chg == null) ? true : chg >= 0;
        var cs = getComputedStyle(pageRoot);
        var green = (cs.getPropertyValue('--chart-success') || '#10b981').trim();
        var red   = (cs.getPropertyValue('--chart-danger')  || '#ef4444').trim();
        var ember = (cs.getPropertyValue('--ember')         || '#ff6b35').trim();
        var lineColor = up ? green : red;
        var fillColor = up ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';

        if (featuredChart) { featuredChart.destroy(); featuredChart = null; }
        featuredChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    data: closes,
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    fill: true,
                    tension: 0.25,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: lineColor,
                    pointHoverBorderColor: '#0a0a0a',
                    spanGaps: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 500 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(18, 18, 18, 0.96)',
                        titleColor: '#f4f4f5',
                        bodyColor: '#f4f4f5',
                        borderColor: lineColor,
                        borderWidth: 1,
                        padding: 10,
                        titleFont: { family: 'JetBrains Mono, monospace', size: 11 },
                        bodyFont:  { family: 'Inter, sans-serif', size: 12 },
                        callbacks: {
                            label: function (ctx) { return formatCurrency(ctx.raw); }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.35)',
                            font: { family: 'JetBrains Mono, monospace', size: 10 },
                            maxTicksLimit: 8,
                            autoSkip: true,
                            maxRotation: 0
                        }
                    },
                    y: {
                        position: 'right',
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.35)',
                            font: { family: 'JetBrains Mono, monospace', size: 10 },
                            callback: function (v) { return formatCurrency(v, 2); }
                        }
                    }
                },
                interaction: { mode: 'index', intersect: false }
            }
        });

        var errEl = $('featured-chart-err');
        if (errEl) errEl.hidden = true;
    }

    function closeFeaturedChart() {
        var panel = $('featured');
        if (panel) panel.hidden = true;
        if (featuredChart) { featuredChart.destroy(); featuredChart = null; }
        currentFeaturedSymbol = null;
        currentFeaturedName = null;
    }

    function initFeaturedControls() {
        pageRoot.querySelectorAll('[data-markets-range]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (!currentFeaturedSymbol) return;
                var lbl = btn.getAttribute('data-markets-range');
                loadFeaturedChart(
                    currentFeaturedSymbol,
                    currentFeaturedName || currentFeaturedSymbol,
                    lbl
                );
            });
        });
        var closeBtn = $('featured-close');
        if (closeBtn) closeBtn.addEventListener('click', closeFeaturedChart);
    }

    // ============================================================
    // STOCKS POLL
    // ============================================================
    function startStocksPoll() {
        stopStocksPoll();
        stocksPollTimer = setInterval(function () {
            if (currentTab === 'stocks') fetchStocks();
        }, POLL_INTERVAL_MS);
    }
    function stopStocksPoll() {
        if (stocksPollTimer) { clearInterval(stocksPollTimer); stocksPollTimer = null; }
    }

    // ============================================================
    // NEWS TAB
    // ============================================================
    async function fetchNews() {
        if (isFetchingNews) return;
        isFetchingNews = true;
        var feedEl = $('news-feed');
        if (feedEl && newsArticles.length === 0) {
            feedEl.innerHTML = '<div class="news-loading">Loading articles…</div>';
        }

        try {
            var results = await Promise.allSettled(
                NEWS_SOURCES.map(function (src) {
                    return apiGetFeed(src.url).then(function (d) {
                        return { src: src, data: d };
                    });
                })
            );

            var articles = [];
            deadNewsSources = new Set();
            results.forEach(function (r, i) {
                var src = NEWS_SOURCES[i];
                if (r.status !== 'fulfilled') { deadNewsSources.add(src.id); return; }
                var d = r.value.data;
                if (!d || !Array.isArray(d.items)) { deadNewsSources.add(src.id); return; }
                d.items.forEach(function (it) {
                    articles.push({
                        title:       it.title,
                        link:        it.link,
                        description: it.description || '',
                        pubDate:     it.pubDate,
                        source:      src
                    });
                });
            });

            // Dedupe by link (same article can show in multiple Yahoo feeds)
            var seen = new Set();
            articles = articles.filter(function (a) {
                if (!a.link || seen.has(a.link)) return false;
                seen.add(a.link);
                return true;
            });

            articles.sort(function (a, b) {
                var ta = new Date(a.pubDate).getTime() || 0;
                var tb = new Date(b.pubDate).getTime() || 0;
                return tb - ta;
            });

            newsArticles = articles;
            renderNewsChips();
            renderNewsFeed();
            clearConnectionError();
        } catch (e) {
            console.error('[Markets] fetchNews error:', e);
            if (feedEl) {
                feedEl.innerHTML = '<div class="news-empty">Unable to load news right now.</div>';
            }
        } finally {
            isFetchingNews = false;
        }
    }

    function renderNewsFeed() {
        var feedEl = $('news-feed');
        if (!feedEl) return;
        var filtered = newsFilter === 'all'
            ? newsArticles
            : newsArticles.filter(function (a) { return a.source.id === newsFilter; });

        if (filtered.length === 0) {
            feedEl.innerHTML = '<div class="news-empty">No articles available for this filter.</div>';
            return;
        }

        feedEl.innerHTML = filtered.slice(0, 60).map(function (a) {
            var desc = (a.description || '').replace(/<[^>]+>/g, '').trim();
            if (desc.length > 240) desc = desc.slice(0, 240) + '…';
            return (
                '<article class="news-card">' +
                    '<div class="news-card-meta">' +
                        '<span class="news-source-tag">' + esc(a.source.name) + '</span>' +
                        '<span class="news-time">' + esc(timeAgo(a.pubDate)) + '</span>' +
                    '</div>' +
                    '<h3 class="news-card-title">' +
                        '<a href="' + esc(a.link) + '" target="_blank" rel="noopener noreferrer">' +
                            esc(a.title) +
                        '</a>' +
                    '</h3>' +
                    (desc ? '<p class="news-card-desc">' + esc(desc) + '</p>' : '') +
                '</article>'
            );
        }).join('');
    }

    function renderNewsChips() {
        var el = $('news-chips');
        if (!el) return;
        var sources = [{ id: 'all', name: 'All' }].concat(
            NEWS_SOURCES.filter(function (s) { return !deadNewsSources.has(s.id); })
        );
        el.innerHTML = sources.map(function (s) {
            var active = s.id === newsFilter ? 'is-active' : '';
            return '<button type="button" class="news-chip ' + active + '" ' +
                   'data-markets-news-filter="' + esc(s.id) + '">' + esc(s.name) + '</button>';
        }).join('');
    }

    function initNewsControls() {
        var chipsEl = $('news-chips');
        if (chipsEl) {
            chipsEl.addEventListener('click', function (e) {
                var chip = e.target.closest('[data-markets-news-filter]');
                if (!chip) return;
                newsFilter = chip.getAttribute('data-markets-news-filter');
                chipsEl.querySelectorAll('[data-markets-news-filter]').forEach(function (b) {
                    b.classList.toggle(
                        'is-active',
                        b.getAttribute('data-markets-news-filter') === newsFilter
                    );
                });
                renderNewsFeed();
            });
        }
        var refreshBtn = $('news-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', function () { fetchNews(); });
    }

    function startNewsPoll() {
        stopNewsPoll();
        newsPollTimer = setInterval(function () {
            if (currentTab === 'news') fetchNews();
        }, NEWS_POLL_INTERVAL_MS);
    }
    function stopNewsPoll() {
        if (newsPollTimer) { clearInterval(newsPollTimer); newsPollTimer = null; }
    }

    // ============================================================
    // CONNECTION ERROR BANNER
    // ============================================================
    function showConnectionError() {
        var el = $('conn-error');
        if (el) el.hidden = false;
    }
    function clearConnectionError() {
        var el = $('conn-error');
        if (el) el.hidden = true;
    }

    // ============================================================
    // HEADER / MISC
    // ============================================================
    function setLastUpdated() {
        var el = $('last-updated');
        if (!el) return;
        var now = new Date();
        el.textContent = now.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', second: '2-digit'
        });
    }

    function initRefreshButton() {
        var btn = $('refresh-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            btn.classList.add('is-spinning');
            setTimeout(function () { btn.classList.remove('is-spinning'); }, 800);
            if (currentTab === 'stocks') fetchStocks();
            else fetchNews();
        });
    }

    // ============================================================
    // CSS.escape polyfill for symbols with special chars (^GSPC)
    // ============================================================
    function cssEscape(s) {
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
        // Minimal fallback — escape ^ and other punctuation
        return String(s).replace(/([!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~])/g, '\\$1');
    }

    // ============================================================
    // INIT
    // ============================================================
    function init() {
        pageRoot = document.querySelector('.markets-page');
        if (!pageRoot) {
            console.error('[Markets] .markets-page root not found');
            return;
        }

        loadWatchlist();

        initTabs();
        initWatchlistControls();
        initFeaturedControls();
        initNewsControls();
        initRefreshButton();

        var intervalEl = $('refresh-interval');
        if (intervalEl) intervalEl.textContent = (POLL_INTERVAL_MS / 1000) + 's';

        updateWatchlistCount();

        console.info('[Markets] Dashboard ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
