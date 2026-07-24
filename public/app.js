'use strict';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value ?? '').trim().match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
  return match ? Number(match[0]) : null;
}

function recordStatus(record = {}) {
  if (record.detected === true) return 'detected';
  if (record.detected === false) return 'not-detected';
  const raw = String(record.result ?? '').trim();
  if (/^(<|ND|NON[- ]?DETECT)/i.test(raw)) return 'not-detected';
  const numeric = numberValue(raw);
  if (numeric === 0) return 'not-detected';
  if (numeric !== null && numeric > 0) return 'detected';
  return 'reported';
}

function plainDate(value) {
  const raw = String(value || '');
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) return 'Date not listed';
  const [year, month, day] = match[0].split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function cleanName(name) {
  return String(name || 'Unknown water system')
    .replace(/,\s*CITY OF/gi, '')
    .replace(/\s+CITY OF/gi, '')
    .replace(/\s*\(\d+\s*WPS\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function latestRecord(report) {
  return report?.latest?.record || report?.latest || null;
}

function reportName(report) {
  return report?.analyte || report?.metal || 'Unnamed result';
}

function resultCard(report) {
  const record = latestRecord(report);
  if (!record) return '';
  const status = recordStatus(record);
  const statusText = status === 'detected' ? 'Detected' : status === 'not-detected' ? 'Not detected' : 'Reported';
  const value = record.result ?? '—';
  const unit = record.unit || '';
  return `<article class="result-card ${status}">
    <div class="result-card-top">
      <h3>${esc(reportName(report))}</h3>
      <span class="result-pill ${status}">${esc(statusText)}</span>
    </div>
    <p class="result-value">${esc(value)} <span>${esc(unit)}</span></p>
    <p class="result-date">Latest listed sample: ${esc(plainDate(record.sample_date))}</p>
  </article>`;
}

function getActiveViolations(data) {
  return data?.federal_data?.sdwis?.violations?.active || [];
}

function getCcr(data) {
  return data?.federal_data?.ccr?.latest || null;
}

function getAddressNoticeCounts(data) {
  const counts = data?.live_web?.address_evidence?.counts || {};
  return Number(counts.exact_address || 0) + Number(counts.affected_address_range || 0) + Number(counts.street || 0) + Number(counts.neighborhood || 0);
}

function overallMessage({ activeCount, detectedCount, totalCount, pfasExceedances = 0 }) {
  if (pfasExceedances > 0) {
    return {
      tone: 'attention',
      title: 'A PFAS result is at or above the EPA limit',
      text: `${pfasExceedances} PFAS running annual average${pfasExceedances === 1 ? '' : 's'} for this water system met or exceeded the EPA maximum contaminant level in the synchronized records. See the PFAS section below for detail.`
    };
  }
  if (activeCount > 0) {
    return {
      tone: 'attention',
      title: 'Active compliance items found',
      text: `${activeCount} active EPA compliance item${activeCount === 1 ? '' : 's'} appeared in the synchronized records. See the detail below before relying on this summary.`
    };
  }
  if (totalCount === 0) {
    return {
      tone: 'unknown',
      title: 'No recent contaminant results were attached',
      text: 'The address was matched to a water system, but this local data bundle did not contain a result to display.'
    };
  }
  if (detectedCount > 0) {
    return {
      tone: 'neutral',
      title: 'No active EPA violations found',
      text: `${detectedCount} substance${detectedCount === 1 ? ' was' : 's were'} detected in the latest displayed system samples. A detection does not automatically mean the water violates a health standard.`
    };
  }
  return {
    tone: 'good',
    title: 'No active EPA violations found',
    text: 'The latest displayed system samples were reported as non-detects or zero values.'
  };
}

// ---- Local Seminole data: PFAS, private wells, telemetry ------------------
// Safety rule: a panel that has not been synchronized must never read as
// "clean". Missing data and a confirmed absence of findings are shown
// differently, because a false all-clear is the dangerous failure mode.

function localBlocks(data) {
  const local = data?.local_data || {};
  return {
    pfas: local.emerging_contaminants || null,
    wells: local.private_well_context || null,
    telemetry: local.local_telemetry || null
  };
}

function pendingPanel(kicker, title, what) {
  return `<section class="local-panel pending">
    <div class="section-heading">
      <div><p class="section-kicker">${esc(kicker)}</p><h2>${esc(title)}</h2></div>
      <span class="pending-badge">Not loaded</span>
    </div>
    <p class="section-note">${esc(what)} has not been downloaded onto this server yet, so there is nothing to show. This is <strong>not</strong> a finding that the water is clean &mdash; it means the data is missing.</p>
  </section>`;
}

function pfasPanel(pfas) {
  if (!pfas) return '';
  if (!pfas.synced) {
    return pendingPanel('PFAS AND EMERGING CONTAMINANTS', 'PFAS results', 'PFAS monitoring data (EPA UCMR 5, Florida DEP, and Water Quality Portal)');
  }
  const compliance = pfas.compliance_exceedances || [];
  const above = pfas.above_benchmark || [];
  const hi = pfas.hazard_index;
  const rows = (compliance.length ? compliance : above).slice(0, 12).map(item => {
    const name = esc(item.analyte || item.canonical_analyte || item.characteristic_name || 'PFAS compound');
    const value = item.running_annual_average_ng_L ?? item.value_ng_L;
    const label = item.running_annual_average_ng_L !== undefined ? 'annual average' : 'single sample';
    const flag = /rescission/.test(String(item.rule_status || '')) ? ' <em>(limit proposed for rescission)</em>' : '';
    return `<div class="alert-row">
      <strong>${name}</strong>
      <span>${esc(value)} ng/L ${esc(label)} &middot; limit ${esc(item.mcl_ng_L)} ng/L${flag}</span>
    </div>`;
  }).join('');
  const tone = compliance.length ? 'attention' : (above.length || pfas.detection_count ? 'neutral' : 'good');
  const headline = compliance.length
    ? `${compliance.length} PFAS annual average${compliance.length === 1 ? '' : 's'} at or above the EPA limit`
    : above.length
      ? `${above.length} individual PFAS sample${above.length === 1 ? '' : 's'} above the EPA limit`
      : pfas.detection_count
        ? `${pfas.detection_count} PFAS compound${pfas.detection_count === 1 ? ' was' : 's were'} detected below the EPA limit`
        : 'No PFAS detections in the synchronized records';
  const complianceNote = !compliance.length && above.length
    ? `<p class="section-note">EPA determines compliance from the running annual average, so a single high sample is not by itself a violation.</p>`
    : '';
  const hiLine = hi
    ? `<p class="section-note">Hazard Index for the four mixture compounds: <strong>${esc(hi.hazard_index)}</strong> (limit ${esc(hi.limit)}).${hi.exceeds ? ' This is at or above the limit.' : ''}</p>`
    : '';
  const status = pfas.regulatory_status;
  const ruleLine = status
    ? `<p class="section-note rule-status"><strong>Rule status:</strong> ${esc(status.summary || '')}</p>`
    : '';
  return `<section class="local-panel ${tone}">
    <div class="section-heading">
      <div><p class="section-kicker">PFAS AND EMERGING CONTAMINANTS</p><h2>${esc(headline)}</h2></div>
      <span class="count-badge">${compliance.length || above.length}</span>
    </div>
    ${rows}
    ${complianceNote}
    ${hiLine}
    ${ruleLine}
    <p class="section-note">${esc(pfas.disclaimer || '')}</p>
  </section>`;
}

function wellPanel(wells) {
  if (!wells) return '';
  if (!wells.synced) {
    return pendingPanel('PRIVATE WELLS AND SEPTIC', 'Nearby private wells', 'Private-well data (the county 1,4-dioxane study, Florida Health records, and district well permits)');
  }
  const samples = wells.nearby_dioxane_well_samples || [];
  const detections = Number(wells.nearby_dioxane_detections || 0);
  const headline = detections
    ? `${detections} nearby private well${detections === 1 ? '' : 's'} had a 1,4-dioxane detection`
    : samples.length
      ? 'Nearby private wells were sampled with no 1,4-dioxane detection'
      : 'No sampled private wells were found near this address';
  return `<section class="local-panel ${detections ? 'attention' : 'good'}">
    <div class="section-heading">
      <div><p class="section-kicker">PRIVATE WELLS AND SEPTIC</p><h2>${esc(headline)}</h2></div>
      <span class="count-badge">${samples.length}</span>
    </div>
    <div class="quick-stats">
      <div><span>Wells sampled nearby</span><strong>${samples.length}</strong></div>
      <div><span>With a detection</span><strong>${detections}</strong></div>
      <div><span>Mapped well points</span><strong>${esc(wells.nearby_well_points || 0)}</strong></div>
    </div>
    <p class="section-note">${esc(wells.disclaimer || '')}</p>
  </section>`;
}

function telemetryPanel(telemetry) {
  if (!telemetry) return '';
  if (!telemetry.synced) {
    return pendingPanel('LOCAL WATERSHED MONITORING', 'Nearby monitoring stations', 'Local monitoring data (the Seminole Water Atlas and county surface-water and weather stations)');
  }
  const stations = (telemetry.nearby_atlas_stations || []).length;
  const surface = (telemetry.nearby_surface_water_sites || []).length;
  const weather = (telemetry.nearby_weather_stations || []).length;
  return `<section class="local-panel">
    <div class="section-heading">
      <div><p class="section-kicker">LOCAL WATERSHED MONITORING</p><h2>Nearby monitoring stations</h2></div>
      <span class="count-badge">${stations + surface + weather}</span>
    </div>
    <div class="quick-stats">
      <div><span>Water Atlas stations</span><strong>${stations}</strong></div>
      <div><span>Surface-water sites</span><strong>${surface}</strong></div>
      <div><span>Weather stations</span><strong>${weather}</strong></div>
    </div>
    <p class="section-note">${esc(telemetry.disclaimer || '')}</p>
  </section>`;
}

function localSections(data) {
  const blocks = localBlocks(data);
  if (!blocks.pfas && !blocks.wells && !blocks.telemetry) return '';
  return `${pfasPanel(blocks.pfas)}${wellPanel(blocks.wells)}${telemetryPanel(blocks.telemetry)}`;
}

function noticeBanner(data) {
  const count = getAddressNoticeCounts(data);
  if (!count) return '';
  return `<div class="notice-banner"><strong>Local notice found:</strong> ${count} public address, street, or neighborhood water notice match${count === 1 ? '' : 'es'} appeared for this search.</div>`;
}

function simpleReport(data) {
  const provider = data?.provider?.system;
  if (!provider) {
    return `<section class="empty-state error-state">
      <div class="state-icon">?</div>
      <h2>We could not identify the water system</h2>
      <p>Check the address and city, then try again. The property may also use a private well or fall outside the mapped service areas.</p>
    </section>`;
  }

  const reports = (data.analyte_reports || data.metal_reports || []).filter(report => latestRecord(report));
  const detected = reports.filter(report => recordStatus(latestRecord(report)) === 'detected');
  const notDetected = reports.filter(report => recordStatus(latestRecord(report)) === 'not-detected');
  const other = reports.filter(report => !['detected', 'not-detected'].includes(recordStatus(latestRecord(report))));
  const activeViolations = getActiveViolations(data);
  const pfasBlock = localBlocks(data).pfas;
  const pfasExceedances = Number(pfasBlock?.compliance_exceedance_count || 0);
  const summary = overallMessage({
    activeCount: activeViolations.length,
    detectedCount: detected.length,
    totalCount: reports.length,
    pfasExceedances
  });
  const matchedAddress = data?.geocode?.primary?.matchedAddress || data?.geocode?.secondary?.matchedAddress || 'Address matched';
  const ccr = getCcr(data);

  const detectedSection = detected.length
    ? `<section class="results-section">
        <div class="section-heading">
          <div><p class="section-kicker">LATEST SYSTEM SAMPLES</p><h2>Detected substances</h2></div>
          <span class="count-badge">${detected.length}</span>
        </div>
        <p class="section-note">These values come from the public water system or its sampling locations, not from this home's faucet.</p>
        <div class="results-grid">${detected.map(resultCard).join('')}</div>
      </section>`
    : `<section class="results-section compact-section"><h2>No detected substances in the latest displayed records</h2><p>The available results were reported as zero, non-detect, or did not contain a numeric detection.</p></section>`;

  const remainingCards = [...notDetected, ...other].map(resultCard).join('');
  const otherSection = remainingCards
    ? `<details class="other-results">
        <summary>See ${notDetected.length + other.length} other tested substances</summary>
        <div class="results-grid other-grid">${remainingCards}</div>
      </details>`
    : '';

  const activeSection = activeViolations.length
    ? `<section class="alerts-section">
        <h2>Active compliance items</h2>
        ${activeViolations.slice(0, 8).map(item => `<div class="alert-row">
          <strong>${esc(item.violation_name || item.violation_type || item.rule_name || 'Compliance item')}</strong>
          <span>${esc(item.status || item.violation_status || 'Active')}</span>
        </div>`).join('')}
      </section>`
    : '';

  return `<section class="report-header">
      <p class="system-label">WHAT MAY BE IN THIS AREA'S WATER</p>
      <h2>${esc(detected.length ? `${detected.length} substance${detected.length === 1 ? '' : 's'} detected in this area's water system` : 'Water system results for this area')}</h2>
      <p class="matched-address">${esc(matchedAddress)}</p>
      <div class="quick-stats">
        <div><span>Latest results shown</span><strong>${reports.length}</strong></div>
        <div><span>Detected</span><strong>${detected.length}</strong></div>
        <div><span>Compliance items</span><strong>${activeViolations.length}</strong></div>
      </div>
    </section>
    <section class="overall-card ${esc(summary.tone)}">
      <div class="overall-icon" aria-hidden="true">${summary.tone === 'attention' ? '!' : summary.tone === 'good' ? '✓' : 'i'}</div>
      <div><h2>${esc(summary.title)}</h2><p>${esc(summary.text)}</p></div>
    </section>
    ${noticeBanner(data)}
    ${activeSection}
    ${detectedSection}
    ${otherSection}
    ${localSections(data)}
    <section class="plain-language-note">
      <h2>Important</h2>
      <p>These results describe the public water system serving this area. Water can change inside a building because of plumbing, filters, or service lines. Only a sample collected from the home can show the water at that faucet. If something here concerns you, a certified home water test is the next step.</p>
    </section>
    <section class="dioxane-note">
      <h2>One thing this tool cannot show</h2>
      <p>This report covers contaminants that public water systems are federally required to monitor. It does <strong>not</strong> include 1,4-dioxane, an industrial chemical with no federal drinking-water limit that has been found in parts of Seminole County. Several local water systems are actively treating for it or in litigation over it. If you are in the Sanford, Lake Mary, or wider Seminole County area, check your city's own water-quality page for the latest 1,4-dioxane information.</p>
    </section>
    <p class="data-source-footer">Based on public drinking-water monitoring data from the U.S. EPA and the Florida Department of Environmental Protection. Tap any result for detail.</p>`;
}

async function boot() {
  const summary = document.querySelector('#summary');
  try {
    const response = await fetch('/api/systems');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    summary.textContent = 'Public EPA and Florida DEP monitoring data are ready.';
    const select = document.querySelector('#pws');
    for (const system of data.systems || []) {
      select.insertAdjacentHTML('beforeend', `<option value="${esc(system.pwsid)}">${esc(cleanName(system.name))}</option>`);
    }
  } catch (error) {
    summary.textContent = 'The water-data service could not be loaded. Start the local server and refresh this page.';
  }
}

boot();

document.querySelector('#form').addEventListener('submit', async event => {
  event.preventDefault();
  const output = document.querySelector('#out');
  const payload = {
    address: document.querySelector('#address').value,
    city: document.querySelector('#city').value,
    pwsid: document.querySelector('#pws').value,
    household_size: document.querySelector('#hh').value,
    online_address_search: document.querySelector('#online').checked
  };

  output.innerHTML = `<section class="loading-state"><div class="spinner" aria-hidden="true"></div><h2>Checking your water system…</h2><p>This can take a few seconds.</p></section>`;

  try {
    const response = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
    output.innerHTML = simpleReport(data);
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    output.innerHTML = `<section class="empty-state error-state"><div class="state-icon">!</div><h2>We could not complete the check</h2><p>${esc(error.message)}</p></section>`;
  }
});

// ---- Disclaimers modal --------------------------------------------------
(function () {
  const btn = document.querySelector('#disclaimer-btn');
  const modal = document.querySelector('#disclaimer-modal');
  if (!btn || !modal) return;
  const panel = modal.querySelector('.disclaimer-panel');
  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    const close = modal.querySelector('.disclaimer-close');
    if (close) close.focus();
    document.addEventListener('keydown', onKey);
  }
  function close() {
    modal.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  btn.addEventListener('click', open);
  modal.addEventListener('click', e => {
    if (e.target.getAttribute && e.target.getAttribute('data-close') === '1') close();
  });
  if (panel) panel.addEventListener('click', e => e.stopPropagation());
})();
