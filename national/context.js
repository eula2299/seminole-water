'use strict';
const {fingerprint,finiteNumber}=require('./evidence');
const BASE='https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items';
const PARAMETERS={'00010':'Water temperature','00060':'Stream discharge','00065':'Water level','00095':'Specific conductance','00300':'Dissolved oxygen','00400':'pH','63680':'Turbidity'};
function normalizeFeature(raw,retrievedAt){
 const p=raw?.properties;
 if(!p||typeof p.monitoring_location_id!=='string'||typeof p.time!=='string'||!Number.isFinite(Date.parse(p.time)))throw new Error('USGS observation schema changed');
 const value=finiteNumber(p.value),date=Date.parse(p.time),age=Math.floor((Date.parse(retrievedAt)-date)/86400000);
 const coords=raw?.geometry?.type==='Point'&&Array.isArray(raw.geometry.coordinates)&&raw.geometry.coordinates.length>=2&&raw.geometry.coordinates.every(Number.isFinite)?raw.geometry.coordinates:null;
 return {id:raw.id,station:p.monitoring_location_id,parameter_code:p.parameter_code,parameter:PARAMETERS[p.parameter_code]||p.parameter_code,original_value:p.value,value,unit:p.unit_of_measure||null,sampled_at:p.time,source_modified_at:p.last_modified,approval_status:p.approval_status,qualifier:p.qualifier,age_days:age,not_recent:age>30,latitude:coords?coords[1]:null,longitude:coords?coords[0]:null,scope:'environmental-telemetry-not-household',household_match:false,raw,sha256:fingerprint(raw)};
}
function createContext({fetchImpl=globalThis.fetch,now=()=>new Date()}={}){
 return async (address,{signal}={})=>{
  const lat=address.latitude,lon=address.longitude;if(typeof lat!=='number'||typeof lon!=='number'||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('Invalid coordinates');
  const dy=.04,dx=Math.min(.8,dy/Math.max(.05,Math.cos(lat*Math.PI/180)));
  const west=lon-dx,east=lon+dx,south=Math.max(-90,lat-dy),north=Math.min(90,lat+dy);
  const boxes=west< -180?[[west+360,south,180,north],[-180,south,east,north]]:east>180?[[west,south,180,north],[-180,south,east-360,north]]:[[west,south,east,north]];
  const results=await Promise.all(boxes.map(async box=>{
   const u=new URL(BASE);u.search=new URLSearchParams({f:'json',bbox:box.join(','),limit:'50'}).toString();
   const own=AbortSignal.timeout(6500);
   const r=await fetchImpl(u,{redirect:'error',signal:signal?AbortSignal.any([signal,own]):own,headers:{Accept:'application/json','User-Agent':'IsMyWaterOK-NationalEvidence/1.0'}});
   if(!r.ok){await r.body?.cancel();throw new Error('USGS context unavailable');}
   let bytes=0;const chunks=[];for await(const part of r.body||[]){bytes+=part.length;if(bytes>1000000)throw new Error('USGS response exceeds budget');chunks.push(Buffer.from(part));}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(data.features)||data.error)throw new Error('USGS context schema unavailable');
   const at=now().toISOString();return {url:u.toString(),retrieved_at:at,paged:!!data.links?.some(l=>l.rel==='next'),records:data.features.map(f=>normalizeFeature(f,at))};
  }));
  return {status:results.some(x=>x.paged)?'partial':results.some(x=>x.records.length)?'records-returned':'no-records-returned',records:results.flatMap(x=>x.records).sort((a,b)=>b.sampled_at.localeCompare(a.sampled_at)),sources:results.map(({url,retrieved_at})=>({url,retrieved_at})),scope:'nearby-environmental-context',household_match:false,warehouse_count_includes_these:false,coverage_complete:false,explanation:'Latest is per time series and can be old. Provisional and historical values retain their status and sample dates. No hydraulic connection to this address is established.'};
 };
}
module.exports={createContext,normalizeFeature};
