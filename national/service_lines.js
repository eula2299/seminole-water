'use strict';
// EPA's public Water ICAT source is utility-scale. Never join its counts to a
// property as though they identify that property's service-line material.
const {createHash}=require('node:crypto');
const ROOT='https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Community_Water_Systems_June_8_2024_all_CWS/FeatureServer';
const DOC='https://www.epa.gov/waterfinancecenter/water-infrastructure-and-capacity-assessment-tool';
const COUNTS=Object.freeze({total:'TOTAL_NUM_SERVICE_LINES_REPORTED',lead:'NUM_LEAD_SERVICE_LINES',galvanized_requiring_replacement:'NUM_GALVANIZED_REQUIRING_REPLACEMENT_SL',unknown:'NUM_LEAD_STATUS_UNKNOWN_SL',non_lead:'NUM_NONLEAD_SERVICE_LINES'});
const FIELDS=['PWSID','PWS_NAME','SL_RPT_STATUS',...Object.values(COUNTS)];
function target(value){const u=new URL(value);if(u.origin!==new URL(ROOT).origin||u.username||u.password||u.hash||!new RegExp('^'+new URL(ROOT).pathname+'(?:/\\d+(?:/query)?)?$').test(u.pathname))throw Error('Unapproved service-line source');return u;}
function sourceReader({fetchImpl=globalThis.fetch,maxBytes=500000}={}){return async(value,{signal}={})=>{
 const response=await fetchImpl(target(value),{signal,redirect:'error',headers:{Accept:'application/json','User-Agent':'IsMyWaterOK-ServiceLines/1'}});
 if(!response.ok){await response.body?.cancel();throw Error('Service-line source unavailable');}
 const reader=response.body?.getReader();if(!reader)throw Error('Missing service-line response');let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Service-line response exceeded budget');chunks.push(Buffer.from(value));}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const data=JSON.parse(Buffer.concat(chunks));if(data.error)throw Error('Service-line source returned an error');return data;
};}
function url(path,params={}){const u=new URL(path);for(const[k,v]of Object.entries({f:'json',...params}))u.searchParams.set(k,String(v));return u.toString();}
function count(value){if(value===null)return null;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('Invalid service-line count');return value;}
function normalize(row,ids){
 if(!row||!ids.includes(row.PWSID)||typeof row.PWS_NAME!=='string'||row.PWS_NAME.length>400||typeof row.SL_RPT_STATUS!=='string'&&row.SL_RPT_STATUS!==null)throw Error('Unexpected utility inventory identity');
 const counts=Object.fromEntries(Object.entries(COUNTS).map(([key,field])=>[key,count(row[field])]));
 const values=Object.keys(COUNTS).filter(k=>k!=='total').map(k=>counts[k]);
 return {pwsid:row.PWSID,provider:row.PWS_NAME,reporting_status:row.SL_RPT_STATUS,counts,category_total_matches:counts.total!==null&&values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0)===counts.total:null,scope:'utility-wide-inventory-not-property',household_material_verified:false,household_lead_concentration:null};
}
function createServiceLines({request=sourceReader(),now=()=>Date.now(),timeoutMs=7000}={}){
 let metadata=null;const cache=new Map();
 async function schema(signal){
  if(metadata&&now()-metadata.loaded<3600000)return metadata;
  const root=await request(url(ROOT),{signal});
  const tables=(root.tables||[]).filter(t=>Number.isSafeInteger(t.id)&&/^CWS_CompleteTable_\d{8}$/.test(t.name||''));
  if(tables.length!==1)throw Error('Ambiguous service-line table');
  const table=ROOT+'/'+tables[0].id,description=await request(url(table),{signal}),fields=new Map((description.fields||[]).map(f=>[f.name,f]));
  if(!FIELDS.every(f=>fields.has(f))||fields.get('PWSID').type!=='esriFieldTypeString'||!Object.values(COUNTS).every(f=>['esriFieldTypeDouble','esriFieldTypeInteger'].includes(fields.get(f).type)))throw Error('Changed service-line schema');
  const edited=description.editingInfo?.dataLastEditDate||description.editingInfo?.lastEditDate;
  if(!Number.isFinite(edited)||edited>now()+86400000)throw Error('Invalid source-update date');
  metadata={loaded:now(),table,name:tables[0].name,updated_at:new Date(edited).toISOString()};return metadata;
 }
 async function lookup({pwsids=[],supplyType}={}){
  const empty={source_url:DOC,scope:'utility-wide-inventory-not-property',comprehensive:false,records:[],household_material_verified:false};
  if(supplyType==='private-well')return {...empty,status:'not-applicable-private-well'};
  const ids=[...new Set(pwsids)].sort();
  if(!ids.length)return {...empty,status:'provider-unresolved'};
  if(ids.length>4||ids.some(id=>typeof id!=='string'||! /^[A-Z0-9]{2}\d{7}$/.test(id)))return {...empty,status:'invalid-provider-selection'};
  const key=ids.join(','),hit=cache.get(key);if(hit&&now()-hit.time<300000)return structuredClone(hit.data);
  const signal=AbortSignal.timeout(timeoutMs);
  try{
   const s=await schema(signal),query=url(s.table+'/query',{where:'PWSID IN ('+ids.map(x=>"'"+x+"'").join(',')+')',outFields:FIELDS.join(','),returnGeometry:false,resultRecordCount:5});
   const raw=await request(query,{signal});
   if(!Array.isArray(raw.features)||raw.exceededTransferLimit||raw.features.length>4)throw Error('Truncated service-line results');
   const records=raw.features.map(f=>normalize(f.attributes,ids));if(new Set(records.map(r=>r.pwsid)).size!==records.length)throw Error('Duplicate utility inventory');
   const data={...empty,status:records.length?'records-returned':'no-matching-inventory',records,source_updated_at:s.updated_at,source_table:s.name,retrieved_at:new Date(now()).toISOString(),record_source_url:query,response_sha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),date_note:'Source-table update date, not a household inspection date or necessarily the date of each utility inventory.'};
   if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,{time:now(),data:structuredClone(data)});return data;
  }catch{return {...empty,status:'unavailable',retrieved_at:new Date(now()).toISOString(),error:'Official inventory could not be verified. No zero count or household conclusion was substituted.'};}
 }
 return lookup;
}
function inventoryAction(record,inventory){
 const c=record.counts,fmt=x=>x===null?'not reported':x.toLocaleString('en-US');
 return {title:'Check service-line records with '+record.provider,text:'EPA’s utility-wide inventory reports '+fmt(c.lead)+' lead lines, '+fmt(c.galvanized_requiring_replacement)+' galvanized lines requiring replacement, '+fmt(c.unknown)+' unknown lines and '+fmt(c.non_lead)+' non-lead lines. '+(record.reporting_status?'Reporting status: '+record.reporting_status+'. ':'')+'This does not identify the pipe serving your home. Ask the utility to confirm your address in its service-line inventory. Source table updated '+inventory.source_updated_at.slice(0,10)+'.',url:DOC};
}
function withServiceLines(engine,{lookup=createServiceLines()}={}){
 function decorate(status){return {...status,utility_service_line_inventory:{status:'official-source-connected',scope:'utility-wide-not-household',source_url:DOC,comprehensive:false}};}
 return {async status(){return decorate(await engine.status());},async lookup(input){
  const data=await engine.lookup(input),inventory=await lookup({pwsids:(data.systems||[]).map(s=>s.pwsid),supplyType:data.supply?.type});
  data.utility_service_lines=inventory;data.coverage=decorate(data.coverage||{});
  if(data.resident_report){data.resident_report.utility_service_lines=inventory;
   // Keep immediate notices first, followed by the existing essential actions.
   for(const record of inventory.records)if(Object.values(record.counts).some(x=>x!==null))data.resident_report.actions.push(inventoryAction(record,inventory));
  }
  return data;
 }};
}
module.exports={ROOT,DOC,COUNTS,FIELDS,target,sourceReader,normalize,createServiceLines,inventoryAction,withServiceLines};
