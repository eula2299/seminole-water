'use strict';

// Local Seminole-County data layer: PFAS & emerging contaminants, private wells
// & septic context, and real-time telemetry / environmental water health.
//
// Discipline (identical to the rest of this project): this module never emits a
// household concentration. PFAS UCMR 5 / FDEP rows are public-water-system level
// and are matched by PWS ID. WQP-PFAS, private wells, and telemetry are nearby
// ENVIRONMENTAL context matched by distance and are labelled as such. The
// county 1,4-dioxane study rows are private-well samples that describe the
// sampled well, never automatically the submitted address.

const fs = require('fs');
const path = require('path');

function safeRead(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function asArray(v) { return Array.isArray(v) ? v : []; }
function clean(v) { return String(v ?? '').trim(); }
function norm(v) { return clean(v).toUpperCase().replace(/\s+/g, ' '); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function pwsid(v) {
  const digits = String(v ?? '').toUpperCase().trim()
    .replace(/^US-?/, '').replace(/^FL/, '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-7) : digits;
}
function dateValue(v) { const t = Date.parse(clean(v)); return Number.isFinite(t) ? t : 0; }

function haversineMiles(a, b) {
  const lat1 = num(a?.lat), lon1 = num(a?.lon), lat2 = num(b?.lat), lon2 = num(b?.lon);
  if ([lat1, lon1, lat2, lon2].some(x => x === null)) return null;
  const R = 3958.7613, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- PFAS unit + benchmark handling --------------------------------------

// Normalize a measured PFAS value to ng/L (== ppt for water). Handles ug/L.
function toNgL(value, unit) {
  const n = num(value); if (n === null) return null;
  const u = norm(unit).replace(/µ/g, 'U');
  if (/NG\/?L|PPT|PARTS PER TRILLION/.test(u) || u === '') return n;
  if (/UG\/?L|PPB|PARTS PER BILLION/.test(u)) return n * 1000;
  if (/MG\/?L|PPM|PARTS PER MILLION/.test(u)) return n * 1_000_000;
  return n; // unknown unit: treat as already ng/L but flag upstream
}

// Canonical short names for every PFAS compound in the EPA UCMR 5 method
// (plus the common CCR spellings). Compounds without a federal MCL still need
// to be recognised and displayed as detections; silently dropping a detected
// PFAS because it lacks an MCL is a real reporting failure. MCL comparison is
// applied separately and only to the regulated subset.
const PFAS_NAME_MAP = [
  [/PERFLUOROOCTANOIC|\bPFOA\b|PERFLUOROOCTANOATE/,'PFOA'],
  [/PERFLUOROOCTANE ?SULFON|\bPFOS\b/,'PFOS'],
  [/PERFLUOROHEXANE ?SULFON|\bPFHXS\b/,'PFHxS'],
  [/PERFLUORONONANOIC|\bPFNA\b|PERFLUORONONANOATE/,'PFNA'],
  [/HEXAFLUOROPROPYLENE OXIDE|HFPO|\bGENX\b/,'HFPO-DA'],
  [/PERFLUOROBUTANE ?SULFON|\bPFBS\b/,'PFBS'],
  [/PERFLUOROBUTANOIC|PERFLUOROBUTYRATE|\bPFBA\b/,'PFBA'],
  [/PERFLUOROPENTANOIC|\bPFPEA\b/,'PFPeA'],
  [/PERFLUOROHEXANOIC|\bPFHXA\b/,'PFHxA'],
  [/PERFLUOROHEPTANOIC|\bPFHPA\b/,'PFHpA'],
  [/PERFLUORODECANOIC|\bPFDA\b/,'PFDA'],
  [/PERFLUOROUNDECANOIC|\bPFUNA\b|\bPFUNDA\b/,'PFUnA'],
  [/PERFLUORODODECANOIC|\bPFDOA\b|\bPFDODA\b/,'PFDoA'],
  [/PERFLUOROTRIDECANOIC|\bPFTRDA\b/,'PFTrDA'],
  [/PERFLUOROTETRADECANOIC|\bPFTA\b|\bPFTEDA\b/,'PFTA'],
  [/PERFLUOROHEPTANE ?SULFON|\bPFHPS\b/,'PFHpS'],
  [/PERFLUOROPENTANE ?SULFON|\bPFPES\b/,'PFPeS'],
  [/PERFLUORODECANE ?SULFON|\bPFDS\b/,'PFDS'],
  [/PERFLUORONONANE ?SULFON|\bPFNS\b/,'PFNS'],
  [/PERFLUORODODECANE ?SULFON|\bPFDOS\b/,'PFDoS'],
  [/4:2.*FLUOROTELOMER|\b4:2 ?FTS\b/,'4:2 FTS'],
  [/6:2.*FLUOROTELOMER|6:2.*PERFLUOROOCTANE|\b6:2 ?FTS\b/,'6:2 FTS'],
  [/8:2.*FLUOROTELOMER|\b8:2 ?FTS\b/,'8:2 FTS'],
  [/N-?METHYL.*PERFLUOROOCTANE|\bNMEFOSAA\b/,'NMeFOSAA'],
  [/N-?ETHYL.*PERFLUOROOCTANE|\bNETFOSAA\b/,'NEtFOSAA'],
  [/PERFLUORO.*4.*DIOXA|\bADONA\b/,'ADONA'],
  [/9.*CHLORO.*HEXADECAFLUORO|\b9CL-PF3ONS\b|F53B/,'9Cl-PF3ONS'],
  [/11.*CHLORO.*EICOSAFLUORO|\b11CL-PF3OUDS\b/,'11Cl-PF3OUdS']
];

function canonicalPfas(name, benchmarks) {
  const n = norm(name);
  if (!n) return null;
  const syn = benchmarks?.synonyms || {};
  for (const key of Object.keys(benchmarks?.mcl || {})) {
    if (n === norm(key)) return key;
  }
  for (const [key, list] of Object.entries(syn)) {
    if ((list || []).some(s => n === norm(s) || n.includes(norm(s)))) return key;
    if (n.includes(norm(key))) return key;
  }
  for (const [pattern, canonical] of PFAS_NAME_MAP) {
    if (pattern.test(n)) return canonical;
  }
  // Looks like a PFAS name but is not in the table: surface it under a
  // normalized label rather than dropping it, so a detection is never hidden.
  if (/\bPF[A-Z]{1,5}\b|PERFLUORO|POLYFLUORO|FLUOROTELOMER/.test(n)) {
    return name && name.trim() ? name.trim() : 'PFAS (unclassified)';
  }
  return null;
}

// Classify one PFAS result against the bundled EPA NPDWR benchmarks.
//
// IMPORTANT: EPA determines MCL compliance using the RUNNING ANNUAL AVERAGE at
// the sampling point. A single sample above an MCL is NOT by itself a
// violation. This function therefore reports `above_benchmark` for a single
// result and never labels one sample a violation; compliance-relevant
// exceedance is computed separately in runningAnnualAverages().
function classifyPfasResult(row, benchmarks) {
  const analyte = canonicalPfas(row.characteristic_name || row.analyte || row.contaminant, benchmarks);
  const raw = clean(row.result_value ?? row.value ?? row.result);
  const ngL = toNgL(row.result_value ?? row.value ?? row.result, row.result_unit ?? row.unit);
  const nonDetect = /^(<|ND|NON[- ]?DETECT)/i.test(raw)
    || norm(row.detection_condition).includes('NON-DETECT') || norm(row.detection_condition).includes('NOT DETECTED');
  const mcl = analyte ? (benchmarks?.mcl?.[analyte] ?? null) : null;
  let status = 'reported';
  if (nonDetect) status = 'not-detected';
  else if (ngL !== null && ngL > 0) status = 'detected';
  let above_benchmark = null;
  if (mcl !== null && ngL !== null && !nonDetect) above_benchmark = ngL >= mcl;
  return {
    ...row,
    canonical_analyte: analyte,
    value_ng_L: nonDetect ? null : ngL,
    mcl_ng_L: mcl,
    status,
    above_benchmark,
    rule_status: analyte ? (benchmarks?.analyte_status?.[analyte] || 'unknown') : null,
    compliance_note: 'A single sample above a maximum contaminant level is not by itself a violation; EPA determines compliance from the running annual average.',
    granularity: row.granularity || 'public-water-system'
  };
}

// Running annual average per analyte, which is how EPA determines compliance.
// Requires at least `minSamples` results inside the trailing 12-month window
// ending at the most recent sample; otherwise the result is inconclusive.
function runningAnnualAverages(classified, benchmarks, { minSamples = 4 } = {}) {
  const byAnalyte = new Map();
  for (const r of asArray(classified)) {
    if (!r.canonical_analyte) continue;
    if (!byAnalyte.has(r.canonical_analyte)) byAnalyte.set(r.canonical_analyte, []);
    byAnalyte.get(r.canonical_analyte).push(r);
  }
  const out = [];
  for (const [analyte, rows] of byAnalyte) {
    const dated = rows
      .map(r => ({ r, t: dateValue(r.sample_date || r.activity_start_date) }))
      .filter(x => x.t > 0)
      .sort((a, b) => b.t - a.t);
    if (!dated.length) continue;
    const end = dated[0].t, start = end - 365 * 24 * 3600 * 1000;
    const window = dated.filter(x => x.t >= start);
    // Non-detects enter the average at zero per EPA compliance arithmetic, but
    // they are still reported as non-detects everywhere else in this project.
    const values = window.map(x => (x.r.status === 'not-detected' ? 0 : x.r.value_ng_L)).filter(v => v !== null);
    if (!values.length) continue;
    const mcl = benchmarks?.mcl?.[analyte] ?? null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const sufficient = values.length >= minSamples;
    out.push({
      analyte,
      running_annual_average_ng_L: Number(avg.toFixed(3)),
      sample_count: values.length,
      window_start: new Date(start).toISOString().slice(0, 10),
      window_end: new Date(end).toISOString().slice(0, 10),
      mcl_ng_L: mcl,
      sufficient_data: sufficient,
      exceeds_mcl: (mcl !== null && sufficient) ? avg >= mcl : null,
      rule_status: benchmarks?.analyte_status?.[analyte] || 'unknown',
      note: sufficient
        ? 'Running annual average computed from the trailing twelve months.'
        : `Only ${values.length} result(s) in the trailing twelve months; a compliance determination needs at least ${minSamples}.`
    });
  }
  return out;
}

function hazardIndex(classified, benchmarks) {
  const hi = benchmarks?.hazard_index;
  if (!hi) return null;
  const conc = hi.health_based_water_concentrations_ng_L || {};
  const latest = new Map();
  for (const r of classified) {
    if (!hi.applies_to.includes(r.canonical_analyte)) continue;
    if (r.value_ng_L === null) continue;
    const prev = latest.get(r.canonical_analyte);
    if (!prev || dateValue(r.sample_date || r.activity_start_date) >= dateValue(prev.sample_date || prev.activity_start_date)) {
      latest.set(r.canonical_analyte, r);
    }
  }
  if (!latest.size) return null;
  let sum = 0; const terms = [];
  for (const [analyte, r] of latest) {
    const denom = conc[analyte]; if (!denom) continue;
    const term = r.value_ng_L / denom; sum += term;
    terms.push({ analyte, value_ng_L: r.value_ng_L, health_based_ng_L: denom, ratio: Number(term.toFixed(3)) });
  }
  return { hazard_index: Number(sum.toFixed(3)), exceeds: sum >= (hi.limit || 1), limit: hi.limit || 1, terms };
}

// ---- Loader ---------------------------------------------------------------

function loadLocalData(root) {
  const dataDir = path.join(root, 'data');
  return {
    root,
    sources: {
      pfas: safeRead(path.join(dataDir, 'emerging_contaminants_sources.json'), { sources: [] }),
      private_wells: safeRead(path.join(dataDir, 'private_well_sources.json'), { sources: [] }),
      telemetry: safeRead(path.join(dataDir, 'telemetry_sources.json'), { sources: [] })
    },
    pfas: {
      benchmarks: safeRead(path.join(dataDir, 'pfas', 'benchmarks.json'), { mcl: {}, synonyms: {} }),
      ucmr5: asArray(safeRead(path.join(dataDir, 'pfas', 'ucmr5_results.json'), [])),
      wqp: asArray(safeRead(path.join(dataDir, 'pfas', 'wqp_pfas_results.json'), [])),
      fdep: asArray(safeRead(path.join(dataDir, 'pfas', 'fdep_pfas_status.json'), [])),
      ewg: asArray(safeRead(path.join(dataDir, 'pfas', 'ewg_indicators.json'), [])),
      manifest: safeRead(path.join(dataDir, 'pfas', 'manifest.json'), { status: 'not-synced' })
    },
    private_wells: {
      dioxane: asArray(safeRead(path.join(dataDir, 'private_wells', 'dioxane_study.json'), [])),
      fdoh: asArray(safeRead(path.join(dataDir, 'private_wells', 'fdoh_records.json'), [])),
      wells: asArray(safeRead(path.join(dataDir, 'private_wells', 'sjrwmd_wells.json'), [])),
      cup: asArray(safeRead(path.join(dataDir, 'private_wells', 'sjrwmd_cup.json'), [])),
      manifest: safeRead(path.join(dataDir, 'private_wells', 'manifest.json'), { status: 'not-synced' })
    },
    telemetry: {
      stations: asArray(safeRead(path.join(dataDir, 'telemetry', 'atlas_stations.json'), [])),
      atlas_wq: asArray(safeRead(path.join(dataDir, 'telemetry', 'atlas_wq.json'), [])),
      surface_sites: asArray(safeRead(path.join(dataDir, 'telemetry', 'surface_water_sites.json'), [])),
      weather: asArray(safeRead(path.join(dataDir, 'telemetry', 'weather_stations.json'), [])),
      gis_assets: asArray(safeRead(path.join(dataDir, 'telemetry', 'gis_assets.json'), [])),
      manifest: safeRead(path.join(dataDir, 'telemetry', 'manifest.json'), { status: 'not-synced' })
    }
  };
}

function coordsOf(row) {
  return { lat: num(row.latitude ?? row.lat ?? row.LatitudeMeasure), lon: num(row.longitude ?? row.lon ?? row.LongitudeMeasure) };
}
function withDistance(rows, center, radiusMiles, limit) {
  const c = { lat: num(center?.lat), lon: num(center?.lon) };
  if (c.lat === null || c.lon === null) return [];
  return rows
    .map(r => ({ ...r, distance_miles: haversineMiles(c, coordsOf(r)) }))
    .filter(r => r.distance_miles !== null && r.distance_miles <= radiusMiles)
    .sort((a, b) => a.distance_miles - b.distance_miles)
    .slice(0, limit);
}

// ---- Context builders -----------------------------------------------------

const PFAS_DISCLAIMER = 'PFAS results are public-water-system occurrence/compliance records (UCMR 5, FDEP) or nearby environmental monitoring (Water Quality Portal). They are system or watershed level, never a laboratory test of the submitted home. UCMR 5 is occurrence monitoring, not a compliance finding.';

function emergingContaminants(local, { id, coords }) {
  const b = local.pfas.benchmarks;
  const target = pwsid(id);
  const ucmr5 = local.pfas.ucmr5.filter(r => pwsid(r.pwsid) === target).map(r => classifyPfasResult({ ...r, granularity: 'public-water-system' }, b));
  const fdep = local.pfas.fdep.filter(r => pwsid(r.pwsid) === target);
  const wqp = withDistance(local.pfas.wqp, coords, 15, 12).map(r => classifyPfasResult({ ...r, granularity: 'environmental-monitoring-station' }, b));
  const measured = [...ucmr5];
  const aboveBenchmark = measured.filter(r => r.above_benchmark === true);
  const detections = measured.filter(r => r.status === 'detected');
  const raa = runningAnnualAverages(measured, b);
  const complianceExceedances = raa.filter(r => r.exceeds_mcl === true);
  const hi = hazardIndex(measured, b);
  const synced = !!(local.pfas.ucmr5.length || local.pfas.fdep.length || local.pfas.wqp.length
    || String(local.pfas.manifest?.status || '').startsWith('synced'));
  return {
    synced,
    pwsid: target,
    benchmarks_rule: b.rule || null,
    ucmr5_results: ucmr5,
    fdep_status: fdep,
    wqp_pfas_context: wqp,
    ewg_indicators: local.pfas.ewg,
    detection_count: detections.length,
    above_benchmark_count: aboveBenchmark.length,
    above_benchmark: aboveBenchmark,
    running_annual_averages: raa,
    compliance_exceedance_count: complianceExceedances.length,
    compliance_exceedances: complianceExceedances,
    hazard_index: hi,
    regulatory_status: b.regulatory_status || null,
    compliance_determination: b.compliance_determination || null,
    disclaimer: PFAS_DISCLAIMER
  };
}

const WELL_DISCLAIMER = 'Private-well and septic records describe neighboring private infrastructure and contextual risk, not the submitted household. The 1,4-dioxane study rows are measurements of the sampled well only. Only an address-specific laboratory sample can characterize this home.';

function privateWellContext(local, { coords }) {
  const dioxane = withDistance(local.private_wells.dioxane, coords, 3, 25).map(r => ({
    ...r, granularity: 'private-well-sample', evidence_class: 'measured-neighboring-well'
  }));
  const wells = withDistance(local.private_wells.wells, coords, 2, 50).map(r => ({
    ...r, granularity: 'well-point', evidence_class: 'well-location-context'
  }));
  const fdoh = withDistance(local.private_wells.fdoh, coords, 3, 25);
  const synced = !!(local.private_wells.dioxane.length || local.private_wells.wells.length
    || local.private_wells.fdoh.length || String(local.private_wells.manifest?.status || '').startsWith('synced'));
  const dioxaneDetections = dioxane.filter(r => {
    const v = num(r.result_value ?? r.value ?? r.concentration);
    return v !== null && v > 0 && !/^(<|ND)/i.test(clean(r.result_value ?? r.value ?? r.concentration));
  });
  return {
    synced,
    nearby_dioxane_well_samples: dioxane,
    nearby_dioxane_detections: dioxaneDetections.length,
    nearby_well_points: wells.length,
    nearby_well_points_sample: wells.slice(0, 10),
    fdoh_records: fdoh,
    cup_areas: local.private_wells.cup.length,
    disclaimer: WELL_DISCLAIMER
  };
}

const TELEMETRY_DISCLAIMER = 'Telemetry and watershed data are environmental-monitoring and infrastructure context maintained by Seminole County and USF. They describe watersheds, source water, and assets, not treated water at a household faucet.';

function localTelemetry(local, { coords }) {
  const stations = withDistance(local.telemetry.stations, coords, 15, 12);
  const surface = withDistance(local.telemetry.surface_sites, coords, 15, 12);
  const weather = withDistance(local.telemetry.weather, coords, 25, 15);
  const synced = !!(local.telemetry.stations.length || local.telemetry.surface_sites.length
    || local.telemetry.weather.length || String(local.telemetry.manifest?.status || '').startsWith('synced'));
  return {
    synced,
    nearby_atlas_stations: stations,
    nearby_surface_water_sites: surface,
    nearby_weather_stations: weather,
    gis_asset_count: local.telemetry.gis_assets.length,
    disclaimer: TELEMETRY_DISCLAIMER
  };
}

function buildLocalContext(local, { id = '', coords = null, systemName = '' } = {}) {
  return {
    emerging_contaminants: emergingContaminants(local, { id, coords }),
    private_well_context: privateWellContext(local, { coords }),
    local_telemetry: localTelemetry(local, { coords }),
    sources: {
      pfas: local.sources.pfas.sources || [],
      private_wells: local.sources.private_wells.sources || [],
      telemetry: local.sources.telemetry.sources || []
    },
    system_name: systemName || null
  };
}

function localSummary(local) {
  return {
    pfas: {
      status: local.pfas.manifest?.status || 'not-synced',
      ucmr5_results: local.pfas.ucmr5.length,
      wqp_pfas_results: local.pfas.wqp.length,
      fdep_status_rows: local.pfas.fdep.length,
      ewg_indicators: local.pfas.ewg.length,
      benchmarks_rule: local.pfas.benchmarks?.rule || null
    },
    private_wells: {
      status: local.private_wells.manifest?.status || 'not-synced',
      dioxane_study_samples: local.private_wells.dioxane.length,
      fdoh_records: local.private_wells.fdoh.length,
      sjrwmd_well_points: local.private_wells.wells.length,
      cup_areas: local.private_wells.cup.length
    },
    telemetry: {
      status: local.telemetry.manifest?.status || 'not-synced',
      atlas_stations: local.telemetry.stations.length,
      surface_water_sites: local.telemetry.surface_sites.length,
      weather_stations: local.telemetry.weather.length,
      gis_assets: local.telemetry.gis_assets.length
    }
  };
}

module.exports = {
  loadLocalData, buildLocalContext, localSummary,
  emergingContaminants, privateWellContext, localTelemetry,
  classifyPfasResult, runningAnnualAverages, hazardIndex, canonicalPfas, toNgL, haversineMiles,
  PFAS_DISCLAIMER, WELL_DISCLAIMER, TELEMETRY_DISCLAIMER
};
