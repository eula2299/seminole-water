'use strict';
// End-to-end crosswalk + engine integration tests (item 4 of the review).
// Proves: polygon -> provider -> PWS -> contaminant report, for every named
// jurisdiction, plus the multi-PWS county case and out-of-county rejection.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p)));
const crosswalk = require(path.join(ROOT, 'lib/crosswalk'));
const { adaptAll, deriveSystems, deriveProviderAliases } = require(path.join(ROOT, 'lib/record_adapter'));
const { buildInvestigation } = require(path.join(ROOT, 'lib/investigator'));

const registry = load('data/source_registry.json');
const records = adaptAll(load('data/all_contaminant_records.json'));
const fdepSystems = load('data/fdep_system_registry.json');
const systems = deriveSystems([...load('data/systems.json'), ...fdepSystems], records);
const aliases = deriveProviderAliases(load('data/provider_aliases.json'), fdepSystems, systems);
const index = crosswalk.buildCrosswalkIndex(systems, aliases, records);

// Each case uses a DIFFERENT polygon field name on purpose, to prove the
// crosswalk discovers the provider field rather than assuming a fixed schema.
const CASES = [
  { city: 'Sanford',           poly: { AGENCY: 'City of Sanford' },                 pwsid: '3590205' },
  { city: 'Lake Mary',         poly: { PROV: 'City of Lake Mary Water Dept' },      pwsid: '3590201' },
  { city: 'Oviedo',            poly: { UTILITY_NAME: 'Oviedo' },                    pwsid: '3590970' },
  { city: 'Winter Springs',    poly: { WATERSYS: 'City of Winter Springs' },        pwsid: '3590879' },
  { city: 'Casselberry',       poly: { LABEL: 'Casselberry', PWSID: '3590159' },    pwsid: '3590159' },
  { city: 'Altamonte Springs', poly: { OPERATOR: 'Altamonte Springs' },             pwsid: '3590026' },
  { city: 'Longwood',          poly: { NAME_OF_UT: 'City of Longwood' },            pwsid: '3590202' },
  { city: 'Bear Lake Manor',   poly: { DESC: 'Bear Lake Manor Mobile Home Park' },  pwsid: '3590069' }
];

function runReport(pwsid, city, liveWeb={ items: [], errors: [] }) {
  const match = { pwsid, name: '', matchMethod: 'test-polygon', properties: { ZONE_ID: 'Z1' } };
  return buildInvestigation(
    { address: '1 Test St', city, household_size: 2 },
    {
      geocode: { lon: -81.3, lat: 28.7, matchedAddress: '1 TEST ST', tigerLine: {} },
      secondaryGeocode: null,
      geocodeConsensus: { primary_available: true, secondary_available: false, disagreement_meters: null, low_confidence: false, selected: 'census-primary' },
      serviceMatches: [match], spatialAssessment: { gap: false, overlap: false, near_boundary: false },
      serviceAreaVersion: { version: 't' }, systems, records, aliases, registry,
      directRows: [], liveErrors: [], utilityLineage: [], sourceInterconnections: [],
      labRegistry: [], liveWeb, publicRecordsTracker: { requests: [] }, hydraulicGraph: { edges: [] }
    }
  );
}

for (const c of CASES) {
  test(`crosswalk: ${c.city} polygon resolves to PWS ${c.pwsid}`, () => {
    const r = crosswalk.resolveProviderForFeature({ properties: c.poly }, index);
    assert.ok(r.accepted, `expected ${c.city} to resolve; got: ${r.reason}`);
    assert.strictEqual(r.pwsid, c.pwsid, `${c.city} resolved to ${r.pwsid}, expected ${c.pwsid}`);
  });

  test(`end-to-end: ${c.city} produces a contaminant report`, () => {
    const inv = runReport(c.pwsid, c.city);
    assert.strictEqual(inv.statuses.location, 'exact-address-to-system-match');
    assert.ok(inv.provider.system && inv.provider.system.pwsid === c.pwsid);
    assert.ok(inv.analyte_reports.length > 0, `${c.city} yielded no analyte reports`);
  });
}

// The four Seminole County systems are geographic quadrants. When a polygon
// carries the quadrant name (or the PWS id) it must resolve to the SPECIFIC
// sub-system, and generate that sub-system's report.
const COUNTY_QUADRANTS = [
  { area: 'Northeast', poly: { WATERSYS: 'Seminole County Northeast' }, pwsid: '3590473' },
  { area: 'Southeast', poly: { LABEL: 'SEMINOLE COUNTY SOUTHEAST' },    pwsid: '3590571' },
  { area: 'Southwest', poly: { PROV: 'Seminole County Southwest' },     pwsid: '3590785' },
  { area: 'Northwest', poly: { UTIL: 'Seminole County', PWSID: '3594107' }, pwsid: '3594107' }
];
for (const q of COUNTY_QUADRANTS) {
  test(`county quadrant: ${q.area} polygon resolves to specific PWS ${q.pwsid}`, () => {
    const r = crosswalk.resolveProviderForFeature({ properties: q.poly }, index);
    assert.ok(r.accepted, `county ${q.area} should resolve; got: ${r.reason}`);
    assert.strictEqual(r.sub_system_ambiguous, false, `${q.area} should NOT be ambiguous when the quadrant is identified`);
    assert.strictEqual(r.pwsid, q.pwsid, `${q.area} resolved to ${r.pwsid}, expected ${q.pwsid}`);
  });
  test(`county quadrant end-to-end: ${q.area} produces its own report`, () => {
    const inv = runReport(q.pwsid, 'Seminole County');
    assert.ok(inv.provider.system && inv.provider.system.pwsid === q.pwsid);
    assert.ok(inv.analyte_reports.length > 0, `${q.area} yielded no analyte reports`);
  });
}

test('county fallback: an undifferentiated "Seminole County" polygon stays provider-level with all sub-systems listed', () => {
  const r = crosswalk.resolveProviderForFeature({ properties: { UTILITY_NAME: 'Seminole County Utilities' } }, index);
  assert.ok(r.accepted, `county should resolve at provider level; got: ${r.reason}`);
  assert.ok(r.sub_system_ambiguous, 'undifferentiated county should be flagged sub_system_ambiguous');
  assert.deepStrictEqual([...r.pwsid_candidates].sort(), aliases['SEMINOLE COUNTY'].slice().sort());
});

test('crosswalk: out-of-county polygon is honestly unresolved (no false assignment)', () => {
  const r = crosswalk.resolveProviderForFeature({ properties: { NAME: 'Reedy Creek Improvement District' } }, index);
  assert.strictEqual(r.accepted, false);
  assert.strictEqual(r.pwsid, null);
});

test('crosswalk: provider field is discovered even under an unexpected field name', () => {
  const r = crosswalk.resolveProviderForFeature({ properties: { SOME_RANDOM_COL: 'City of Sanford' } }, index);
  assert.ok(r.accepted);
  assert.strictEqual(r.pwsid, '3590205');
  assert.strictEqual(r.diagnostic.provider_field, 'SOME_RANDOM_COL');
});

test('expanded contaminant classes are reachable (not metals-only)', () => {
  const inv = runReport('3590069', 'Bear Lake');
  const groups = new Set(load('data/all_contaminant_records.json').filter(x => x.pwsid === '3590069').map(x => x.contaminant_group));
  assert.ok(groups.has('DBP') && groups.has('VOC') && groups.has('RAD'), 'DBP/VOC/RAD should be present in the bank');
  assert.ok(inv.analyte_reports.length > 20, 'expanded classes should yield many analyte reports');
});


test('crosswalk keeps Lake Mary MHP distinct from the City of Lake Mary', () => {
  const r = crosswalk.resolveProviderForFeature({ properties: { PROVIDER_NAME: 'Lake Mary MHP' } }, index);
  assert.ok(r.accepted, r.reason);
  assert.strictEqual(r.pwsid, '3591248');
});


test('end-to-end online address evidence is displayed but never upgraded into a household concentration', () => {
  const item = {
    id: 'official-notice', title: 'Boil Water Notice', publisher: 'City of Oviedo',
    url: 'https://www.cityofoviedo.net/notice', excerpt: 'A boil water notice applies to 1 Test Street.',
    text: 'A boil water notice applies to 1 Test Street.', tier: 'official-live',
    scope: 'exact-address', match_score: 1, match_reason: 'The source explicitly names the address.',
    water_relevant: true, notice_status: 'active-or-unspecified', address_specific: true
  };
  const inv = runReport('3590970', 'Oviedo', {items:[item],errors:[],checked_at:'2026-07-18T00:00:00Z',public_search_enabled:true});
  assert.strictEqual(inv.live_web.address_evidence.best_scope, 'exact-address');
  assert.strictEqual(inv.statuses.result_level, 'exact-address/system-level-water-quality');
  assert.strictEqual(inv.statuses.direct_data, 'no-exact-household-sample-found');
  const agent=inv.agents.find(x=>x.name==='Address & Neighborhood Online Evidence Agent');
  assert.strictEqual(agent.status, 'address-specific-evidence-found');
  assert.ok(inv.evidence.some(x=>x.type==='address-or-neighborhood-online-evidence'));
});

test('end-to-end federal context adds SDWIS, WQP, and CCR agents without turning ambient data into a tap sample', () => {
  const match = { pwsid: '3590970', name: 'OVIEDO', matchMethod: 'test-polygon', properties: { ZONE_ID: 'Z1' } };
  const federalContext = {
    sdwis:{synced:true,system:{pwsid:'3590970',pws_name:'OVIEDO, CITY OF'},compliance_status:'no-active-violations-in-synced-cache',violations:{all:[],active:[],active_health_based_or_treatment:[],active_monitoring_or_reporting:[]},facilities:[],geographic_areas:[],service_areas:[],lcr_samples:[],site_visits:[],events:[],public_notices:[],disclaimer:'system context'},
    wqp:{synced:true,radius_miles:15,stations:[{monitoring_location_id:'WQP-1',monitoring_location_name:'Lake station',distance_miles:2.1,latest_results:[{characteristic:'Nitrate',value:'0.2',unit:'mg/L',sample_date:'2025-01-01'}]}],disclaimer:'not household tap samples'},
    ccr:{synced:true,latest:{pwsid:'3590970',report_year:2024,title:'2024 Water Quality Report',url:'https://example.gov/ccr.pdf'},reports:[],disclaimer:'system-level report'},
    summary:{status:'synced'}
  };
  const inv=buildInvestigation({address:'1 Test St',city:'Oviedo'}, {
    geocode:{lon:-81.2,lat:28.7,matchedAddress:'1 TEST ST'},secondaryGeocode:null,
    geocodeConsensus:{primary_available:true,secondary_available:false,disagreement_meters:null,low_confidence:false,selected:'census'},
    serviceMatches:[match],spatialAssessment:{gap:false,overlap:false,near_boundary:false},serviceAreaVersion:{version:'t'},
    systems,records,aliases,registry,directRows:[],liveErrors:[],utilityLineage:[],sourceInterconnections:[],labRegistry:[],
    liveWeb:{items:[],errors:[]},publicRecordsTracker:{requests:[]},hydraulicGraph:{edges:[]},federalContext
  });
  assert.equal(inv.federal_data.sdwis.system.pws_name,'OVIEDO, CITY OF');
  assert.equal(inv.agents.find(x=>x.name==='EPA SDWIS System & Compliance Agent').status,'completed');
  assert.equal(inv.agents.find(x=>x.name==='Consumer Confidence Report Agent').status,'report-found');
  assert.equal(inv.statuses.direct_data,'no-exact-household-sample-found');
  assert.ok(inv.evidence.some(x=>x.type==='nearby-environmental-monitoring'));
  assert.ok(inv.proof.what_is_not_proven.some(x=>/Water Quality Portal/.test(x)));
});


test('crosswalk skips ArcGIS metadata instead of treating the official item id as a provider', () => {
  const r = crosswalk.resolveProviderForFeature({properties:{WaterDistrict:null,_official_item_id:'41f6f18ec9cd48a5b89b94e946cf2143',_official_layer_url:'https://example.gov/layer'}}, index);
  assert.equal(r.accepted,false);
  assert.equal(r.classification,'unassigned-no-provider-label');
  assert.equal(r.diagnostic.provider_field,'(none found)');
});


test('FGUA polygon stays provider-level without address locality', () => {
  const r = crosswalk.resolveProviderForFeature({properties:{WaterDistrict:'FLORIDA GOVT UTILITY AUTHORITY'}}, index);
  assert.ok(r.accepted, r.reason);
  assert.ok(r.sub_system_ambiguous);
  assert.deepStrictEqual([...r.pwsid_candidates].sort(), ['3590186','3590497']);
});

test('FGUA Chuluota address resolves to Chuluota Water System 3590186', () => {
  const r = crosswalk.resolveProviderForFeature({properties:{WaterDistrict:'FLORIDA GOVT UTILITY AUTHORITY'}}, index, {location_city:'Chuluota'});
  assert.ok(r.accepted, r.reason);
  assert.strictEqual(r.pwsid, '3590186');
  assert.strictEqual(r.sub_system_ambiguous, false);
});

test('FGUA Altamonte Springs address resolves to Harmony Homes 3590497', () => {
  const r = crosswalk.resolveProviderForFeature({properties:{WaterDistrict:'FLORIDA GOVT UTILITY AUTHORITY'}}, index, {location_city:'Altamonte Springs'});
  assert.ok(r.accepted, r.reason);
  assert.strictEqual(r.pwsid, '3590497');
  assert.strictEqual(r.sub_system_ambiguous, false);
});

const OFFICIAL_LABEL_FIXES = [
  ['LAKE HARNEY WATER ASSOC.','3590698'],
  ['MULLET LAKE WATER ASSOC.','3590865'],
  ['PALM VALLEY ASSOC.','3590988'],
  ['TWELVE OAKS CAMPGROUND','3591395'],
  ['JANSEN','3590615'],
  ['PHILLIPS','3591008'],
  ['CRYSTAL LAKE','3590258'],
  ['BLACK HAMMOCK','3594186'],
  ['SER','3590571'],
  ['LAKE HARRIET','3590785']
];
for(const [label,pwsid] of OFFICIAL_LABEL_FIXES){
  test(`official WaterDistrict label ${label} resolves to ${pwsid}`,()=>{
    const r=crosswalk.resolveProviderForFeature({properties:{WaterDistrict:label}},index);
    assert.ok(r.accepted,r.reason);
    assert.equal(r.pwsid,pwsid);
  });
}

test('coverage separates blank/unassigned polygons from named-provider failures',()=>{
  const report=crosswalk.validateCrosswalk([
    {properties:{WaterDistrict:'SANFORD'}},
    {properties:{WaterDistrict:null,_official_item_id:'41f6f18ec9cd48a5b89b94e946cf2143'}},
    {properties:{WaterDistrict:'NOT A REAL PROVIDER'}}
  ],index);
  assert.equal(report.loaded_polygons,3);
  assert.equal(report.blank_or_unassigned_polygons,1);
  assert.equal(report.named_provider_polygons,2);
  assert.equal(report.matched_provider,1);
  assert.equal(report.unmatched_named_provider,1);
  assert.equal(report.named_provider_coverage_pct,50);
});
