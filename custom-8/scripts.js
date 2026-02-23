/* ========================================================
   TECH NEWS FEED — Custom 8
   scripts.js
   ======================================================== */

// ─── CATEGORY CONFIGURATION ─────────────────────────────
const CATEGORIES = {
    ai: {
        title: 'Artificial Intelligence',
        subtitle: 'Latest AI developments, research & industry news',
        icon: '◈',
        color: '#a78bfa',
        sections: [
            {
                label: 'AI Research & Development',
                feeds: [
                    { name: 'MIT Tech Review AI', rss: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
                    { name: 'VentureBeat AI', rss: 'https://venturebeat.com/category/ai/feed/' }
                ]
            },
            {
                label: 'Machine Learning & LLMs',
                feeds: [
                    { name: 'The Verge AI', rss: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
                    { name: 'Ars Technica AI', rss: 'https://arstechnica.com/ai/feed/' }
                ]
            },
            {
                label: 'AI Industry & Business',
                feeds: [
                    { name: 'TechCrunch AI', rss: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
                    { name: 'Wired AI', rss: 'https://www.wired.com/feed/tag/ai/latest/rss' }
                ]
            }
        ]
    },
    cybersecurity: {
        title: 'Cybersecurity',
        subtitle: 'Threats, vulnerabilities, breaches & security operations',
        icon: '⬡',
        color: '#34d399',
        sections: [
            {
                label: 'Threats & Vulnerabilities',
                feeds: [
                    { name: 'The Hacker News', rss: 'https://feeds.feedburner.com/TheHackersNews' },
                    { name: 'Krebs on Security', rss: 'https://krebsonsecurity.com/feed/' }
                ]
            },
            {
                label: 'Data Breaches',
                feeds: [
                    { name: 'BleepingComputer', rss: 'https://www.bleepingcomputer.com/feed/' },
                    { name: 'Dark Reading', rss: 'https://www.darkreading.com/rss.xml' }
                ]
            },
            {
                label: 'Security Operations',
                feeds: [
                    { name: 'SecurityWeek', rss: 'https://feeds.feedburner.com/securityweek' },
                    { name: 'Threatpost', rss: 'https://threatpost.com/feed/' }
                ]
            }
        ]
    },
    microsoft: {
        title: 'Microsoft',
        subtitle: 'Windows, Azure, Office 365, Copilot & enterprise news',
        icon: '⊞',
        color: '#38bdf8',
        sections: [
            {
                label: 'Windows & OS Updates',
                feeds: [
                    { name: 'Windows Central', rss: 'https://www.windowscentral.com/feed' },
                    { name: 'Neowin', rss: 'https://www.neowin.net/news/rss/' }
                ]
            },
            {
                label: 'Azure & Cloud',
                feeds: [
                    { name: 'Microsoft Azure Blog', rss: 'https://azure.microsoft.com/en-us/blog/feed/' },
                    { name: 'ZDNet Microsoft', rss: 'https://www.zdnet.com/topic/microsoft/rss.xml' }
                ]
            },
            {
                label: 'Microsoft Business & Products',
                feeds: [
                    { name: 'The Verge Microsoft', rss: 'https://www.theverge.com/rss/microsoft/index.xml' },
                    { name: 'MS Power User', rss: 'https://mspoweruser.com/feed/' }
                ]
            }
        ]
    },
    it: {
        title: 'Information Technology',
        subtitle: 'Infrastructure, networking, DevOps & enterprise IT',
        icon: '⌘',
        color: '#fb923c',
        sections: [
            {
                label: 'IT Infrastructure & Cloud',
                feeds: [
                    { name: 'Ars Technica', rss: 'https://feeds.arstechnica.com/arstechnica/index' },
                    { name: 'InfoWorld', rss: 'https://www.infoworld.com/feed/' }
                ]
            },
            {
                label: 'Networking & DevOps',
                feeds: [
                    { name: 'The Register', rss: 'https://www.theregister.com/headlines.atom' },
                    { name: 'TechRepublic', rss: 'https://www.techrepublic.com/rssfeeds/articles/' }
                ]
            },
            {
                label: 'Enterprise & Trends',
                feeds: [
                    { name: 'ZDNet', rss: 'https://www.zdnet.com/news/rss.xml' },
                    { name: 'ComputerWorld', rss: 'https://www.computerworld.com/feed/' }
                ]
            }
        ]
    }
};

// RSS-to-JSON proxy (free, no key needed)
const RSS_PROXY = 'https://api.rss2json.com/v1/api.json?rss_url=';

let currentCategory = 'ai';
let newsCache = {};

// ─── ANIMATED TECH BACKGROUND ────────────────────────────
function initBackground() {
    const canvas = document.getElementById('techBg');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, particles = [], connections = [];
    const PARTICLE_COUNT = 60;
    const MAX_DIST = 140;

    function resize() {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
    }

    function createParticles() {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                r: Math.random() * 2 + 0.5,
                pulse: Math.random() * Math.PI * 2
            });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);

        // Draw subtle grid
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.02)';
        ctx.lineWidth = 0.5;
        const gridSize = 60;
        for (let x = 0; x < w; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0; y < h; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Update and draw particles
        const catColor = CATEGORIES[currentCategory]?.color || '#38bdf8';

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.pulse += 0.02;

            // Bounce off edges
            if (p.x < 0 || p.x > w) p.vx *= -1;
            if (p.y < 0 || p.y > h) p.vy *= -1;

            const alpha = 0.15 + 0.1 * Math.sin(p.pulse);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = catColor.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
            // Use hex to rgba conversion
            const r = parseInt(catColor.slice(1, 3), 16);
            const g = parseInt(catColor.slice(3, 5), 16);
            const b = parseInt(catColor.slice(5, 7), 16);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            ctx.fill();

            // Draw connections
            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dx = p.x - p2.x;
                const dy = p.y - p2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < MAX_DIST) {
                    const lineAlpha = (1 - dist / MAX_DIST) * 0.06;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${lineAlpha})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        requestAnimationFrame(draw);
    }

    resize();
    createParticles();
    draw();
    window.addEventListener('resize', () => { resize(); createParticles(); });
}

// ─── RSS FETCHING ─────────────────────────────────────────
async function fetchFeed(feedUrl) {
    try {
        const resp = await fetch(RSS_PROXY + encodeURIComponent(feedUrl));
        if (!resp.ok) throw new Error('Feed fetch failed');
        const data = await resp.json();
        if (data.status === 'ok' && data.items) {
            return data.items.map(item => ({
                title: item.title || 'Untitled',
                description: stripHTML(item.description || item.content || ''),
                link: item.link || '#',
                pubDate: item.pubDate || '',
                source: data.feed?.title || extractDomain(feedUrl),
                thumbnail: item.thumbnail || item.enclosure?.link || null
            }));
        }
        return [];
    } catch (e) {
        console.warn('Feed error:', feedUrl, e.message);
        return [];
    }
}

function stripHTML(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

function extractDomain(url) {
    try {
        const u = new URL(url);
        return u.hostname.replace('www.', '').replace('feeds.feedburner.com', 'Feedburner');
    } catch {
        return 'Unknown';
    }
}

function timeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date)) return dateStr;
    const now = new Date();
    const diffMs = now - date;
    const mins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);

    if (mins < 2) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24) return `${hrs}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── CATEGORY LOADING ─────────────────────────────────────
async function loadCategory(catKey) {
    currentCategory = catKey;
    const cat = CATEGORIES[catKey];
    if (!cat) return;

    // Update header
    document.getElementById('categoryTitle').innerHTML = `<span class="title-icon">${cat.icon}</span> ${cat.title}`;
    document.getElementById('categorySubtitle').textContent = cat.subtitle;

    // Update active sidebar button
    document.querySelectorAll('.icon-btn[data-category]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === catKey);
    });

    // Set category attribute on main for accent coloring
    document.querySelector('.news-main').setAttribute('data-active-cat', catKey);

    // Show loading
    const loadingEl = document.getElementById('loadingState');
    const sectionsEl = document.getElementById('newsSections');
    const errorEl = document.getElementById('errorState');
    loadingEl.classList.add('visible');
    sectionsEl.innerHTML = '';
    errorEl.style.display = 'none';

    // Check cache (5 min)
    const cacheKey = catKey;
    const cached = newsCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp < 300000)) {
        loadingEl.classList.remove('visible');
        renderSections(cached.sections, catKey);
        document.getElementById('lastUpdated').textContent = `Updated ${timeAgo(new Date(cached.timestamp).toISOString())}`;
        return;
    }

    // Fetch all feeds in parallel per section
    try {
        const sectionResults = [];

        for (const section of cat.sections) {
            const feedPromises = section.feeds.map(f => fetchFeed(f.rss));
            const feedResults = await Promise.allSettled(feedPromises);

            let articles = [];
            feedResults.forEach((result, i) => {
                if (result.status === 'fulfilled' && result.value.length) {
                    articles = articles.concat(
                        result.value.map(a => ({ ...a, feedSource: section.feeds[i].name }))
                    );
                }
            });

            // Sort by date, take top 6
            articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            articles = articles.slice(0, 6);

            sectionResults.push({
                label: section.label,
                articles
            });
        }

        // Cache results
        newsCache[cacheKey] = { sections: sectionResults, timestamp: Date.now() };

        loadingEl.classList.remove('visible');
        renderSections(sectionResults, catKey);
        document.getElementById('lastUpdated').textContent = 'Updated just now';

    } catch (err) {
        console.error('Category load error:', err);
        loadingEl.classList.remove('visible');
        errorEl.style.display = 'flex';
    }
}

// ─── RENDER ───────────────────────────────────────────────
function renderSections(sections, catKey) {
    const container = document.getElementById('newsSections');
    container.innerHTML = '';

    sections.forEach((section, sIdx) => {
        if (!section.articles.length) return;

        const sectionEl = document.createElement('div');
        sectionEl.className = 'news-section';
        sectionEl.style.animationDelay = `${sIdx * 0.1}s`;

        const labelEl = document.createElement('h2');
        labelEl.className = 'section-label';
        labelEl.textContent = section.label;
        sectionEl.appendChild(labelEl);

        const cardsGrid = document.createElement('div');
        cardsGrid.className = 'section-cards';

        section.articles.forEach((article, aIdx) => {
            const card = document.createElement('div');
            card.className = 'news-card';
            card.style.animationDelay = `${(sIdx * 0.1) + (aIdx * 0.05)}s`;
            card.onclick = () => window.open(article.link, '_blank', 'noopener');

            card.innerHTML = `
                <div class="card-tag">
                    <span class="tag-dot"></span>
                    ${article.feedSource || article.source}
                </div>
                <h3 class="card-title">${escapeHTML(article.title)}</h3>
                ${article.description ? `<p class="card-description">${escapeHTML(article.description.substring(0, 160))}</p>` : ''}
                <div class="card-footer">
                    <span class="card-date">${timeAgo(article.pubDate)}</span>
                    <span class="card-source">${extractDomain(article.link)}</span>
                    <svg class="card-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                </div>
            `;

            cardsGrid.appendChild(card);
        });

        sectionEl.appendChild(cardsGrid);
        container.appendChild(sectionEl);
    });

    // If no articles at all
    if (!container.children.length) {
        container.innerHTML = `
            <div class="error-state" style="display:flex">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                </svg>
                <p>No articles found for this category. The RSS feeds may be temporarily unavailable.</p>
                <button class="retry-btn" onclick="newsCache = {}; loadCategory('${catKey}')">Retry</button>
            </div>
        `;
    }
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── SIDEBAR EVENT LISTENERS ──────────────────────────────
function initSidebar() {
    document.querySelectorAll('.icon-btn[data-category]').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.dataset.category;
            if (cat !== currentCategory) {
                loadCategory(cat);
            }
        });
    });

    // Refresh button
    const refreshBtn = document.getElementById('refreshAll');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.classList.add('spinning');
            newsCache = {};
            loadCategory(currentCategory).then(() => {
                setTimeout(() => refreshBtn.classList.remove('spinning'), 800);
            });
        });
    }
}

// ─── AUTO REFRESH (every 5 minutes) ──────────────────────
function startAutoRefresh() {
    setInterval(() => {
        delete newsCache[currentCategory];
        loadCategory(currentCategory);
    }, 300000);
}

// ─── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initBackground();
    initSidebar();
    loadCategory('ai');
    startAutoRefresh();
});
