'use strict';
const {EvidenceError,validateInput,fingerprint,censusMatch,boundaryCandidates,echoRows,queryId,REGION_CODES}=require('./evidence');
const ENDPOINTS=Object.freeze({
  census:'https://geocoding.geo.census.gov/geocoder/geographies/address',
  boundaries:'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query',
  systems:'https://echodata.epa.gov/echo/sdw_rest_services.get_systems',
  query:'https://echodata.epa.gov/echo/sdw_rest_services.get_qid'
});
const SOURCE_DOCS=Object.freeze({
  census:'https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html',
  boundaries:'https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas',
  systems:'https://echo.epa.gov/tools/web-services/facility-search-drinking-water',
  ucmr:'https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule',
  wqp:'https://www.waterqualitydata.us/beta/webservices_documentation/',
  usgs:'https://api.waterdata.usgs.gov/ogcapi/v1/'
});
function safeTarget(value){const u=new URL(value);if(u.username||u.password||u.hash||u.protocol!=='https:'||u.port&&u.port!=='443'||!Object.values(ENDPOINTS).some(v=>{const a=new URL(v);return a.host===u.host&&a.pathname===u.pathname;}))throw new EvidenceError('UNAPPROVED_SOURCE','Upstream source not allowed.',502);return u;}
function transport({fetchImpl=globalThis.fetch,timeoutMs=6500,maxBytes=2000000}={}){
 return async(value,{signal}={})=>{
  const u=safeTarget(value),own=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([own,signal]):own;
  const response=await fetchImpl(u,{redirect:'error',signal:combined,headers:{Accept:'application/json','User-Agent':'IsMyWaterOK-NationalEvidence/1.0'}});
  if(!response.ok){await response.body?.cancel();throw new EvidenceError('SOURCE_HTTP_ERROR',`Upstream HTTP ${response.status}.`,502);}
  if(Number(response.headers.get('content-length')||0)>maxBytes){await response.body?.cancel();throw new EvidenceError('SOURCE_TOO_LARGE','Source exceeded bounded-response limit.',502);}
  const reader=response.body?.getReader();if(!reader)throw new EvidenceError('SOURCE_EMPTY','Missing source body.',502);
  const chunks=[];let count=0;
  try{while(true){const {done,value:chunk}=await reader.read();if(done)break;count+=chunk.byteLength;if(count>maxBytes)throw new EvidenceError('SOURCE_TOO_LARGE','Source exceeded bounded-response limit.',502);chunks.push(Buffer.from(chunk));}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new EvidenceError('SOURCE_JSON','Source did not return valid JSON.',502);}
  if(data?.error||data?.Error||data?.Results?.Error||data?.Results?.error)throw new EvidenceError('SOURCE_ERROR','Source returned an error payload; this is not a zero-result finding.',502);
  return data;
 };
}
function query(base,params){const u=new URL(base);for(const[k,v]of Object.entries(params))if(v!==''&&v!=null)u.searchParams.set(k,String(v));return u.toString();}
function createEngine({request=transport(),now=()=>new Date(),deadlineMs=20000}={}){
 async function lookup(raw){
  const input=validateInput(raw),signal=AbortSignal.timeout(deadlineMs),audit=[];
  async function stage(name,fn){const started=now().toISOString();try{signal.throwIfAborted();const value=await fn();audit.push({agent:name,type:'deterministic',status:'completed',retrieved_at:started});return value;}catch(e){audit.push({agent:name,type:'deterministic',status:'unavailable',retrieved_at:started,error_code:e.code||'SOURCE_UNAVAILABLE'});return null;}}
  const get=url=>request(url,{signal});
  const hasAddress=input.street&&(input.city||input.zip);
  const address=hasAddress?await stage('address-resolution',async()=>censusMatch(await get(query(ENDPOINTS.census,{street:input.street,city:input.city,state:input.state,zip:input.zip,benchmark:'Public_AR_Current',vintage:'Current_Current',format:'json'})),input)):{status:'not-requested'};
  let candidates=[],boundaryStatus='not-requested',nearby=[],nearbyStatus='not-requested';
  if(address?.status==='matched'&&input.supply_type!=='private-well'){
   const params={f:'json',geometryType:'esriGeometryPoint',geometry:`${address.longitude},${address.latitude}`,inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:'false'};
   const found=await stage('provider-candidates',async()=>boundaryCandidates(await get(query(ENDPOINTS.boundaries,params))));
   candidates=found||[];boundaryStatus=found===null?'unavailable':found.length?'candidates-found':'unresolved';
   if(found&&found.length){const dy=30/111320,dx=dy/Math.max(.01,Math.cos(address.latitude*Math.PI/180));const probe=await stage('boundary-ambiguity-screen',async()=>boundaryCandidates(await get(query(ENDPOINTS.boundaries,{...params,geometryType:'esriGeometryEnvelope',geometry:`${address.longitude-dx},${address.latitude-dy},${address.longitude+dx},${address.latitude+dy}`}))));nearby=probe===null?null:probe;nearbyStatus=probe===null?'unavailable':'completed';}
  }
  const ids=[...new Set(candidates.map(x=>x.pwsid))],selected=input.pwsid?[input.pwsid]:ids,systems=[];
  if(input.supply_type!=='private-well'&&selected.length<=4){
   // Two concurrent source jobs; never launch a national fan-out per address.
   for(let i=0;i<selected.length;i+=2)await Promise.all(selected.slice(i,i+2).map(async pwsid=>{
    const records=await stage(`public-system:${pwsid}`,async()=>{let data=await get(query(ENDPOINTS.systems,{output:'JSON',p_pid:pwsid,queryset:10,responseset:10}));const qid=queryId(data);if(qid)data=await get(query(ENDPOINTS.query,{output:'JSON',qid,pageno:1}));return echoRows(data,pwsid);});
    systems.push({pwsid,status:records===null?'unavailable':records.length?'records-returned':'no-matching-records',scope:'public-system-not-household',records:(records||[]).map(data=>({data,sha256:fingerprint(data)})),source:SOURCE_DOCS.systems});
   }));
  }
  systems.sort((a,b)=>a.pwsid.localeCompare(b.pwsid));
  const gaps=['No authenticated laboratory sample from this household was supplied.','Current local advisories and premise plumbing have not been comprehensively checked.','Fetching a record today does not mean the water was sampled today.'];
  if(input.supply_type==='private-well')gaps.push('Private-well status is user-reported. Nearby monitoring wells do not establish this well\'s water quality.');
  if(!ids.length&&input.supply_type!=='private-well')gaps.push('No mapped provider was established; this does not prove a private well.');
  if(ids.length>1)gaps.push('Multiple providers overlap the location. No winner has been selected.');
  if(selected.length>4)gaps.push('More than four candidate providers: confirm a full PWSID before retrieving federal records.');
  const conflict=!!input.pwsid&&ids.length>0&&!ids.includes(input.pwsid);if(conflict)gaps.push('The supplied PWSID conflicts with the mapped candidate set.');
  if(input.pwsid)gaps.push('The PWSID is user-selected, not independently verified as connected to this household.');
  return {schema_version:'national-evidence/1',generated_at:now().toISOString(),release_state:'incomplete-national-coverage',address:address||{status:'unavailable'},supply:{type:input.supply_type,evidence:'user-reported'},provider:{status:boundaryStatus,candidates,user_selected_pwsid:input.pwsid||null,conflict,household_connection_verified:false,nearby_screen:{method:'30m-envelope-not-a-calibrated-geocode-error-bound',status:nearbyStatus,candidates:nearby||[]}},systems,household_safety:{status:'not-determined',measured_concentrations:[]},gaps,audit,models:{nationally_validated_models:0,predictive_inference_enabled:false},coverage:status(),sources:SOURCE_DOCS};
 }
 function status(){return {supported_input_regions:REGION_CODES,coverage_verified:false,national_unique_observations_ingested:'0',count_scope:'new national layer only; not the existing county dataset or publisher catalogs',household_laboratory_data:'not-connected',occurrence_database:'not-connected',advisories:'not-connected',lead_line_inventories:'not-connected',well_registries:'not-connected',ucmr:'not-connected-to-serving',wqp:'not-connected-to-serving',usgs:'not-connected-to-serving',billion_row_load_test:'not-run',deployment:'requires-integration-and-acceptance'};}
 return {lookup,status};
}
module.exports={ENDPOINTS,SOURCE_DOCS,safeTarget,transport,query,createEngine};
