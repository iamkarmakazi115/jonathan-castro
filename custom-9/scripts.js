/**
 * ============================================================
 * CUSTOM 9 PAGE - SCRIPTS.JS
 * ============================================================
 * 
 * Page-specific JavaScript for the Custom 9 page.
 * Add any Custom 9 page functionality here.
 * 
 * Navigation is handled by /navigation.js (shared across all pages)
 * 
 * ============================================================
 */

document.addEventListener('DOMContentLoaded', function() {
    
    // =========================================
    // SCROLL ANIMATIONS
    // =========================================
    const animateOnScroll = () => {
        const elements = document.querySelectorAll('.content-card, .section-title, .section-text');
        
        elements.forEach(element => {
            const elementTop = element.getBoundingClientRect().top;
            const windowHeight = window.innerHeight;
            
            if (elementTop < windowHeight - 100) {
                element.style.opacity = '1';
                element.style.transform = 'translateY(0)';
            }
        });
    };
    
    // Set initial state for animation
    document.querySelectorAll('.content-card').forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    });
    
    window.addEventListener('scroll', animateOnScroll);
    animateOnScroll(); // Run once on load
    
    // =========================================
    // ADD YOUR CUSTOM PAGE CODE BELOW
    // =========================================
    
    
});
