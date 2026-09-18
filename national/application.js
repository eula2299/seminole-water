'use strict';
const {createEngine}=require('./service');
const {REGION_CODES,validPwsid,EvidenceError}=require('./evidence');
function warehouseClient({base=process.env.WAREHOUSE_URL,fetchImpl=globalThis.fetch,ttlMs=60000,maxCache=256}={}){
 const cache=new Map(),pending=new Map();
 async function read(path){
  if(!base)throw new EvidenceError('WAREHOUSE_NOT_CONFIGURED','National observation storage is not configured.',503);
  const root=new URL(base);
  if(!['http:','https:'].includes(root.protocol)||root.username||root.password||root.search||root.hash)throw new Error('Invalid server warehouse configuration');
  if(path!=='/status'&&!/^\/pws\/[A-Z0-9]{9}$/.test(path))throw new Error('Invalid warehouse resource');
  const saved=cache.get(path);if(saved&&saved.until>Date.now())return saved.value;
  if(pending.has(path))return pending.get(path);
  const work=(async()=>{
   const response=await fetchImpl(new URL(path,root),{redirect:'error',signal:AbortSignal.timeout(4000),headers:{Accept:'application/json'}});
   if(!response.ok){await response.body?.cancel();throw new Error('National storage unavailable');}
   const reader=response.body?.getReader();if(!reader)throw new Error('National storage empty response');
   let size=0;const parts=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4_000_000)throw new Error('National storage response exceeded budget');parts.push(Buffer.from(value));}}
   catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
   const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
   if(path==='/status'){
    if(value.schema!=='occurrence-warehouse/1'||!Number.isSafeInteger(value.retained_source_records)||value.retained_source_records<0)throw new Error('Unrecognized national storage status');
   }else if(value.pwsid!==path.slice(5)||!Array.isArray(value.summaries)||!Array.isArray(value.sources))throw new Error('Mismatched national storage response');
   if(Buffer.byteLength(JSON.stringify(value))<=500000){cache.set(path,{value,until:Date.now()+(path==='/status'?15000:ttlMs)});while(cache.size>maxCache)cache.delete(cache.keys().next().value);}
   return value;
  })().finally(()=>pending.delete(path));pending.set(path,work);return work;
 }
 return {read};
}
const HEALTH_DOC='https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations';
const HEALTH=Object.freeze([
 {match:/^LEAD$/i,title:'Lead',text:'Lead exposure can affect children’s development and adult kidney and cardiovascular health. Household plumbing can change lead levels, so a utility sample does not establish your tap’s level.',source:'https://www.epa.gov/ground-water-and-drinking-water/basic-information-about-lead-drinking-water'},
 {match:/^ARSENIC$/i,title:'Arsenic',text:'Long-term exposure to elevated arsenic can damage skin and circulation and increase cancer risk. The records here do not establish your personal exposure.',source:HEALTH_DOC},
 {match:/NITR(A|I)TE/i,title:'Nitrate and nitrite',text:'High nitrate or nitrite in drinking water can be particularly dangerous for infants. Chemical reporting basis matters: a result expressed as nitrogen cannot be compared directly with a result expressed as nitrate.',source:'https://www.epa.gov/privatewells/potential-well-water-contaminants-and-their-impacts'},
 {match:/^(PFOA|PFOS|PFNA|PFHXS|HFPO-DA|GENX)$/i,title:'PFAS',text:'PFAS health interpretation depends on the specific chemical, concentration and exposure. Historical monitoring is useful evidence, but it is not a current household exposure estimate.',source:'https://www.epa.gov/pfas/our-current-understanding-human-health-and-environmental-risks-pfas'},
 {match:/TRIHALOMETHAN|^TTHM|HALOACETIC|^HAA5/i,title:'Disinfection byproducts',text:'Long-term exposure above drinking-water standards can have health consequences. Compliance is evaluated with the applicable sampling and averaging rules—not a single historical maximum.',source:HEALTH_DOC},
 {match:/RADIUM|URANIUM|ALPHA|BETA|PHOTON/i,title:'Radioactive substances',text:'Certain radionuclides can increase cancer risk, and uranium can affect kidneys. Radioactivity units and chemical concentration units are not interchangeable.',source:'https://www.epa.gov/privatewells/potential-well-water-contaminants-and-their-impacts'},
 {match:/COLIFORM|E\. ?COLI|ESCHERICHIA|GIARDIA|CRYPTOSPORIDIUM/i,title:'Microbiological indicators',text:'Microbiological results can indicate contamination or treatment concerns. Historical records do not establish that an advisory is active today. Follow current instructions from your utility or health department.',source:HEALTH_DOC}
]);
function healthContext(summaries){return HEALTH.filter(h=>summaries.some(s=>Number(s.detects)>0&&h.match.test(s.analyte||''))).map(({title,text,source})=>({title,text,source}));}
function createApplication({core=createEngine(),warehouse=warehouseClient(),context=null}={}){
 async function status(){
  let data;try{data=await warehouse.read('/status');}catch{data={ingestion_status:'unavailable',retained_source_records:null,published_archives:null,target_met:false,sources:{},errors:{storage:'unavailable'}};}
  return {schema_version:'national-production/1',supported_input_regions:REGION_CODES,coverage_complete:false,household_safety_certified:false,
   observations:{retained_source_records:data.retained_source_records,raw_rows:data.raw_rows??null,published_archives:data.published_archives,ingestion_status:data.ingestion_status,current_archive:data.current_archive||null,stored_bytes:data.stored_bytes??null,target_minimum_records:data.target_minimum_records||200000000,target_met:data.target_met===true,count_definition:data.count_definition||'Count unavailable. No record count is inferred from publisher inventories.',sources:Object.values(data.sources||{}).map(s=>({id:s.id,source_url:s.url,retrieved_at:s.retrieved_at,sha256:s.sha256,records:s.distinct_source_rows})),errors:data.errors||{}},
   capabilities:{address_geocoding:'live-Census',provider_mapping:'EPA-candidates-with-provenance',system_compliance:'live-ECHO',occurrence_warehouse:data.published_archives>0?'connected':'not-ready',environmental_context:context?'bounded-live-source-queries':'not-connected',household_lab_data:'not-connected',current_advisories:'utility-verification-required',property_lead_inventory:'not-connected',national_private_well_registry:'not-connected',national_prediction_models:'not-validated',billion_row_load_test:'not-run'}};
 }
 async function lookup(raw){
  const result=await core.lookup(raw);
  const ids=[...new Set([result.provider?.user_selected_pwsid,...(result.systems||[]).map(s=>s.pwsid)])].filter(validPwsid).slice(0,4);
  const occurrence=[];
  if(result.supply?.type!=='private-well')for(let start=0;start<ids.length;start+=2)await Promise.all(ids.slice(start,start+2).map(async id=>{
   try{const data=await warehouse.read('/pws/'+id);occurrence.push(data);result.audit.push({agent:'occurrence-evidence:'+id,type:'deterministic',status:'completed',retrieved_at:result.generated_at});}
   catch{occurrence.push({pwsid:id,status:'unavailable',summaries:[],sources:[],current_safety:'not-determined'});result.audit.push({agent:'occurrence-evidence:'+id,type:'deterministic',status:'unavailable',error_code:'WAREHOUSE_UNAVAILABLE'});}
  }));
  result.occurrence=occurrence.sort((a,b)=>a.pwsid.localeCompare(b.pwsid));
  result.health_context=healthContext(occurrence.flatMap(x=>x.summaries));
  result.coverage=await status();result.release_state='operational-with-disclosed-coverage';
  result.environment={status:'not-requested',household_match:false,records:[]};
  if(context&&raw.include_environment===true&&result.address?.status==='matched'){
   try{result.environment=await context(result.address);}catch{result.environment={status:'unavailable',household_match:false,records:[]};}
  }
  result.next_steps=result.supply.type==='private-well'?
   [{title:'Test this well',text:'Use a state-certified laboratory. Nearby monitoring cannot establish the chemistry of this particular well.',url:'https://www.cdc.gov/drinking-water/safety/guidelines-for-testing-well-water.html'},
    {title:'Check local conditions',text:'Ask your health department about local contaminants and any current well-water notices.',url:'https://www.epa.gov/privatewells/protect-your-homes-water'}]:
   [{title:'Confirm the provider',text:'Compare the provider and complete PWSID with your water bill, landlord or utility. Overlapping or modeled boundaries are candidates, not confirmed connections.',url:'https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas'},
    {title:'Read the current utility report and notices',text:'Obtain the latest Consumer Confidence Report and current advisories directly from the utility. No nationwide real-time advisory clearance is implied.',url:'https://www.epa.gov/ccr'},
    {title:'Resolve household-specific questions',text:'Lead service lines, premise plumbing and a household sample require separate evidence.',url:'https://www.epa.gov/ground-water-and-drinking-water/basic-information-about-lead-drinking-water'}];
  return result;
 }
 return {lookup,status};
}
module.exports={warehouseClient,healthContext,createApplication};
