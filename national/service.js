'use strict';
const {EvidenceError,validateInput,fingerprint,censusMatch,boundaryCandidates,echoRows,queryId,REGION_CODES}=require('./evidence');
const {getHealthContext}=require('./health_context');
const {buildResidentReport}=require('./resident');
const ENDPOINTS=Object.freeze({
  census:'https://geocoding.geo.census.gov/geocoder/geographies/address',
  censusOneLine:'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress',
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
function createEngine({request=transport(),warehouse=null,archive=null,context=null,propertyContext=null,advisories=null,now=()=>new Date(),deadlineMs=28000}={}){
 async function lookup(raw){
  const input=validateInput(raw),signal=AbortSignal.timeout(deadlineMs),audit=[];
  async function stage(name,fn){const started=now().toISOString();try{signal.throwIfAborted();const value=await fn();audit.push({agent:name,type:'deterministic',status:'completed',retrieved_at:started});return value;}catch(e){audit.push({agent:name,type:'deterministic',status:'unavailable',retrieved_at:started,error_code:e.code||'SOURCE_UNAVAILABLE'});return null;}}
  const get=url=>request(url,{signal});
  const hasAddress=input.address||input.street&&(input.city||input.zip);
  const address=hasAddress?await stage('address-resolution',async()=>{
   const common={benchmark:'Public_AR_Current',vintage:'Current_Current',format:'json'},one=input.address;
   let match=await get(query(one?ENDPOINTS.censusOneLine:ENDPOINTS.census,one?{...common,address:one}:{...common,street:input.street,city:input.city,state:input.state,zip:input.zip})).then(x=>censusMatch(x,input));
   // Retry only a unit-stripped street address, keeping city/state/ZIP unchanged.
   // An ambiguous match always requires the resident to choose an address.
   if(match.status==='unresolved'){
    const value=one||input.street,clean=value.replace(/\s+(?:APT|UNIT|SUITE|STE|#)\s*[A-Z0-9-]+(?=,|$)/i,'');
    if(clean!==value)match=await get(query(one?ENDPOINTS.censusOneLine:ENDPOINTS.census,one?{...common,address:clean}:{...common,street:clean,city:input.city,state:input.state,zip:input.zip})).then(x=>censusMatch(x,input));
   }return match;
  }):{status:'not-requested'};
  const includeEnvironment=raw.include_environment!==false;
  const environmentJob=context&&includeEnvironment&&address?.status==='matched'?stage('environmental-context',()=>context(address,{signal})):Promise.resolve({status:'not-requested',records:[],household_match:false});
  const archivedEnvironmentJob=archive?.lookupEnvironment&&includeEnvironment&&address?.status==='matched'?stage('archived-environmental-context',()=>archive.lookupEnvironment(address)):Promise.resolve({status:'not-requested',records:[],household_sample_verified:false});
  const propertyJob=propertyContext&&address?.status==='matched'?stage('property-and-groundwater-evidence',()=>propertyContext(address,{signal,supplyType:input.supply_type})):Promise.resolve(null);
  const wellArchiveJob=archive?.lookupWells&&address?.status==='matched'?stage('state-well-records',()=>archive.lookupWells(address)):Promise.resolve(null);
  let candidates=[],boundaryStatus='not-requested',nearby=[],nearbyStatus='not-requested';
  if(address?.status==='matched'&&input.supply_type!=='private-well'){
   const params={f:'json',geometryType:'esriGeometryPoint',geometry:`${address.longitude},${address.latitude}`,inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:'false'};
   const found=await stage('provider-candidates',async()=>boundaryCandidates(await get(query(ENDPOINTS.boundaries,params))));
   candidates=found||[];boundaryStatus=found===null?'unavailable':found.length?'candidates-found':'unresolved';
   if(found&&found.length){const dy=30/111320,dx=dy/Math.max(.01,Math.cos(address.latitude*Math.PI/180));const probe=await stage('boundary-ambiguity-screen',async()=>boundaryCandidates(await get(query(ENDPOINTS.boundaries,{...params,geometryType:'esriGeometryEnvelope',geometry:`${address.longitude-dx},${address.latitude-dy},${address.longitude+dx},${address.latitude+dy}`}))));nearby=probe===null?null:probe;nearbyStatus=probe===null?'unavailable':'completed';}
  }
  const ids=[...new Set(candidates.map(x=>x.pwsid))],selected=input.pwsid?[input.pwsid]:ids,systems=[];
  // Advisory retrieval overlaps historical retrieval and never substitutes a
  // compliance violation for an active public notice.
  const advisoryJob=advisories?stage('current-official-advisories',()=>advisories({address,pwsids:selected.length<=4?selected:[],supplyType:input.supply_type},{signal})):Promise.resolve(null);
  if(input.supply_type!=='private-well'&&selected.length<=4){
   // Two concurrent source jobs; never launch a national fan-out per address.
   for(let i=0;i<selected.length;i+=2)await Promise.all(selected.slice(i,i+2).map(async pwsid=>{
    const liveJob=stage(`public-system:${pwsid}`,async()=>{let data=await get(query(ENDPOINTS.systems,{output:'JSON',p_pid:pwsid,queryset:10,responseset:10}));const qid=queryId(data);if(qid)data=await get(query(ENDPOINTS.query,{output:'JSON',qid,pageno:1}));return echoRows(data,pwsid);});
    const storedJob=warehouse?stage(`stored-evidence:${pwsid}`,()=>warehouse.lookupSystem(pwsid,{limit:120})):null;
    const archiveJob=archive?stage(`historical-archive:${pwsid}`,()=>archive.lookupSystem(pwsid)):null;
    const [records,stored,historical]=await Promise.all([liveJob,storedJob,archiveJob]);
    if(historical?.summaries)historical.summaries=historical.summaries.map(r=>({...r,health_context:getHealthContext(r.analyte)}));
    systems.push({pwsid,status:records===null?'unavailable':records.length?'records-returned':'no-matching-records',scope:'public-system-not-household',records:(records||[]).map(data=>({data,sha256:fingerprint(data)})),source:SOURCE_DOCS.systems,warehouse:stored,archive:historical});
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
  const occurrenceRecords=systems.flatMap(s=>(s.warehouse?.observations||[]).map(r=>({...r,pwsid:s.pwsid,scope:'public-system-not-household',health_context:getHealthContext(r.analyte)})));
  const storedStates=systems.map(s=>s.warehouse?.status||'unavailable');
  const failed=storedStates.some(s=>!['records-returned','no-matching-records'].includes(s));
  const occurrenceStatus=input.supply_type==='private-well'?'not-applicable':!warehouse?'not-connected':!systems.length?'provider-unresolved':occurrenceRecords.length?(failed?'partial':'records-returned'):storedStates.every(s=>s==='not-connected')?'not-connected':failed?'unavailable':'no-records-returned';
  const occurrence={status:occurrenceStatus,records:occurrenceRecords,summary:systems.map(s=>({pwsid:s.pwsid,status:s.warehouse?.status||'unavailable',analytes:(s.warehouse?.observation_summary||[]).map(r=>({...r,health_context:getHealthContext(r.analyte)})),counts:s.warehouse?.counts,truncated:s.warehouse?.truncated})),household_sample:false};
  const next_steps=input.supply_type==='private-well'?[{title:'Test your own well',description:'A state-certified laboratory can test a sample from your well. Nearby environmental measurements cannot establish the chemistry of this well.',url:'https://www.cdc.gov/drinking-water/safety/guidelines-for-testing-well-water.html'},{title:'Find a certified drinking-water laboratory',url:'https://www.epa.gov/dwlabcert/contact-information-certification-programs-and-certified-laboratories-drinking-water'}]:[{title:'Confirm the provider on your water bill',description:'Mapped service areas may overlap and include modeled boundaries. Use your full public water system ID to narrow the records.'},{title:'Find your annual water quality report',url:'https://www.epa.gov/ccr'},{title:'Check current notices with your utility',description:'Federal compliance and sampling records are historical and do not replace current boil-water or do-not-drink notices.'}];
  const environment=await environmentJob||{status:'unavailable',records:[],household_match:false};
  const archived_environment=await archivedEnvironmentJob||{status:'unavailable',records:[],household_sample_verified:false};
  const property=await propertyJob,well_records=await wellArchiveJob;
  const current_advisories=await advisoryJob||{status:advisories?'unavailable':'not-connected',records:[],checks:[],comprehensive:false};
  const result={schema_version:'national-evidence/2',generated_at:now().toISOString(),release_state:'incomplete-national-coverage',address:address||{status:'unavailable'},supply:{type:input.supply_type,evidence:'user-reported'},provider:{status:boundaryStatus,candidates,user_selected_pwsid:input.pwsid||null,conflict,household_connection_verified:false,nearby_screen:{method:'30m-envelope-not-a-calibrated-geocode-error-bound',status:nearbyStatus,candidates:nearby||[]}},systems,occurrence,environment,archived_environment,property,well_records,next_steps,household_safety:{status:'not-determined',measured_concentrations:[]},gaps,audit,models:{nationally_validated_models:0,predictive_inference_enabled:false},coverage:await status(),sources:SOURCE_DOCS};
  result.current_advisories=current_advisories;
  result.resident_report=buildResidentReport(result);return result;
 }
 function status(){
  const base={supported_input_regions:REGION_CODES,coverage_verified:false,national_unique_observations_ingested:'0',count_scope:'new national layer only; not the existing county dataset or publisher catalogs',household_laboratory_data:'not-connected',occurrence_database:'not-connected',advisories:'not-connected',lead_line_inventories:'not-connected',well_registries:'not-connected',ucmr:'not-connected-to-serving',wqp:'not-connected-to-serving',usgs:'not-connected-to-serving',billion_row_load_test:'not-run',deployment:'integrated-national-route'};
  if(context)base.usgs='bounded-live-environmental-queries';
  if(advisories)base.advisories={status:'selected-official-live-sources',sources:['Oregon Drinking Water Services','Cleveland Water'],comprehensive:false};
  if(propertyContext){base.lead_line_inventories='NYC-address-matched-inventory';base.well_registries='USGS-monitoring-well-locations';base.cleanup_sites='bounded-EPA-Superfund-queries';}
  if(!warehouse&&!archive)return base;
  const current=warehouse?warehouse.status().then(data=>({...base,...data,occurrence_database:data.status,datasets:data.sources||[],last_ingested_at:(data.sources||[]).map(s=>s.completed_at?new Date(s.completed_at).toISOString():null).filter(Boolean).sort().at(-1)||null,ucmr:(data.sources||[]).some(s=>s.source==='ucmr5'&&s.run_id)?'connected':'awaiting-import'})).catch(()=>({...base,national_unique_observations_ingested:null,occurrence_database:'unavailable'})):Promise.resolve(base);
  const historical=archive?archive.status().catch(()=>({ingestion_status:'unavailable',retained_source_records:null})):Promise.resolve(null);
  return Promise.all([current,historical]).then(([data,history])=>({...data,well_registries:history?.well_archive?.published_states?.length?'acquired-state-NWWDB-and-USGS-monitoring-wells':data.well_registries,wqp:history?.environmental_archive?.schema==='wqp-durable/1'?'persistent-bounded-geographic-lookups':data.wqp,historical_archive:history}));
 }

 return {lookup,status};
}
module.exports={ENDPOINTS,SOURCE_DOCS,safeTarget,transport,query,createEngine};
