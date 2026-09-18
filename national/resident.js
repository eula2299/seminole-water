'use strict';
const {getHealthContext}=require('./health_context');
const LAB='https://www.epa.gov/dwlabcert/contact-information-certification-programs-and-certified-laboratories-drinking-water';
const WELL='https://www.cdc.gov/drinking-water/safety/guidelines-for-testing-well-water.html';
const LEAD='https://www.epa.gov/ground-water-and-drinking-water/basic-information-about-lead-drinking-water';
const RULES='https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations';
const validNumber=x=>x!==null&&x!==undefined&&String(x).trim()!==''&&Number.isFinite(Number(x))&&Number(x)>=0;
const quantity=x=>validNumber(x)?Number(x).toLocaleString('en-US',{maximumSignificantDigits:6}):null;
function sourceLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function providerName(system,candidates){return candidates.find(c=>c.pwsid===system.pwsid)?.name||system.warehouse?.system?.name||system.records?.[0]?.data?.PWSName||'Water provider';}
function comparison(row){
 // Educational comparisons of reported system monitoring, not compliance
 // calculations (which can depend on averaging, location and regulatory dates).
 if(row.scope!=='system-monitoring'||row.result_kind==='presence-absence'||!validNumber(row.max_detect))return null;
 const key=String(row.analyte).toLowerCase().replace(/[\s,_()-]+/g,'');
 const refs={arsenic:[10,'Arsenic'],arsenictotal:[10,'Arsenic'],nitrateasn:[10000,'Nitrate as nitrogen'],nitriteasn:[1000,'Nitrite as nitrogen'],barium:[2000,'Barium'],cadmium:[5,'Cadmium'],fluoride:[4000,'Fluoride'],selenium:[50,'Selenium'],benzene:[5,'Benzene'],atrazine:[3,'Atrazine']};
 const ref=refs[key],unit=String(row.unit||'').replace(/[µμ]/g,'u').replace(/\s/g,'').toLowerCase(),factor={'ug/l':1,'mg/l':1000,'ng/l':.001}[unit];
 if(!ref||factor===undefined)return null;const maximum=Number(row.max_detect)*factor;
 return {above_reference:maximum>ref[0],reference_text:quantity(ref[0]/factor)+' '+row.unit,source: RULES,description:maximum>ref[0]?'At least one reported result was above the federal drinking-water limit. Ask the utility about follow-up results.':'The displayed detected range is at or below this federal drinking-water limit.',qualification:'This compares historical samples with a federal limit; it does not determine legal compliance or the concentration at your tap.'};
}
function finding(row,provider,source){
 const name=String(row.analyte||''),health=row.health_context?.matched?row.health_context:getHealthContext(name),qualitative=row.result_kind==='presence-absence';
 const hasDetection=qualitative?Number(row.present_results)>0:Number(row.detects)>0;
 let result='Below the laboratory reporting limit';
 if(qualitative)result=Number(row.present_results)>0?'Present in '+row.present_results+' reported tests':'Reported absent in the displayed tests';
 else if(validNumber(row.min_detect)&&validNumber(row.max_detect)&&Number(row.min_detect)<=Number(row.max_detect))result=quantity(row.min_detect)+(Number(row.min_detect)!==Number(row.max_detect)?'–'+quantity(row.max_detect):'')+' '+(row.unit||'unit not reported');
 else if(!Number(row.nondetects))result='See the original report for the reported result';
 return {name,provider,scope:row.scope,detected:hasDetection,result,first_sample:row.first_date,last_sample:row.last_date,source_name:source?.label||source?.id||'EPA monitoring records',source_url:sourceLink(source?.catalogue_url||source?.source_url||source?.url),reported_results:Number(row.n)||null,non_detects:Number(row.nondetects)||0,health:health.matched?{title:health.label,text:health.summary,action:health.practical_step,sources:health.sources}:null,comparison:comparison(row)};
}
function buildResidentReport(data){
 const privateWell=data.supply?.type==='private-well',candidates=data.provider?.candidates||[],findings=[],providers=[];
 if(!privateWell)for(const system of data.systems||[]){
  const name=providerName(system,candidates);providers.push({id:system.pwsid,name});
  for(const row of system.archive?.summaries||[]){if(Number(row.invalid_identity_date)>0||!row.analyte)continue;findings.push(finding(row,name,system.archive.sources?.find(s=>s.id===row.source_id)));}
  const group=data.occurrence?.summary?.find(s=>s.pwsid===system.pwsid);
  for(const row of group?.analytes||[]){if(!row.analyte)continue;const source=system.warehouse?.sources?.find(s=>s.source==='ucmr5');
   // UCMR5 already occurs in the historical archive; do not count it twice.
   if(system.archive?.summaries?.some(r=>r.source_id==='ucmr5'&&r.analyte===row.analyte&&r.unit===row.unit))continue;
   findings.push(finding({analyte:row.analyte,unit:row.unit,n:row.sample_results,detects:Number(row.sample_results)-Number(row.non_detects),nondetects:row.non_detects,min_detect:row.minimum_detected,max_detect:row.maximum_detected,first_date:row.first_sample,last_date:row.last_sample,scope:'system-sampling-context-unspecified',health_context:row.health_context},name,source));
  }
 }
 findings.sort((a,b)=>Number(!!b.comparison?.above_reference)-Number(!!a.comparison?.above_reference)||Number(b.detected)-Number(a.detected)||String(b.last_sample||'').localeCompare(a.last_sample||''));
 const compliance=[];
 if(!privateWell)for(const system of data.systems||[]){const c=system.archive?.compliance;if(c?.status!=='records-returned')continue;const seen=new Map();
  for(const row of c.records||[]){if(!row.VIOLATION_ID)continue;let issue=seen.get(row.VIOLATION_ID);if(!issue){issue={id:row.VIOLATION_ID,provider:providerName(system,candidates),title:row.code_descriptions?.VIOLATION_CODE||row.code_descriptions?.VIOLATION_CATEGORY_CODE||'Reported water-system issue',contaminant:row.code_descriptions?.CONTAMINANT_CODE||null,status:row.VIOLATION_STATUS||'Status not reported',health_based:row.IS_HEALTH_BASED_IND==='Y',begin:row.NON_COMPL_PER_BEGIN_DATE||row.COMPL_PER_BEGIN_DATE,end:row.NON_COMPL_PER_END_DATE||row.COMPL_PER_END_DATE,returned_to_compliance:row.CALCULATED_RTC_DATE||null,actions:[]};seen.set(row.VIOLATION_ID,issue);}const action=row.code_descriptions?.ENFORCEMENT_ACTION_TYPE_CODE;if(action&&!issue.actions.some(a=>a.title===action&&a.date===row.ENFORCEMENT_DATE))issue.actions.push({title:action,date:row.ENFORCEMENT_DATE});}
  compliance.push({provider:providerName(system,candidates),reported_violations:c.distinct_violation_ids,issues:[...seen.values()],truncated:c.truncated===true,source_url:sourceLink(c.source?.documentation_url),reporting_periods:c.submission_periods||[]});
 }
 const unresolvedIssues=compliance.flatMap(x=>x.issues).filter(x=>x.health_based&&String(x.status).toLowerCase()==='unresolved');
 const service=data.property?.service_line,lead=service?.status==='address-record-match'?service.records?.[0]:null;
 const detectedNames=new Set(findings.filter(x=>x.detected&&x.scope==='system-monitoring').map(x=>x.name.toLowerCase()));
 const hasRecords=findings.length||compliance.length,matched=data.address?.status==='matched';
 let headline=privateWell?'Your well needs its own water test':hasRecords?'Here’s what the records show':'Your next step is to confirm your water source';
 let summary=privateWell?'A well’s construction and nearby monitoring help explain the setting. Only a sample from your well can establish what is in the water you drink.':hasRecords?'We found water-system records for the service area around this address. The findings below explain the reported substances and past issues. They describe utility samples, not a test of your tap.':'Public records alone have not identified a reliable utility connection for this address. You can still check the local setting and follow the steps below to get a home-specific answer.';
 if(!matched&&!data.provider?.user_selected_pwsid){headline=data.address?.status==='ambiguous'?'Choose the address you meant':'Add a little more detail to your address';summary='Use the street number, street name, city and state or ZIP code. That lets us connect the report to the right place instead of guessing a nearby home.';}
 const actions=[];
 const notices=privateWell?{status:'not-applicable-private-well',records:[],checks:[],comprehensive:false}:data.current_advisories||{status:'not-connected',records:[],checks:[],comprehensive:false};
 if(notices.records?.length){headline='A water notice needs your attention';summary='An official source lists a notice for a possible provider or an area near this address. Check whether your home is affected and follow the notice before using the water. The historical results below do not override it.';}
 for(const notice of notices.records||[])actions.push({title:'Read the '+notice.provider+' notice',text:notice.guidance,url:sourceLink(notice.source_url)});
 if(unresolvedIssues.length)actions.push({title:'Ask the utility about a reported health-related issue',text:'The federal snapshot labels '+unresolvedIssues.length+' displayed issue'+(unresolvedIssues.length===1?'':'s')+' unresolved. Ask whether it has since been corrected and whether any notice applies today.',url:'https://www.epa.gov/ground-water-and-drinking-water/local-drinking-water-information'});
 if(lead)actions.push({title:'Check your recorded service-line material',text:'The local property inventory lists “'+lead.material+'” at '+lead.address+'. Ask the utility to confirm the current material and explain its verification record.',url:service.source_url});
 if(privateWell)actions.push({title:'Arrange a well-water test',text:'CDC recommends annual checks for total coliform bacteria, nitrate, total dissolved solids and pH. Ask your health department which additional tests matter locally.',url:WELL});
 else actions.push({title:providers.length?'Check today’s notices with your utility':'Confirm who supplies your home',text:providers.length?'Use the provider name on your water bill. Ask about current advisories and the latest water-quality report; historical records do not establish today’s conditions.':'Your water bill or local water department can confirm the provider. A property outside a mapped service area is not automatically on a private well.',url:'https://www.epa.gov/ccr'});
 actions.push({title:privateWell?'Use a certified laboratory':'Check what reaches your own tap',text:privateWell?'A certified laboratory can explain sampling instructions and the tests appropriate for your well.':'Home plumbing can change water quality. For lead concerns, ask your utility about your service line and a certified laboratory about testing your tap.',url:privateWell?LAB:LEAD});
 return {version:'resident-report/1',headline,summary,address:data.address?.matched_address||null,address_choices:data.address?.candidates||[],providers,provider_ambiguity:candidates.length>1||data.provider?.conflict===true,private_well:privateWell,findings,detected_substances:detectedNames.size,compliance,actions,service_line:service||null,location:data.address?.geography||{},scope_note:'Historical water-system and nearby environmental records help you decide what to check. They cannot certify the water at a particular tap today.',advisories:notices,current_advisories_checked:(notices.checks||[]).some(c=>c.status==='checked'),advisories_comprehensive:false,household_safety:'not-determined',generated_at:data.generated_at};
}
module.exports={buildResidentReport,comparison,sourceLink};
