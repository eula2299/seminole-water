'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {addressParts,validateInput}=require('../national/evidence');
const {createEngine,ENDPOINTS}=require('../national/service');

test('a full address preserves explicitly entered locality without another form field',()=>{
 for(const [address,street,city,state,zip] of [
  ['100 Synthetic St, Example, NY 10001','100 Synthetic St','Example','NY','10001'],
  ['100 Synthetic St, Example NY 10001-1234','100 Synthetic St','Example','NY','10001-1234'],
  ['100 Synthetic St, Apt 2, Example, New York 10001, USA','100 Synthetic St, Apt 2','Example','NY','10001'],
  ['100 Synthetic St, San Juan, Puerto Rico 00901','100 Synthetic St','San Juan','PR','00901'],
  ['100 Synthetic St, Washington, DC 20004','100 Synthetic St','Washington','DC','20004'],
  ['100 Synthetic St, Washington, District of Columbia 20004, United States','100 Synthetic St','Washington','DC','20004']
 ]){
  assert.deepEqual(addressParts(address),{street,city,state,zip});
  const input=validateInput({address});assert.equal(input.address,address);assert.equal(input.state,state);assert.equal(input.city,city);assert.equal(input.zip,zip);
 }
});
test('address parser does not invent a city boundary or infer a state from a ZIP',()=>{
 assert.deepEqual(addressParts('100 Synthetic St Example NY 10001'),{street:'',city:'',state:'NY',zip:'10001'});
 assert.deepEqual(addressParts('100 Synthetic St, Washington 20004'),{street:'',city:'',state:'',zip:'20004'});
 assert.equal(addressParts('100 Synthetic St, Toronto, ON M5V 2T6').state,'');
 assert.equal(addressParts('100 Synthetic St').city,'');
 assert.throws(()=>validateInput({address:'100 Synthetic St, Example, NY 10001',state:'CA'}),/does not match/);
 assert.throws(()=>validateInput({address:'100 Synthetic St, Example, NY 10001',zip:'90210'}),/does not match/);
});
test('one-line Census keeps the original full address and retry uses parsed structured fields',async()=>{
 const address='100 Synthetic St, Example, NY 10001',urls=[];
 const result=await createEngine({request:async url=>{
  urls.push(new URL(url));
  if(url.startsWith(ENDPOINTS.censusOneLine))return {result:{addressMatches:[]}};
  if(url.startsWith(ENDPOINTS.census))return {result:{addressMatches:[{matchedAddress:address,addressComponents:{state:'NY',city:'Example',zip:'10001'},coordinates:{x:-74,y:41}}]}};
  return {features:[]};
 }}).lookup({address});
 assert.equal(urls[0].searchParams.get('address'),address);
 const retry=urls.find(url=>url.pathname.endsWith('/address'));
 assert.equal(retry.searchParams.get('street'),'100 Synthetic St');assert.equal(retry.searchParams.get('city'),'Example');assert.equal(retry.searchParams.get('state'),'NY');assert.equal(retry.searchParams.get('zip'),'10001');assert.equal(result.address.status,'matched');
});
test('a missing geocoder address exposes contact listings without attaching their chemistry',async()=>{
 const seen=[];
 const warehouse={status:async()=>({status:'ready',sources:[]}),findLocalSystems:async query=>{seen.push(query);return [{pwsid:'NY0000001',name:'Fixture Water',state:'NY',active:true}];},lookupSystem:async pwsid=>({pwsid,status:'records-returned',system:{name:'Fixture Water'},observations:[],observation_summary:[{analyte:'Arsenic',unit:'µg/L',sample_results:1,non_detects:0,minimum_detected:2,maximum_detected:2,first_sample:'2020-01-01',last_sample:'2020-01-01'}],sources:[{source:'ucmr5',source_sha256:'a'.repeat(64),completed_at:'2026-01-01'}],counts:{observation:1}})};
 const result=await createEngine({warehouse,request:async url=>url.startsWith(ENDPOINTS.census)?{result:{addressMatches:[]}}:{Results:{QueryRows:'0'}}}).lookup({address:'100 Synthetic St, Example, NY 10001'});
 assert.equal(seen.length,1);assert.deepEqual(seen[0],{state:'NY',city:'Example',zip:'10001'});assert.equal(result.address.status,'unresolved');assert.equal(result.address.latitude,undefined);assert.equal(result.provider.method,'local-directory');assert.equal(result.provider.household_connection_verified,false);assert.equal(result.provider.requires_selection,true);assert.equal(result.provider.candidates[0].candidate_basis,'mailing-contact-address');assert.equal(result.resident_report.provider_ambiguity,true);assert.equal(result.resident_report.findings.length,0);assert.equal(result.resident_report.risk_profile.priority_risks.length,0);
 const chosen=await createEngine({warehouse,request:async url=>url.startsWith(ENDPOINTS.census)?{result:{addressMatches:[]}}:{Results:{QueryRows:'0'}}}).lookup({address:'100 Synthetic St, Example, NY 10001',pwsid:'NY0000002'});
 assert.equal(chosen.provider.requires_selection,false);assert.equal(chosen.provider.conflict,false);assert.deepEqual(chosen.provider.records_retrieved_for,['NY0000002']);assert.equal(chosen.resident_report.findings.length,1);
});
test('structured retry never converts two different Census points into a single address',async()=>{
 const rows=[1,2].map(n=>({matchedAddress:n+' Synthetic St, Example, NY 10001',addressComponents:{state:'NY',city:'Example',zip:'10001'},coordinates:{x:-74+n/1000,y:41}}));
 const result=await createEngine({request:async()=>({result:{addressMatches:rows}})}).lookup({address:'100 Synthetic St, Example, NY 10001'});
 assert.equal(result.address.status,'ambiguous');assert.equal(result.address.latitude,undefined);assert.equal(result.systems.length,0);
});
test('provider name search is bounded and returns only names and public identifiers',async()=>{
 let options;
 const rows=Array.from({length:15},(_,i)=>({pwsid:'NY'+String(i).padStart(7,'0'),name:'Fixture Water '+i,state:'NY',active:true,city:'Mailing City',email:'not-returned@example.test',address:'Not returned'}));
 const engine=createEngine({warehouse:{searchSystems:async input=>{options=input;return [{...rows[0],state:'CA'},rows[0],...rows];}}});
 const result=await engine.searchProviders({state:'ny',query:'  Fixture  '});
 assert.deepEqual(options,{state:'NY',query:'Fixture',limit:10});assert.equal(result.length,10);assert.equal(new Set(result.map(row=>row.id)).size,10);assert.deepEqual(Object.keys(result[0]).sort(),['id','name','state']);
 for(const invalid of [{state:'ZZ',query:'Water'},{state:'NY',query:'W'},{state:'NY',query:'a'.repeat(101)},{state:'NY',query:'Water\nOther'},{state:'NY',query:[]}])await assert.rejects(engine.searchProviders(invalid));
});
