'use strict';

(function () {
  function addNavLink() {
    const nav = document.querySelector('.resident-nav .nav-links, .community-topbar-links');
    if (!nav || nav.querySelector('[data-feedback-link]')) return;
    nav.insertAdjacentHTML('beforeend', '<a data-feedback-link href="/feedback.html">Feedback</a>');
  }

  function addResultLink() {
    const report = document.querySelector('#resident-action-report');
    if (!report || report.querySelector('.detailed-feedback-link')) return;
    const city = encodeURIComponent(document.querySelector('#city')?.value || '');
    report.insertAdjacentHTML('beforeend', `<div class="detailed-feedback-link"><div><strong>Something look wrong or confusing?</strong><span>Send detailed feedback about this result.</span></div><a class="small-link-button" href="/feedback.html?from=water-result&city=${city}">Tell us more →</a></div>`);
  }

  function init() {
    addNavLink();
    addResultLink();
    const observer = new MutationObserver(() => { addNavLink(); addResultLink(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
