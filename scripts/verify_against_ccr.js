#!/usr/bin/env node
'use strict';
// Ground-truth verification harness.
//
// Every other test in this project checks that the code does what the code
// says. This one is different: it prints what the application would tell a
// resident, next to the source document a human must read, so a person can
// confirm the two agree.
//
// This exists because a tab-vs-comma parsing assumption silently produced
// "no PFAS found" instead of an error, and the entire test suite passed. Only
// comparison against the published record catches that class of failure.
//
//   node scripts/verify_against_ccr.js
//   node scripts/verify_against_ccr.js --port 3000 --out verification.md

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(argOf('--port', process.env.PORT || 3000));
const OUT = argOf('--out', 'verification-worksheet.md');
const ROOT = path.join(__dirname, '..');

// Spread across distinct water systems, so one bad crosswalk cannot pass.
const SAMPLES = [
  { address: '300 N Park Ave', city: 'Sanford' },
  { address: '100 N Country Club Rd', city: 'Lake Mary' },
  { address: '400 Alexandria Blvd', city: 'Oviedo' },
  { address: '1126 E State Road 434', city: 'Winter Springs' },
  { address: '95 Triplet Lake Dr', city: 'Casselberry' },
  { address: '225 Newburyport Ave', city: 'Altamonte Springs' }
];

function lookup(address, city) {
  return new Promise(resolve => {
    const body = JSON.stringify({ address, city, pwsid: 'AUTO', online_address_search: false });
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/api/lookup', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', d => { raw += d; });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { resolve({ error: `unparseable response (HTTP ${res.statusCode})` }); }
        });
      });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(45_000, () => { req.destroy(); resolve({ error: 'timed out' }); });
    req.end(body);
  });
}

function ccrLinkFor(pwsid) {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'epa', 'ccr_index.json'), 'utf8'));
    const rows = Array.isArray(index) ? index : (index.reports || index.entries || []);
    const hit = rows.filter(r => String(r.pwsid || '').includes(String(pwsid)))
      .sort((a, b) => String(b.year || '').localeCompare(String(a.year || '')))[0];
    return hit ? (hit.url || hit.link || hit.report_url || '') : '';
  } catch { return ''; }
}

function pfasLines(inv) {
  const p = inv?.local_data?.emerging_contaminants;
  if (!p) return ['  (no PFAS block in response)'];
  if (!p.synced) return ['  NOT LOADED — run the sync before verifying'];
  const out = [];
  for (const r of (p.compliance_exceedances || []).slice(0, 6)) {
    out.push(`  ${r.analyte}: annual average ${r.running_annual_average_ng_L} ng/L vs limit ${r.mcl_ng_L} ng/L  [COMPLIANCE EXCEEDANCE]`);
  }
  for (const r of (p.above_benchmark || []).slice(0, 6)) {
    out.push(`  ${r.canonical_analyte || r.characteristic_name}: ${r.value_ng_L} ng/L vs limit ${r.mcl_ng_L} ng/L  (single sample, not a violation)`);
  }
  if (!out.length) out.push(`  no PFAS at or above a limit; ${p.detection_count || 0} detection(s) recorded`);
  return out;
}

function detectionLines(inv) {
  const rows = (inv?.results || inv?.reports || []).filter(r => {
    const s = String(r.status || r.result_status || '').toLowerCase();
    return s.includes('detect') && !s.includes('non');
  });
  if (!rows.length) return ['  (no detections reported)'];
  return rows.slice(0, 8).map(r =>
    `  ${r.analyte || r.contaminant || r.name}: ${r.result ?? r.value ?? '?'} ${r.unit || ''}`.trimEnd());
}

(async () => {
  const lines = [];
  const say = t => { lines.push(t); console.log(t); };

  say('# CCR Verification Worksheet');
  say('');
  say(`Generated ${new Date().toISOString()} against localhost:${PORT}`);
  say('');
  say('For each address: open the CCR link, find the same contaminant, and compare.');
  say('Write the published figure in the blank. Any mismatch is a launch blocker.');
  say('');
  say('Watch specifically for: values off by a factor of 1000 (unit error), results');
  say('attached to the wrong utility (crosswalk error), and non-detects shown as zero.');
  say('');

  let reachable = 0;
  for (const s of SAMPLES) {
    const inv = await lookup(s.address, s.city);
    say(`## ${s.address}, ${s.city}`);
    say('');
    if (inv.error) {
      say(`  REQUEST FAILED: ${inv.error}`);
      say('');
      continue;
    }
    reachable += 1;
    const pwsid = inv?.provider?.consensus?.pwsid || inv?.provider?.pwsid || '(unresolved)';
    const name = inv?.provider?.consensus?.provider_label || inv?.provider?.name || '(unknown)';
    say(`- Utility resolved to: **${name}**  (PWS ${pwsid})`);
    const link = ccrLinkFor(pwsid);
    say(`- Published CCR: ${link || 'not in ccr_index.json — search the utility website'}`);
    say('');
    say('**What the app displays:**');
    say('');
    say('```');
    detectionLines(inv).forEach(say);
    say('');
    say('PFAS:');
    pfasLines(inv).forEach(say);
    say('```');
    say('');
    say('| Check | App says | CCR says | Match? |');
    say('| --- | --- | --- | --- |');
    say(`| Utility name | ${name} | | |`);
    say('| Lead 90th percentile | | | |');
    say('| Highest PFAS result | | | |');
    say('| Any violation listed | | | |');
    say('');
  }

  say('## Sign-off');
  say('');
  say('- [ ] All six addresses resolved to the correct utility');
  say('- [ ] Every compared figure matches the published CCR');
  say('- [ ] No unit-scale discrepancies (ng/L vs ug/L vs mg/L)');
  say('- [ ] A private-well address does not show a neighbour well as its own water');
  say('- [ ] PFAS rule status re-checked at epa.gov/sdwa/proposed-pfas-rescission-rule');
  say('- [ ] Legal review complete');
  say('');
  say(`Verified by: ______________________  Date: ____________`);

  fs.writeFileSync(path.join(ROOT, OUT), lines.join('\n') + '\n');
  console.log(`\nWorksheet written to ${OUT}`);
  if (reachable === 0) {
    console.error('\nNo address reached the server. Start it first: node server.js');
    process.exit(1);
  }
})();
