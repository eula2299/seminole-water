'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createArchive}=require('../national/archive');
test('environmental archive preserves its separate scope and validates coordinates',async()=>{
 let url;const archive=createArchive({baseUrl:'http://localhost:8080',fetchImpl:async u=>{url=u;return Response.json({status:'records-returned',household_sample_verified:false,records:[{site_id:'USGS-X',value_text:'<0.005',pwsid:null}]});}});
 const result=await archive.lookupEnvironment({latitude:44.5,longitude:-93.5});assert.equal(url.pathname,'/environment/near');assert.equal(url.searchParams.get('lat'),'44.5');assert.equal(result.records[0].value_text,'<0.005');assert.equal(result.household_sample_verified,false);
 await assert.rejects(archive.lookupEnvironment({latitude:NaN,longitude:0}),/coordinates/);
 await assert.rejects(createArchive({baseUrl:'http://localhost',fetchImpl:async()=>Response.json({records:[],household_sample_verified:true})}).lookupEnvironment({latitude:0,longitude:0}),/SCHEMA/);
});
test('archive is optional and rejects unsafe configured HTTP destinations',()=>{
 assert.equal(createArchive({baseUrl:''}),null);
 for(const baseUrl of ['file:///tmp/data','http://public.example','https://user:pass@example.com'])assert.throws(()=>createArchive({baseUrl}));
});
test('older unvalidated archive summaries are unavailable until corrected release',async()=>{
 let calls=0;const archive=createArchive({baseUrl:'http://national-warehouse.railway.internal:8080',fetchImpl:async()=>{calls++;return Response.json({schema:'occurrence-warehouse/1',retained_source_records:123});}});
 const result=await archive.lookupSystem('NY0000001');assert.equal(result.status,'validation-update-pending');assert.deepEqual(result.summaries,[]);assert.equal(calls,2);
});
test('corrected archive validates full system ID and quarantines invalid summaries',async()=>{
 const archive=createArchive({baseUrl:'http://localhost:8080',fetchImpl:async url=>Response.json(url.pathname==='/status'?{schema:'occurrence-warehouse/2'}:{schema:'occurrence-warehouse/2',pwsid:'NY0000001',status:'records-returned',sources:[],summaries:[{analyte:'Arsenic',source_id:'syr4',invalid_identity_date:0},{analyte:'Lead',source_id:'syr4',invalid_identity_date:1}]})});
 const result=await archive.lookupSystem('NY0000001');assert.equal(result.summaries.length,1);assert.equal(result.quarantined_summaries,1);assert.equal(result.household_sample,false);
});
test('foreign PWSID, HTTP failures and excessive responses are not empty evidence',async()=>{
 const baseUrl='http://localhost:8080';
 const archive=createArchive({baseUrl,fetchImpl:async url=>Response.json(url.pathname==='/status'?{schema:'occurrence-warehouse/2'}:{pwsid:'CA0000001',sources:[],summaries:[]})});
 await assert.rejects(archive.lookupSystem('NY0000001'),/ARCHIVE_SCHEMA/);
 await assert.rejects(createArchive({baseUrl,fetchImpl:async()=>new Response('unavailable',{status:503})}).status(),/ARCHIVE_HTTP_ERROR/);
 await assert.rejects(createArchive({baseUrl,fetchImpl:async()=>new Response('x'.repeat(2000001))}).status(),/ARCHIVE_TOO_LARGE/);
});

test('bulk compliance rejects a foreign system even when outer archive identity matches',async()=>{
 const archive=createArchive({baseUrl:'http://localhost:8080',fetchImpl:async url=>Response.json(url.pathname==='/status'?{schema:'occurrence-warehouse/2'}:{schema:'occurrence-warehouse/2',pwsid:'NY0000001',sources:[],summaries:[],compliance:{pwsid:'NY0000001',records:[{PWSID:'CA0000001'}]}})});
 await assert.rejects(archive.lookupSystem('NY0000001'),/ARCHIVE_COMPLIANCE_IDENTITY/);
});

const pwsid='NY0000001';
function history(count=1){return {schema:'occurrence-warehouse/2',pwsid,status:'records-returned',serving_ready:true,sources:[{id:'syr4',url:'https://www.epa.gov/dwsixyearreview',sha256:'verified-source-hash'}],summaries:Array.from({length:count},(_,i)=>({source_id:'syr4',analyte:'Fixture substance '+i,scope:'system-monitoring',unit:'µg/L',n:2,detects:1,nondetects:1,min_detect:i+.25,max_detect:i+.25,first_date:'2018-01-01',last_date:'2019-01-01',invalid_identity_date:0}))};}
const compliance=()=>({pwsid,status:'no-records-in-snapshot',records:[],source:{sha256:'verified-compliance-hash'}});
test('a slow compliance source cannot discard 200 verified chemical summaries',async()=>{
 const paths=[],original=history(200);
 const archive=createArchive({baseUrl:'http://localhost',fetchImpl:async url=>{
  paths.push(url.pathname+url.search);
  if(url.pathname==='/status')return Response.json({schema:'occurrence-warehouse/2',serving_ready:true});
  if(url.pathname.startsWith('/compliance/'))throw Error('simulated cold-shard timeout');
  return Response.json(original);
 }});
 const result=await archive.lookupSystem(pwsid);
 assert.equal(result.summaries.length,200);assert.deepEqual(result.summaries,original.summaries);
 assert.equal(result.compliance.status,'unavailable');assert.ok(paths.includes('/pws/'+pwsid+'?include_compliance=0'));
});
test('system chemistry does not depend on the broader status endpoint',async()=>{
 const archive=createArchive({baseUrl:'http://localhost',fetchImpl:async url=>{
  if(url.pathname==='/status')throw Error('environmental checkpoint still saving');
  return Response.json(url.pathname.startsWith('/compliance/')?compliance():history(200));
 }});
 await assert.rejects(archive.status(),/checkpoint/);
 const result=await archive.lookupSystem(pwsid);assert.equal(result.summaries.length,200);assert.equal(result.retrieval.status,'live');
});
test('failed refresh retains exact last-verified values and dates, never beyond the age bound',async()=>{
 let clock=0,failed=false,calls=0;
 const archive=createArchive({baseUrl:'http://localhost',now:()=>clock,staleTtlMs:60000,fetchImpl:async url=>{
  calls++;if(failed)throw Error('simulated outage');
  return Response.json(url.pathname==='/status'?{schema:'occurrence-warehouse/2',serving_ready:true}:url.pathname.startsWith('/compliance/')?compliance():history());
 }});
 const first=await archive.lookupSystem(pwsid);const original=structuredClone(first.summaries);
 first.summaries[0].max_detect=999999;first.sources[0].sha256='mutated-client-copy';
 const cached=await archive.lookupSystem(pwsid);assert.equal(calls,2);assert.deepEqual(cached.summaries,original);assert.equal(cached.retrieval.status,'cached');
 failed=true;clock=31000;
 const saved=await archive.lookupSystem(pwsid);assert.deepEqual(saved.summaries,original);assert.equal(saved.retrieval.status,'saved');assert.equal(saved.retrieval.checked_at,'1970-01-01T00:00:00.000Z');assert.equal(saved.compliance.retrieval.status,'saved');assert.equal(saved.sources[0].sha256,'verified-source-hash');
 clock=60001;await assert.rejects(archive.lookupSystem(pwsid),/simulated outage/);
});
test('partly restored archives cannot overwrite a complete verified snapshot',async()=>{
 let clock=0,ready=true,chemistryCalls=0;
 const archive=createArchive({baseUrl:'http://localhost',now:()=>clock,fetchImpl:async url=>{
  if(url.pathname==='/status')return Response.json({schema:'occurrence-warehouse/2',serving_ready:ready});
  if(url.pathname.startsWith('/compliance/'))return Response.json(compliance());
  chemistryCalls++;return Response.json({...history(ready?200:30),serving_ready:ready});
 }});
 assert.equal((await archive.lookupSystem(pwsid)).summaries.length,200);
 clock=31000;ready=false;const saved=await archive.lookupSystem(pwsid);
 assert.equal(saved.summaries.length,200);assert.equal(saved.retrieval.status,'saved');assert.equal(chemistryCalls,2);
});
test('independent compliance remains available when chemistry cannot load',async()=>{
 const archive=createArchive({baseUrl:'http://localhost',fetchImpl:async url=>{
  if(url.pathname==='/status')return Response.json({schema:'occurrence-warehouse/2',serving_ready:true});
  if(url.pathname.startsWith('/compliance/'))return Response.json({...compliance(),status:'records-returned',records:[{PWSID:pwsid,VIOLATION_ID:'fixture'}]});
  throw Error('chemistry unavailable');
 }});
 const result=await archive.lookupSystem(pwsid);assert.equal(result.status,'chemistry-unavailable');assert.equal(result.summaries.length,0);assert.equal(result.compliance.records[0].VIOLATION_ID,'fixture');
});
test('concurrent lookups share bounded requests and independent returned objects',async()=>{
 const calls=[];
 const archive=createArchive({baseUrl:'http://localhost',fetchImpl:async url=>{calls.push(url.pathname);await new Promise(resolve=>setImmediate(resolve));return Response.json(url.pathname==='/status'?{schema:'occurrence-warehouse/2',serving_ready:true}:url.pathname.startsWith('/compliance/')?compliance():history());}});
 const results=await Promise.all(Array.from({length:20},()=>archive.lookupSystem(pwsid)));
 assert.equal(calls.length,2);results[0].summaries[0].max_detect=123;
 assert.equal(results[1].summaries[0].max_detect,.25);
});
test('the snapshot cache evicts old systems within its entry bound',async()=>{
 let calls=0;
 const archive=createArchive({baseUrl:'http://localhost',fetchImpl:async url=>{calls++;if(url.pathname==='/status')return Response.json({schema:'occurrence-warehouse/2',serving_ready:true});const id=url.pathname.split('/').pop();return Response.json(url.pathname.startsWith('/compliance/')?{...compliance(),pwsid:id}:{...history(),pwsid:id});}});
 for(let i=1;i<=25;i++)await archive.lookupSystem('NY'+String(i).padStart(7,'0'));
 const before=calls;await archive.lookupSystem(pwsid);assert.equal(calls,before+2);
});
