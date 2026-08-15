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
  let decorating = false;
  const originalFetch = window.fetch.bind(window);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
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

  function detectedReports(data) {
    return reports(data).filter(report => isDetected(latestRecord(report)));
  }

  function activeViolations(data) {
    return data?.federal_data?.sdwis?.violations?.active || [];
  }

  function activeHealthViolations(data) {
    return data?.federal_data?.sdwis?.violations?.active_health_based_or_treatment || [];
  }

  function noticeCount(data) {
    const counts = data?.live_web?.address_evidence?.counts || {};
    return Number(counts.exact_address || 0) + Number(counts.affected_address_range || 0) +
      Number(counts.street || 0) + Number(counts.neighborhood || 0);
  }

  function foreverChemicalConcernCount(data) {
    return Number(data?.local_data?.emerging_contaminants?.compliance_exceedance_count || 0);
  }

  function healthLevel(data) {
    const notices = noticeCount(data);
    const serious = activeHealthViolations(data).length + foreverChemicalConcernCount(data);
    const otherOfficialIssues = activeViolations(data).length;
    const found = detectedReports(data).length;

    if (notices > 0) {
      return {
        number: 4,
        key: 'advisory',
        label: 'Active water alert',
        short: 'Follow the local notice now',
        meaning: 'An official local water notice matched your area. Some alerts can involve bacteria, pressure loss, or another problem that may require immediate precautions until the notice is lifted.',
        longTerm: 'The long-term health meaning depends on what caused the alert. The most important step right now is following the official instructions for your area.',
        next: 'Open the current water-alert page and follow the instructions for your neighborhood.'
      };
    }

    if (serious > 0) {
      return {
        number: 3,
        key: 'concern',
        label: 'Higher health concern',
        short: 'A health-protective limit is involved',
        meaning: 'Current records show a water-quality problem tied to a health-protective limit. The exact health risk depends on which substance is involved and how long exposure continues.',
        longTerm: 'Depending on the substance, repeated exposure can affect brain development, kidneys, liver, the heart and blood vessels, reproduction, or cancer risk. The substance cards below show which effects apply to your results.',
        next: 'Review the substances marked below, then check the serving utility for its latest update and response.'
      };
    }

    if (found > 0 || otherOfficialIssues > 0) {
      return {
        number: 2,
        key: 'monitor',
        label: 'Some findings to watch',
        short: 'Substances were found, but no current health-limit problem is shown',
        meaning: 'One or more substances were found in recent testing. The records checked do not show a current problem tied to a health-protective drinking-water limit.',
        longTerm: 'Finding a substance does not mean it will cause disease. Long-term risk depends on the amount and how long someone is exposed. Each substance below explains the health problems linked with higher or prolonged exposure.',
        next: 'Read the long-term health section under each substance, especially for children, pregnancy, or anyone with a relevant health condition.'
      };
    }

    return {
      number: 1,
      key: 'low',
      label: 'Low current concern',
      short: 'No current health problem is flagged',
      meaning: 'The records checked do not show a current health-limit problem or local water alert.',
      longTerm: 'No specific long-term disease concern is flagged by the current results shown here.',
      next: 'No special action is suggested by the current results. Check again when new local water results or notices are published.'
    };
  }

  const LEVELS = [
    { number: 1, key: 'low', label: 'Low current concern', meaning: 'No current health-limit problem or local alert is shown.' },
    { number: 2, key: 'monitor', label: 'Some findings to watch', meaning: 'Something was found, but no current health-limit problem is shown.' },
    { number: 3, key: 'concern', label: 'Higher health concern', meaning: 'A current result or official issue involves a health-protective limit.' },
    { number: 4, key: 'advisory', label: 'Active water alert', meaning: 'An official local alert matched your area; follow its instructions now.' }
  ];

  const HEALTH_INFO = [
    {
      match: /lead/i,
      name: 'Lead',
      why: 'Lead is especially harmful to the developing brain and nervous system.',
      longTerm: 'Repeated exposure can permanently lower IQ and attention in children and contribute to learning and behavior problems. In adults, lead exposure is linked with high blood pressure, kidney damage, and reproductive problems.',
      sensitive: 'Most sensitive: babies, young children, and pregnancy.'
    },
    {
      match: /arsenic/i,
      name: 'Arsenic',
      why: 'Arsenic can affect the skin, nerves, blood vessels, and several organs when exposure continues for years.',
      longTerm: 'Long-term exposure has been associated with cardiovascular disease and type 2 diabetes, and it can raise the risk of skin, lung, and bladder cancers. Nerve damage and characteristic skin changes can also occur.',
      sensitive: 'Concern rises with repeated exposure over months to years.'
    },
    {
      match: /pfoa|pfos|pfas|perfluoro|polyfluoro|pfhx|pfna|pfbs|genx/i,
      name: 'PFAS “forever chemicals”',
      why: 'Some PFAS can remain in the body for years and build up with repeated exposure.',
      longTerm: 'Studies link certain PFAS with higher cholesterol, liver and immune-system effects, pregnancy and developmental effects, and increased risk of some cancers, including kidney and testicular cancer. Effects differ by the specific PFAS.',
      sensitive: 'Most sensitive: pregnancy, babies, and children.'
    },
    {
      match: /nitrate|nitrite/i,
      name: 'Nitrate / nitrite',
      why: 'The clearest drinking-water danger is reduced oxygen delivery in very young infants.',
      longTerm: 'The best-established serious effect is “blue baby syndrome,” in which the blood cannot carry enough oxygen. It can become life-threatening in infants under 6 months. This is primarily an immediate infant risk rather than a well-established chronic disease effect.',
      sensitive: 'Most sensitive: infants under 6 months, especially formula-fed infants.'
    },
    {
      match: /copper/i,
      name: 'Copper',
      why: 'Too much copper can irritate the stomach and, with prolonged high exposure, affect major organs.',
      longTerm: 'Long-term exposure above drinking-water limits can damage the liver or kidneys. Shorter-term high exposure can cause nausea, vomiting, diarrhea, and stomach pain.',
      sensitive: 'People with Wilson disease are especially sensitive to copper.'
    },
    {
      match: /cadmium/i,
      name: 'Cadmium',
      why: 'Cadmium builds up slowly in the body, especially in the kidneys.',
      longTerm: 'Repeated lower-level exposure can lead to kidney disease and make bones more fragile. Cadmium is also classified as a human carcinogen, although drinking-water standards focus strongly on kidney damage.',
      sensitive: 'Long-term exposure is the main concern because cadmium leaves the body slowly.'
    },
    {
      match: /mercury/i,
      name: 'Mercury',
      why: 'Inorganic mercury in drinking water is mainly a kidney concern at high levels.',
      longTerm: 'Long-term exposure above the drinking-water limit can damage the kidneys. Other forms of mercury can also harm the nervous system, but drinking-water rules for inorganic mercury focus on kidney damage.',
      sensitive: 'Risk depends strongly on the form of mercury and the amount of exposure.'
    },
    {
      match: /uranium/i,
      name: 'Uranium',
      why: 'Uranium can damage the kidneys and also adds radiation exposure.',
      longTerm: 'Long-term exposure above the drinking-water limit can increase cancer risk and cause kidney toxicity.',
      sensitive: 'Repeated exposure over years is the main concern.'
    },
    {
      match: /radium|gross alpha|alpha particle|beta particle|photon|radio/i,
      name: 'Radioactive material',
      why: 'Radioactive substances can expose body tissues to ionizing radiation.',
      longTerm: 'Long-term exposure above drinking-water limits can increase cancer risk. The exact risk depends on which radioactive substance is present and the amount of exposure.',
      sensitive: 'Long duration of exposure matters most.'
    },
    {
      match: /trihalomethane|tthm|haloacetic|haa5|haa/i,
      name: 'Disinfection byproducts',
      why: 'These chemicals can form when disinfectants react with natural material in water.',
      longTerm: 'Long-term exposure above drinking-water limits can increase cancer risk. Some trihalomethanes are also linked with liver, kidney, or nervous-system problems at high exposure.',
      sensitive: 'Long-term exposure above the limit is the main concern.'
    },
    {
      match: /bromate/i,
      name: 'Bromate',
      why: 'Bromate can form during certain water-disinfection processes.',
      longTerm: 'Long-term exposure above the drinking-water limit is associated with increased cancer risk.',
      sensitive: 'Long-term exposure is the main concern.'
    },
    {
      match: /chlorite/i,
      name: 'Chlorite',
      why: 'Too much chlorite can affect red blood cells and the developing nervous system.',
      longTerm: 'High exposure can contribute to anemia. Infants and young children can also be vulnerable to nervous-system effects.',
      sensitive: 'Most sensitive: infants and young children.'
    },
    {
      match: /chloramine/i,
      name: 'Chloramine',
      why: 'Chloramine is used to kill germs in drinking water.',
      longTerm: 'Levels above the allowed amount can cause eye or nose irritation, stomach discomfort, and anemia. It is used because controlling harmful microbes is also important for health.',
      sensitive: 'Effects are more likely when levels are unusually high.'
    },
    {
      match: /chlorine dioxide/i,
      name: 'Chlorine dioxide',
      why: 'This disinfectant can affect red blood cells at high exposure.',
      longTerm: 'Too much exposure can contribute to anemia, and infants and young children can be vulnerable to nervous-system effects.',
      sensitive: 'Most sensitive: infants and young children.'
    },
    {
      match: /chlorine/i,
      name: 'Chlorine',
      why: 'Chlorine is added to kill disease-causing germs.',
      longTerm: 'The main health concern at unusually high levels is irritation of the eyes or nose and stomach discomfort, rather than a specific chronic disease.',
      sensitive: 'Higher-than-normal levels are the main concern.'
    },
    {
      match: /fluoride/i,
      name: 'Fluoride',
      why: 'Fluoride helps prevent tooth decay at appropriate levels, but too much over time can affect teeth and bones.',
      longTerm: 'Long-term exposure above the drinking-water limit can cause bone disease with pain and tenderness. Children can also develop mottling or discoloration of teeth when exposed to too much fluoride while teeth are forming.',
      sensitive: 'Children with developing teeth are especially sensitive to excess fluoride.'
    },
    {
      match: /e\. coli|ecoli|fecal coliform/i,
      name: 'E. coli / fecal bacteria',
      why: 'These bacteria can signal contamination by human or animal waste.',
      longTerm: 'The main danger is infection rather than a years-long buildup. Contaminated water can cause diarrhea, cramps, nausea, vomiting, and other gastrointestinal illness, and some infections can become severe.',
      sensitive: 'Most sensitive: infants, young children, older adults, and people with weakened immune systems.'
    },
    {
      match: /legionella/i,
      name: 'Legionella',
      why: 'Legionella bacteria can cause a serious lung infection.',
      longTerm: 'Exposure can lead to Legionnaires’ disease, a form of pneumonia. This is an infection risk rather than a chemical that accumulates over years.',
      sensitive: 'Higher risk: older adults, smokers, and people with weakened immune systems or chronic lung disease.'
    },
    {
      match: /giardia|cryptosporidium|virus|microb|bacteria|coliform/i,
      name: 'Germs / microorganisms',
      why: 'Disease-causing germs in water can make people sick quickly.',
      longTerm: 'The main concern is gastrointestinal infection, including diarrhea, vomiting, and cramps. The risk is generally immediate rather than a chemical building up in the body over years.',
      sensitive: 'Most sensitive: young children and people with weakened immune systems.'
    },
    {
      match: /turbidity/i,
      name: 'Cloudiness',
      why: 'Cloudy water can be a sign that filtration is not working as well as expected.',
      longTerm: 'Cloudiness itself is not usually the disease-causing agent, but high cloudiness can be associated with viruses, parasites, or bacteria that cause nausea, cramps, diarrhea, and headaches.',
      sensitive: 'The health concern comes from possible germs carried with the particles.'
    },
    {
      match: /benzene/i,
      name: 'Benzene',
      why: 'Benzene can damage the blood-forming system.',
      longTerm: 'Long-term exposure above the drinking-water limit can cause anemia, lower blood platelets, and increased cancer risk.',
      sensitive: 'Long-term exposure is the main concern.'
    },
    {
      match: /trichloroethylene|\btce\b/i,
      name: 'Trichloroethylene',
      why: 'This industrial solvent can affect the liver and has cancer concerns.',
      longTerm: 'Long-term exposure above the drinking-water limit can cause liver problems and increase cancer risk.',
      sensitive: 'Long-term exposure is the main concern.'
    },
    {
      match: /tetrachloroethylene|perchloroethylene|\bpce\b/i,
      name: 'Tetrachloroethylene',
      why: 'This solvent can affect the liver and has cancer concerns.',
      longTerm: 'Long-term exposure above the drinking-water limit can cause liver problems and increase cancer risk.',
      sensitive: 'Long-term exposure is the main concern.'
    },
    {
      match: /vinyl chloride/i,
      name: 'Vinyl chloride',
      why: 'Vinyl chloride is a known cancer concern when exposure is high enough.',
      longTerm: 'Long-term exposure above the drinking-water limit increases cancer risk.',
      sensitive: 'Long-term exposure is the main concern.'
    },
    {
      match: /barium/i,
      name: 'Barium',
      why: 'Too much barium can affect blood pressure.',
      longTerm: 'Long-term exposure above the drinking-water limit can increase blood pressure.',
      sensitive: 'People with cardiovascular disease may be especially interested in this result.'
    },
    {
      match: /selenium/i,
      name: 'Selenium',
      why: 'Selenium is needed in tiny amounts, but too much can become harmful.',
      longTerm: 'Long-term high exposure can cause hair or fingernail loss, numbness in fingers or toes, and circulation problems.',
      sensitive: 'Long-term high exposure is the main concern.'
    },
    {
      match: /thallium/i,
      name: 'Thallium',
      why: 'Thallium can affect several organs even at relatively low drinking-water limits.',
      longTerm: 'Long-term high exposure can cause hair loss, changes in the blood, and kidney, intestinal, or liver problems.',
      sensitive: 'Repeated exposure is the main concern.'
    },
    {
      match: /cyanide/i,
      name: 'Cyanide',
      why: 'Cyanide interferes with normal cell function.',
      longTerm: 'Long-term exposure above the drinking-water limit can cause nerve damage or thyroid problems.',
      sensitive: 'Higher exposure can become dangerous quickly.'
    },
    {
      match: /chromium/i,
      name: 'Chromium',
      why: 'Health effects depend on the form of chromium and the amount present.',
      longTerm: 'The federal drinking-water standard for total chromium is intended to prevent health effects; long-term high exposure can cause skin reactions such as allergic dermatitis.',
      sensitive: 'The specific form of chromium matters.'
    },
    {
      match: /1,?4[- ]?dioxane/i,
      name: '1,4-dioxane',
      why: '1,4-dioxane is an industrial chemical that can contaminate drinking-water sources.',
      longTerm: 'Federal health reviews identify liver toxicity and cancer as concerns from drinking-water exposure. Cancer risk is the major long-term concern considered in federal risk assessments.',
      sensitive: 'Long-term repeated exposure is the main concern.'
    }
  ];

  function healthInfo(name) {
    const raw = String(name || '');
    return HEALTH_INFO.find(item => item.match.test(raw)) || {
      name: plainName(raw),
      why: 'Whether this substance matters for health depends on how much is present and how long exposure continues.',
      longTerm: 'Long-term health effects are substance-specific. Higher exposure over time can affect organs or increase chronic disease risk for some drinking-water contaminants.',
      sensitive: 'Check the amount shown and any official local notice for this substance.'
    };
  }

  function plainName(name) {
    const n = String(name || '').trim();
    if (/pfoa/i.test(n)) return 'PFOA — a PFAS “forever chemical”';
    if (/pfos/i.test(n)) return 'PFOS — a PFAS “forever chemical”';
    if (/pfhx|pfna|pfbs|genx|perfluoro|polyfluoro/i.test(n)) return 'PFAS “forever chemical”';
    if (/total trihalometh|tthm/i.test(n)) return 'Disinfection byproducts';
    if (/haloacetic|haa5/i.test(n)) return 'Disinfection byproducts';
    if (/gross alpha/i.test(n)) return 'Radioactive material';
    if (/total coliform/i.test(n)) return 'Bacteria indicator';
    return n
      .replace(/\([^)]*code[^)]*\)/gi, '')
      .replace(/\b(analyte|parameter)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Water substance';
  }

  function plainUnit(unit) {
    const u = String(unit || '').trim().toLowerCase().replace(/μ/g, 'µ');
    if (!u) return '';
    if (/ng\/?l|ppt/.test(u)) return 'parts per trillion';
    if (/µg\/?l|ug\/?l|mcg\/?l|ppb/.test(u)) return 'parts per billion';
    if (/mg\/?l|ppm/.test(u)) return 'parts per million';
    if (/pci\/?l/.test(u)) return 'radioactivity units';
    return unit;
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

  function localHealthHighlights(data) {
    const cards = [];
    const forever = data?.local_data?.emerging_contaminants;
    if (forever?.synced && Number(forever.detection_count || 0) > 0) {
      const above = Number(forever.compliance_exceedance_count || 0);
      cards.push(`<article class="local-health-card ${above ? 'attention' : ''}">
        <span class="fact-label">PFAS “forever chemicals”</span>
        <strong>${above ? 'A result is above a federal drinking-water limit' : 'Found in local monitoring'}</strong>
        <p>${esc(healthInfo('PFAS').longTerm)}</p>
      </article>`);
    }

    const wells = data?.local_data?.private_well_context;
    if (wells?.synced && Number(wells.nearby_dioxane_detections || 0) > 0) {
      cards.push(`<article class="local-health-card attention">
        <span class="fact-label">Nearby private-well study</span>
        <strong>1,4-dioxane was found nearby</strong>
        <p>${esc(healthInfo('1,4-dioxane').longTerm)}</p>
      </article>`);
    }

    return cards.length ? `<div class="local-health-highlights"><h3>Other local health findings</h3><div>${cards.join('')}</div></div>` : '';
  }

  function buildPanel(data) {
    const provider = cleanName(data?.provider?.system?.name || data?.provider?.system?.system_name);
    const level = healthLevel(data);
    const found = detectedReports(data).length;
    const serious = activeHealthViolations(data).length + foreverChemicalConcernCount(data);
    const notices = noticeCount(data);

    return `<section id="resident-action-report" class="resident-action-report level-${esc(level.key)}" data-lookup-key="${esc(latestLookupKey)}" aria-labelledby="resident-action-title">
      <div class="resident-action-head">
        <div>
          <p class="section-kicker">YOUR WATER HEALTH SUMMARY</p>
          <h2 id="resident-action-title">Level ${level.number}: ${esc(level.label)}</h2>
          <p class="health-level-short">${esc(level.short)}</p>
        </div>
        <span class="resident-action-badge level-${esc(level.key)}">Level ${level.number}</span>
      </div>

      <div class="resident-facts resident-facts-health">
        <article><span class="fact-label">Your water provider</span><strong>${esc(provider)}</strong></article>
        <article><span class="fact-label">Substances found</span><strong>${found}</strong><span class="fact-detail">in the recent results shown</span></article>
        <article><span class="fact-label">Current health concerns</span><strong>${serious}</strong><span class="fact-detail">results or official issues tied to a health limit</span></article>
        <article><span class="fact-label">Local water alerts</span><strong>${notices}</strong><span class="fact-detail">current area notices matched</span></article>
      </div>

      <div class="health-meaning-box level-${esc(level.key)}">
        <span class="fact-label">What this means now</span>
        <h3>${esc(level.meaning)}</h3>
      </div>

      <div class="long-term-summary level-${esc(level.key)}">
        <span class="fact-label">What this could mean long term</span>
        <p>${esc(level.longTerm)}</p>
      </div>

      <div class="resident-next-step level-${esc(level.key)}">
        <span class="next-step-icon" aria-hidden="true">${level.number >= 3 ? '!' : level.number === 2 ? 'i' : '✓'}</span>
        <div><span class="fact-label">What to do</span><p>${esc(level.next)}</p></div>
      </div>

      ${localHealthHighlights(data)}

      <div class="health-guide-wrap">
        <div class="official-resources-heading">
          <h3>What the four levels mean</h3>
          <p>The level rises when the records show stronger evidence of a current health concern or an active local water alert.</p>
        </div>
        ${buildLevelGuide(level)}
      </div>

      <div class="official-resources-wrap">
        <div class="official-resources-heading">
          <h3>Local help and official updates</h3>
          <p>Check current water alerts, local testing resources, and Seminole County information.</p>
        </div>
        <div class="official-resources-grid">
          ${resourceCard(OFFICIAL_RESOURCES.advisories, 'CURRENT ALERTS', 'Current water alerts', 'See official local instructions for boil-water or other water notices.')}
          ${resourceCard(OFFICIAL_RESOURCES.labs, 'WATER TESTING', 'Local approved water labs', 'Find laboratories listed by the Florida Department of Health.')}
          ${resourceCard(OFFICIAL_RESOURCES.dioxane, 'LOCAL WATER ISSUE', '1,4-dioxane in Seminole County', 'See county information and published local results.')}
        </div>
      </div>
    </section>`;
  }

  function simplifyBaseReport(out, data) {
    out.querySelectorAll('.plain-language-note, .dioxane-note, .local-panel, .notice-banner, .alerts-section, .overall-card').forEach(node => node.remove());
    out.querySelectorAll('.section-note').forEach(node => node.remove());

    const header = out.querySelector('.report-header');
    if (header) {
      const found = detectedReports(data).length;
      const label = header.querySelector('.system-label');
      const title = header.querySelector('h2');
      if (label) label.textContent = 'YOUR WATER RESULTS';
      if (title) title.textContent = found ? `${found} substance${found === 1 ? '' : 's'} found in recent testing` : 'Recent water testing results';
      const stats = [...header.querySelectorAll('.quick-stats > div')];
      const labels = ['Tests shown', 'Things found', 'Current official concerns'];
      stats.forEach((item, index) => {
        const span = item.querySelector('span');
        if (span && labels[index]) span.textContent = labels[index];
      });
    }

    const detectedSection = out.querySelector('.results-section:not(.compact-section)');
    if (detectedSection) {
      const kicker = detectedSection.querySelector('.section-kicker');
      const h2 = detectedSection.querySelector('h2');
      if (kicker) kicker.textContent = 'WHAT WAS FOUND';
      if (h2) h2.textContent = 'What was found in testing';
    }

    const compact = out.querySelector('.compact-section');
    if (compact) {
      const h2 = compact.querySelector('h2');
      const p = compact.querySelector('p');
      if (h2) h2.textContent = 'No substances were found in the results shown';
      if (p) p.textContent = 'The recent results shown here were reported as not found or zero.';
    }

    const otherSummary = out.querySelector('.other-results > summary');
    if (otherSummary) otherSummary.textContent = 'See other substances that were tested';

    const source = out.querySelector('.data-source-footer');
    if (source) source.textContent = 'Public water and health information translated into plain language.';
  }

  function simplifyResultCards(out) {
    out.querySelectorAll('.result-card').forEach(card => {
      const heading = card.querySelector('h3');
      if (!heading) return;
      const originalName = heading.dataset.originalName || heading.textContent;
      heading.dataset.originalName = originalName;
      const info = healthInfo(originalName);
      heading.textContent = info.name || plainName(originalName);

      const pill = card.querySelector('.result-pill');
      if (pill) {
        if (pill.classList.contains('detected')) pill.textContent = 'Found';
        else if (pill.classList.contains('not-detected')) pill.textContent = 'Not found';
        else pill.textContent = 'Result listed';
      }

      const value = card.querySelector('.result-value');
      const unit = value?.querySelector('span');
      if (unit) unit.textContent = plainUnit(unit.textContent);

      const date = card.querySelector('.result-date');
      if (date) date.textContent = date.textContent.replace('Latest listed sample:', 'Last tested:');

      const old = card.querySelector('.result-health-meaning');
      if (old) old.remove();
      card.insertAdjacentHTML('beforeend', `<div class="result-health-meaning">
        <div><span>Why it matters</span><p>${esc(info.why)}</p></div>
        <div><span>Possible long-term health effects</span><p>${esc(info.longTerm)}</p></div>
        <div><span>Who should pay closest attention</span><p>${esc(info.sensitive)}</p></div>
      </div>`);
    });
  }

  function decorate() {
    if (decorating) return;
    const out = document.querySelector('#out');
    if (!out || !latestLookup || !latestLookupKey || !out.querySelector('.report-header')) return;

    decorating = true;
    try {
      simplifyBaseReport(out, latestLookup);
      simplifyResultCards(out);

      const existing = out.querySelector('#resident-action-report');
      if (!existing || lastRenderedKey !== latestLookupKey) {
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
    } finally {
      decorating = false;
    }
  }

  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    const request = args[0];
    const url = typeof request === 'string' ? request : request?.url || '';

    if (String(url).includes(LOOKUP_PATH)) {
      response.clone().json().then(data => {
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
      if (latestLookupKey && out.querySelector('.report-header')) window.setTimeout(decorate, 0);
    });
    observer.observe(out, { childList: true, subtree: true });
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
