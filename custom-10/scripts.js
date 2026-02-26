// ============================================================
// MARKET PULSE & BUDGET ANALYZER — scripts.js
// Jonathan Castro Portfolio | Custom 10
// ============================================================

// ============================================================
// SECTION 1: CONFIG & UTILITIES
// ============================================================

const YAHOO_PROXY = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const NEWS_PROXY = 'https://api.jonathan-castro.com/api/market-news';

const INDICES = [
    { symbol: '^GSPC', name: 'S&P 500', short: 'SPX' },
    { symbol: '^DJI', name: 'Dow Jones', short: 'DOW' },
    { symbol: '^IXIC', name: 'NASDAQ', short: 'NDX' },
    { symbol: '^RUT', name: 'Russell 2000', short: 'RUT' }
];

const ACTIVE_STOCKS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'NFLX', 'JPM', 'V', 'WMT', 'DIS', 'PYPL', 'INTC', 'BA', 'CRM', 'UBER', 'COIN', 'PLTR'];

const TOP_CRYPTO = ['bitcoin', 'ethereum', 'tether', 'binancecoin', 'solana', 'ripple', 'dogecoin', 'cardano', 'avalanche-2', 'polkadot', 'chainlink', 'litecoin', 'uniswap', 'stellar', 'monero'];

let featuredChart = null;
let cryptoChart = null;
let spendingChart = null;
let trendChart = null;
let budgetData = null;
let uploadedFiles = [];

// Configure pdf.js worker to use CDN (avoids CSP blob: violation)
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Utility functions
function formatCurrency(n, decimals = 2) {
    if (n == null || isNaN(n)) return '--';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCompact(n) {
    if (n == null || isNaN(n)) return '--';
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
    return '$' + n.toFixed(2);
}

function formatPercent(n) {
    if (n == null || isNaN(n)) return '--';
    const sign = n >= 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
}

function changeClass(n) {
    if (n == null || isNaN(n)) return '';
    return n >= 0 ? 'positive' : 'negative';
}

function changeArrow(n) {
    if (n == null || isNaN(n)) return '';
    return n >= 0 ? '▲' : '▼';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


// ============================================================
// SECTION 2: BACKGROUND CANVAS (Animated grid + particles)
// ============================================================

function initBackground() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, particles = [];

    function resize() {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight * 3;
    }
    resize();
    window.addEventListener('resize', resize);

    // Create floating particles
    for (let i = 0; i < 50; i++) {
        particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            r: Math.random() * 2 + 0.5,
            o: Math.random() * 0.3 + 0.05
        });
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        // Grid
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.03)';
        ctx.lineWidth = 0.5;
        const gridSize = 60;
        for (let x = 0; x < w; x += gridSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += gridSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        // Particles
        particles.forEach(p => {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > w) p.vx *= -1;
            if (p.y < 0 || p.y > h) p.vy *= -1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 255, 136, ${p.o})`;
            ctx.fill();
        });
        requestAnimationFrame(draw);
    }
    draw();
}


// ============================================================
// SECTION 3: TICKER STRIP & TAB NAVIGATION
// ============================================================

async function initTicker() {
    const content = document.getElementById('tickerContent');
    if (!content) return;
    try {
        const symbols = ['^GSPC', '^DJI', '^IXIC', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'BTC-USD', 'ETH-USD'];
        const data = await fetchStockQuote(symbols);
        let html = '';
        data.forEach(s => {
            const cls = changeClass(s.changePercent);
            html += `<div class="ticker-item ${cls}">
                <span class="ticker-symbol">${s.symbol.replace('-USD','')}</span>
                <span class="ticker-price">${formatCurrency(s.price, s.price < 10 ? 4 : 2)}</span>
                <span class="ticker-change">${changeArrow(s.changePercent)} ${formatPercent(s.changePercent)}</span>
            </div>`;
        });
        // Duplicate for seamless scroll
        content.innerHTML = html + html;
    } catch (e) {
        console.warn('Ticker load failed:', e);
        content.innerHTML = '<div class="ticker-item">Market data loading...</div>';
    }
}

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const target = document.getElementById('tab-' + tab);
            if (target) target.classList.add('active');
        });
    });
}


// ============================================================
// SECTION 4: STOCK DATA (Yahoo Finance via CORS proxy)
// ============================================================

async function fetchStockQuote(symbols) {
    const results = [];
    // Use allorigins as CORS proxy for Yahoo Finance
    for (const sym of symbols) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const resp = await fetch(proxyUrl);
            if (!resp.ok) continue;
            const data = await resp.json();
            const meta = data.chart.result[0].meta;
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const change = price - prevClose;
            const changePct = (change / prevClose) * 100;
            results.push({
                symbol: sym,
                name: meta.shortName || meta.symbol || sym,
                price: price,
                change: change,
                changePercent: changePct,
                volume: meta.regularMarketVolume || 0,
                marketCap: 0,
                high: meta.regularMarketDayHigh || price,
                low: meta.regularMarketDayLow || price
            });
        } catch (e) {
            console.warn(`Failed to fetch ${sym}:`, e);
        }
    }
    return results;
}

async function loadIndices() {
    const grid = document.getElementById('indicesGrid');
    if (!grid) return;
    grid.innerHTML = INDICES.map(() => '<div class="index-card loading"><div class="skeleton-text"></div></div>').join('');

    const symbols = INDICES.map(i => i.symbol);
    const data = await fetchStockQuote(symbols);

    grid.innerHTML = '';
    INDICES.forEach((idx, i) => {
        const d = data.find(r => r.symbol === idx.symbol) || {};
        const cls = changeClass(d.changePercent);
        grid.innerHTML += `
            <div class="index-card ${cls}" onclick="loadFeaturedChart('${idx.symbol}', '${idx.name}', '1D')">
                <div class="index-name">${idx.short}</div>
                <div class="index-price">${formatCurrency(d.price, 2)}</div>
                <div class="index-change ${cls}">${changeArrow(d.changePercent)} ${formatPercent(d.changePercent)}</div>
            </div>`;
    });
}

async function loadActiveStocks() {
    const body = document.getElementById('activeStocksBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="loading-cell">Loading market data...</td></tr>';

    const data = await fetchStockQuote(ACTIVE_STOCKS);
    if (data.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="loading-cell">Market data unavailable — markets may be closed</td></tr>';
        return;
    }

    // Sort by absolute change percent (most active first)
    data.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

    // Populate gainers & losers
    const gainers = [...data].filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
    const losers = [...data].filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
    renderMiniTable('gainersTable', gainers);
    renderMiniTable('losersTable', losers);

    body.innerHTML = '';
    data.forEach(s => {
        const cls = changeClass(s.changePercent);
        body.innerHTML += `
            <tr class="stock-row" onclick="loadFeaturedChart('${s.symbol}', '${s.name}', '1D')">
                <td><strong>${s.symbol}</strong></td>
                <td class="hide-mobile">${s.name}</td>
                <td>${formatCurrency(s.price)}</td>
                <td class="${cls}">${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}</td>
                <td class="${cls}">${formatPercent(s.changePercent)}</td>
                <td>${s.volume ? (s.volume / 1e6).toFixed(1) + 'M' : '--'}</td>
                <td class="hide-mobile">${s.marketCap ? formatCompact(s.marketCap) : '--'}</td>
            </tr>`;
    });
}

function renderMiniTable(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    items.forEach(s => {
        const cls = changeClass(s.changePercent);
        container.innerHTML += `
            <div class="mini-row ${cls}" onclick="loadFeaturedChart('${s.symbol}', '${s.name}', '1D')">
                <span class="mini-symbol">${s.symbol}</span>
                <span class="mini-price">${formatCurrency(s.price)}</span>
                <span class="mini-change ${cls}">${formatPercent(s.changePercent)}</span>
            </div>`;
    });
}

async function loadFeaturedChart(symbol, name, range) {
    const nameEl = document.getElementById('featuredStockName');
    const symEl = document.getElementById('featuredStockSymbol');
    const priceEl = document.getElementById('featuredStockPrice');
    const changeEl = document.getElementById('featuredStockChange');

    if (nameEl) nameEl.textContent = name;
    if (symEl) symEl.textContent = symbol;

    // Map range to Yahoo Finance params
    const rangeMap = {
        '1D': { range: '1d', interval: '5m' },
        '5D': { range: '5d', interval: '15m' },
        '1M': { range: '1mo', interval: '1d' },
        '6M': { range: '6mo', interval: '1d' },
        '1Y': { range: '1y', interval: '1wk' },
        '5Y': { range: '5y', interval: '1mo' }
    };

    const params = rangeMap[range] || rangeMap['1D'];

    // Set active range button
    document.querySelectorAll('#tab-stocks .range-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === range);
    });

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${params.interval}&range=${params.range}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const resp = await fetch(proxyUrl);
        const data = await resp.json();
        const result = data.chart.result[0];
        const meta = result.meta;
        const timestamps = result.timestamp || [];
        const closes = result.indicators.quote[0].close || [];

        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        const change = price - prevClose;
        const changePct = (change / prevClose) * 100;

        if (priceEl) priceEl.textContent = formatCurrency(price);
        if (changeEl) {
            changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${formatPercent(changePct)})`;
            changeEl.className = 'chart-change ' + changeClass(changePct);
        }

        // Build chart data
        const labels = timestamps.map(t => {
            const d = new Date(t * 1000);
            if (range === '1D' || range === '5D') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            if (range === '1M' || range === '6M') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        });

        const validCloses = closes.map(c => c != null ? c : null);
        const isUp = changePct >= 0;
        const lineColor = isUp ? '#00ff88' : '#ff4444';
        const fillColor = isUp ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 68, 68, 0.1)';

        if (featuredChart) featuredChart.destroy();
        const ctx = document.getElementById('featuredChart');
        if (!ctx) return;

        featuredChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    data: validCloses,
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: lineColor,
                    spanGaps: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: {
                    backgroundColor: 'rgba(10, 14, 20, 0.95)',
                    titleColor: '#ccc',
                    bodyColor: '#fff',
                    borderColor: 'rgba(0,255,136,0.3)',
                    borderWidth: 1,
                    callbacks: { label: ctx => formatCurrency(ctx.raw) }
                }},
                scales: {
                    x: {
                        display: true,
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: { color: 'rgba(255,255,255,0.3)', font: { family: 'Share Tech Mono', size: 10 }, maxTicksLimit: 8 }
                    },
                    y: {
                        display: true,
                        position: 'right',
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.3)',
                            font: { family: 'Share Tech Mono', size: 10 },
                            callback: v => formatCurrency(v, 0)
                        }
                    }
                },
                interaction: { mode: 'index', intersect: false }
            }
        });
    } catch (e) {
        console.warn('Chart load failed:', e);
        if (priceEl) priceEl.textContent = '--';
        if (changeEl) changeEl.textContent = 'Data unavailable';
    }
}

// Stock search
function initStockSearch() {
    const input = document.getElementById('stockSearch');
    const btn = document.getElementById('stockSearchBtn');

    const doSearch = async () => {
        const query = input.value.trim().toUpperCase();
        if (!query) return;
        const data = await fetchStockQuote([query]);
        if (data.length > 0) {
            loadFeaturedChart(query, data[0].name, '1D');
            input.value = '';
        }
    };

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    // Range buttons
    document.querySelectorAll('#tab-stocks .range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const range = btn.dataset.range;
            const symbol = document.getElementById('featuredStockSymbol').textContent;
            const name = document.getElementById('featuredStockName').textContent;
            loadFeaturedChart(symbol, name, range);
        });
    });
}


// ============================================================
// SECTION 5: CRYPTO DATA (CoinGecko Free API)
// ============================================================

async function loadCryptoData() {
    try {
        // Global market data
        const globalResp = await fetch(`${COINGECKO_BASE}/global`);
        if (globalResp.ok) {
            const global = await globalResp.json();
            const g = global.data;
            document.getElementById('totalMarketCap').textContent = formatCompact(g.total_market_cap.usd);
            document.getElementById('totalVolume').textContent = formatCompact(g.total_volume.usd);
            document.getElementById('btcDominance').textContent = g.market_cap_percentage.btc.toFixed(1) + '%';
            document.getElementById('activeCryptos').textContent = g.active_cryptocurrencies.toLocaleString();
        }

        // Top 50 coins
        const resp = await fetch(`${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=1h,24h,7d`);
        if (!resp.ok) throw new Error('CoinGecko API rate limited');
        const coins = await resp.json();

        const body = document.getElementById('cryptoBody');
        if (!body) return;
        body.innerHTML = '';

        coins.forEach((coin, i) => {
            const pct1h = coin.price_change_percentage_1h_in_currency;
            const pct24h = coin.price_change_percentage_24h_in_currency;
            const pct7d = coin.price_change_percentage_7d_in_currency;

            body.innerHTML += `
                <tr class="stock-row" onclick="loadCryptoChart('${coin.id}', '${coin.name}', '1')" style="cursor:pointer">
                    <td>${i + 1}</td>
                    <td>
                        <div class="crypto-name-cell">
                            <img src="${coin.image}" alt="${coin.symbol}" class="crypto-icon" width="24" height="24" loading="lazy">
                            <span><strong>${coin.name}</strong> <span class="crypto-sym">${coin.symbol.toUpperCase()}</span></span>
                        </div>
                    </td>
                    <td>${formatCurrency(coin.current_price, coin.current_price < 1 ? 6 : 2)}</td>
                    <td class="${changeClass(pct1h)}">${formatPercent(pct1h)}</td>
                    <td class="${changeClass(pct24h)}">${formatPercent(pct24h)}</td>
                    <td class="${changeClass(pct7d)}">${formatPercent(pct7d)}</td>
                    <td>${formatCompact(coin.market_cap)}</td>
                    <td class="hide-mobile">${formatCompact(coin.total_volume)}</td>
                </tr>`;
        });

        // Load default crypto chart (Bitcoin)
        loadCryptoChart('bitcoin', 'Bitcoin', '1');

    } catch (e) {
        console.warn('Crypto data load failed:', e);
        const body = document.getElementById('cryptoBody');
        if (body) body.innerHTML = '<tr><td colspan="8" class="loading-cell">Crypto data temporarily unavailable — CoinGecko may be rate limiting</td></tr>';
    }
}

async function loadCryptoChart(coinId, coinName, days) {
    const nameEl = document.getElementById('featuredCryptoName');
    const symEl = document.getElementById('featuredCryptoSymbol');
    const priceEl = document.getElementById('featuredCryptoPrice');
    const changeEl = document.getElementById('featuredCryptoChange');

    if (nameEl) nameEl.textContent = coinName;
    if (symEl) symEl.textContent = coinId.toUpperCase();

    // Set active range button
    document.querySelectorAll('#tab-crypto .range-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === days);
    });

    try {
        const resp = await fetch(`${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`);
        if (!resp.ok) throw new Error('Chart data unavailable');
        const data = await resp.json();
        const prices = data.prices; // [[timestamp, price], ...]

        if (!prices || prices.length === 0) throw new Error('No price data');

        const currentPrice = prices[prices.length - 1][1];
        const startPrice = prices[0][1];
        const change = currentPrice - startPrice;
        const changePct = (change / startPrice) * 100;

        if (priceEl) priceEl.textContent = formatCurrency(currentPrice, currentPrice < 1 ? 6 : 2);
        if (changeEl) {
            changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${formatPercent(changePct)})`;
            changeEl.className = 'chart-change ' + changeClass(changePct);
        }

        const labels = prices.map(p => {
            const d = new Date(p[0]);
            if (days <= 1) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            if (days <= 30) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        });

        const values = prices.map(p => p[1]);
        const isUp = changePct >= 0;
        const lineColor = isUp ? '#00ff88' : '#ff4444';
        const fillColor = isUp ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 68, 68, 0.1)';

        if (cryptoChart) cryptoChart.destroy();
        const ctx = document.getElementById('cryptoChart');
        if (!ctx) return;

        cryptoChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: lineColor,
                    spanGaps: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: {
                    backgroundColor: 'rgba(10, 14, 20, 0.95)',
                    titleColor: '#ccc',
                    bodyColor: '#fff',
                    borderColor: 'rgba(0,255,136,0.3)',
                    borderWidth: 1,
                    callbacks: { label: ctx => formatCurrency(ctx.raw, ctx.raw < 1 ? 6 : 2) }
                }},
                scales: {
                    x: {
                        display: true,
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: { color: 'rgba(255,255,255,0.3)', font: { family: 'Share Tech Mono', size: 10 }, maxTicksLimit: 8 }
                    },
                    y: {
                        display: true,
                        position: 'right',
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.3)',
                            font: { family: 'Share Tech Mono', size: 10 },
                            callback: v => formatCurrency(v, 0)
                        }
                    }
                },
                interaction: { mode: 'index', intersect: false }
            }
        });
    } catch (e) {
        console.warn('Crypto chart failed:', e);
        if (priceEl) priceEl.textContent = '--';
        if (changeEl) changeEl.textContent = 'Chart unavailable';
    }
}

function initCryptoSearch() {
    const input = document.getElementById('cryptoSearch');
    const btn = document.getElementById('cryptoSearchBtn');
    if (!input || !btn) return;

    const doSearch = async () => {
        const query = input.value.trim().toLowerCase();
        if (!query) return;
        try {
            const resp = await fetch(`${COINGECKO_BASE}/search?query=${encodeURIComponent(query)}`);
            const data = await resp.json();
            if (data.coins && data.coins.length > 0) {
                const coin = data.coins[0];
                loadCryptoChart(coin.id, coin.name, '1');
                input.value = '';
            }
        } catch (e) {
            console.warn('Crypto search failed:', e);
        }
    };

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    // Range buttons for crypto
    document.querySelectorAll('#tab-crypto .range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const days = btn.dataset.range;
            const coinName = document.getElementById('featuredCryptoName').textContent;
            const coinId = document.getElementById('featuredCryptoSymbol').textContent.toLowerCase();
            // Need to reverse-lookup the coinId from name; default to bitcoin for safety
            loadCryptoChart(coinId === 'btc' ? 'bitcoin' : coinId, coinName, days);
        });
    });
}


// ============================================================
// SECTION 6: MARKET NEWS (RSS via your API proxy or fallback)
// ============================================================

async function loadMarketNews() {
    const grid = document.getElementById('newsGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading-cell" style="padding:2rem; text-align:center; color:rgba(255,255,255,0.4)">Loading market news...</div>';

    let articles = [];

    // Try your API proxy first
    try {
        const resp = await fetch(NEWS_PROXY);
        if (resp.ok) {
            const data = await resp.json();
            articles = data.articles || data;
        }
    } catch (e) {
        console.warn('News proxy failed, using fallback:', e);
    }

    // Fallback: fetch from public RSS feeds via rss2json
    if (articles.length === 0) {
        const feeds = [
            'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US',
            'https://www.investing.com/rss/news.rss',
            'https://feeds.marketwatch.com/marketwatch/topstories/'
        ];

        for (const feedUrl of feeds) {
            try {
                const resp = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&count=10`);
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.items) {
                        articles = articles.concat(data.items.map(item => ({
                            title: item.title,
                            description: item.description ? item.description.replace(/<[^>]*>/g, '').substring(0, 200) : '',
                            url: item.link,
                            source: data.feed?.title || 'Market News',
                            publishedAt: item.pubDate,
                            image: item.thumbnail || item.enclosure?.link || null
                        })));
                    }
                }
            } catch (e) {
                console.warn('RSS feed failed:', e);
            }
        }
    }

    if (articles.length === 0) {
        grid.innerHTML = '<div class="loading-cell" style="padding:2rem; text-align:center; color:rgba(255,255,255,0.4)">Market news temporarily unavailable. Try refreshing.</div>';
        return;
    }

    // Deduplicate by title
    const seen = new Set();
    articles = articles.filter(a => {
        const key = a.title?.toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 20);

    grid.innerHTML = '';
    articles.forEach(article => {
        const timeAgo = article.publishedAt ? getTimeAgo(new Date(article.publishedAt)) : '';
        grid.innerHTML += `
            <a href="${article.url}" target="_blank" rel="noopener" class="news-card">
                ${article.image ? `<div class="news-image" style="background-image:url('${article.image}')"></div>` : ''}
                <div class="news-body">
                    <div class="news-source">${article.source || 'Market News'} ${timeAgo ? '· ' + timeAgo : ''}</div>
                    <h4 class="news-title">${article.title}</h4>
                    ${article.description ? `<p class="news-desc">${article.description}</p>` : ''}
                </div>
            </a>`;
    });
}

function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return diffMins + 'm ago';
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return diffHrs + 'h ago';
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return diffDays + 'd ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


// ============================================================
// SECTION 7: BUDGET ANALYZER (PDF/CSV Parser + Analysis)
// ============================================================

// --- 7A: File Upload & Parsing ---

function initBudgetAnalyzer() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const clearBtn = document.getElementById('clearFilesBtn');
    const manualBtn = document.getElementById('manualEntryBtn');
    const closeModal = document.getElementById('closeModal');
    const addExpBtn = document.getElementById('addExpenseBtn');
    const submitManual = document.getElementById('submitManualBtn');

    if (!uploadZone) return;

    // Drag & drop
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', e => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleFiles(fileInput.files));

    // Buttons
    analyzeBtn.addEventListener('click', () => analyzeStatements());
    clearBtn.addEventListener('click', () => {
        uploadedFiles = [];
        renderUploadedFiles();
        document.getElementById('budgetResults').style.display = 'none';
    });

    // Manual entry modal
    manualBtn.addEventListener('click', () => {
        document.getElementById('manualModal').style.display = 'flex';
    });
    closeModal.addEventListener('click', () => {
        document.getElementById('manualModal').style.display = 'none';
    });
    document.getElementById('manualModal').addEventListener('click', e => {
        if (e.target === document.getElementById('manualModal')) {
            document.getElementById('manualModal').style.display = 'none';
        }
    });
    addExpBtn.addEventListener('click', () => {
        const container = document.getElementById('manualExpenses');
        const row = document.createElement('div');
        row.className = 'expense-row';
        row.innerHTML = `
            <input type="text" placeholder="Expense name" class="exp-name">
            <input type="number" placeholder="Amount" class="exp-amount" step="0.01">
            <select class="exp-type"><option value="recurring">Recurring</option><option value="discretionary">Discretionary</option></select>
            <button class="remove-exp" onclick="this.parentElement.remove()">&times;</button>`;
        container.appendChild(row);
    });
    submitManual.addEventListener('click', processManualEntry);
}

function handleFiles(fileList) {
    const maxFiles = 4;
    const allowed = ['application/pdf', 'text/csv', 'text/plain'];

    for (const file of fileList) {
        if (uploadedFiles.length >= maxFiles) {
            alert('Maximum 4 files allowed');
            break;
        }
        if (!allowed.includes(file.type) && !file.name.endsWith('.csv') && !file.name.endsWith('.pdf')) {
            alert(`Unsupported file: ${file.name}. Use PDF or CSV.`);
            continue;
        }
        uploadedFiles.push(file);
    }
    renderUploadedFiles();
}

function renderUploadedFiles() {
    const container = document.getElementById('uploadedFiles');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const clearBtn = document.getElementById('clearFilesBtn');

    container.innerHTML = '';
    uploadedFiles.forEach((file, i) => {
        container.innerHTML += `
            <div class="file-chip">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span>${file.name}</span>
                <span class="file-size">(${(file.size / 1024).toFixed(0)}KB)</span>
                <button class="file-remove" onclick="removeFile(${i})">&times;</button>
            </div>`;
    });

    analyzeBtn.disabled = uploadedFiles.length === 0;
    clearBtn.style.display = uploadedFiles.length > 0 ? 'inline-flex' : 'none';
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    renderUploadedFiles();
}

// --- 7B: Parse PDF & CSV ---

async function parseFile(file) {
    const transactions = [];

    if (file.name.endsWith('.csv') || file.type === 'text/csv' || file.type === 'text/plain') {
        // CSV parsing
        const text = await file.text();
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length < 2) return transactions;

        // Detect header row
        const header = lines[0].toLowerCase();
        let dateCol = -1, descCol = -1, amountCol = -1, debitCol = -1, creditCol = -1;

        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
        headers.forEach((h, i) => {
            if (h.includes('date') && dateCol === -1) dateCol = i;
            if ((h.includes('description') || h.includes('memo') || h.includes('payee') || h.includes('name') || h.includes('merchant')) && descCol === -1) descCol = i;
            if ((h === 'amount' || h.includes('amount')) && amountCol === -1) amountCol = i;
            if (h.includes('debit') || h.includes('withdrawal')) debitCol = i;
            if (h.includes('credit') || h.includes('deposit')) creditCol = i;
        });

        // If we can't find columns by header, try positional
        if (dateCol === -1) dateCol = 0;
        if (descCol === -1) descCol = headers.length > 2 ? 1 : 0;
        if (amountCol === -1 && debitCol === -1) amountCol = headers.length - 1;

        for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVLine(lines[i]);
            if (cols.length < 2) continue;

            const dateStr = cols[dateCol]?.replace(/"/g, '').trim();
            const desc = cols[descCol]?.replace(/"/g, '').trim();
            let amount = 0;

            if (debitCol >= 0 && creditCol >= 0) {
                const debit = parseFloat(cols[debitCol]?.replace(/[^0-9.-]/g, '')) || 0;
                const credit = parseFloat(cols[creditCol]?.replace(/[^0-9.-]/g, '')) || 0;
                amount = credit > 0 ? credit : -debit;
            } else {
                amount = parseFloat(cols[amountCol]?.replace(/[^0-9.-]/g, '')) || 0;
            }

            const date = parseDateString(dateStr);
            if (desc && !isNaN(amount) && amount !== 0) {
                transactions.push({ date, description: desc, amount });
            }
        }
    } else if (file.name.endsWith('.pdf') || file.type === 'application/pdf') {
        // PDF parsing using pdf.js
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let fullText = '';

            for (let p = 1; p <= pdf.numPages; p++) {
                const page = await pdf.getPage(p);
                const textContent = await page.getTextContent();

                // Reconstruct lines using Y-coordinates
                // Each text item has a transform[5] (Y position) — items on the same
                // visual line share roughly the same Y value
                const items = textContent.items.filter(item => item.str.trim().length > 0);
                if (items.length === 0) continue;

                // Group items by their Y-coordinate (rounded to handle minor differences)
                const lineMap = {};
                items.forEach(item => {
                    const y = Math.round(item.transform[5]);
                    const x = Math.round(item.transform[4]);
                    if (!lineMap[y]) lineMap[y] = [];
                    lineMap[y].push({ x, text: item.str });
                });

                // Sort lines by Y descending (PDF Y starts at bottom, so higher Y = higher on page)
                const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a);

                for (const y of sortedYs) {
                    // Sort items within each line by X coordinate (left to right)
                    const lineItems = lineMap[y].sort((a, b) => a.x - b.x);
                    const lineText = lineItems.map(item => item.text).join(' ').trim();
                    if (lineText.length > 0) {
                        fullText += lineText + '\n';
                    }
                }
                fullText += '\n'; // Page break
            }

            console.log('[PDF Parser] Extracted text preview (first 2000 chars):', fullText.substring(0, 2000));
            console.log('[PDF Parser] Total text length:', fullText.length);

            // Parse transactions from extracted text
            const parsed = extractTransactionsFromText(fullText);
            transactions.push(...parsed);
        } catch (e) {
            console.warn('PDF parsing failed:', e);
        }
    }

    return transactions;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
        else { current += ch; }
    }
    result.push(current.trim());
    return result;
}

function parseDateString(str) {
    if (!str) return new Date();
    // Try multiple formats
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;

    // MM/DD/YYYY or DD/MM/YYYY
    const parts = str.split(/[/-]/);
    if (parts.length === 3) {
        const [a, b, c] = parts.map(Number);
        if (c > 100) return new Date(c, a - 1, b); // MM/DD/YYYY
        if (a > 100) return new Date(a, b - 1, c); // YYYY/MM/DD
    }
    return new Date();
}

function extractTransactionsFromText(text) {
    const transactions = [];

    // -------------------------------------------------------
    // STEP 1: Detect Wells Fargo format
    // -------------------------------------------------------
    const isWellsFargo = /Wells Fargo|Transaction [Hh]istory|Statement period activity summary/i.test(text);

    if (isWellsFargo) {
        return parseWellsFargoText(text);
    }

    // -------------------------------------------------------
    // STEP 2: Generic bank statement fallback
    // -------------------------------------------------------
    const patterns = [
        /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+?)\s+(-?\$?[\d,]+\.?\d{0,2})\s*$/gm,
        /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([\d,]+\.\d{2})\s*(?:([\d,]+\.\d{2}))?\s*$/gm
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const date = parseDateString(match[1]);
            const desc = match[2].trim();
            let amount = parseFloat(match[3].replace(/[$,]/g, ''));
            if (match[3].startsWith('-') || /debit|payment|purchase|withdrawal/i.test(desc)) {
                amount = -Math.abs(amount);
            }
            if (/deposit|credit|payroll|direct dep|salary|transfer in/i.test(desc)) {
                amount = Math.abs(amount);
            }
            if (desc.length > 2 && !isNaN(amount) && amount !== 0) {
                transactions.push({ date, description: desc, amount });
            }
        }
    }

    if (transactions.length === 0) {
        const lines = text.split('\n');
        for (const line of lines) {
            const amountMatch = line.match(/(-?\$?[\d,]+\.\d{2})/);
            const dateMatch = line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]?\d{0,4})/);
            if (amountMatch && dateMatch) {
                const amount = parseFloat(amountMatch[1].replace(/[$,]/g, ''));
                const remaining = line.replace(amountMatch[0], '').replace(dateMatch[0], '').trim();
                if (remaining.length > 2 && !isNaN(amount)) {
                    transactions.push({
                        date: parseDateString(dateMatch[1]),
                        description: remaining.substring(0, 80),
                        amount: amount
                    });
                }
            }
        }
    }

    return transactions;
}


// ==============================================================
// WELLS FARGO SPECIFIC PARSER
// ==============================================================
// Wells Fargo PDF text comes out as a continuous stream where
// each transaction starts with a short date (M/D or MM/DD),
// followed by a description (possibly multi-line), then one or
// more dollar amounts on the same conceptual line. The PDF
// extraction joins everything with spaces, so we split by lines
// first, then re-assemble transaction blocks.
// ==============================================================

function parseWellsFargoText(text) {
    const transactions = [];

    // Detect the statement year from the header text
    // Look for patterns like "October 24, 2025" or "January 27, 2026"
    const yearMatch = text.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(\d{4})/i);
    const statementYear = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();

    // Detect the statement period to know which months map to which year
    // e.g. "Beginning balance on 12/24" with year 2026 means Dec = 2025, Jan = 2026
    const periodMatch = text.match(/Beginning balance on\s+(\d{1,2})\/(\d{1,2})/);
    const periodStartMonth = periodMatch ? parseInt(periodMatch[1]) : null;

    // Detect the ending date month from "Ending balance on M/DD"
    const endMatch = text.match(/Ending balance on\s+(\d{1,2})\/(\d{1,2})/);
    const periodEndMonth = endMatch ? parseInt(endMatch[1]) : null;

    // Split text into lines
    const lines = text.split('\n');
    let allText = '';
    let inTransactionSection = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Detect start of transaction section
        if (/Transaction [Hh]istory/i.test(trimmed) || /Transaction History \(continued\)/i.test(trimmed)) {
            inTransactionSection = true;
            continue;
        }

        // Detect end of transaction section
        if (inTransactionSection && /^Totals\s/i.test(trimmed)) {
            inTransactionSection = false;
            continue;
        }
        if (/The Ending Daily Balance does not reflect/i.test(trimmed)) {
            inTransactionSection = false;
            continue;
        }
        if (/Summary of Overdraft/i.test(trimmed)) {
            inTransactionSection = false;
            continue;
        }
        if (/Monthly service fee summary/i.test(trimmed)) {
            inTransactionSection = false;
            continue;
        }

        // Skip header rows and page boundary text
        if (/^\s*Date\s+(Check\s+)?Number\s+Description/i.test(trimmed)) continue;
        if (/^\s*Number\s+Description/i.test(trimmed)) continue;
        if (/Deposits\/\s*Additions/i.test(trimmed)) continue;
        if (/Withdrawals\/\s*Subtractions/i.test(trimmed)) continue;
        if (/Ending daily/i.test(trimmed)) continue;
        if (/Date\s+Number\s+Description\s+Additions\s+Subtractions\s+balance/i.test(trimmed)) continue;

        // Skip page headers/footers (e.g. "October 24, 2025 Page 3 of 8")
        if (/Page\s+\d+\s+of\s+\d+/i.test(trimmed)) continue;
        // Skip standalone month headers like "January 27, 2026"
        if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i.test(trimmed)) continue;
        // Skip "Check Deposits/ Withdrawals/ Ending daily" column header variants
        if (/^Check\s+Deposits/i.test(trimmed)) continue;

        if (inTransactionSection && trimmed.length > 0) {
            allText += trimmed + '\n';
        }
    }

    // Now parse the collected transaction text
    // Wells Fargo PDF text for each transaction looks like:
    // "9/25 Purchase authorized on 09/23 Chick-Fil-A #03322 Houston TX S305266417636713 Card 1089 22.48"
    // or across multiple lines:
    // "10/3 Final Expense Di Payroll 251003 648097637282Kfq Castro,Jonathan J 2,724.22"
    //
    // Key patterns:
    // - Transaction starts with M/D or MM/DD at the beginning of a line
    // - Dollar amounts are decimal numbers like 22.48, 2,724.22, 1,000.00
    // - Ending daily balance appears as an additional amount at end of day groups

    const txLines = allText.split('\n').filter(l => l.trim().length > 0);

    console.log('[WF Parser] Transaction section lines:', txLines.length);
    console.log('[WF Parser] First 10 lines:', txLines.slice(0, 10));

    // Group lines into transaction blocks
    // A new transaction starts when a line begins with a date pattern
    const dateStartRegex = /^(\d{1,2})\/(\d{1,2})\s+/;
    const blocks = [];
    let currentBlock = null;

    for (const line of txLines) {
        // Skip lines that are page headers/column headers that slipped through
        if (/Date\s+Number\s+Description\s+Additions\s+Subtractions\s+balance/i.test(line)) continue;
        if (/Page\s+\d+\s+of\s+\d+/i.test(line)) continue;

        const dateMatch = line.match(dateStartRegex);
        if (dateMatch) {
            if (currentBlock) blocks.push(currentBlock);
            currentBlock = { dateStr: dateMatch[0].trim(), month: parseInt(dateMatch[1]), day: parseInt(dateMatch[2]), text: line.substring(dateMatch[0].length).trim() };
        } else if (currentBlock) {
            // Continuation line — append to current block
            // But first strip any page boundary text that leaked in
            let cleanLine = line.trim()
                .replace(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\s*Page\s+\d+\s+of\s+\d+.*/i, '')
                .replace(/Page\s+\d+\s+of\s+\d+\s*Date\s+Number\s+Description.*/i, '')
                .replace(/Date\s+Number\s+Description\s+Additions\s+Subtractions\s+balance.*/i, '')
                .trim();
            if (cleanLine.length > 0) {
                currentBlock.text += ' ' + cleanLine;
            }
        }
    }
    if (currentBlock) blocks.push(currentBlock);

    // Parse each block to extract description and amounts
    for (const block of blocks) {
        const fullText = block.text;

        // Extract all dollar amounts from the line (with positions)
        // Amounts look like: 22.48, 2,724.22, 1,000.00
        const amountRegex = /(-?\d{1,3}(?:,\d{3})*\.\d{2})/g;
        const amounts = [];
        let amMatch;
        while ((amMatch = amountRegex.exec(fullText)) !== null) {
            amounts.push({ value: parseFloat(amMatch[1].replace(/,/g, '')), index: amMatch.index, raw: amMatch[1] });
        }

        if (amounts.length === 0) continue;

        // Determine if this is a deposit or withdrawal based on description keywords
        const isDeposit = isDepositTransaction(fullText);
        const isReturn = /Purchase Return|Provisional Credit|My Deals Cash Back/i.test(fullText);

        // The FIRST amount is the transaction amount (deposit or withdrawal)
        // Additional amounts are typically: ending daily balance, or secondary column amounts
        // We extract the transaction amount and then build the description by stripping ALL amounts out
        
        let transactionAmount = 0;
        if (isDeposit || isReturn) {
            transactionAmount = amounts[0].value;
        } else {
            transactionAmount = -Math.abs(amounts[0].value);
        }

        if (transactionAmount === 0) continue;

        // Build description by removing ALL dollar amounts from the text
        // This strips the transaction amount, ending balance, and any other numeric noise
        let description = fullText
            .replace(/-?\d{1,3}(?:,\d{3})*\.\d{2}/g, ' ')  // Remove all dollar amounts
            .replace(/\s+-\s+/g, ' ')                         // Remove leftover negative signs
            .replace(/\$\s*/g, '')                            // Remove dollar signs

        // Clean up description: remove Card XXXX references, long alphanumeric codes
        description = description
            .replace(/\s+S\d{15,}\s*/g, ' ')          // Wells Fargo S-codes
            .replace(/\s+P\d{15,}\s*/g, ' ')           // Wells Fargo P-codes
            .replace(/\s*Card\s+\d{4}\s*/gi, '')       // Card 1089
            .replace(/\s*\d{15,}\s*/g, ' ')             // Long numeric codes
            .replace(/\s+ATM ID\s+\w+/gi, '')           // ATM ID refs
            .replace(/\$\s*/g, '')                      // Dollar signs (from overdraft descriptions)
            .replace(/\s+/g, ' ')
            .trim();

        if (description.length < 3) continue;

        // Determine the year for this transaction
        let year = statementYear;
        // If the statement spans a year boundary (e.g., Dec 2025 to Jan 2026)
        if (periodStartMonth && periodEndMonth && periodStartMonth > periodEndMonth) {
            // Cross-year statement: months >= periodStartMonth are previous year
            if (block.month >= periodStartMonth) {
                year = statementYear - 1;
            }
        } else if (periodEndMonth) {
            // Same-year statement: use the statement end date's year logic
            // The header date (e.g., "October 24, 2025") gives us the year
            // If transaction month > header month, it's the prior year
            const headerMonthMatch = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)/i);
            if (headerMonthMatch) {
                const headerMonth = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(headerMonthMatch[1].toLowerCase()) + 1;
                if (block.month > headerMonth) {
                    year = statementYear - 1;
                }
            }
        }

        const txDate = new Date(year, block.month - 1, block.day);

        transactions.push({
            date: txDate,
            description: cleanWFDescription(description),
            amount: transactionAmount
        });
    }

    console.log(`[WF Parser] Extracted ${transactions.length} transactions`);
    return transactions;
}

function isDepositTransaction(desc) {
    const depositPatterns = [
        /Payroll/i, /Direct Deposit/i, /Final Expense Di/i,
        /Zelle From/i, /Money Transfer.*From/i,
        /Online Transfer From/i,
        /Provisional Credit/i, /Purchase Return/i,
        /ATM Cash Deposit/i,
        /University of Ph/i,          // Student disbursements
        /Kim Wilhelm Busi/i,           // Business vendor payments
        /Fid Bkg Svc LLC/i,           // Fidelity transfers
        /My Deals Cash Back/i,
        /Figloans.*From/i
    ];
    return depositPatterns.some(p => p.test(desc));
}

function cleanWFDescription(desc) {
    return desc
        // Remove "Purchase authorized on MM/DD" prefix — keep the merchant
        .replace(/^Purchase authorized on\s+\d{2}\/\d{2}\s*/i, '')
        // Remove "Recurring Payment authorized on MM/DD" prefix
        .replace(/^Recurring Payment authorized on\s+\d{2}\/\d{2}\s*/i, '')
        // Remove "Purchase Return authorized on MM/DD" prefix but mark as return
        .replace(/^Purchase Return authorized on\s+\d{2}\/\d{2}\s*/i, 'RETURN: ')
        // Remove "Non-WF ATM Withdrawal authorized on MM/DD" prefix
        .replace(/^Non-WF ATM Withdrawal authorized on\s+\d{2}\/\d{2}\s*/i, 'ATM Withdrawal ')
        // Remove "ATM Withdrawal authorized on MM/DD" prefix
        .replace(/^ATM Withdrawal authorized on\s+\d{2}\/\d{2}\s*/i, 'ATM Withdrawal ')
        // Remove "Money Transfer authorized on MM/DD From" prefix
        .replace(/^Money Transfer authorized on\s+\d{2}\/\d{2}\s+From\s*/i, 'Transfer From ')
        // Clean trailing reference codes
        .replace(/\s+Ref\s+#\w+.*$/i, '')
        // Clean location details at end (2-letter state codes, phone numbers)
        .replace(/\s+\d{3}-\d{3}-\d{4}\s+[A-Z]{2}\s*$/i, '')
        .replace(/\s+\d{3}-\d{7}\s+[A-Z]{2}\s*$/i, '')
        // Clean "on MM/DD/YY" within remaining text
        .replace(/\s+on\s+\d{2}\/\d{2}\/\d{2}\s*/i, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}


// --- 7C: Analyze Transactions ---

async function analyzeStatements() {
    const progressDiv = document.getElementById('analysisProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const resultsDiv = document.getElementById('budgetResults');

    progressDiv.style.display = 'block';
    resultsDiv.style.display = 'none';
    progressFill.style.width = '0%';

    let allTransactions = [];

    // Parse each file
    for (let i = 0; i < uploadedFiles.length; i++) {
        progressText.textContent = `Parsing ${uploadedFiles[i].name}...`;
        progressFill.style.width = ((i + 1) / (uploadedFiles.length + 2) * 100) + '%';
        await sleep(300);

        const txns = await parseFile(uploadedFiles[i]);
        allTransactions = allTransactions.concat(txns);
    }

    if (allTransactions.length === 0) {
        progressText.textContent = 'No transactions found. Try a different file format or use manual entry.';
        progressFill.style.width = '100%';
        progressFill.style.background = '#ff4444';
        return;
    }

    progressText.textContent = `Analyzing ${allTransactions.length} transactions...`;
    progressFill.style.width = '80%';
    await sleep(500);

    // Run analysis
    budgetData = analyzeBudget(allTransactions);

    progressText.textContent = 'Generating report...';
    progressFill.style.width = '95%';
    await sleep(300);

    renderBudgetResults(budgetData);

    progressFill.style.width = '100%';
    progressText.textContent = 'Analysis complete!';
    await sleep(500);
    progressDiv.style.display = 'none';
    resultsDiv.style.display = 'block';

    // Scroll to results
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function analyzeBudget(transactions) {
    // Sort by date
    transactions.sort((a, b) => a.date - b.date);

    // Separate income vs expenses
    const income = transactions.filter(t => t.amount > 0);
    const expenses = transactions.filter(t => t.amount < 0);

    // Total income & expenses
    const totalIncome = income.reduce((s, t) => s + t.amount, 0);
    const totalExpenses = Math.abs(expenses.reduce((s, t) => s + t.amount, 0));
    const netSavings = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? (netSavings / totalIncome * 100) : 0;

    // Group by month
    const monthlyData = {};
    transactions.forEach(t => {
        const key = t.date.getFullYear() + '-' + String(t.date.getMonth() + 1).padStart(2, '0');
        if (!monthlyData[key]) monthlyData[key] = { income: 0, expenses: 0, transactions: [] };
        if (t.amount > 0) monthlyData[key].income += t.amount;
        else monthlyData[key].expenses += Math.abs(t.amount);
        monthlyData[key].transactions.push(t);
    });

    const months = Object.keys(monthlyData).sort();
    const avgMonthlyIncome = months.length > 0 ? totalIncome / months.length : 0;
    const avgMonthlyExpenses = months.length > 0 ? totalExpenses / months.length : 0;

    // Detect recurring payments (same merchant, similar amounts, appearing 2+ months)
    const recurring = detectRecurring(expenses);

    // Detect pay schedule
    const paySchedule = detectPaySchedule(income);

    // Categorize spending
    const categories = categorizeSpending(expenses);

    // Identify extra/discretionary spending
    const discretionary = identifyDiscretionary(expenses, recurring);

    // Generate budget plan
    const plan = generateBudgetPlan(avgMonthlyIncome, avgMonthlyExpenses, recurring, categories, savingsRate);

    return {
        totalIncome, totalExpenses, netSavings, savingsRate,
        avgMonthlyIncome, avgMonthlyExpenses,
        months, monthlyData,
        income, expenses, transactions,
        recurring, paySchedule, categories,
        discretionary, plan
    };
}

function detectRecurring(expenses) {
    // Group by normalized merchant name
    const merchantGroups = {};
    expenses.forEach(t => {
        const key = normalizeMerchant(t.description);
        if (!merchantGroups[key]) merchantGroups[key] = [];
        merchantGroups[key].push(t);
    });

    const recurring = [];
    for (const [merchant, txns] of Object.entries(merchantGroups)) {
        if (txns.length >= 2) {
            const amounts = txns.map(t => Math.abs(t.amount));
            const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
            // Check if amounts are similar (within 20%)
            const consistent = amounts.every(a => Math.abs(a - avgAmount) / avgAmount < 0.2);
            if (consistent) {
                recurring.push({
                    name: txns[0].description,
                    amount: avgAmount,
                    frequency: estimateFrequency(txns),
                    occurrences: txns.length,
                    monthlyEstimate: estimateMonthly(avgAmount, estimateFrequency(txns))
                });
            }
        }
    }

    return recurring.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
}

function normalizeMerchant(desc) {
    return desc.toLowerCase()
        .replace(/authorized on \d{2}\/\d{2}/gi, '')
        .replace(/\s+s\d{15,}/gi, '')
        .replace(/\s+p\d{15,}/gi, '')
        .replace(/\s+card\s+\d{4}/gi, '')
        .replace(/\d{15,}/g, '')
        .replace(/[#*]/g, '')
        .replace(/(purchase|recurring payment|debit|pos|ach|auto-pay|autopay)/gi, '')
        .replace(/\s+(houston|stafford|sugar land|santa clara|bentonville)\s+(tx|ca|ar|wa|ny|nj|pa|fl|mo|wi|mt)\s*/gi, ' ')
        .replace(/\d{3}-\d{3,4}-?\d{4}/g, '')   // Phone numbers
        .replace(/\s+\d{6,}/g, '')               // Long reference numbers
        .replace(/\*\w+/g, '')                    // Amazon *ID codes
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 35);
}

function estimateFrequency(txns) {
    if (txns.length < 2) return 'monthly';
    const diffs = [];
    for (let i = 1; i < txns.length; i++) {
        diffs.push((txns[i].date - txns[i - 1].date) / (1000 * 60 * 60 * 24));
    }
    const avgDays = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    if (avgDays <= 10) return 'weekly';
    if (avgDays <= 20) return 'biweekly';
    if (avgDays <= 40) return 'monthly';
    if (avgDays <= 100) return 'quarterly';
    return 'annual';
}

function estimateMonthly(amount, frequency) {
    switch (frequency) {
        case 'weekly': return amount * 4.33;
        case 'biweekly': return amount * 2.17;
        case 'monthly': return amount;
        case 'quarterly': return amount / 3;
        case 'annual': return amount / 12;
        default: return amount;
    }
}

function detectPaySchedule(income) {
    if (income.length === 0) return { frequency: 'unknown', avgPay: 0, payDays: [] };

    // Focus on PAYROLL deposits only for pay frequency detection
    // Other deposits (Zelle from friends, Fidelity transfers, returns) skew the analysis
    const payrollDeposits = income.filter(t => 
        /payroll|final expense di|direct deposit/i.test(t.description)
    );

    // If we found payroll deposits, use those for frequency detection
    const sourceDeposits = payrollDeposits.length >= 2 ? payrollDeposits : income;
    
    const amounts = sourceDeposits.map(t => t.amount);
    const avgPay = amounts.reduce((s, a) => s + a, 0) / amounts.length;

    // Check intervals between deposits
    const sorted = [...sourceDeposits].sort((a, b) => a.date - b.date);
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
        intervals.push((sorted[i].date - sorted[i - 1].date) / (1000 * 60 * 60 * 24));
    }

    const avgInterval = intervals.length > 0 ? intervals.reduce((s, d) => s + d, 0) / intervals.length : 30;

    let frequency = 'monthly';
    if (avgInterval <= 10) frequency = 'weekly';
    else if (avgInterval <= 18) frequency = 'biweekly';
    else if (avgInterval <= 22) frequency = 'semi-monthly';

    // Identify typical pay days from payroll deposits
    const payDays = sorted.map(t => t.date.getDate());
    const commonDays = [...new Set(payDays)].sort((a, b) => a - b);

    return { frequency, avgPay, payDays: commonDays, deposits: sorted, totalDeposits: income.length };
}

function categorizeSpending(expenses) {
    const categories = {
        'Housing': { keywords: ['rent', 'mortgage', 'hoa', 'property', 'apartment', 'lease', 'computers wherhouse', 'zelle to computers'], total: 0, count: 0, color: '#00ff88' },
        'Utilities': { keywords: ['electric', 'direct energy', 'water', 'internet', 'phone', 'mobile', 'cable', 'utility', 'verizon', 'at&t', 'tmobile', 't-mobile', 'comcast', 'xfinity', 'spectrum'], total: 0, count: 0, color: '#00d4ff' },
        'Auto & Transport': { keywords: ['gas station', 'shell', 'chevron', 'exxon', 'murphy', 'fugua chevron', 'uber', 'lyft', 'parking', 'toll', 'hctra', 'ez tag', 'transit', 'fuel', 'car wash', 'mister car wash', 'autozone', 'pnm*sameday auto', 'love\'s', 'quick stuff'], total: 0, count: 0, color: '#eab308' },
        'Insurance': { keywords: ['insurance', 'insurancetpa', 'geico', 'allstate', 'progressive', 'state farm', 'liberty mutual', 'premium', 'vsp'], total: 0, count: 0, color: '#a855f7' },
        'Groceries': { keywords: ['grocery', 'kroger', 'h-e-b', 'heb', 'walmart', 'wal-mart', 'wm supercenter', 'target', 'costco', 'samsclub', 'sams club', 'safeway', 'aldi', 'food town', 'whole foods', 'publix', 'amazon groce', 'amazon grocery'], total: 0, count: 0, color: '#22c55e' },
        'Dining': { keywords: ['restaurant', 'mcdonald', 'chick-fil-a', 'starbucks', 'chipotle', 'subway', 'doordash', 'dd *doordash', 'uber eats', 'grubhub', 'dining', 'pizza hut', 'burger king', 'taco bell', 'whataburger', 'popeyes', 'sonic drive', 'jack in the box', 'kfc', 'shipley', 'dairy queen', 'five below', 'tortilleria', 'a&y liquor', 'wendy'], total: 0, count: 0, color: '#f97316' },
        'Subscriptions': { keywords: ['netflix', 'spotify', 'hulu', 'disney', 'amazon prime', 'apple.com/bill', 'apple.com', 'google *', 'youtube', 'hbo', 'paramount', 'amc+', 'amcplus', 'crunchyroll', 'hidive', 'peacock', 'kocowa', 'wemod', 'openai', 'chatgpt', 'claude.ai', 'anthropic', 'glass cannon', 'monthly mal', 'prime video'], total: 0, count: 0, color: '#ec4899' },
        'Shopping': { keywords: ['amazon', 'ebay', 'etsy', 'best buy', 'apple store', 'clothing', 'fashion', 'nike', 'nordstrom', 'macy', 'kids foot locker', 'five below', 'today s vision', 'temu', 'the home depot', 'walmart.com', 'inter-state studio', 'steam', 'steamgames', 'wl *steam', 'nintendo', 'cvs', 'walgreens'], total: 0, count: 0, color: '#06b6d4' },
        'Loans & Debt': { keywords: ['loan', 'student', 'credit card', 'acima', 'figloans', 'financing', 'capital one', 'chase', 'amex', 'overdraft fee'], total: 0, count: 0, color: '#f43f5e' },
        'Transfers': { keywords: ['online transfer to', 'zelle to', 'atm withdrawal', 'non-wells fargo atm'], total: 0, count: 0, color: '#8b5cf6' },
        'Entertainment': { keywords: ['amc 2430', 'amc 9640', 'amc online', 'movies', 'ppg 307', 'audible', 'google *boo', 'google *hily', 'hily datin', 'myfico', 'xactus', 'towneplace'], total: 0, count: 0, color: '#14b8a6' },
        'Healthcare': { keywords: ['pharmacy', 'cvs/pharmacy', 'walgreens', 'doctor', 'medical', 'hospital', 'dental', 'health', 'rx', 'prescription'], total: 0, count: 0, color: '#ef4444' },
        'Storage': { keywords: ['public storage', 'storage'], total: 0, count: 0, color: '#78716c' },
        'Other': { keywords: [], total: 0, count: 0, color: '#6b7280' }
    };

    expenses.forEach(t => {
        const desc = t.description.toLowerCase();
        let matched = false;
        for (const [cat, info] of Object.entries(categories)) {
            if (cat === 'Other') continue;
            if (info.keywords.some(kw => desc.includes(kw))) {
                info.total += Math.abs(t.amount);
                info.count++;
                matched = true;
                break;
            }
        }
        if (!matched) {
            categories['Other'].total += Math.abs(t.amount);
            categories['Other'].count++;
        }
    });

    // Filter out zero categories
    return Object.fromEntries(Object.entries(categories).filter(([, v]) => v.total > 0));
}

function identifyDiscretionary(expenses, recurring) {
    const recurringNames = new Set(recurring.map(r => normalizeMerchant(r.name)));
    return expenses.filter(t => {
        const key = normalizeMerchant(t.description);
        return !recurringNames.has(key);
    }).sort((a, b) => a.amount - b.amount); // Most expensive first (negative amounts)
}

function generateBudgetPlan(income, expenses, recurring, categories, savingsRate) {
    const plan = { recommendations: [], allocations: {} };

    // 50/30/20 rule targets
    const needs = income * 0.50;
    const wants = income * 0.30;
    const savings = income * 0.20;

    plan.targetNeeds = needs;
    plan.targetWants = wants;
    plan.targetSavings = savings;

    const totalRecurring = recurring.reduce((s, r) => s + r.monthlyEstimate, 0);

    // Recommendations
    if (savingsRate < 0) {
        plan.recommendations.push({
            type: 'critical',
            title: 'Spending Exceeds Income',
            text: `You're spending $${Math.abs(income - expenses).toFixed(2)} more than you earn each month. This is unsustainable and needs immediate attention. Start by cutting discretionary spending and renegotiating recurring bills.`
        });
    } else if (savingsRate < 10) {
        plan.recommendations.push({
            type: 'warning',
            title: 'Low Savings Rate',
            text: `Your savings rate is ${savingsRate.toFixed(1)}%. Financial experts recommend saving at least 20% of income. Look for subscriptions or dining expenses to reduce.`
        });
    } else if (savingsRate >= 20) {
        plan.recommendations.push({
            type: 'success',
            title: 'Healthy Savings Rate',
            text: `Great job! You're saving ${savingsRate.toFixed(1)}% of your income. Consider directing excess savings toward investment accounts or an emergency fund.`
        });
    }

    // Subscription audit
    const subs = recurring.filter(r => r.monthlyEstimate < 50);
    if (subs.length > 3) {
        const subTotal = subs.reduce((s, r) => s + r.monthlyEstimate, 0);
        plan.recommendations.push({
            type: 'tip',
            title: 'Subscription Audit',
            text: `You have ${subs.length} recurring subscriptions totaling ~$${subTotal.toFixed(2)}/month. Review each one — canceling even 2-3 unused subscriptions could save $${(subTotal * 0.3).toFixed(2)}/month ($${(subTotal * 0.3 * 12).toFixed(2)}/year).`
        });
    }

    // Dining spending
    if (categories['Dining'] && categories['Dining'].total > income * 0.15) {
        plan.recommendations.push({
            type: 'warning',
            title: 'High Dining Costs',
            text: `Dining makes up ${(categories['Dining'].total / expenses * 100).toFixed(1)}% of your spending. Try meal prepping 2-3 times a week to cut this by 30-40%.`
        });
    }

    // Emergency fund
    plan.recommendations.push({
        type: 'tip',
        title: 'Emergency Fund Target',
        text: `Based on your monthly expenses of ~$${expenses.toFixed(0)}, aim for an emergency fund of $${(expenses * 3).toFixed(0)} to $${(expenses * 6).toFixed(0)} (3-6 months of expenses).`
    });

    // 50/30/20 allocation
    plan.allocations = {
        needs: { target: needs, label: 'Needs (50%)', items: ['Housing', 'Utilities', 'Insurance', 'Groceries', 'Transportation', 'Healthcare', 'Debt Payments'] },
        wants: { target: wants, label: 'Wants (30%)', items: ['Dining', 'Shopping', 'Subscriptions', 'Entertainment'] },
        savings: { target: savings, label: 'Savings (20%)', items: ['Emergency Fund', 'Investments', 'Retirement'] }
    };

    return plan;
}


// --- 7D: Render Budget Results ---

function renderBudgetResults(data) {
    // Summary cards
    const summaryGrid = document.getElementById('budgetSummary');
    const savingsClass = data.savingsRate >= 10 ? 'positive' : data.savingsRate >= 0 ? 'warning' : 'negative';

    summaryGrid.innerHTML = `
        <div class="summary-card">
            <div class="summary-label">Total Income</div>
            <div class="summary-value positive">${formatCurrency(data.totalIncome)}</div>
            <div class="summary-sub">~${formatCurrency(data.avgMonthlyIncome)}/mo</div>
        </div>
        <div class="summary-card">
            <div class="summary-label">Total Expenses</div>
            <div class="summary-value negative">${formatCurrency(data.totalExpenses)}</div>
            <div class="summary-sub">~${formatCurrency(data.avgMonthlyExpenses)}/mo</div>
        </div>
        <div class="summary-card">
            <div class="summary-label">Net Savings</div>
            <div class="summary-value ${data.netSavings >= 0 ? 'positive' : 'negative'}">${formatCurrency(data.netSavings)}</div>
            <div class="summary-sub">${data.months.length} months analyzed</div>
        </div>
        <div class="summary-card">
            <div class="summary-label">Savings Rate</div>
            <div class="summary-value ${savingsClass}">${data.savingsRate.toFixed(1)}%</div>
            <div class="summary-sub">Target: 20%+</div>
        </div>`;

    // Income & Pay Schedule
    const incomeSection = document.getElementById('incomeSection');
    const ps = data.paySchedule;
    incomeSection.innerHTML = `
        <div class="info-grid">
            <div class="info-card">
                <div class="info-label">Pay Frequency</div>
                <div class="info-value">${ps.frequency.charAt(0).toUpperCase() + ps.frequency.slice(1)}</div>
            </div>
            <div class="info-card">
                <div class="info-label">Avg Paycheck</div>
                <div class="info-value positive">${formatCurrency(ps.avgPay)}</div>
            </div>
            <div class="info-card">
                <div class="info-label">Typical Pay Days</div>
                <div class="info-value">${ps.payDays.length > 0 ? ps.payDays.map(d => ordinal(d)).join(', ') : 'Varies'}</div>
            </div>
            <div class="info-card">
                <div class="info-label">Payroll Deposits</div>
                <div class="info-value">${ps.deposits ? ps.deposits.length : data.income.length}</div>
            </div>
            <div class="info-card">
                <div class="info-label">Total Deposits (All Sources)</div>
                <div class="info-value">${data.income.length}</div>
            </div>
        </div>`;

    // Recurring payments
    const recurringSection = document.getElementById('recurringSection');
    if (data.recurring.length > 0) {
        const totalRecurring = data.recurring.reduce((s, r) => s + r.monthlyEstimate, 0);
        recurringSection.innerHTML = `
            <div class="recurring-total">Total Recurring: <strong>${formatCurrency(totalRecurring)}/mo</strong></div>
            <div class="recurring-list">
                ${data.recurring.map(r => `
                    <div class="recurring-item">
                        <div class="recurring-name">${r.name}</div>
                        <div class="recurring-detail">${r.frequency} · ${r.occurrences} charges</div>
                        <div class="recurring-amount">${formatCurrency(r.monthlyEstimate)}/mo</div>
                    </div>
                `).join('')}
            </div>`;
    } else {
        recurringSection.innerHTML = '<p style="color:rgba(255,255,255,0.4); padding:1rem;">No recurring payments detected. Try uploading more statements.</p>';
    }

    // Spending breakdown chart
    renderSpendingChart(data.categories);

    // Monthly trend chart
    renderTrendChart(data.months, data.monthlyData);

    // Extra spending
    renderExtraSpending(data.discretionary);

    // Budget plan
    renderBudgetPlan(data.plan, data.avgMonthlyIncome, data.avgMonthlyExpenses);
}

function renderSpendingChart(categories) {
    const labels = Object.keys(categories);
    const values = labels.map(k => categories[k].total);
    const colors = labels.map(k => categories[k].color);
    const total = values.reduce((s, v) => s + v, 0);

    const ctx = document.getElementById('spendingChart');
    if (!ctx) return;
    if (spendingChart) spendingChart.destroy();

    spendingChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,14,20,0.95)',
                    titleColor: '#fff',
                    bodyColor: '#ccc',
                    callbacks: {
                        label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)} (${(ctx.raw / total * 100).toFixed(1)}%)`
                    }
                }
            }
        }
    });

    // Legend
    const legend = document.getElementById('spendingLegend');
    legend.innerHTML = labels.map((label, i) => `
        <div class="legend-item">
            <span class="legend-dot" style="background:${colors[i]}"></span>
            <span class="legend-label">${label}</span>
            <span class="legend-value">${formatCurrency(values[i])} <span class="legend-pct">(${(values[i] / total * 100).toFixed(1)}%)</span></span>
        </div>
    `).join('');
}

function renderTrendChart(months, monthlyData) {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;
    if (trendChart) trendChart.destroy();

    const labels = months.map(m => {
        const [y, mo] = m.split('-');
        return new Date(y, mo - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    });

    const incomeData = months.map(m => monthlyData[m].income);
    const expenseData = months.map(m => monthlyData[m].expenses);

    trendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Income',
                    data: incomeData,
                    backgroundColor: 'rgba(0, 255, 136, 0.6)',
                    borderColor: '#00ff88',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: 'Expenses',
                    data: expenseData,
                    backgroundColor: 'rgba(255, 68, 68, 0.6)',
                    borderColor: '#ff4444',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: 'rgba(255,255,255,0.6)', font: { family: 'Share Tech Mono' } }
                },
                tooltip: {
                    backgroundColor: 'rgba(10,14,20,0.95)',
                    callbacks: { label: ctx => ctx.dataset.label + ': ' + formatCurrency(ctx.raw) }
                }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: 'rgba(255,255,255,0.4)' } },
                y: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: { color: 'rgba(255,255,255,0.4)', callback: v => formatCurrency(v, 0) }
                }
            }
        }
    });
}

function renderExtraSpending(discretionary) {
    const section = document.getElementById('extraSpendingSection');
    if (!section) return;

    // Show top 20 largest discretionary expenses
    const top = discretionary.slice(0, 20);
    if (top.length === 0) {
        section.innerHTML = '<p style="color:rgba(255,255,255,0.4); padding:1rem;">No discretionary spending detected beyond recurring payments.</p>';
        return;
    }

    const totalDisc = top.reduce((s, t) => s + Math.abs(t.amount), 0);
    section.innerHTML = `
        <div class="recurring-total">Top Discretionary Charges: <strong>${formatCurrency(totalDisc)}</strong></div>
        <div class="recurring-list">
            ${top.map(t => `
                <div class="recurring-item">
                    <div class="recurring-name">${t.description}</div>
                    <div class="recurring-detail">${t.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    <div class="recurring-amount negative">${formatCurrency(Math.abs(t.amount))}</div>
                </div>
            `).join('')}
        </div>`;
}

function renderBudgetPlan(plan, income, expenses) {
    const section = document.getElementById('budgetPlanSection');
    if (!section) return;

    let html = '';

    // 50/30/20 allocation bars
    html += `<div class="allocation-grid">
        <div class="allocation-card">
            <div class="alloc-header"><span class="alloc-label">Needs (50%)</span><span class="alloc-target">${formatCurrency(plan.targetNeeds)}/mo</span></div>
            <div class="alloc-bar"><div class="alloc-fill needs" style="width:${Math.min(100, (Math.min(expenses, plan.targetNeeds) / income * 100))}%"></div></div>
            <div class="alloc-items">Housing, Utilities, Insurance, Groceries, Transport, Healthcare</div>
        </div>
        <div class="allocation-card">
            <div class="alloc-header"><span class="alloc-label">Wants (30%)</span><span class="alloc-target">${formatCurrency(plan.targetWants)}/mo</span></div>
            <div class="alloc-bar"><div class="alloc-fill wants" style="width:${Math.min(100, 30)}%"></div></div>
            <div class="alloc-items">Dining, Shopping, Subscriptions, Entertainment</div>
        </div>
        <div class="allocation-card">
            <div class="alloc-header"><span class="alloc-label">Savings (20%)</span><span class="alloc-target">${formatCurrency(plan.targetSavings)}/mo</span></div>
            <div class="alloc-bar"><div class="alloc-fill savings" style="width:${Math.min(100, 20)}%"></div></div>
            <div class="alloc-items">Emergency Fund, Investments, Retirement</div>
        </div>
    </div>`;

    // Recommendations
    html += '<div class="recommendations">';
    plan.recommendations.forEach(rec => {
        const icon = rec.type === 'critical' ? '🚨' : rec.type === 'warning' ? '⚠️' : rec.type === 'success' ? '✅' : '💡';
        html += `
            <div class="rec-card rec-${rec.type}">
                <div class="rec-icon">${icon}</div>
                <div>
                    <div class="rec-title">${rec.title}</div>
                    <div class="rec-text">${rec.text}</div>
                </div>
            </div>`;
    });
    html += '</div>';

    section.innerHTML = html;
}

// --- 7E: Manual Entry ---

function processManualEntry() {
    const income = parseFloat(document.getElementById('manualIncome').value) || 0;
    const frequency = document.getElementById('payFrequency').value;

    if (income <= 0) {
        alert('Please enter your monthly take-home pay.');
        return;
    }

    const expenseRows = document.querySelectorAll('#manualExpenses .expense-row');
    const transactions = [];
    const now = new Date();

    // Generate income transactions (simulate 4 months)
    let payAmount = income;
    let payInterval = 30;
    if (frequency === 'biweekly') { payAmount = income / 2.17; payInterval = 14; }
    else if (frequency === 'semimonthly') { payAmount = income / 2; payInterval = 15; }
    else if (frequency === 'weekly') { payAmount = income / 4.33; payInterval = 7; }

    for (let m = 0; m < 4; m++) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
        let day = 1;
        while (day <= 28) {
            transactions.push({
                date: new Date(monthStart.getFullYear(), monthStart.getMonth(), day),
                description: 'Direct Deposit - Payroll',
                amount: payAmount
            });
            day += payInterval;
            if (frequency === 'monthly') break;
        }
    }

    // Generate expense transactions (4 months)
    expenseRows.forEach(row => {
        const name = row.querySelector('.exp-name')?.value?.trim();
        const amount = parseFloat(row.querySelector('.exp-amount')?.value) || 0;
        if (!name || amount <= 0) return;

        for (let m = 0; m < 4; m++) {
            const date = new Date(now.getFullYear(), now.getMonth() - m, 15);
            transactions.push({ date, description: name, amount: -amount });
        }
    });

    // Close modal and analyze
    document.getElementById('manualModal').style.display = 'none';

    budgetData = analyzeBudget(transactions);
    renderBudgetResults(budgetData);
    document.getElementById('budgetResults').style.display = 'block';
    document.getElementById('budgetResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// --- 7F: Print & Export ---

function printBudgetReport() {
    window.print();
}

function exportBudgetCSV() {
    if (!budgetData) return;

    let csv = 'Category,Description,Amount,Date\n';

    // Income
    budgetData.income.forEach(t => {
        csv += `Income,"${t.description}",${t.amount.toFixed(2)},${t.date.toLocaleDateString()}\n`;
    });

    // Expenses
    budgetData.expenses.forEach(t => {
        csv += `Expense,"${t.description}",${t.amount.toFixed(2)},${t.date.toLocaleDateString()}\n`;
    });

    csv += '\nRecurring Payments\n';
    csv += 'Name,Monthly Estimate,Frequency,Occurrences\n';
    budgetData.recurring.forEach(r => {
        csv += `"${r.name}",${r.monthlyEstimate.toFixed(2)},${r.frequency},${r.occurrences}\n`;
    });

    csv += '\nSummary\n';
    csv += `Total Income,${budgetData.totalIncome.toFixed(2)}\n`;
    csv += `Total Expenses,${budgetData.totalExpenses.toFixed(2)}\n`;
    csv += `Net Savings,${budgetData.netSavings.toFixed(2)}\n`;
    csv += `Savings Rate,${budgetData.savingsRate.toFixed(1)}%\n`;

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}


// ============================================================
// SECTION 8: UTILITIES & HELPERS
// ============================================================

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}


// ============================================================
// SECTION 9: INITIALIZATION & AUTO-REFRESH
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize background
    initBackground();

    // Initialize tabs
    initTabs();

    // Initialize search
    initStockSearch();
    initCryptoSearch();

    // Initialize budget analyzer
    initBudgetAnalyzer();

    // Set market status
    const statusEl = document.getElementById('marketStatus');
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;
    const isMarketHours = hour >= 9 && hour < 16;

    if (isWeekend) {
        if (statusEl) statusEl.textContent = 'Markets closed — Weekend';
    } else if (isMarketHours) {
        if (statusEl) statusEl.textContent = 'Markets OPEN — Live data streaming';
    } else {
        if (statusEl) statusEl.textContent = 'Markets closed — Showing last close';
    }

    // Load initial data
    try {
        await Promise.all([
            initTicker(),
            loadIndices(),
            loadActiveStocks(),
            loadFeaturedChart('^GSPC', 'S&P 500', '1D')
        ]);
    } catch (e) {
        console.warn('Stock data load error:', e);
    }

    // Load crypto data (separate to avoid rate limiting issues)
    try {
        await loadCryptoData();
    } catch (e) {
        console.warn('Crypto data load error:', e);
    }

    // Load news
    try {
        await loadMarketNews();
    } catch (e) {
        console.warn('News load error:', e);
    }

    // Auto-refresh every 60 seconds for stock data
    setInterval(async () => {
        try {
            await initTicker();
            await loadIndices();
        } catch (e) { /* silently retry */ }
    }, 60000);

    // Refresh crypto every 2 minutes (CoinGecko rate limits)
    setInterval(async () => {
        try {
            await loadCryptoData();
        } catch (e) { /* silently retry */ }
    }, 120000);

    // Refresh news every 5 minutes
    setInterval(async () => {
        try {
            await loadMarketNews();
        } catch (e) { /* silently retry */ }
    }, 300000);
});
