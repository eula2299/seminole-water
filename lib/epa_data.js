'use strict';

const fs=require('fs');
const path=require('path');

const FILES={
  manifest:'manifest.json',
  systems:'sdwis_systems.json',
  facilities:'sdwis_facilities.json',
  geographicAreas:'sdwis_geographic_areas.json',
  serviceAreas:'sdwis_service_areas.json',
  violations:'sdwis_violations.json',
  lcrSamples:'sdwis_lcr_samples.json',
  siteVisits:'sdwis_site_visits.json',
  events:'sdwis_events.json',
  publicNotices:'sdwis_public_notices.json',
  wqpStations:'wqp_stations.json',
  wqpResults:'wqp_results.json',
  ccrIndex:'ccr_index.json'
};

function safeRead(file,fallback){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}
}
function asArray(v){return Array.isArray(v)?v:[];}
function pwsid(v){
  const digits=String(v??'').toUpperCase().trim().replace(/^US-?/,'').replace(/^FL/,'').replace(/\D/g,'');
  return digits.length>=7?digits.slice(-7):digits;
}
function clean(v){return String(v??'').trim();}
function norm(v){return clean(v).toUpperCase().replace(/\s+/g,' ');}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function dateValue(v){
  const s=clean(v); if(!s)return 0;
  const t=Date.parse(s); return Number.isFinite(t)?t:0;
}
function latest(rows,fields=['sample_date','date','report_year']){
  return [...asArray(rows)].sort((a,b)=>{
    const ad=Math.max(...fields.map(f=>dateValue(a?.[f]))),bd=Math.max(...fields.map(f=>dateValue(b?.[f])));
    if(ad!==bd)return bd-ad;
    return Number(b?.report_year||0)-Number(a?.report_year||0);
  })[0]||null;
}
function activeViolation(v){
  const status=norm(v.status||v.violation_status||v.current_status||v.VIOLATION_STATUS);
  const resolved=norm(v.resolved||v.resolution_status||v.compliance_status);
  const end=dateValue(v.end_date||v.compliance_end_date||v.violation_end_date);
  const explicitlyClosed=/(RESOLVED|RETURNED TO COMPLIANCE|CLOSED|ARCHIVED|LIFTED|RESCINDED|NO VIOLATION)/.test(`${status} ${resolved}`);
  const explicitlyOpen=/(OPEN|ACTIVE|UNRESOLVED|ONGOING|PENDING|VIOLATION)/.test(status)&&!explicitlyClosed;
  if(explicitlyClosed)return false;
  if(explicitlyOpen)return true;
  if(v.is_active===true||String(v.is_active).toLowerCase()==='true')return true;
  return !!end&&end>Date.now();
}
function violationKind(v){
  const s=norm([v.violation_name,v.violation_category,v.violation_type,v.rule_name,v.rule_code,v.contaminant_name,v.description].filter(Boolean).join(' '));
  if(/MONITOR|REPORT|CCR|PUBLIC NOTICE|RECORDKEEP|SAMPL/.test(s)&&!/MCL|MAXIMUM CONTAMINANT|TREATMENT TECHNIQUE|ACTION LEVEL|HEALTH/.test(s))return 'monitoring-or-reporting';
  if(/MCL|MAXIMUM CONTAMINANT|TREATMENT TECHNIQUE|ACTION LEVEL|HEALTH|TOTAL COLIFORM|E\. COLI|LEAD|COPPER|NITRATE|ARSENIC|RADIONUCLIDE|PFAS/.test(s))return 'health-based-or-treatment';
  return 'other-compliance';
}
function normalizeRows(rows){return asArray(rows).map(r=>({...r,pwsid:pwsid(r.pwsid||r.PWSID||r.PWS_ID||r.pws_id)}));}

function loadEpaData(root){
  const dir=path.join(root,'data','epa');
  const out={dir};
  for(const [key,name] of Object.entries(FILES))out[key]=safeRead(path.join(dir,name),key==='manifest'?{status:'not-synced',downloaded_at:null,errors:[]}:[]);
  for(const key of ['systems','facilities','geographicAreas','serviceAreas','violations','lcrSamples','siteVisits','events','publicNotices','ccrIndex'])out[key]=normalizeRows(out[key]);
  out.wqpStations=asArray(out.wqpStations);
  out.wqpResults=asArray(out.wqpResults);
  return out;
}

function summarizeSdwis(data,id){
  const target=pwsid(id);
  const systems=data.systems.filter(x=>pwsid(x.pwsid)===target);
  const facilities=data.facilities.filter(x=>pwsid(x.pwsid)===target);
  const geographicAreas=data.geographicAreas.filter(x=>pwsid(x.pwsid)===target);
  const serviceAreas=data.serviceAreas.filter(x=>pwsid(x.pwsid)===target);
  const violations=data.violations.filter(x=>pwsid(x.pwsid)===target);
  const active=violations.filter(activeViolation).map(v=>({...v,classification:violationKind(v)}));
  const health=active.filter(v=>v.classification==='health-based-or-treatment');
  const monitoring=active.filter(v=>v.classification==='monitoring-or-reporting');
  const lcrSamples=data.lcrSamples.filter(x=>pwsid(x.pwsid)===target);
  const siteVisits=data.siteVisits.filter(x=>pwsid(x.pwsid)===target);
  const events=data.events.filter(x=>pwsid(x.pwsid)===target);
  const publicNotices=data.publicNotices.filter(x=>pwsid(x.pwsid)===target);
  const synced=systems.length||violations.length||facilities.length||String(data.manifest?.sdwis?.status||'').startsWith('synced');
  let compliance_status='not-synced';
  if(synced){
    if(health.length)compliance_status='active-health-based-or-treatment-violation';
    else if(monitoring.length)compliance_status='active-monitoring-or-reporting-violation';
    else if(active.length)compliance_status='active-other-compliance-issue';
    else compliance_status='no-active-violations-in-synced-cache';
  }
  return {
    pwsid:target,
    synced:!!synced,
    system:latest(systems,['last_updated','data_date'])||null,
    facilities,
    geographic_areas:geographicAreas,
    service_areas:serviceAreas,
    violations:{all:violations,active,active_health_based_or_treatment:health,active_monitoring_or_reporting:monitoring},
    lcr_samples:lcrSamples,
    site_visits:siteVisits,
    events,
    public_notices:publicNotices,
    compliance_status,
    disclaimer:'EPA SDWIS/ECHO is a system and compliance repository. Federal reporting can lag state or local records and does not represent a sample from the submitted household unless a row explicitly identifies that home.'
  };
}

function haversineMiles(a,b){
  const lat1=num(a?.lat),lon1=num(a?.lon),lat2=num(b?.lat),lon2=num(b?.lon);
  if([lat1,lon1,lat2,lon2].some(x=>x===null))return null;
  const R=3958.7613,toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1);
  const h=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function stationId(x){return clean(x.monitoring_location_id||x.MonitoringLocationIdentifier||x.station_id||x.siteid);}
function stationCoords(x){return {lat:num(x.latitude??x.LatitudeMeasure),lon:num(x.longitude??x.LongitudeMeasure)};}
function resultStationId(x){return clean(x.monitoring_location_id||x.MonitoringLocationIdentifier||x.station_id||x.siteid);}
function resultDate(x){return clean(x.activity_start_date||x.ActivityStartDate||x.sample_date||x.date);}
function resultCharacteristic(x){return clean(x.characteristic_name||x.CharacteristicName||x.analyte||x.characteristic);}
function resultValue(x){return x.result_value??x['ResultMeasure/ResultMeasureValue']??x.ResultMeasureValue??x.value??null;}
function resultUnit(x){return clean(x.result_unit||x['ResultMeasure/MeasureUnitCode']||x.MeasureUnitCode||x.unit);}

function nearbyWqp(data,coords,{radiusMiles=15,limit=8,resultsPerStation=12}={}){
  const center={lat:num(coords?.lat),lon:num(coords?.lon)};
  const synced=data.wqpStations.length>0||String(data.manifest?.wqp?.status||'').startsWith('synced');
  if(center.lat===null||center.lon===null)return {synced,stations:[],reason:'address coordinates unavailable',disclaimer:WQP_DISCLAIMER};
  const stations=data.wqpStations.map(s=>{
    const c=stationCoords(s),distance_miles=haversineMiles(center,c);
    return {...s,monitoring_location_id:stationId(s),latitude:c.lat,longitude:c.lon,distance_miles};
  }).filter(s=>s.distance_miles!==null&&s.distance_miles<=radiusMiles).sort((a,b)=>a.distance_miles-b.distance_miles).slice(0,limit);
  const resultsByStation=new Map();
  for(const r of data.wqpResults){const id=resultStationId(r);if(!id)continue;(resultsByStation.get(id)||resultsByStation.set(id,[]).get(id)).push(r);}
  for(const s of stations){
    const rows=(resultsByStation.get(s.monitoring_location_id)||[]).sort((a,b)=>dateValue(resultDate(b))-dateValue(resultDate(a)));
    const seen=new Set(),latestResults=[];
    for(const r of rows){const c=resultCharacteristic(r)||'UNKNOWN';if(seen.has(c))continue;seen.add(c);latestResults.push({characteristic:c,value:resultValue(r),unit:resultUnit(r),sample_date:resultDate(r),detection_condition:clean(r.detection_condition||r.ResultDetectionConditionText),media:clean(r.activity_media||r.ActivityMediaName),organization:clean(r.organization_id||r.OrganizationIdentifier)});if(latestResults.length>=resultsPerStation)break;}
    s.latest_results=latestResults;
  }
  return {synced,center,radius_miles:radiusMiles,stations,station_count:stations.length,disclaimer:WQP_DISCLAIMER};
}
const WQP_DISCLAIMER='Water Quality Portal records are environmental monitoring data from nearby stations (such as lakes, streams, groundwater wells, or source-water locations). They are contextual evidence only and are not household tap samples or proof of the public water system’s compliance.';

function ccrForPws(data,id){
  const target=pwsid(id);
  const reports=data.ccrIndex.filter(x=>pwsid(x.pwsid)===target).sort((a,b)=>Number(b.report_year||0)-Number(a.report_year||0)||dateValue(b.published_at)-dateValue(a.published_at));
  const synced=data.ccrIndex.length>0||String(data.manifest?.ccr?.status||'').startsWith('synced');
  return {pwsid:target,synced,latest:reports[0]||null,reports,disclaimer:'A Consumer Confidence Report is an annual system-level report. It describes the utility’s source water, detected contaminants, and compliance; it is not a laboratory test of the submitted home.'};
}

function federalSummary(data){
  const pwsids=new Set([...data.systems,...data.violations,...data.ccrIndex].map(x=>pwsid(x.pwsid)).filter(Boolean));
  return {
    manifest:data.manifest,
    sdwis_systems:data.systems.length,
    sdwis_facilities:data.facilities.length,
    sdwis_violations:data.violations.length,
    sdwis_active_violations:data.violations.filter(activeViolation).length,
    sdwis_lcr_samples:data.lcrSamples.length,
    wqp_stations:data.wqpStations.length,
    wqp_results:data.wqpResults.length,
    ccr_reports:data.ccrIndex.length,
    pwsids:pwsids.size,
    status:(data.manifest?.status||'not-synced')
  };
}
function buildFederalContext(data,id,coords,options={}){
  return {sdwis:summarizeSdwis(data,id),wqp:nearbyWqp(data,coords,options.wqp||{}),ccr:ccrForPws(data,id),summary:federalSummary(data)};
}

module.exports={FILES,pwsid,activeViolation,violationKind,loadEpaData,summarizeSdwis,haversineMiles,nearbyWqp,ccrForPws,federalSummary,buildFederalContext,WQP_DISCLAIMER};
