/* figma-animations.js — Mychat v9 Professional Micro-interactions */
'use strict';

window.FigmaStudio = (() => {
  const init = () => {
    // Stagger feed on load
    const feed = document.getElementById('chat-feed');
    if (feed) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1 && node.classList.contains('bubble')) {
              node.style.opacity = '0';
              node.animate([
                { transform: 'translateY(10px)', opacity: 0 },
                { transform: 'translateY(0)', opacity: 1 }
              ], {
                duration: 400,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'forwards'
              });
            }
          });
        });
      });
      observer.observe(feed, { childList: true });
    }

    // Input focus ring animation
    document.querySelectorAll('.input-field').forEach(input => {
      input.addEventListener('focus', () => {
        input.parentElement?.classList.add('focused');
      });
      input.addEventListener('blur', () => {
        input.parentElement?.classList.remove('focused');
      });
    });
  };

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  window.FigmaStudio.init();
});
