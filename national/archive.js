'use strict';
const {validPwsid}=require('./evidence');

function createArchive({baseUrl=process.env.NATIONAL_ARCHIVE_URL,fetchImpl=fetch,now=Date.now,requestTimeoutMs=5000,cacheTtlMs=30000,staleTtlMs=21600000,maxCacheBytes=8000000}={}){
 if(!baseUrl)return null;
 const base=new URL(baseUrl);
 if(base.username||base.password||base.search||base.hash||!['http:','https:'].includes(base.protocol))throw new Error('Invalid configured archive URL');
 if(base.protocol==='http:'&&!base.hostname.endsWith('.railway.internal')&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw new Error('Archive HTTP requires the private network');
 async function get(path){
  const r=await fetchImpl(new URL(path,base),{redirect:'error',signal:AbortSignal.timeout(requestTimeoutMs),headers:{Accept:'application/json'}});
  if(!r.ok){await r.body?.cancel();throw new Error('ARCHIVE_HTTP_ERROR');}
  const reader=r.body.getReader();let bytes=0;const chunks=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2000000)throw new Error('ARCHIVE_TOO_LARGE');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 let cached=null,pending=null,expires=0;
 async function status(){
  if(cached&&now()<expires)return cached;
  if(!pending)pending=get('/status').then(data=>{if(!String(data.schema||'').startsWith('occurrence-warehouse/'))throw new Error('ARCHIVE_SCHEMA');cached=data;expires=now()+15000;return data;}).finally(()=>{pending=null;});
  return pending;
 }
 // Public-system snapshots only: no resident addresses or household documents.
 // Chemistry and compliance are independently bounded so a cold compliance
 // shard cannot erase every historical chemistry result in the response.
 const snapshots=new Map(),inflight=new Map();let cacheBytes=0;
 function remember(key,data){
  const bytes=Buffer.byteLength(JSON.stringify(data));if(bytes>maxCacheBytes)return;
  const previous=snapshots.get(key);if(previous){cacheBytes-=previous.bytes;snapshots.delete(key);}
  while(snapshots.size>=48||cacheBytes+bytes>maxCacheBytes){const first=snapshots.keys().next().value;if(first===undefined)break;cacheBytes-=snapshots.get(first).bytes;snapshots.delete(first);}
  snapshots.set(key,{data:structuredClone(data),checked:now(),bytes});cacheBytes+=bytes;
 }
 const withRetrieval=(entry,status)=>({...structuredClone(entry.data),retrieval:{status,checked_at:new Date(entry.checked).toISOString(),refresh_unavailable:status==='saved'}});
 async function snapshot(key,load,acceptable){
  const previous=snapshots.get(key);
  if(previous&&now()-previous.checked<cacheTtlMs)return withRetrieval(previous,'cached');
  if(inflight.has(key))return structuredClone(await inflight.get(key));
  const job=(async()=>{
   try{
    if(inflight.size>=32)throw Error('ARCHIVE_BUSY');
    const data=await load();
    if(!acceptable(data))throw Error('ARCHIVE_INITIALIZING');
    remember(key,data);
    return {...data,retrieval:{status:'live',checked_at:new Date(now()).toISOString(),refresh_unavailable:false}};
   }catch(error){
    if(previous&&now()-previous.checked<=staleTtlMs)return withRetrieval(previous,'saved');
    throw error;
   }
  })();
  inflight.set(key,job);
  try{return structuredClone(await job);}finally{if(inflight.get(key)===job)inflight.delete(key);}
 }
 function validateCompliance(data,pwsid){
  if(data.pwsid!==pwsid||!Array.isArray(data.records)||data.records.some(r=>String(r.PWSID||'').trim().toUpperCase()!==pwsid))throw Error('ARCHIVE_COMPLIANCE_IDENTITY');
  return data;
 }
 async function lookupSystem(pwsid){
  if(!validPwsid(pwsid))throw new Error('Invalid archive PWSID');
  const chemistry=snapshot('chemistry:'+pwsid,async()=>{
   const data=await get('/pws/'+pwsid+'?include_compliance=0');
   if(data.schema==='occurrence-warehouse/1')return {status:'validation-update-pending',summaries:[],sources:[],schema:data.schema};
   if(data.schema!=='occurrence-warehouse/2'||data.pwsid!==pwsid||!Array.isArray(data.summaries)||!Array.isArray(data.sources))throw new Error('ARCHIVE_SCHEMA');
   // An old server may still return the combined response during a rollout.
   if(data.compliance)validateCompliance(data.compliance,pwsid);
   const accepted=data.summaries.filter(r=>Number(r.invalid_identity_date||0)===0&&r.analyte&&r.source_id);
   return {...data,status:accepted.length?'records-returned':data.status,summaries:accepted,quarantined_summaries:data.summaries.length-accepted.length,household_sample:false};
  },data=>data.serving_ready!==false);
  // Older releases have no separate endpoint. A validated embedded response
  // above is preferred in that case, keeping rolling deployments compatible.
  const compliance=snapshot('compliance:'+pwsid,async()=>validateCompliance(await get('/compliance/'+pwsid),pwsid),data=>['records-returned','no-records-in-snapshot'].includes(data.status)).catch(()=>null);
  const [history,issues]=await Promise.allSettled([chemistry,compliance]);
  const detail=issues.status==='fulfilled'?issues.value:null;
  if(history.status==='rejected'){
   if(!detail)throw history.reason;
   return {pwsid,status:'chemistry-unavailable',summaries:[],sources:[],compliance:detail,household_sample:false,retrieval:{status:'unavailable',checked_at:null,refresh_unavailable:true}};
  }
  return {...history.value,compliance:history.value.compliance||detail||{pwsid,status:'unavailable',records:[],current_safety:'not-determined'}};
 }
 async function lookupEnvironment(address){
  const {latitude:lat,longitude:lon}=address;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('Invalid environmental coordinates');
  const data=await get('/environment/near?'+new URLSearchParams({lat:String(lat),lon:String(lon)}));
  if(!Array.isArray(data.records)||data.household_sample_verified!==false)throw new Error('ARCHIVE_ENVIRONMENT_SCHEMA');
  return data;
 }
 async function lookupWells(address){
  const {latitude:lat,longitude:lon}=address;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('Invalid well coordinates');
  const data=await get('/wells/near?'+new URLSearchParams({lat:String(lat),lon:String(lon)}));
  if(!Array.isArray(data.records)||data.household_connection_verified!==false)throw new Error('ARCHIVE_WELL_SCHEMA');
  return data;
 }
 return {status,lookupSystem,lookupEnvironment,lookupWells};
}
module.exports={createArchive};
