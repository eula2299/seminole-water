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
 const result=await archive.lookupSystem('NY0000001');assert.equal(result.status,'validation-update-pending');assert.deepEqual(result.summaries,[]);assert.equal(calls,1);
});
test('corrected archive validates full system ID and quarantines invalid summaries',async()=>{
 const archive=createArchive({baseUrl:'http://localhost:8080',fetchImpl:async url=>Response.json(url.pathname==='/status'?{schema:'occurrence-warehouse/2'}:{pwsid:'NY0000001',status:'records-returned',sources:[],summaries:[{analyte:'Arsenic',source_id:'syr4',invalid_identity_date:0},{analyte:'Lead',source_id:'syr4',invalid_identity_date:1}]})});
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
 const archive=createArchive({baseUrl:'http://localhost:8080',fetchImpl:async url=>Response.json(url.pathname==='/status'?{schema:'occurrence-warehouse/2'}:{pwsid:'NY0000001',sources:[],summaries:[],compliance:{pwsid:'NY0000001',records:[{PWSID:'CA0000001'}]}})});
 await assert.rejects(archive.lookupSystem('NY0000001'),/ARCHIVE_COMPLIANCE_IDENTITY/);
});
