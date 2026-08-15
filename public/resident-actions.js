'use strict';

(function () {
  const LOOKUP_PATH = '/api/lookup';
  const OFFICIAL_RESOURCES = {
    advisories: 'https://www.seminolecountyfl.gov/departments-services/utilities/water/boil-water-advisories',
    labs: 'https://seminole.floridahealth.gov/programs-and-services/environmental-public-health/state-approved-water-labs/',
    dioxane: 'https://www.seminolecountyfl.gov/departments-services/utilities/utilities-engineering/dioxane'
  };

  let latestLookup = null;
  let latestLookupKey = '';
  let lastRenderedKey = '';
  const originalFetch = window.fetch.bind(window);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function cleanName(name) {
    return String(name || 'Water provider not identified')
      .replace(/,\s*CITY OF/gi, '')
      .replace(/\s+CITY OF/gi, '')
      .replace(/\s*\(\d+\s*WPS\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function activeViolations(data) {
    return data?.federal_data?.sdwis?.violations?.active || [];
  }

  function noticeCount(data) {
    const counts = data?.live_web?.address_evidence?.counts || {};
    return Number(counts.exact_address || 0) +
      Number(counts.affected_address_range || 0) +
      Number(counts.street || 0) +
      Number(counts.neighborhood || 0);
  }

  function pfasExceedanceCount(data) {
    return Number(data?.local_data?.emerging_contaminants?.compliance_exceedance_count || 0);
  }

  function actionSummary(data) {
    const notices = noticeCount(data);
    const violations = activeViolations(data).length;
    const pfas = pfasExceedanceCount(data);

    if (notices > 0) {
      return {
        tone: 'attention',
        title: 'Check the official notice first',
        text: 'A street, neighborhood, or address-level public water notice matched this search. Confirm the notice with the utility and follow its instructions.'
      };
    }

    if (pfas > 0 || violations > 0) {
      return {
        tone: 'attention',
        title: 'Review the flagged system information',
        text: 'This lookup found a compliance or PFAS item that deserves a closer look. Use the details above and confirm the latest status with the serving utility.'
      };
    }

    return {
      tone: 'good',
      title: 'No urgent system-level action is shown',
      text: 'Keep the distinction between the public water system and your individual faucet in mind. Home plumbing can change water after it leaves the utility system.'
    };
  }

  function resourceCard(href, label, title, text) {
    return `<a class="official-resource" href="${href}" target="_blank" rel="noopener noreferrer" data-resource="${esc(label)}">
      <span class="official-resource-label">${esc(label)}</span>
      <strong>${esc(title)}</strong>
      <span>${esc(text)}</span>
      <span class="resource-arrow" aria-hidden="true">↗</span>
    </a>`;
  }

  function buildPanel(data) {
    const provider = cleanName(data?.provider?.system?.name || data?.provider?.system?.system_name);
    const pwsid = data?.provider?.system?.pwsid || data?.provider?.system?.PWSID || '';
    const action = actionSummary(data);

    return `<section id="resident-action-report" class="resident-action-report" data-lookup-key="${esc(latestLookupKey)}" aria-labelledby="resident-action-title">
      <div class="resident-action-head">
        <div>
          <p class="section-kicker">YOUR SEMINOLE WATER ACTION REPORT</p>
          <h2 id="resident-action-title">What this means for you</h2>
        </div>
        <span class="resident-action-badge">Address matched</span>
      </div>

      <div class="resident-facts">
        <article>
          <span class="fact-label">Your water provider</span>
          <strong>${esc(provider)}</strong>
          ${pwsid ? `<span class="fact-detail">Public water system ${esc(pwsid)}</span>` : ''}
        </article>
        <article>
          <span class="fact-label">What this report tells you</span>
          <strong>System-level monitoring</strong>
          <span class="fact-detail">Utility and regulatory records associated with the system serving this area.</span>
        </article>
        <article>
          <span class="fact-label">What it cannot prove</span>
          <strong>Your exact tap water</strong>
          <span class="fact-detail">Service lines, building plumbing, fixtures, and filters can change water before it reaches your faucet.</span>
        </article>
      </div>

      <div class="resident-next-step ${esc(action.tone)}">
        <span class="next-step-icon" aria-hidden="true">${action.tone === 'attention' ? '!' : '✓'}</span>
        <div>
          <span class="fact-label">Your next step</span>
          <h3>${esc(action.title)}</h3>
          <p>${esc(action.text)}</p>
        </div>
      </div>

      <div class="official-resources-wrap">
        <div class="official-resources-heading">
          <h3>Official local resources</h3>
          <p>Use these when you need to verify a notice, learn about local testing, or check Seminole County's 1,4-dioxane information.</p>
        </div>
        <div class="official-resources-grid">
          ${resourceCard(OFFICIAL_RESOURCES.advisories, 'CURRENT NOTICES', 'Boil-water advisories', 'Check Seminole County Utilities notices and official instructions.')}
          ${resourceCard(OFFICIAL_RESOURCES.labs, 'HOME TESTING', 'State-approved water labs', 'See Florida Department of Health listings for certified local laboratories.')}
          ${resourceCard(OFFICIAL_RESOURCES.dioxane, 'LOCAL ISSUE', '1,4-dioxane information', 'See Seminole County testing results, background, and address-oriented information.')}
        </div>
      </div>
    </section>`;
  }

  function decorate() {
    const out = document.querySelector('#out');
    if (!out || !latestLookup || !latestLookupKey || !out.querySelector('.report-header')) return;

    const existing = out.querySelector('#resident-action-report');
    if (existing && lastRenderedKey === latestLookupKey) return;
    if (existing) existing.remove();

    const reportHeader = out.querySelector('.report-header');
    reportHeader.insertAdjacentHTML('afterend', buildPanel(latestLookup));
    lastRenderedKey = latestLookupKey;

    if (typeof window.gtag === 'function') {
      window.gtag('event', 'resident_action_report_viewed', {
        event_category: 'impact',
        event_label: cleanName(latestLookup?.provider?.system?.name)
      });
    }
  }

  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    const request = args[0];
    const url = typeof request === 'string' ? request : request?.url || '';

    if (String(url).includes(LOOKUP_PATH)) {
      const clone = response.clone();
      clone.json().then(data => {
        if (!data || data.error) return;
        latestLookup = data;
        latestLookupKey = JSON.stringify([
          data?.provider?.system?.pwsid || '',
          data?.geocode?.primary?.matchedAddress || data?.geocode?.secondary?.matchedAddress || ''
        ]);
        lastRenderedKey = '';
        window.setTimeout(decorate, 0);
      }).catch(() => {});
    }

    return response;
  };

  const out = document.querySelector('#out');
  if (out) {
    const observer = new MutationObserver(() => {
      if (latestLookupKey && out.querySelector('.report-header')) decorate();
    });
    observer.observe(out, { childList: true });
  }

  document.addEventListener('click', event => {
    const link = event.target.closest?.('.official-resource');
    if (!link || typeof window.gtag !== 'function') return;
    window.gtag('event', 'official_resource_clicked', {
      event_category: 'impact',
      event_label: link.dataset.resource || 'official resource'
    });
  });
})();
