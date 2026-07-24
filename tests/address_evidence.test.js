'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {canonical,parseAddress,addressRangeMatch,classifyAddressEvidence,extractNeighborhoodCandidates,summarizeAddressEvidence}=require('../lib/address_evidence');
const {sourceApplies,parseDuckDuckGo,officialWaterLinks}=require('../lib/live_layer');

test('canonical normalizes street suffixes and punctuation',()=>{
  assert.equal(canonical("510 Kay's Landing Drive"),'510 KAYS LANDING DR');
  assert.equal(canonical('North Winter Park Road'),'N WINTER PARK RD');
});

test('parseAddress separates house number and street',()=>{
  assert.deepEqual(parseAddress('601 King Street, Oviedo, FL'),{line:'601 King Street',canonical:'601 KING ST',house_number:'601',street:'KING ST'});
});

test('classifies an explicit exact-address water notice',()=>{
  const x=classifyAddressEvidence({title:'Boil Water Notice',excerpt:'A precautionary boil water notice applies to 601 King Street, Oviedo.'},{full_address:'601 King St, Oviedo, FL',neighborhoods:[]});
  assert.equal(x.scope,'exact-address');
  assert.equal(x.water_relevant,true);
  assert.equal(x.address_specific,true);
});

test('classifies an affected numeric address range',()=>{
  const x=classifyAddressEvidence({title:'Boil Water Advisory',excerpt:'Affected areas: 500-650 King Street. Boil water for one minute.'},{full_address:'601 King St, Oviedo, FL',neighborhoods:[]});
  assert.equal(x.scope,'affected-address-range');
  assert.deepEqual(addressRangeMatch(canonical(x.excerpt),parseAddress('601 King St'))?.range,[500,650]);
});

test('does not match a house number outside an address range',()=>{
  const x=classifyAddressEvidence({title:'Boil Water Advisory',excerpt:'Affected areas: 100-200 King Street. Boil water for one minute.'},{full_address:'601 King St, Oviedo, FL',neighborhoods:[]});
  assert.equal(x.scope,'street');
});

test('classifies a neighborhood water notice',()=>{
  const x=classifyAddressEvidence({title:'Water main repair',excerpt:'A boil water notice affects the Kays Landing subdivision.'},{full_address:'510 Kays Landing Dr, Sanford, FL',neighborhoods:['Kays Landing']});
  assert.equal(x.scope,'neighborhood');
  assert.equal(x.neighborhood_specific,true);
});

test('marks lifted notices separately from active or unspecified notices',()=>{
  const x=classifyAddressEvidence({title:'Notice lifted',excerpt:'The boil water notice for 601 King St has been rescinded and the water is cleared.'},{full_address:'601 King St, Oviedo, FL'});
  assert.equal(x.notice_status,'lifted-or-rescinded');
});

test('non-water address result remains a low-confidence lead',()=>{
  const x=classifyAddressEvidence({title:'Real estate listing',excerpt:'601 King Street is a three-bedroom home.'},{full_address:'601 King St, Oviedo, FL'});
  assert.equal(x.scope,'exact-address');
  assert.equal(x.water_relevant,false);
  assert.ok(x.match_score<=.55);
});

test('extracts subdivision names from unpredictable parcel schemas',()=>{
  const n=extractNeighborhoodCandidates({SUBDIVISION_NAME:'Kays Landing Phase 2',owner_name:'Someone',NBHD_DESC:'North Sanford'},{subdivision:''});
  assert.deepEqual(n,['Kays Landing','North Sanford']);
});

test('summarizes only water-relevant address and neighborhood matches',()=>{
  const items=[
    classifyAddressEvidence({title:'Boil notice',excerpt:'Boil water notice at 601 King St.'},{full_address:'601 King St'}),
    classifyAddressEvidence({title:'House sale',excerpt:'601 King St sold.'},{full_address:'601 King St'})
  ];
  const s=summarizeAddressEvidence(items);
  assert.equal(s.counts.exact_address,1);
  assert.equal(s.matches.length,1);
  assert.equal(s.best_scope,'exact-address');
});

test('official source selector respects provider and PWS restrictions',()=>{
  assert.equal(sourceApplies({provider_patterns:['OVIEDO']},{system_name:'OVIEDO, CITY OF',city:'Oviedo',pwsid:'3590970'}),true);
  assert.equal(sourceApplies({provider_patterns:['SANFORD']},{system_name:'OVIEDO, CITY OF',city:'Oviedo',pwsid:'3590970'}),false);
  assert.equal(sourceApplies({pwsids:['3590201']},{system_name:'LAKE MARY, CITY OF',city:'Lake Mary',pwsid:'3590201'}),true);
});

test('DuckDuckGo parser returns public result cards without executing HTML',()=>{
  const html='<div class="result"><a rel="nofollow" class="result__a" href="https://example.gov/notice">Official notice</a><a class="result__snippet">Boil water notice for 601 King St</a></div>';
  const rows=parseDuckDuckGo(html,'2026-07-18T00:00:00Z');
  assert.equal(rows.length,1);
  assert.equal(rows[0].url,'https://example.gov/notice');
  assert.match(rows[0].excerpt,/Boil water/);
});


test('official alert scanner follows only same-origin water links',()=>{
  const html='<a href="/AlertCenter.aspx?AID=4">Boil Water Advisory</a><a href="https://evil.example/x">Water Quality</a><a href="/parks">Parks</a>';
  const links=officialWaterLinks(html,'https://www.city.example/alerts');
  assert.deepEqual(links,[{url:'https://www.city.example/AlertCenter.aspx?AID=4',label:'Boil Water Advisory'}]);
});
