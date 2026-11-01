'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDirectory,withArchiveDirectory}=require('../national/directory');
const raw={PWSID:'WA5370000',PWS_NAME:'Redmond',STATE_CODE:'WA',PWS_TYPE_CODE:'CWS',PWS_ACTIVITY_CODE:'A',CITY_NAME:'Redmond',ZIP_CODE:'98052',POPULATION_SERVED_COUNT:'72000'};
const source={url:'https://echo.epa.gov/files/echodownloads/SDWA_latest_downloads.zip',sha256:'a'.repeat(64),retrieved_at:'2026-11-01T01:00:00Z'};
function payload(records=[raw],extras={}){return {schema:'sdwis-directory/1',status:records.length?'records-returned':'no-matching-records',records,source,total_records:434000,truncated:false,...extras};}
function client(body){return createDirectory({baseUrl:'https://archive.example',fetchImpl:async()=>new Response(JSON.stringify(body))});}
test('directory verifies official provenance and keeps reported values',async()=>{
 const r=await client(payload()).lookupSystem(raw.PWSID);
 assert.equal(r.system.population_served,72000);assert.equal(r.system.state,'WA');assert.equal(r.system.active,true);assert.equal(r.source.sha256,source.sha256);
});
test('directory rejects mismatched identity, unverifiable source and ambiguous records',async()=>{
 for(const body of [payload([{...raw,PWSID:'WA0000001'}]),payload([raw],{source:{...source,url:'https://other.example/file.zip'}}),payload([raw],{source:{...source,sha256:''}}),payload([raw],{status:'ambiguous'}),payload([raw,{...raw,PWS_NAME:'Different supplier'}]),payload([raw],{truncated:true})]){
  await assert.rejects(()=>client(body).lookupSystem(raw.PWSID));
 }
});
test('local directory rejects wrong-state and wrong-city results, retains numeric tribal IDs',async()=>{
 const options={state:'WA',city:'Redmond',zip:'98052',local:true};
 for(const row of [{...raw,STATE_CODE:'OR'},{...raw,PWSID:'OR5370000'},{...raw,CITY_NAME:'Seattle',ZIP_CODE:'98101'},{...raw,PWS_ACTIVITY_CODE:'I'}])await assert.rejects(()=>client(payload([row])).searchSystems(options));
 assert.equal((await client(payload([{...raw,PWSID:'095370000'}])).searchSystems(options)).rows.length,1);
});
test('fresh directory replaces supplier details without replacing historical measurements',async()=>{
 const observation={value:0.003,unit:'mg/L',sample_date:'2025-01-01'};
 const old={status:'records-returned',system:{name:'Old name'},observations:[observation],violations:[{violation_id:'v1'}],observation_summary:[{sample_results:'45'}],counts:{system:'1',observation:'45'},sources:[{source:'ucmr5'}]};
 const hybrid=withArchiveDirectory({lookupSystem:async()=>old},client(payload()));
 const r=await hybrid.lookupSystem(raw.PWSID);
 assert.equal(r.system.name,'Redmond');assert.deepEqual(r.observations,[observation]);assert.equal(r.counts.observation,'45');assert.deepEqual(r.sources,old.sources);assert.equal(r.directory_status,'archive-verified');
 assert.equal(old.system.name,'Old name');
});
test('verified current absence does not resurrect obsolete directory entry',async()=>{
 const hybrid=withArchiveDirectory({lookupSystem:async()=>({status:'records-returned',system:{name:'Removed'},counts:{system:'1'},observations:[]})},client(payload([])));
 const r=await hybrid.lookupSystem(raw.PWSID);assert.equal(r.system,null);assert.equal(r.counts.system,'0');
});
test('failed directory preserves database; failed database can still use verified supplier',async()=>{
 const legacy={status:'records-returned',system:{name:'Retained'},observations:[{value:2}],counts:{observation:'1'}};
 const fallback=withArchiveDirectory({lookupSystem:async()=>legacy,searchSystems:async()=>['legacy-search'],findLocalSystems:async()=>['legacy-local']},client(payload([raw],{status:'not-acquired'})));
 assert.equal((await fallback.lookupSystem(raw.PWSID)).system.name,'Retained');assert.deepEqual(await fallback.searchSystems({state:'WA'}),['legacy-search']);assert.deepEqual(await fallback.findLocalSystems({state:'WA'}),['legacy-local']);
 const failed=withArchiveDirectory({lookupSystem:async()=>{throw Error('offline');}},client(payload()));
 const r=await failed.lookupSystem(raw.PWSID);assert.equal(r.system.name,'Redmond');assert.deepEqual(r.observations,[]);assert.equal(r.observation_status,'unavailable');
});
test('missing archive configuration retains existing warehouse instance',()=>{
 const warehouse={};assert.equal(withArchiveDirectory(warehouse,null),warehouse);
});
test('ZIP+4 requests use the verified five-digit directory field',async()=>{
 let requested;
 const directory=createDirectory({baseUrl:'https://archive.example',fetchImpl:async url=>{requested=new URL(url);return new Response(JSON.stringify(payload()));}});
 await directory.searchSystems({state:'WA',city:'Redmond',zip:'98052-1234',local:true});
 assert.equal(requested.searchParams.get('zip'),'98052');
});
