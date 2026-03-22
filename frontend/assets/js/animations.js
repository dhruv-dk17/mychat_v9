/* animations.js — Mychat v9 High-Level Micro-interactions */
'use strict';

window.NanoAnimations = (() => {
  const init = () => {
    observeElements();
    setupMicroInteractions();
  };

  const observeElements = () => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
  };

  const setupMicroInteractions = () => {
    // Button hover effects
    document.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('mousedown', () => btn.style.transform = 'scale(0.95)');
      btn.addEventListener('mouseup', () => btn.style.transform = 'scale(1)');
      btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');
    });

    // Sidebar item hover glow
    document.addEventListener('mouseover', (e) => {
      const item = e.target.closest('.chat-list-item');
      if (item) {
        item.style.boxShadow = 'inset 0 0 10px rgba(247, 255, 0, 0.05)';
      }
    });
    document.addEventListener('mouseout', (e) => {
      const item = e.target.closest('.chat-list-item');
      if (item) {
        item.style.boxShadow = 'none';
      }
    });
  };

  // Stagger messages in feed
  const staggerFeed = (feed) => {
    const bubbles = Array.from(feed.children);
    bubbles.forEach((bubble, i) => {
      bubble.style.animationDelay = `${i * 0.05}s`;
    });
  };

  return { init, staggerFeed };
})();

document.addEventListener('DOMContentLoaded', () => {
  window.NanoAnimations.init();
});
