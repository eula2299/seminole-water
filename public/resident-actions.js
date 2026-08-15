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

  function numberValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const match = String(value ?? '').trim().match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
    return match ? Number(match[0]) : null;
  }

  function latestRecord(report) {
    return report?.latest?.record || report?.latest || null;
  }

  function isDetected(record = {}) {
    if (record.detected === true) return true;
    if (record.detected === false) return false;
    const raw = String(record.result ?? '').trim();
    if (/^(<|ND|NON[- ]?DETECT)/i.test(raw)) return false;
    const numeric = numberValue(raw);
    return numeric !== null && numeric > 0;
  }

  function reports(data) {
    return (data?.analyte_reports || data?.metal_reports || []).filter(report => latestRecord(report));
  }

  function detectedCount(data) {
    return reports(data).filter(report => isDetected(latestRecord(report))).length;
  }

  function activeViolations(data) {
    return data?.federal_data?.sdwis?.violations?.active || [];
  }

  function activeHealthViolations(data) {
    return data?.federal_data?.sdwis?.violations?.active_health_based_or_treatment || [];
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

  function healthLevel(data) {
    const notices = noticeCount(data);
    const healthViolations = activeHealthViolations(data).length;
    const pfas = pfasExceedanceCount(data);
    const allViolations = activeViolations(data).length;
    const detections = detectedCount(data);

    if (notices > 0) {
      return {
        number: 4,
        key: 'advisory',
        label: 'Official advisory',
        short: 'Take action now',
        meaning: 'A local water notice matched this address, street, or neighborhood. Follow the official notice now because residents may need immediate protective steps.',
        next: 'Open the official boil-water and water-notice page and follow the instructions for your area.'
      };
    }

    if (healthViolations > 0 || pfas > 0) {
      return {
        number: 3,
        key: 'concern',
        label: 'Health concern',
        short: 'Elevated concern',
        meaning: 'A health-based or treatment violation, or a PFAS result at or above an EPA limit, appears in the current records. Continued exposure above drinking-water standards can increase health risk depending on the contaminant.',
        next: 'Review the flagged contaminant or compliance item and check the serving utility for the latest corrective action or notice.'
      };
    }

    if (detections > 0 || allViolations > 0) {
      return {
        number: 2,
        key: 'monitor',
        label: 'Monitor',
        short: 'Some findings to review',
        meaning: 'One or more contaminants were detected, or a non-health compliance item is active, but no current health-based violation was identified in the records checked. Detections within drinking-water standards are generally not treated as a regulatory health violation.',
        next: 'Review the detected substances below, especially any that matter to children, pregnancy, or long-term exposure.'
      };
    }

    return {
      number: 1,
      key: 'low',
      label: 'Low concern',
      short: 'No current health flag',
      meaning: 'No active health-based violation, PFAS limit exceedance, or local advisory was identified in the records checked. Based on current utility monitoring, the health concern level is low.',
      next: 'No special action is indicated by the current records. Keep an eye on future utility reports and local notices.'
    };
  }

  const LEVELS = [
    {
      number: 1,
      key: 'low',
      label: 'Low concern',
      meaning: 'No current health-based violation or local advisory is identified.'
    },
    {
      number: 2,
      key: 'monitor',
      label: 'Monitor',
      meaning: 'Contaminants are detected or another compliance item exists, but no current health-based violation is identified.'
    },
    {
      number: 3,
      key: 'concern',
      label: 'Health concern',
      meaning: 'A health-based violation or an EPA-limit exceedance is present; continued exposure may increase health risk.'
    },
    {
      number: 4,
      key: 'advisory',
      label: 'Official advisory',
      meaning: 'A local notice matched; follow official protective instructions now.'
    }
  ];

  function healthMeaning(name) {
    const n = String(name || '').toLowerCase();
    if (/lead/.test(n)) return 'Lead can harm brain development in children and is especially important during pregnancy.';
    if (/arsenic/.test(n)) return 'Long-term elevated arsenic exposure can increase cancer and other chronic health risks.';
    if (/nitrate|nitrite/.test(n)) return 'High nitrate can reduce the blood’s ability to carry oxygen, with infants under 6 months at greatest risk.';
    if (/pfoa|pfos|pfas|perfluoro|polyfluoro/.test(n)) return 'Higher PFAS exposure has been associated with cholesterol, liver, immune, pregnancy, and some cancer outcomes.';
    if (/copper/.test(n)) return 'High copper can cause stomach symptoms, and long-term high exposure can affect the liver or kidneys.';
    if (/mercury/.test(n)) return 'High mercury exposure can affect the nervous system and kidneys.';
    if (/cadmium/.test(n)) return 'Long-term elevated cadmium exposure can damage kidneys and bones and is linked with cancer risk.';
    if (/radium|uranium|gross alpha|radio/.test(n)) return 'Long-term elevated radioactive contaminants can increase cancer risk; uranium can also affect the kidneys.';
    if (/e\. coli|ecoli|coliform|bacteria|microbial/.test(n)) return 'Disease-causing microbes can cause gastrointestinal illness; E. coli can indicate fecal contamination.';
    if (/trihalomethane|tthm|haloacetic|haa5|haa/.test(n)) return 'Long-term exposure above drinking-water standards can increase chronic health risks, including cancer concerns.';
    if (/fluoride/.test(n)) return 'Excess long-term fluoride exposure can affect teeth and, at much higher levels, bones.';
    if (/chlorine/.test(n)) return 'Chlorine protects against microbes; unusually high exposure can irritate the eyes, nose, or stomach.';
    return 'Health significance depends on the contaminant and how its concentration compares with the applicable drinking-water standard.';
  }

  function resourceCard(href, label, title, text) {
    return `<a class="official-resource" href="${href}" target="_blank" rel="noopener noreferrer" data-resource="${esc(label)}">
      <span class="official-resource-label">${esc(label)}</span>
      <strong>${esc(title)}</strong>
      <span>${esc(text)}</span>
      <span class="resource-arrow" aria-hidden="true">↗</span>
    </a>`;
  }

  function buildLevelGuide(current) {
    return `<div class="health-level-guide" aria-label="Water health level guide">
      ${LEVELS.map(level => `<article class="health-level-card level-${level.key}${level.number === current.number ? ' current' : ''}">
        <div class="health-level-top">
          <span class="health-level-number">${level.number}</span>
          <div><strong>${esc(level.label)}</strong>${level.number === current.number ? '<span class="current-level-tag">Your level</span>' : ''}</div>
        </div>
        <p>${esc(level.meaning)}</p>
      </article>`).join('')}
    </div>`;
  }

  function buildPanel(data) {
    const provider = cleanName(data?.provider?.system?.name || data?.provider?.system?.system_name);
    const pwsid = data?.provider?.system?.pwsid || data?.provider?.system?.PWSID || '';
    const level = healthLevel(data);
    const detections = detectedCount(data);
    const healthViolations = activeHealthViolations(data).length;
    const notices = noticeCount(data);

    return `<section id="resident-action-report" class="resident-action-report level-${esc(level.key)}" data-lookup-key="${esc(latestLookupKey)}" aria-labelledby="resident-action-title">
      <div class="resident-action-head">
        <div>
          <p class="section-kicker">YOUR SEMINOLE WATER HEALTH SUMMARY</p>
          <h2 id="resident-action-title">Level ${level.number}: ${esc(level.label)}</h2>
          <p class="health-level-short">${esc(level.short)}</p>
        </div>
        <span class="resident-action-badge level-${esc(level.key)}">Level ${level.number}</span>
      </div>

      <div class="resident-facts resident-facts-health">
        <article>
          <span class="fact-label">Water provider</span>
          <strong>${esc(provider)}</strong>
          ${pwsid ? `<span class="fact-detail">System ${esc(pwsid)}</span>` : ''}
        </article>
        <article>
          <span class="fact-label">Detected substances</span>
          <strong>${detections}</strong>
          <span class="fact-detail">Latest displayed records</span>
        </article>
        <article>
          <span class="fact-label">Health-based flags</span>
          <strong>${healthViolations + pfasExceedanceCount(data)}</strong>
          <span class="fact-detail">Health/treatment violations or PFAS limit exceedances</span>
        </article>
        <article>
          <span class="fact-label">Local advisories</span>
          <strong>${notices}</strong>
          <span class="fact-detail">Address, street, or neighborhood notice matches</span>
        </article>
      </div>

      <div class="health-meaning-box level-${esc(level.key)}">
        <span class="fact-label">What Level ${level.number} means for your health</span>
        <h3>${esc(level.label)}</h3>
        <p>${esc(level.meaning)}</p>
      </div>

      <div class="resident-next-step level-${esc(level.key)}">
        <span class="next-step-icon" aria-hidden="true">${level.number >= 3 ? '!' : level.number === 2 ? 'i' : '✓'}</span>
        <div>
          <span class="fact-label">What to do</span>
          <p>${esc(level.next)}</p>
        </div>
      </div>

      <div class="health-guide-wrap">
        <div class="official-resources-heading">
          <h3>What every level means</h3>
          <p>Higher levels mean stronger evidence of a current drinking-water health concern or official action.</p>
        </div>
        ${buildLevelGuide(level)}
      </div>

      <div class="official-resources-wrap">
        <div class="official-resources-heading">
          <h3>Official local resources</h3>
          <p>Check current notices, certified water-testing resources, and Seminole County 1,4-dioxane information.</p>
        </div>
        <div class="official-resources-grid">
          ${resourceCard(OFFICIAL_RESOURCES.advisories, 'CURRENT NOTICES', 'Boil-water advisories', 'Check Seminole County Utilities notices and official instructions.')}
          ${resourceCard(OFFICIAL_RESOURCES.labs, 'WATER TESTING', 'State-approved water labs', 'Florida Department of Health listings for certified local laboratories.')}
          ${resourceCard(OFFICIAL_RESOURCES.dioxane, 'LOCAL ISSUE', '1,4-dioxane information', 'Seminole County testing results, background, and local information.')}
        </div>
      </div>
    </section>`;
  }

  function removeLimitationMessaging(out) {
    out.querySelectorAll('.plain-language-note, .dioxane-note').forEach(node => node.remove());

    out.querySelectorAll('.section-note').forEach(node => {
      const text = node.textContent.toLowerCase();
      if (
        text.includes("not from this home's faucet") ||
        text.includes('not a household') ||
        text.includes('not household') ||
        text.includes('contextual evidence') ||
        text.includes('not proof') ||
        text.includes('does not represent') ||
        text.includes('cannot')
      ) node.remove();
    });

    out.querySelectorAll('.overall-card p').forEach(node => {
      if (/detection does not automatically mean/i.test(node.textContent)) {
        node.textContent = 'Detected substances are listed below with a plain-language health explanation. Review any active compliance or PFAS flags first.';
      }
    });
  }

  function addHealthMeaningToCards(out) {
    out.querySelectorAll('.result-card').forEach(card => {
      if (card.querySelector('.result-health-meaning')) return;
      const name = card.querySelector('h3')?.textContent || '';
      card.insertAdjacentHTML('beforeend', `<div class="result-health-meaning"><span>Health meaning</span><p>${esc(healthMeaning(name))}</p></div>`);
    });
  }

  function decorate() {
    const out = document.querySelector('#out');
    if (!out || !latestLookup || !latestLookupKey || !out.querySelector('.report-header')) return;

    removeLimitationMessaging(out);
    addHealthMeaningToCards(out);

    const existing = out.querySelector('#resident-action-report');
    if (existing && lastRenderedKey === latestLookupKey) return;
    if (existing) existing.remove();

    const reportHeader = out.querySelector('.report-header');
    reportHeader.insertAdjacentHTML('afterend', buildPanel(latestLookup));
    lastRenderedKey = latestLookupKey;

    if (typeof window.gtag === 'function') {
      const level = healthLevel(latestLookup);
      window.gtag('event', 'resident_health_level_viewed', {
        event_category: 'impact',
        event_label: `Level ${level.number}: ${level.label}`,
        value: level.number
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
