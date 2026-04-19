/**
 * ============================================================
 * HOME PAGE SCRIPT  -  site/home/scripts.js
 * ------------------------------------------------------------
 * - Ensures hero video plays (handles mobile autoplay quirks)
 * - Pauses hero video when it scrolls out of view (perf)
 * - Reveals About + Projects sections and cards on scroll
 * - Respects prefers-reduced-motion
 * - No framework, no build step, no external deps
 * ============================================================
 */

(function () {
    'use strict';

    const prefersReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
    ).matches;

    /* --------------------------------------------------------
     * Hero video: kick autoplay + pause when off-screen
     * -------------------------------------------------------- */
    function initHeroVideo() {
        const video = document.querySelector('.hero-video');
        if (!video) return;

        // Some mobile browsers block autoplay unless muted + playsinline.
        // Both attributes are set in HTML; this is belt-and-suspenders.
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(function (err) {
                console.warn('[home] hero video autoplay blocked:', err);
            });
        }

        // Pause when off-screen to save battery and GPU cycles.
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        video.play().catch(function () { /* ignore */ });
                    } else {
                        video.pause();
                    }
                });
            }, { threshold: 0.15 });
            io.observe(video);
        }
    }

    /* --------------------------------------------------------
     * Reveal on scroll: fade sections + cards as they enter view
     * Skipped entirely if user prefers reduced motion.
     * -------------------------------------------------------- */
    function initReveal() {
        if (prefersReducedMotion) return;

        const targets = document.querySelectorAll(
            '.about, .projects, .project-card'
        );
        if (targets.length === 0) return;

        // Add the reveal class so CSS knows to hide them initially.
        targets.forEach(function (el) { el.classList.add('reveal'); });

        // Fallback for ancient browsers: show everything immediately.
        if (!('IntersectionObserver' in window)) {
            targets.forEach(function (el) { el.classList.add('is-visible'); });
            return;
        }

        const io = new IntersectionObserver(function (entries, observer) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

        targets.forEach(function (el) { io.observe(el); });
    }

    /* --------------------------------------------------------
     * DOM ready helper
     * -------------------------------------------------------- */
    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    onReady(function () {
        initHeroVideo();
        initReveal();
    });

})();
