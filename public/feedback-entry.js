'use strict';

(function () {
  const isSpanish = () => localStorage.getItem('water_lang') === 'es' || document.documentElement.lang === 'es';
  const t = (en, es) => isSpanish() ? es : en;

  function addNavLink() {
    const nav = document.querySelector('.resident-nav .nav-links, .community-topbar-links');
    if (!nav || nav.querySelector('[data-feedback-link]')) return;
    nav.insertAdjacentHTML('beforeend', `<a data-feedback-link href="/feedback.html">${t('Feedback', 'Comentarios')}</a>`);
  }

  function addResultLink() {
    const report = document.querySelector('#resident-action-report');
    if (!report || report.querySelector('.detailed-feedback-link')) return;
    const city = encodeURIComponent(document.querySelector('#city')?.value || '');
    report.insertAdjacentHTML('beforeend', `<div class="detailed-feedback-link"><div><strong>${t('Something look wrong or confusing?', '¿Algo parece incorrecto o confuso?')}</strong><span>${t('Send detailed feedback about this result.', 'Envíe comentarios detallados sobre este resultado.')}</span></div><a class="small-link-button" href="/feedback.html?from=water-result&city=${city}">${t('Tell us more', 'Cuéntenos más')} →</a></div>`);
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
