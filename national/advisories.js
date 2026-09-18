'use strict';
const {fingerprint,validPwsid}=require('./evidence');

// Each connector has an independently reviewed publisher, identity mapping and
// active-status contract. A successful read is never a nationwide all-clear.
const SOURCES=Object.freeze({
 oregon:{id:'oregon-dws',name:'Oregon Drinking Water Services',
  layer:'https://services.arcgis.com/uUvqNMGPm7axC2dD/arcgis/rest/services/advisories/FeatureServer/0',
  page:'https://yourwater.oregon.gov/advisories.php',
  fields:['PWS_Number','PWS_Name','Advisory_Type','Advisory_Label','Advisory_Reason','Area_Affected','Affected_Population','Begin_Date','Link_to_Details_Page','ObjectId'],
  coverage:'Oregon public-system notices in the state map; some partial notices are omitted.'},
 cleveland:{id:'cleveland-water',name:'Cleveland Water',
  layer:'https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Water_Boil_Alert_Area_View/FeatureServer/0',
  page:'https://clevelandgis.maps.arcgis.com/apps/webappviewer/index.html?id=21d27b6876944aa1b6ac5d060d699fb8',
  fields:['OBJECTID','ADVISESTART','ADVISEEND','ADVISETYPE'],
  coverage:'Cleveland Water published advisory areas, screened within 30 meters of the estimated address.'}
});
const GUIDE='https://www.cdc.gov/water-emergency/about/drinking-water-advisories-an-overview.html';
const TYPES=Object.freeze({'Boil Water':'boil-water','Do Not Drink Water':'do-not-drink','Do Not Drink':'do-not-drink','Do Not Use':'do-not-use','Other':'other','Informational':'informational'});
function url(base,params){const u=new URL(base);u.search=new URLSearchParams(params);return u.href;}
function sourceReader({fetchImpl=globalThis.fetch,timeoutMs=7000,maxBytes=1500000}={}){
 return async(value,{signal}={})=>{
  const u=new URL(value);
  if(u.username||u.password||u.hash||!Object.values(SOURCES).some(s=>[s.layer,s.layer+'/query'].some(v=>{const a=new URL(v);return a.origin===u.origin&&a.pathname===u.pathname;})))throw Error('Unapproved advisory source');
  const own=AbortSignal.timeout(timeoutMs),r=await fetchImpl(u,{redirect:'error',signal:signal?AbortSignal.any([signal,own]):own,headers:{Accept:'application/json','User-Agent':'IsMyWaterOK (+https://www.ismywaterok.com)'}});
  if(!r.ok||Number(r.headers.get('content-length')||0)>maxBytes){await r.body?.cancel();throw Error('Advisory source unavailable or oversized');}
  if(!r.body)throw Error('Advisory source empty');
  const reader=r.body.getReader(),parts=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>maxBytes)throw Error('Advisory response budget exceeded');parts.push(Buffer.from(value));}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  const data=JSON.parse(Buffer.concat(parts));if(data?.error)throw Error('Advisory publisher returned an error');return data;
 };
}
function text(value,max=4000){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Advisory text schema changed');return value.trim();}
function timestamp(value){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0||!Number.isFinite(new Date(value).getTime()))throw Error('Advisory date schema changed');return new Date(value).toISOString();}
function features(data,max){if(!Array.isArray(data?.features)||data.exceededTransferLimit===true||data.features.length>=max)throw Error('Advisory response incomplete');return data.features;}
function metadata(data,source,at){
 if(!source.fields.every(k=>data?.fields?.some(f=>f.name===k)))throw Error('Advisory fields changed');
 const modified=timestamp(data.editingInfo?.dataLastEditDate??data.editingInfo?.lastEditDate);
 if(Date.parse(modified)>Date.parse(at)+600000)throw Error('Advisory source clock mismatch');
 return {source_updated_at:modified,source_is_recent:Date.parse(at)-Date.parse(modified)<=48*3600000};
}
function oregonRecord(feature,at){
 const p=feature?.attributes;if(!p||!/^\d{5}$/.test(p.PWS_Number)||!Object.hasOwn(TYPES,p.Advisory_Type))throw Error('Oregon advisory identity changed');
 const link=new URL(text(p.Link_to_Details_Page));
 if(link.origin!=='https://yourwater.oregon.gov'||link.pathname!=='/advisorydetails.php'||!/^\d+$/.test(link.searchParams.get('ISN')||'')||link.username||link.password||link.hash)throw Error('Oregon advisory link changed');
 const start=timestamp(p.Begin_Date);if(Date.parse(start)>Date.parse(at))return null;
 const area=text(p.Area_Affected),population=text(p.Affected_Population);
 return {id:'oregon:'+link.searchParams.get('ISN'),pwsid:'OR41'+p.PWS_Number,provider:text(p.PWS_Name),type:TYPES[p.Advisory_Type],title:text(p.Advisory_Label),reason:text(p.Advisory_Reason),area,affected_population:population,issued_at:start,ends_at:null,source_url:link.href,source_id:SOURCES.oregon.id,match_method:'candidate-public-water-system-id',household_applies_verified:false,sha256:fingerprint(p)};
}
function clevelandRecord(feature,at){
 const p=feature?.attributes;if(!p||!Number.isSafeInteger(p.OBJECTID)||p.OBJECTID<=0||!Object.hasOwn(TYPES,p.ADVISETYPE)||!Object.hasOwn(p,'ADVISEEND'))throw Error('Cleveland advisory identity changed');
 const start=timestamp(p.ADVISESTART),end=p.ADVISEEND===null?null:timestamp(p.ADVISEEND);
 if(end&&Date.parse(end)<Date.parse(start))throw Error('Cleveland advisory interval changed');
 if(Date.parse(start)>Date.parse(at)||end&&Date.parse(end)<=Date.parse(at))return null;
 return {id:'cleveland:'+p.OBJECTID,provider:'Cleveland Water',type:TYPES[p.ADVISETYPE],title:p.ADVISETYPE+' advisory',reason:null,area:'Published advisory area near the estimated address',affected_population:'Confirm the affected customers in the official notice',issued_at:start,ends_at:end,source_url:SOURCES.cleveland.page,source_id:SOURCES.cleveland.id,match_method:'30m-envelope-intersects-publisher-advisory-polygon',household_applies_verified:false,sha256:fingerprint(p)};
}
function guidance(type){
 if(type==='do-not-use')return 'If your home is affected, follow the do-not-use notice for drinking and other water uses. Boiling is not a substitute for these instructions.';
 if(type==='do-not-drink')return 'If your home is affected, follow the do-not-drink notice and use the alternative water supply it recommends. Do not assume boiling makes the water safe.';
 if(type==='boil-water')return 'If your home is affected, follow the official boil-water instructions for drinking and preparing food, including the required boiling time.';
 return 'Read the official notice for affected customers and the actions to take.';
}
function createAdvisories({request=sourceReader(),now=()=>new Date(),cacheMs=60000}={}){
 let oregonCache=null,oregonPending=null;
 async function oregon(signal){
  if(oregonCache&&Date.parse(now())<oregonCache.until)return oregonCache.value;
  if(!oregonPending)oregonPending=(async()=>{
   const s=SOURCES.oregon,at=now().toISOString(),[meta,data]=await Promise.all([request(url(s.layer,{f:'json'}),{signal}),request(url(s.layer+'/query',{f:'json',where:'1=1',outFields:s.fields.join(','),returnGeometry:'false',resultRecordCount:'1000'}),{signal})]);
   const m=metadata(meta,s,at),records=features(data,1000).map(f=>oregonRecord(f,at)).filter(Boolean);
   if(new Set(records.map(r=>r.id)).size!==records.length)throw Error('Duplicate Oregon advisory identity');
   const value={...m,checked_at:at,records};oregonCache={until:Date.parse(at)+cacheMs,value};return value;
  })().finally(()=>oregonPending=null);
  return oregonPending;
 }
 async function cleveland(address,signal){
  const s=SOURCES.cleveland,at=now().toISOString(),dy=30/111320,dx=dy/Math.cos(address.latitude*Math.PI/180);
  const [meta,data]=await Promise.all([request(url(s.layer,{f:'json'}),{signal}),request(url(s.layer+'/query',{f:'json',where:'1=1',geometryType:'esriGeometryEnvelope',geometry:[address.longitude-dx,address.latitude-dy,address.longitude+dx,address.latitude+dy].join(','),inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:s.fields.join(','),returnGeometry:'false',resultRecordCount:'100'}),{signal})]);
  const m=metadata(meta,s,at),records=features(data,100).map(f=>clevelandRecord(f,at)).filter(Boolean);
  if(new Set(records.map(r=>r.id)).size!==records.length)throw Error('Duplicate Cleveland advisory identity');
  return {...m,checked_at:at,records};
 }
 return async({address,pwsids=[],supplyType},{signal}={})=>{
  const result={schema:'current-advisories/1',status:'coverage-unavailable',records:[],checks:[],comprehensive:false,household_safety:'not-determined'};
  if(supplyType==='private-well')return {...result,status:'not-applicable-private-well'};
  const ids=[...new Set(pwsids.filter(validPwsid))].slice(0,4),jobs=[];
  if(ids.some(id=>/^OR41\d{5}$/.test(id)))jobs.push([SOURCES.oregon,async()=>{const data=await oregon(signal);return {...data,records:data.records.filter(r=>ids.includes(r.pwsid))};}]);
  else if(address?.state==='OR')result.status='provider-unresolved';
  if(address?.status==='matched'&&address.state==='OH'&&Number.isFinite(address.latitude)&&Number.isFinite(address.longitude)&&address.latitude>=40.9&&address.latitude<=42.1&&address.longitude>=-82.8&&address.longitude<=-80.8)jobs.push([SOURCES.cleveland,()=>cleveland(address,signal)]);
  const responses=await Promise.allSettled(jobs.map(async([s,fn])=>{
   const data=await fn();return {check:{source_id:s.id,name:s.name,source_url:s.page,coverage:s.coverage,status:data.source_is_recent?'checked':'source-not-recent',checked_at:data.checked_at,source_updated_at:data.source_updated_at,matching_records:data.records.length},records:data.records.map(r=>({...r,checked_at:data.checked_at,source_updated_at:data.source_updated_at,source_is_recent:data.source_is_recent,guidance:guidance(r.type),guidance_url:GUIDE}))};
  }));
  responses.forEach((r,i)=>{if(r.status==='fulfilled'){result.checks.push(r.value.check);result.records.push(...r.value.records);}else{const s=jobs[i][0];result.checks.push({source_id:s.id,name:s.name,source_url:s.page,coverage:s.coverage,status:'unavailable',checked_at:now().toISOString()});}});
  const rank={'do-not-use':0,'do-not-drink':1,'boil-water':2,other:3,informational:4};result.records.sort((a,b)=>rank[a.type]-rank[b.type]||b.issued_at.localeCompare(a.issued_at));
  if(jobs.length)result.status=result.checks.some(c=>c.status==='checked')?'checked-sources':result.checks.some(c=>c.status==='source-not-recent')?'source-not-recent':'unavailable';
  return result;
 };
}
module.exports={SOURCES,GUIDE,createAdvisories,sourceReader,oregonRecord,clevelandRecord,guidance};
