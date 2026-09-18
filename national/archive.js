'use strict';
const {validPwsid}=require('./evidence');

function createArchive({baseUrl=process.env.NATIONAL_ARCHIVE_URL,fetchImpl=fetch}={}){
 if(!baseUrl)return null;
 const base=new URL(baseUrl);
 if(base.username||base.password||base.search||base.hash||!['http:','https:'].includes(base.protocol))throw new Error('Invalid configured archive URL');
 if(base.protocol==='http:'&&!base.hostname.endsWith('.railway.internal')&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw new Error('Archive HTTP requires the private network');
 async function get(path){
  const r=await fetchImpl(new URL(path,base),{redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'}});
  if(!r.ok){await r.body?.cancel();throw new Error('ARCHIVE_HTTP_ERROR');}
  const reader=r.body.getReader();let bytes=0;const chunks=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2000000)throw new Error('ARCHIVE_TOO_LARGE');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 let cached=null,pending=null,expires=0;
 async function status(){
  if(cached&&Date.now()<expires)return cached;
  if(!pending)pending=get('/status').then(data=>{if(!String(data.schema||'').startsWith('occurrence-warehouse/'))throw new Error('ARCHIVE_SCHEMA');cached=data;expires=Date.now()+15000;return data;}).finally(()=>{pending=null;});
  return pending;
 }
 async function lookupSystem(pwsid){
  if(!validPwsid(pwsid))throw new Error('Invalid archive PWSID');
  const inventory=await status();
  if(inventory.schema!=='occurrence-warehouse/2')return {status:'validation-update-pending',summaries:[],sources:[],schema:inventory.schema};
  const data=await get('/pws/'+pwsid);
  if(data.pwsid!==pwsid||!Array.isArray(data.summaries)||!Array.isArray(data.sources))throw new Error('ARCHIVE_SCHEMA');
  if(data.compliance&&(data.compliance.pwsid!==pwsid||!Array.isArray(data.compliance.records)||data.compliance.records.some(r=>String(r.PWSID||'').trim().toUpperCase()!==pwsid)))throw new Error('ARCHIVE_COMPLIANCE_IDENTITY');
  const accepted=data.summaries.filter(r=>Number(r.invalid_identity_date||0)===0&&r.analyte&&r.source_id);
  return {...data,status:accepted.length?'records-returned':data.status,summaries:accepted,quarantined_summaries:data.summaries.length-accepted.length,household_sample:false};
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
