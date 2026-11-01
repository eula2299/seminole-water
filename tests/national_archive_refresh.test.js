'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {archiveServingSource,syncSource,SOURCES}=require('../national/sync');
const now=Date.now();
const provenance=source=>({url:SOURCES[source].url,sha256:'a'.repeat(64),retrieved_at:new Date(now-10000).toISOString()});
const inventory=()=>({schema:'occurrence-warehouse/2',serving_ready:true,sources:{ucmr5:{...provenance('ucmr5'),count_state:'published',parser_current:true,eligible_source_records:1991977}},compliance_archive:{directory:{status:'available',source:provenance('sdwis'),source_rows:434040}}});
test('only current verified serving receipts replace redundant database imports',()=>{
 for(const source of ['sdwis','ucmr5'])assert.equal(archiveServingSource(source,inventory(),{now}).status,'archive-serving');
 assert.equal(archiveServingSource('sdwis-violations',inventory(),{now}),null);
 for(const change of [d=>d.serving_ready=false,d=>d.sources.ucmr5.parser_current=false,d=>d.sources.ucmr5.sha256='',d=>d.sources.ucmr5.url='https://other.example',d=>d.sources.ucmr5.retrieved_at='2025-01-01']){
  const d=inventory();change(d);assert.equal(archiveServingSource('ucmr5',d,{now}),null);
 }
 for(const change of [d=>d.compliance_archive.directory.status='not-acquired',d=>d.compliance_archive.directory.source.sha256='',d=>d.compliance_archive.directory.source.retrieved_at='2025-01-01']){
  const d=inventory();change(d);assert.equal(archiveServingSource('sdwis',d,{now}),null);
 }
});
test('verified archive avoids database snapshot allocation and does not alter database timestamps',async()=>{
 let touched=0;
 const warehouse={status:async()=>{touched++;throw Error('database full');},beginImport:async()=>{touched++;throw Error('database full');}};
 const result=await syncSource('sdwis',{warehouse,archive:{status:async()=>inventory()},log:()=>{}});
 assert.equal(result.status,'archive-serving');assert.equal(result.postgres_snapshot,'retained-fallback');assert.equal(touched,0);
});
test('failed or stale archive continues existing database workflow',async()=>{
 for(const archive of [{status:async()=>{throw Error('offline');}},{status:async()=>({...inventory(),serving_ready:false})}]){
  let touched=0;
  const warehouse={status:async()=>{touched++;return {sources:[{source:'sdwis',run_id:'retained',checked_at:new Date().toISOString()}]};}};
  assert.equal((await syncSource('sdwis',{warehouse,archive,log:()=>{}})).status,'fresh');assert.equal(touched,1);
 }
});
