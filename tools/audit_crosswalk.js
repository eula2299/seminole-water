'use strict';
/*
 * Standalone crosswalk audit against the REAL service-area layer.
 *
 *   node tools/audit_crosswalk.js [path/to/water_service_areas.geojson]
 *
 * Prints the coverage table the review asked for:
 *   polygons loaded / matched to provider / matched to single PWS /
 *   provider-only (multi-PWS) / unresolved — with a reason for every gap —
 *   and flags any resolved PWS that has no records in the bank (would generate
 *   an empty report).
 *
 * No dependencies; run it against your actual 107-polygon file.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const load = p => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p)));
const crosswalk = require(path.join(ROOT, 'lib/crosswalk'));
const { adaptAll, deriveSystems } = require(path.join(ROOT, 'lib/record_adapter'));

const geojsonPath = process.argv[2] || 'data/service_areas/water_service_areas.geojson';

let features;
try { features = (load(geojsonPath).features) || []; }
catch (e) { console.error(`Could not read GeoJSON at ${geojsonPath}: ${e.message}`); process.exit(1); }

const aliases = load('data/provider_aliases.json');
const records = adaptAll(load('data/all_contaminant_records.json'));
const systems = deriveSystems(load('data/systems.json'), records);
const index = crosswalk.buildCrosswalkIndex(systems, aliases, records);

const recCountByPwsid = records.reduce((m, r) => (m[r.pwsid] = (m[r.pwsid] || 0) + 1, m), {});

const report = crosswalk.validateCrosswalk(features, index);
console.log('================ CROSSWALK AUDIT ================');
console.log(`GeoJSON: ${geojsonPath}`);
console.log(crosswalk.printCoverage(report));

// Extra check: resolved polygons whose PWS has zero records -> empty report.
console.log('\n--- resolved-but-no-records (would yield an empty report) ---');
let emptyCount = 0;
for (const f of features) {
  const r = crosswalk.resolveProviderForFeature(f, index);
  if (!r.accepted) continue;
  const ids = r.pwsid_candidates && r.pwsid_candidates.length ? r.pwsid_candidates : [r.pwsid];
  const withData = ids.filter(id => recCountByPwsid[id]);
  if (!withData.length) {
    emptyCount++;
    console.log(`  ${r.provider_label} [${ids.join(', ')}] resolved but 0 records in bank`);
  }
}
if (!emptyCount) console.log('  (none — every resolved provider has records)');

console.log('\nDone. Any non-zero "Unmatched" above lists the exact polygon field/value and reason.');
