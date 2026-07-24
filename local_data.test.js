'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const L = require('../lib/local_data');
const benchmarks = JSON.parse(fs.readFileSync(path.join(root, 'data', 'pfas', 'benchmarks.json'), 'utf8'));

test('local source registries are present and describe every requested family', () => {
  const pfas = JSON.parse(fs.readFileSync(path.join(root, 'data', 'emerging_contaminants_sources.json'), 'utf8'));
  const wells = JSON.parse(fs.readFileSync(path.join(root, 'data', 'private_well_sources.json'), 'utf8'));
  const telem = JSON.parse(fs.readFileSync(path.join(root, 'data', 'telemetry_sources.json'), 'utf8'));
  const ids = o => (o.sources || []).map(s => s.id);
  for (const id of ['epa-ucmr5', 'fdep-pfas-program', 'ewg-pfas-map']) assert.ok(ids(pfas).includes(id), `missing ${id}`);
  for (const id of ['seminole-14-dioxane-study', 'fdoh-seminole-dws', 'sjrwmd-well-permits', 'sjrwmd-cup']) {
    assert.ok(ids(wells).includes(id), `missing ${id}`);
  }
  for (const id of ['seminole-water-atlas', 'seminole-surface-water-program', 'seminole-gis-library']) {
    assert.ok(ids(telem).includes(id), `missing ${id}`);
  }
});

test('PFAS units normalize to ng/L', () => {
  assert.equal(L.toNgL('5.2', 'ng/L'), 5.2);
  assert.equal(L.toNgL('0.006', 'ug/L'), 6);
  assert.equal(L.toNgL('1', 'mg/L'), 1_000_000);
  assert.equal(L.toNgL('4', 'ppt'), 4);
});

test('PFAS results compare against the EPA benchmarks without asserting a violation', () => {
  const over = L.classifyPfasResult({ characteristic_name: 'Perfluorooctanoic acid', result_value: '5.2', result_unit: 'ng/L' }, benchmarks);
  assert.equal(over.canonical_analyte, 'PFOA');
  assert.equal(over.status, 'detected');
  assert.equal(over.above_benchmark, true);
  assert.ok(!('exceeds_mcl' in over), 'a single sample must never claim an MCL violation');
  assert.equal(over.rule_status, 'in-force');

  const under = L.classifyPfasResult({ characteristic_name: 'PFOS', result_value: '1.1', result_unit: 'ng/L' }, benchmarks);
  assert.equal(under.above_benchmark, false);

  const atLimit = L.classifyPfasResult({ characteristic_name: 'PFOA', result_value: '4', result_unit: 'ng/L' }, benchmarks);
  assert.equal(atLimit.above_benchmark, true, 'a value at the MCL is at the benchmark');
});

test('compliance uses the running annual average, not a single sample', () => {
  const quarterly = ['2025-09-01', '2025-12-01', '2026-03-01', '2026-06-01']
    .map(d => L.classifyPfasResult({ characteristic_name: 'PFOA', result_value: '6', result_unit: 'ng/L', sample_date: d }, benchmarks));
  const raa = L.runningAnnualAverages(quarterly, benchmarks)[0];
  assert.equal(raa.running_annual_average_ng_L, 6);
  assert.equal(raa.sufficient_data, true);
  assert.equal(raa.exceeds_mcl, true);

  const single = [L.classifyPfasResult({ characteristic_name: 'PFOA', result_value: '9', result_unit: 'ng/L', sample_date: '2026-06-01' }, benchmarks)];
  const thin = L.runningAnnualAverages(single, benchmarks)[0];
  assert.equal(thin.sufficient_data, false);
  assert.equal(thin.exceeds_mcl, null, 'one sample cannot determine compliance');
});

test('the bundled PFAS rule state is present and flags the proposed rescission', () => {
  assert.equal(benchmarks.compliance_determination.method, 'running-annual-average');
  assert.equal(benchmarks.analyte_status.PFOA, 'in-force');
  assert.match(benchmarks.analyte_status.PFHxS, /rescission/);
  assert.ok(Array.isArray(benchmarks.regulatory_status.proposals));
  assert.ok(benchmarks.regulatory_status.proposals.every(p => p.status === 'proposed-not-final'));
  assert.equal(benchmarks.other_contaminants['1,4-Dioxane'].enforceable, false);
});

test('non-detects are never converted to zero or treated as an exceedance', () => {
  const nd = L.classifyPfasResult({ characteristic_name: 'PFOA', result_value: 'ND' }, benchmarks);
  assert.equal(nd.status, 'not-detected');
  assert.equal(nd.value_ng_L, null, 'non-detect must not become a numeric zero');
  assert.equal(nd.above_benchmark, null);
});

test('hazard index sums the four mixture compounds and flags the limit', () => {
  const rows = [
    { characteristic_name: 'PFHxS', result_value: '5', result_unit: 'ng/L', sample_date: '2024-05-01' },
    { characteristic_name: 'PFNA', result_value: '5', result_unit: 'ng/L', sample_date: '2024-05-01' }
  ].map(r => L.classifyPfasResult(r, benchmarks));
  const hi = L.hazardIndex(rows, benchmarks);
  assert.equal(hi.hazard_index, 1);
  assert.equal(hi.exceeds, true);
});

test('local context loads and reports an un-synced cache as un-synced, not as clean', () => {
  const data = L.loadLocalData(root);
  const ctx = L.buildLocalContext(data, { id: '3590205', coords: { lat: 28.8, lon: -81.27 } });
  for (const key of ['emerging_contaminants', 'private_well_context', 'local_telemetry']) {
    assert.ok(key in ctx, `context missing ${key}`);
  }
  const summary = L.localSummary(data);
  for (const family of ['pfas', 'private_wells', 'telemetry']) {
    assert.ok(summary[family], `summary missing ${family}`);
    assert.ok(typeof summary[family].status === 'string');
  }
});

test('environmental and private-well evidence is never labelled as a household sample', () => {
  const data = L.loadLocalData(root);
  const ctx = L.buildLocalContext(data, { id: '3590205', coords: { lat: 28.8, lon: -81.27 } });
  assert.match(ctx.emerging_contaminants.disclaimer, /never a laboratory test of the submitted home/i);
  assert.match(ctx.private_well_context.disclaimer, /not the submitted household/i);
  assert.match(ctx.local_telemetry.disclaimer, /not treated water at a household faucet/i);
});

test('the public page distinguishes missing data from a clean result', () => {
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /pendingPanel/, 'a pending state must exist for un-synced caches');
  assert.match(app, /not<\/strong> a finding that the water is clean/i);
  assert.match(app, /pfasExceedances/, 'PFAS exceedances must feed the overall message');
});

test('a PFAS exceedance overrides an otherwise clean overall message', () => {
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const fn = app.slice(app.indexOf('function overallMessage'), app.indexOf('function noticeBanner'));
  const idxPfas = fn.indexOf('pfasExceedances > 0');
  const idxActive = fn.indexOf('activeCount > 0');
  assert.ok(idxPfas > -1 && idxActive > -1);
  assert.ok(idxPfas < idxActive, 'the PFAS check must be evaluated before any all-clear branch');
});

test('sync scripts use verified official endpoints rather than placeholders', () => {
  const telemetry = fs.readFileSync(path.join(root, 'scripts', 'sync_telemetry.py'), 'utf8');
  assert.match(telemetry, /api\.wateratlas\.usf\.edu/, 'must use the documented Water Atlas API');
  assert.match(telemetry, /DataMapper\/Stations\/All/);
  assert.match(telemetry, /rainfall\/latest/);

  const wells = fs.readFileSync(path.join(root, 'scripts', 'sync_private_wells.py'), 'utf8');
  assert.match(wells, /utilities-engineering\/dioxane/, 'must point at the real county 1,4-dioxane page');
  assert.match(wells, /discover_dioxane_documents/);

  const pfas = fs.readFileSync(path.join(root, 'scripts', 'sync_pfas.py'), 'utf8');
  assert.match(pfas, /and-polyfluoroalkyl-substances-pfas/, 'must use the real FDEP PFAS program URL');
});

test('sync scripts exist for every requested data family', () => {
  for (const script of ['sync_pfas.py', 'sync_private_wells.py', 'sync_telemetry.py', 'seminole_sync_lib.py']) {
    assert.ok(fs.existsSync(path.join(root, 'scripts', script)), `missing scripts/${script}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const s of ['sync:pfas', 'sync:private-wells', 'sync:telemetry', 'sync:local']) {
    assert.ok(pkg.scripts[s], `missing npm script ${s}`);
  }
});

test('every PFAS compound in a real Seminole CCR is recognized, not silently dropped', () => {
  // These names appear verbatim in the 2024 CCRs for Sanford (PWS 3590205) and
  // Lake Mary (PWS 3590201). Before this was fixed, four of them mapped to null
  // and were dropped from the report entirely.
  const namesFromRealCCRs = [
    'Perfluorooctanoic acid', 'Perfluorooctanesulfonic acid',
    'Perfluorohexanesulfonic acid', 'Perfluorobutanesulfonic acid',
    'Perfluoroheptanoic acid', 'Perfluorohexanoic acid',
    'Perfluorobutanoic acid', 'Perfluoropentanoic acid',
    '1H,1H, 2H, 2H-perfluorooctane sulfonic acid'
  ];
  for (const name of namesFromRealCCRs) {
    const r = L.classifyPfasResult({ characteristic_name: name, result_value: '2.0', result_unit: 'ng/L' }, benchmarks);
    assert.ok(r.canonical_analyte, `PFAS compound silently dropped: ${name}`);
  }
});

test('unregulated PFAS is surfaced as a detection but never as an MCL exceedance', () => {
  // PFHxA (4.2 ppt in Lake Mary's CCR) has no federal MCL. It must be shown,
  // but must never be flagged as above a limit that does not exist.
  const r = L.classifyPfasResult({ characteristic_name: 'Perfluorohexanoic acid', result_value: '4.2', result_unit: 'ng/L' }, benchmarks);
  assert.equal(r.canonical_analyte, 'PFHxA');
  assert.equal(r.mcl_ng_L, null, 'PFHxA has no MCL');
  assert.equal(r.above_benchmark, null, 'no MCL means no benchmark comparison');
  assert.equal(r.status, 'detected');
});

test('a regulated PFAS at a real CCR value is classified correctly against its MCL', () => {
  // Lake Mary CCR: PFHxS 3.6 ppt vs a 10 ppt limit -> below.
  const below = L.classifyPfasResult({ characteristic_name: 'Perfluorohexanesulfonic acid', result_value: '3.6', result_unit: 'ng/L' }, benchmarks);
  assert.equal(below.canonical_analyte, 'PFHxS');
  assert.equal(below.mcl_ng_L, 10);
  assert.equal(below.above_benchmark, false);
  // Sanford CCR: PFOS ranged 1.70-4.70, average 2.73 vs 4.0 limit. The average
  // is below; a single 4.70 sample is above the benchmark but not a violation.
  const pfosAvg = L.classifyPfasResult({ characteristic_name: 'PFOS', result_value: '2.73', result_unit: 'ng/L' }, benchmarks);
  assert.equal(pfosAvg.above_benchmark, false, 'the running average is compliant');
});

test('the report surfaces the 1,4-dioxane coverage gap for Seminole residents', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /1,4-dioxane/i, 'the known local coverage gap must be disclosed');
  assert.match(app, /does <strong>not<\/strong> include|cannot show/i);
});

test('a disclaimers button and modal are present with the required terms', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="disclaimer-btn"/, 'a clickable Disclaimers button must exist');
  assert.match(html, /id="disclaimer-modal"/, 'the modal container must exist');
  assert.match(html, /role="dialog"/, 'the modal must be an accessible dialog');
  // required content inside the modal
  assert.match(html, /not a test of your home/i, 'must state it is not a home water test');
  assert.match(html, /not medical, legal, or professional advice/i);
  assert.match(html, /provided "as is"/i, 'must include an as-is / no-warranty statement');
  assert.match(html, /not affiliated with/i, 'must disclaim government/utility affiliation');
  assert.match(html, /1-800-426-4791/, 'must point to the official EPA hotline');
  assert.match(html, /1,4-dioxane/i, 'must disclose the known coverage gap');
  // the open/close wiring must be in app.js
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /disclaimer-btn/, 'app.js must wire up the disclaimer button');
  assert.match(app, /Escape/, 'the modal must be closable with the Escape key');
});
