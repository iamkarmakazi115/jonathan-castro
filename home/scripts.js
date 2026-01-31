/**
 * ============================================================
 * HOME PAGE - SCRIPTS.JS
 * ============================================================
 * 
 * Page-specific JavaScript for the Home page.
 * Add any Home page functionality here.
 * 
 * Navigation is handled by /navigation.js (shared across all pages)
 * 
 * ============================================================
 */

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    
    // =========================================
    // VIDEO HANDLING
    // =========================================
    const heroVideo = document.querySelector('.hero-video');
    
    if (heroVideo) {
        // Ensure video plays (some browsers block autoplay)
        heroVideo.play().catch(function(error) {
            console.log('Video autoplay was prevented:', error);
            // You could show a play button here if needed
        });
        
        // Optional: Pause video when not visible (performance)
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    heroVideo.play();
                } else {
                    heroVideo.pause();
                }
            });
        }, { threshold: 0.25 });
        
        observer.observe(heroVideo);
    }
    
    // =========================================
    // SMOOTH SCROLL FOR ANCHOR LINKS
    // =========================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId !== '#') {
                e.preventDefault();
                const target = document.querySelector(targetId);
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });
    });
    
    // =========================================
    // SCROLL ANIMATIONS (Fade in elements)
    // =========================================
    const animateOnScroll = () => {
        const elements = document.querySelectorAll('.feature-card, .section-title, .section-text');
        
        elements.forEach(element => {
            const elementTop = element.getBoundingClientRect().top;
            const windowHeight = window.innerHeight;
            
            if (elementTop < windowHeight - 100) {
                element.classList.add('animate-in');
            }
        });
    };
    
    // Run on scroll
    window.addEventListener('scroll', animateOnScroll);
    
    // Run once on load
    animateOnScroll();
    
    // =========================================
    // ADD YOUR CUSTOM HOME PAGE CODE BELOW
    // =========================================
    
    
});

/**
 * Utility function: Check if element is in viewport
 */
function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}
