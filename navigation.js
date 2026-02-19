/**
 * ============================================================
 * JONATHAN CASTRO WEBSITE - MASTER NAVIGATION CONTROLLER
 * ============================================================
 * 
 * This single file handles ALL navigation across the entire website.
 * Edit this file to add, remove, or modify navigation links.
 * 
 * HOW TO EDIT:
 * 1. To change a page name: Edit the 'label' value
 * 2. To change a page URL: Edit the 'href' value
 * 3. To add a new page: Copy a nav item object and modify it
 * 4. To remove a page: Delete the entire object from the array
 * 
 * ============================================================
 */

const SITE_CONFIG = {
    // Your website base URL - update this if your domain changes
    baseUrl: 'https://jonathan-castro.com',
    
    // Logo settings
    logo: {
        src: '/assets/KarmakaziLogo-512x512.png',
        alt: 'Karmakazi Logo',
        width: 60,
        height: 60
    },
    
    // Site metadata
    siteName: 'Jonathan Castro',
    
    // Navigation items - EDIT THIS ARRAY TO MODIFY YOUR NAVIGATION
    // Each item needs: id, label (display name), href (URL path)
    navItems: [
        {
            id: 'home',
            label: 'Home',
            href: '/home/'
        },
        {
            id: 'custom-1',
            label: 'Vuln Scanner',
            href: '/custom-1/'
        },
        {
            id: 'custom-2',
            label: 'Homelab',
            href: '/custom-2/'
        },
        {
            id: 'custom-3',
            label: 'Castro Chat',
            href: '/custom-3/'
        },
        {
            id: 'custom-4',
            label: 'Custom 4',
            href: '/custom-4/'
        },
        {
            id: 'custom-5',
            label: 'Custom 5',
            href: '/custom-5/'
        },
        {
            id: 'custom-6',
            label: 'Custom 6',
            href: '/custom-6/'
        },
        {
            id: 'custom-7',
            label: 'Custom 7',
            href: '/custom-7/'
        },
        {
            id: 'custom-8',
            label: 'Custom 8',
            href: '/custom-8/'
        },
        {
            id: 'custom-9',
            label: 'Custom 9',
            href: '/custom-9/'
        }
    ]
};

/**
 * Builds and injects the navigation bar into any page
 * Called automatically when this script loads
 */
function buildNavigation() {
    // Find current page to highlight active link
    const currentPath = window.location.pathname;
    
    // Create navigation HTML
    const navHTML = `
        <nav class="main-nav" id="mainNav">
            <div class="nav-container">
                <!-- Mobile menu button -->
                <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Toggle navigation menu">
                    <span class="hamburger-line"></span>
                    <span class="hamburger-line"></span>
                    <span class="hamburger-line"></span>
                </button>
                
                <!-- Navigation links -->
                <ul class="nav-links" id="navLinks">
                    ${SITE_CONFIG.navItems.map(item => `
                        <li class="nav-item">
                            <a href="${item.href}" 
                               class="nav-link ${currentPath.includes(item.id) ? 'active' : ''}"
                               data-page="${item.id}">
                                ${item.label}
                            </a>
                        </li>
                    `).join('')}
                </ul>
                
                <!-- Logo (top right) -->
                <a href="/home/" class="nav-logo">
                    <img src="${SITE_CONFIG.logo.src}" 
                         alt="${SITE_CONFIG.logo.alt}"
                         width="${SITE_CONFIG.logo.width}"
                         height="${SITE_CONFIG.logo.height}">
                </a>
            </div>
        </nav>
    `;
    
    // Find the nav placeholder and inject navigation
    const navPlaceholder = document.getElementById('nav-placeholder');
    if (navPlaceholder) {
        navPlaceholder.innerHTML = navHTML;
    } else {
        // If no placeholder, insert at beginning of body
        document.body.insertAdjacentHTML('afterbegin', navHTML);
    }
    
    // Initialize mobile menu functionality
    initMobileMenu();
    
    // Add scroll effect
    initScrollEffect();
}

/**
 * Mobile menu toggle functionality
 */
function initMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navLinks = document.getElementById('navLinks');
    
    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            navLinks.classList.toggle('nav-open');
            mobileMenuBtn.classList.toggle('menu-open');
        });
        
        // Close menu when clicking a link
        navLinks.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('nav-open');
                mobileMenuBtn.classList.remove('menu-open');
            });
        });
    }
}

/**
 * Adds background to nav on scroll
 */
function initScrollEffect() {
    const nav = document.getElementById('mainNav');
    if (nav) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                nav.classList.add('nav-scrolled');
            } else {
                nav.classList.remove('nav-scrolled');
            }
        });
    }
}

/**
 * Utility function to get current page info
 */
function getCurrentPage() {
    const currentPath = window.location.pathname;
    return SITE_CONFIG.navItems.find(item => currentPath.includes(item.id)) || SITE_CONFIG.navItems[0];
}

/**
 * Utility function to navigate to a specific page programmatically
 */
function navigateTo(pageId) {
    const page = SITE_CONFIG.navItems.find(item => item.id === pageId);
    if (page) {
        window.location.href = page.href;
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildNavigation);
} else {
    buildNavigation();
}

// Export for use in other scripts if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SITE_CONFIG, buildNavigation, getCurrentPage, navigateTo };
}
