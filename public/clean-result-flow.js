'use strict';

(function () {
  const out = document.getElementById('out');
  if (!out) return;

  let cleaning = false;

  function text(node) {
    return String(node?.textContent || '').trim();
  }

  function removeDuplicateFact(report, labelText) {
    report?.querySelectorAll('.resident-facts article').forEach(article => {
      const label = text(article.querySelector('.fact-label')).toLowerCase();
      if (label === labelText.toLowerCase()) article.remove();
    });
  }

  function compactHealthSummary(report) {
    if (!report) return;
    report.classList.add('clean-health-summary');

    const kicker = report.querySelector('.resident-action-head .section-kicker');
    if (kicker) kicker.textContent = 'WHAT THIS MEANS';

    const title = report.querySelector('#resident-action-title');
    if (title) title.textContent = title.textContent.replace(/^Level\s+\d+\s*:\s*/i, '');

    report.querySelector('.resident-action-badge')?.remove();
    removeDuplicateFact(report, 'Substances found');

    const meaningLabel = report.querySelector('.health-meaning-box .fact-label');
    if (meaningLabel) meaningLabel.textContent = 'What it means';

    const nextLabel = report.querySelector('.resident-next-step .fact-label');
    if (nextLabel) nextLabel.textContent = 'What to do next';

    const longTerm = report.querySelector('.long-term-summary');
    if (longTerm && !report.querySelector('.clean-long-term-details')) {
      const detail = document.createElement('details');
      detail.className = 'clean-long-term-details';
      const summary = document.createElement('summary');
      summary.textContent = 'Long-term health information';
      const body = document.createElement('div');
      body.className = 'clean-long-term-body';
      while (longTerm.firstChild) body.appendChild(longTerm.firstChild);
      detail.append(summary, body);
      longTerm.replaceWith(detail);
    }

    // These remain available in the roadmap below, so do not duplicate them inside the core result.
    report.querySelector('.health-guide-wrap')?.remove();
    report.querySelector('.official-resources-wrap')?.remove();

    const local = report.querySelector('.local-health-highlights');
    if (local && !local.closest('details')) {
      const detail = document.createElement('details');
      detail.className = 'clean-local-details';
      const summary = document.createElement('summary');
      summary.textContent = 'More local health context';
      local.replaceWith(detail);
      detail.append(summary, local);
    }
  }

  function addLocationLine(section, header, report) {
    if (!section || section.querySelector('.clean-result-location')) return;
    const matched = text(header?.querySelector('.matched-address'));
    const provider = text(report?.querySelector('.resident-facts article strong'));
    if (!matched && !provider) return;

    const line = document.createElement('p');
    line.className = 'clean-result-location';
    line.textContent = [matched, provider].filter(Boolean).join(' · ');
    const heading = section.querySelector('.section-heading');
    if (heading) heading.after(line);
    else section.prepend(line);
  }

  function ensureSecondaryHeading() {
    const roadmap = document.getElementById('roadmap-home');
    if (!roadmap || document.getElementById('more-water-tools-heading')) return;
    const heading = document.createElement('div');
    heading.id = 'more-water-tools-heading';
    heading.className = 'clean-secondary-heading';
    heading.innerHTML = '<p>MORE WATER TOOLS</p><h2>Need something beyond your result?</h2><span>Local alerts, private-well help, city information, labs, and issue guides are below.</span>';
    roadmap.before(heading);
  }

  function cleanReport() {
    if (cleaning) return;
    const resultSection = out.querySelector('.results-section:not(.compact-section)') || out.querySelector('.results-section.compact-section');
    const report = out.querySelector('#resident-action-report');
    const header = out.querySelector('.report-header');
    if (!resultSection || !report) return;

    cleaning = true;
    try {
      resultSection.classList.add('primary-findings');
      const kicker = resultSection.querySelector('.section-kicker');
      if (kicker) kicker.textContent = 'WHAT WAS FOUND';
      else if (!resultSection.querySelector('.clean-kicker')) {
        resultSection.insertAdjacentHTML('afterbegin', '<p class="section-kicker clean-kicker">WHAT WAS FOUND</p>');
      }

      const heading = resultSection.querySelector('h2');
      if (heading && resultSection.classList.contains('compact-section')) heading.textContent = 'Nothing was found in the recent results shown';
      else if (heading) heading.textContent = 'What was found in recent testing';

      addLocationLine(resultSection, header, report);

      // The findings are always the first visible content after the address form.
      if (out.firstElementChild !== resultSection) out.prepend(resultSection);

      compactHealthSummary(report);
      if (resultSection.nextElementSibling !== report) resultSection.after(report);

      const other = out.querySelector('.other-results');
      if (other && report.nextElementSibling !== other) report.after(other);

      if (header) header.classList.add('clean-hidden-context');
      out.querySelectorAll('.overall-card, .notice-banner, .alerts-section, .plain-language-note, .dioxane-note, .local-panel').forEach(node => node.remove());

      // The old binary prompt and signup advertisement distract from the result.
      out.querySelector('.lookup-feedback')?.remove();
      out.querySelector('.account-cta')?.remove();

      ensureSecondaryHeading();
    } finally {
      cleaning = false;
    }
  }

  const observer = new MutationObserver(() => window.setTimeout(cleanReport, 0));
  observer.observe(out, { childList: true, subtree: true });

  const pageObserver = new MutationObserver(ensureSecondaryHeading);
  pageObserver.observe(document.querySelector('main') || document.body, { childList: true, subtree: false });

  cleanReport();
  ensureSecondaryHeading();
})();
