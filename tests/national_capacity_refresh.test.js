'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {syncSource}=require('../national/sync');
const bytes=Buffer.from('complete official download fixture'),digest=createHash('sha256').update(bytes).digest('hex');
function fixture({activeHash=digest,age=8*86400000,error='DATABASE_STORAGE_BUDGET_EXCEEDED',httpFailure=false}={}){
 const calls={downloads:0,batches:0,published:0,checked:0,failed:[]},events=[];
 const last={status:'failed',error_code:error,started_at:new Date(Date.now()-age).toISOString()};
 const job={metadata:async()=>{},activeHash:async()=>activeHash,unchanged:async()=>{calls.checked++;},batch:async()=>{calls.batches++;},publish:async()=>{calls.published++;},fail:async code=>{calls.failed.push(code);last.started_at=new Date().toISOString();last.error_code=code;}};
 const warehouse={status:async()=>({sources:[{source:'sdwis',run_id:'active',checked_at:'2020-01-01',latest_attempt:last}]}),importCapacity:async()=>({can_import:false,bytes:3002000000,maximum_bytes:3000000000}),beginImport:async()=>job};
 const fetchImpl=async(url,options)=>{calls.downloads++;if(httpFailure)return new Response('',{status:404});return new Response(options.method==='HEAD'?null:bytes,{headers:{'content-length':String(bytes.length),'last-modified':'Sat, 31 Oct 2026 00:00:00 GMT'}});};
 return {calls,events,options:{warehouse,fetchImpl,log:e=>events.push(e)}};
}
test('full database can verify an unchanged complete source without inserting records',async()=>{
 const f=fixture(),result=await syncSource('sdwis',f.options);
 assert.equal(result.status,'unchanged');assert.equal(result.sha256,digest);assert.equal(f.calls.downloads,2);assert.equal(f.calls.checked,1);assert.equal(f.calls.batches,0);assert.equal(f.calls.published,0);assert.deepEqual(f.calls.failed,[]);
});
test('changed checksum stays paused before parsing or inserting and throttles the next check',async()=>{
 const f=fixture({activeHash:'f'.repeat(64)}),result=await syncSource('sdwis',f.options);
 assert.equal(result.status,'storage-paused');assert.equal(result.source_changed,true);assert.equal(f.calls.checked,0);assert.equal(f.calls.batches,0);assert.equal(f.calls.published,0);assert.deepEqual(f.calls.failed,['DATABASE_STORAGE_BUDGET_EXCEEDED']);
 await syncSource('sdwis',f.options);assert.equal(f.calls.downloads,2);
});
test('recent capacity failure does not download on each hourly attempt',async()=>{
 const f=fixture({age:3600000});assert.equal((await syncSource('sdwis',f.options)).status,'storage-paused');assert.equal(f.calls.downloads,0);
});
test('network failure persists its true cause and remains throttled while full',async()=>{
 const f=fixture({httpFailure:true});await assert.rejects(syncSource('sdwis',f.options),/SOURCE_HTTP_404/);assert.deepEqual(f.calls.failed,['SOURCE_HTTP_404']);
 assert.equal((await syncSource('sdwis',f.options)).status,'storage-paused');assert.equal(f.calls.downloads,1);assert.equal(f.calls.checked,0);
});
test('minimum day interval prevents rapid probe cycles under short custom freshness',async()=>{
 const f=fixture({age:2*3600000});assert.equal((await syncSource('sdwis',{...f.options,freshnessMs:60000})).status,'storage-paused');assert.equal(f.calls.downloads,0);
});
