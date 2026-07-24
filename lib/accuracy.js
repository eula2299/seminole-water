'use strict';
const crypto=require('crypto');
const UNIT_TO_UGL={
  'UG/L':1,'µG/L':1,'MCG/L':1,'PPB':1,
  'MG/L':1000,'PPM':1000,
  'NG/L':0.001,'PPT':0.001
};
function norm(s){return String(s??'').trim().toUpperCase().replace(/μ/g,'µ').replace(/\s+/g,' ')}
function normalizeMeasurement(result,unit,detectionLimit=null){
  const raw=String(result??'').trim();
  const m=raw.match(/^\s*(<|<=|>|>=)?\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$/i);
  const factor=UNIT_TO_UGL[norm(unit)] ?? null;
  const parsed=m?Number(m[2]):null;
  const qualifier=m?.[1]||null;
  const dl=Number.isFinite(Number(detectionLimit))?Number(detectionLimit):null;
  return {
    raw_result:result,raw_unit:unit,qualifier,
    numeric_value:parsed,
    canonical_unit:'ug/L',
    canonical_value:parsed!==null&&factor!==null?parsed*factor:null,
    detection_limit_ug_l:dl!==null&&factor!==null?dl*factor:null,
    censored:qualifier==='<'||qualifier==='<='||/^ND|NON[- ]?DETECT/i.test(raw),
    censoring_type:(qualifier==='<'||qualifier==='<='||/^ND|NON[- ]?DETECT/i.test(raw))?'left-censored':null,
    conversion_factor:factor
  };
}
function recordFingerprint(r){
  const stable=[r.pwsid,r.metal,r.sample_date,r.sample_type,r.facility_id,r.sample_point,r.result,r.unit,r.lab_id,r.source_id].map(x=>norm(x)).join('|');
  return crypto.createHash('sha256').update(stable).digest('hex');
}
function versionRecords(rows){
  const byLogical=new Map();
  for(const r of rows){
    const key=[r.pwsid,r.metal,r.sample_date,r.sample_type,r.facility_id||'',r.sample_point||''].map(norm).join('|');
    if(!byLogical.has(key))byLogical.set(key,[]);
    byLogical.get(key).push({...r,record_fingerprint:recordFingerprint(r)});
  }
  const out=[];
  for(const group of byLogical.values()){
    group.sort((a,b)=>String(a.revision_date||a.ingested_at||a.source_year||'').localeCompare(String(b.revision_date||b.ingested_at||b.source_year||'')));
    for(let i=0;i<group.length;i++)out.push({...group[i],version:i+1,is_current:i===group.length-1,superseded_by:i<group.length-1?group[i+1].record_fingerprint:null});
  }
  return out;
}
function selectServiceAreaVersion(versions,sampleDate){
  if(!versions?.length)return null;
  const t=sampleDate?new Date(sampleDate).getTime():Date.now();
  const eligible=versions.filter(v=>{
    const from=v.valid_from?new Date(v.valid_from).getTime():-Infinity;
    const to=v.valid_to?new Date(v.valid_to).getTime():Infinity;
    return t>=from&&t<=to;
  });
  return (eligible.sort((a,b)=>String(b.valid_from||'').localeCompare(String(a.valid_from||'')))[0]||null);
}
function pointSegmentDistanceMeters(lon,lat,a,b){
  const kx=111320*Math.cos(lat*Math.PI/180),ky=110540;
  const px=lon*kx,py=lat*ky,ax=a[0]*kx,ay=a[1]*ky,bx=b[0]*kx,by=b[1]*ky;
  const dx=bx-ax,dy=by-ay; const den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/den)):0;
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function distanceToGeometryBoundaryMeters(lon,lat,g){
  const rings=[];
  if(g?.type==='Polygon')rings.push(...g.coordinates);
  if(g?.type==='MultiPolygon')for(const p of g.coordinates)rings.push(...p);
  let min=Infinity;
  for(const ring of rings)for(let i=1;i<ring.length;i++)min=Math.min(min,pointSegmentDistanceMeters(lon,lat,ring[i-1],ring[i]));
  return Number.isFinite(min)?min:null;
}
function assessSpatialAmbiguity({lon,lat,matches=[],allFeatures=[],edgeThresholdMeters=75}){
  const distances=matches.map(m=>({name:m.name||'',meters:distanceToGeometryBoundaryMeters(lon,lat,m.geometry)}));
  const min=Math.min(...distances.map(x=>x.meters??Infinity));
  const overlap=matches.length>1;
  const gap=matches.length===0;
  return {overlap,gap,near_boundary:Number.isFinite(min)&&min<=edgeThresholdMeters,min_boundary_distance_m:Number.isFinite(min)?Math.round(min*10)/10:null,edge_threshold_m:edgeThresholdMeters,distances};
}
function resolveUtilityLineage(pwsid,date,lineages=[]){
  const t=date?new Date(date).getTime():Date.now();
  const chain=lineages.filter(x=>x.pwsid===pwsid||x.predecessor_pwsid===pwsid||x.successor_pwsid===pwsid);
  const active=chain.find(x=>t>=new Date(x.valid_from||'1900-01-01').getTime()&&t<=new Date(x.valid_to||'2999-12-31').getTime());
  return {active:active||null,chain};
}
function applicableSources(pwsid,date,network=[]){
  const t=date?new Date(date).getTime():Date.now();
  return network.filter(x=>x.retail_pwsid===pwsid&&t>=new Date(x.valid_from||'1900-01-01').getTime()&&t<=new Date(x.valid_to||'2999-12-31').getTime())
    .map(x=>({...x,source_weight:Number(x.blend_fraction??1)}));
}
module.exports={normalizeMeasurement,recordFingerprint,versionRecords,selectServiceAreaVersion,distanceToGeometryBoundaryMeters,assessSpatialAmbiguity,resolveUtilityLineage,applicableSources};
