/**
 * ============================================================
 * JONATHAN CASTRO - MASTER NAVIGATION CONTROLLER v2
 * ============================================================
 * Single source of truth for site nav. 5 pages.
 * Edit SITE_CONFIG.navItems to change nav entries.
 * ============================================================
 */

const SITE_CONFIG = {
    baseUrl: 'https://jonathan-castro.com',
    logo: {
        src: '/assets/KarmakaziLogo-512x512.png',
        alt: 'Karmakazi Logo',
        width: 60,
        height: 60
    },
    siteName: 'Jonathan Castro',
    navItems: [
        { id: 'home',         label: 'Home',         href: '/home/' },
        { id: 'security-ops', label: 'Security Ops', href: '/security-ops/' },
        { id: 'homelab',      label: 'Homelab',      href: '/homelab/' },
        { id: 'markets',      label: 'Markets',      href: '/markets/' },
        { id: 'tech-news',    label: 'Tech News',    href: '/tech-news/' }
    ]
};

function isActivePath(currentPath, item) {
    if (item.id === 'home') {
        return currentPath === '/' ||
               currentPath === '/index.html' ||
               currentPath.startsWith('/home');
    }
    return currentPath.startsWith(item.href) ||
           currentPath.includes(`/${item.id}/`);
}

function buildNavigation() {
    const currentPath = window.location.pathname;
    const navHTML = `
        <nav class="main-nav" id="mainNav" role="navigation" aria-label="Primary">
            <div class="nav-container">
                <button class="mobile-menu-btn" id="mobileMenuBtn"
                        aria-label="Toggle navigation menu"
                        aria-expanded="false"
                        aria-controls="navLinks">
                    <span class="hamburger-line"></span>
                    <span class="hamburger-line"></span>
                    <span class="hamburger-line"></span>
                </button>
                <ul class="nav-links" id="navLinks">
                    ${SITE_CONFIG.navItems.map(item => {
                        const active = isActivePath(currentPath, item);
                        return `
                        <li class="nav-item">
                            <a href="${item.href}"
                               class="nav-link ${active ? 'active' : ''}"
                               data-page="${item.id}"
                               ${active ? 'aria-current="page"' : ''}>
                                ${item.label}
                            </a>
                        </li>`;
                    }).join('')}
                </ul>
                <a href="/home/" class="nav-logo" aria-label="Jonathan Castro home">
                    <img src="${SITE_CONFIG.logo.src}"
                         alt="${SITE_CONFIG.logo.alt}"
                         width="${SITE_CONFIG.logo.width}"
                         height="${SITE_CONFIG.logo.height}">
                </a>
            </div>
        </nav>
    `;

    const navPlaceholder = document.getElementById('nav-placeholder');
    if (navPlaceholder) {
        navPlaceholder.innerHTML = navHTML;
    } else {
        document.body.insertAdjacentHTML('afterbegin', navHTML);
    }

    initMobileMenu();
    initScrollEffect();
}

function initMobileMenu() {
    const btn   = document.getElementById('mobileMenuBtn');
    const links = document.getElementById('navLinks');
    if (!btn || !links) return;

    const close = () => {
        links.classList.remove('nav-open');
        btn.classList.remove('menu-open');
        btn.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
        links.classList.add('nav-open');
        btn.classList.add('menu-open');
        btn.setAttribute('aria-expanded', 'true');
    };
    const toggle = () => {
        (links.classList.contains('nav-open') ? close : open)();
    };

    btn.addEventListener('click', toggle);
    links.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && links.classList.contains('nav-open')) close();
    });
    document.addEventListener('click', (e) => {
        if (!links.classList.contains('nav-open')) return;
        if (links.contains(e.target) || btn.contains(e.target)) return;
        close();
    });
}

function initScrollEffect() {
    const nav = document.getElementById('mainNav');
    if (!nav) return;
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            nav.classList.toggle('nav-scrolled', window.scrollY > 50);
            ticking = false;
        });
    }, { passive: true });
}

function getCurrentPage() {
    const currentPath = window.location.pathname;
    return SITE_CONFIG.navItems.find(item => isActivePath(currentPath, item))
        || SITE_CONFIG.navItems[0];
}

function navigateTo(pageId) {
    const page = SITE_CONFIG.navItems.find(item => item.id === pageId);
    if (page) window.location.href = page.href;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildNavigation);
} else {
    buildNavigation();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SITE_CONFIG, buildNavigation, getCurrentPage, navigateTo };
}
