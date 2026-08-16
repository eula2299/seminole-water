'use strict';

(function () {
  const out = document.getElementById('out');
  const form = document.getElementById('form');
  const explainer = document.querySelector('.how-it-helps');
  if (!out || !form) return;

  let pendingLookup = false;
  let scrolledForLookup = false;

  function keepResultsFirst() {
    const roadmap = document.getElementById('roadmap-home');
    if (!roadmap) return;

    // The roadmap script historically inserts this block before #out.
    // Keep address results immediately below the search and move all
    // educational/discovery content underneath the result instead.
    if (explainer) {
      if (explainer.nextElementSibling !== roadmap) explainer.after(roadmap);
    } else if (out.nextElementSibling !== roadmap) {
      out.after(roadmap);
    }
  }

  function hasFinishedResult() {
    return !!(
      out.querySelector('.report-header') ||
      out.querySelector('#resident-action-report') ||
      out.querySelector('.resident-action-report')
    );
  }

  function revealFinishedResult() {
    keepResultsFirst();
    if (!pendingLookup || scrolledForLookup || !hasFinishedResult()) return;

    scrolledForLookup = true;
    pendingLookup = false;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      out.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      out.focus({ preventScroll: true });
    });
  }

  out.setAttribute('tabindex', '-1');
  out.setAttribute('aria-label', 'Your water results');

  form.addEventListener('submit', () => {
    pendingLookup = true;
    scrolledForLookup = false;
    keepResultsFirst();
  });

  const observer = new MutationObserver(revealFinishedResult);
  observer.observe(out, { childList: true, subtree: true });

  // roadmap.js may insert its large homepage block after this script begins.
  const pageObserver = new MutationObserver(keepResultsFirst);
  pageObserver.observe(document.querySelector('main') || document.body, { childList: true, subtree: false });

  keepResultsFirst();
})();
