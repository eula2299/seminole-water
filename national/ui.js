'use strict';
const {REGION_CODES}=require('./evidence');

// The same formatting functions are used by the browser and the contract tests.
function safeSourceUrl(value){
  try { const url=new URL(value); return url.protocol==='https:'&&!url.username&&!url.password?url.href:null; }
  catch { return null; }
}
function readableDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value))return 'Not supplied';
  const date=new Date(value);
  const day=new Date(value.slice(0,10)+'T00:00:00Z');
  return Number.isNaN(date.getTime())||Number.isNaN(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10)?'Not supplied':date.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
}
function formatOccurrence(record){
  const raw=record.value??record.result_value??record.reported_value;
  const qualifier=String(record.qualifier??'').trim();
  const nonDetect=/^(ND|non[- ]?detect(?:ed)?|not detected|below detection limit)$/i.test(qualifier)||/^ND$/i.test(String(raw));
  const belowLimit=record.censored===true&&(!qualifier||/^(<|<=|≤)$/.test(qualifier));
  const unit=String(record.unit??record.result_unit??'').trim();
  const missing=raw===null||raw===undefined||String(raw).trim()==='';
  const operator=/^(<|>|<=|>=|≤|≥)$/.test(qualifier)?qualifier:'';
  let value=belowLimit?'Below reporting limit':nonDetect?'Not detected':missing?'Not reported':String(raw);
  if(!belowLimit&&!nonDetect&&!missing&&operator&&!/^[<>≤≥]/.test(value))value=operator+' '+value;
  if(!belowLimit&&!nonDetect&&!missing&&unit)value+=' '+unit;
  const limit=record.reporting_limit??record.reporting_limit_value;
  const limitUnit=record.reporting_limit_unit||unit;
  const bound=record.reported_bound;
  if(belowLimit&&bound!==null&&bound!==undefined&&String(bound).trim()!==''&&Number.isFinite(Number(bound))&&Number(bound)>=0&&
    (limit===null||limit===undefined||String(limit).trim()===''||Number(bound)!==Number(limit)))value=(operator||'<')+' '+bound+(unit?' '+unit:'');
  const note=nonDetect||belowLimit?(limit!==null&&limit!==undefined&&String(limit).trim()!==''?'Reporting limit: '+limit+(limitUnit?' '+limitUnit:''):'Reporting limit not supplied; not detected does not mean zero.'):
    qualifier&&!operator?'Qualifier: '+qualifier:!unit&&!missing?'Unit not supplied.':'';
  return {name:String(record.contaminant??record.contaminant_name??record.analyte??'Unnamed analyte'),value,note,date:readableDate(record.sampled_at??record.sample_date),source:safeSourceUrl(record.source_url),pwsid:String(record.pwsid??'')};
}
function systemFacts(record){
  const fields={};
  for(const [key,value]of Object.entries(record||{}))fields[key.replace(/[^a-z0-9]/gi,'').toLowerCase()]=value;
  function pick(keys){for(const key of keys){const value=fields[key.toLowerCase()];if(value!==null&&value!==undefined&&value!=='')return String(value);}return null;}
  const pairs=[
    ['System name',['pwsname','pwsystemname','name']],
    ['Population served',['populationservedcount','populationserved','population']],
    ['Primary source',['primarysourcetype','primarysourcecode','sourcetype','sourcewatertype']],
    ['System type',['pwsType','pwsTypeCode','systemtype']],
    ['System status',['pwsactivitycode','pwsactivitystatus','activitystatus','status','active']],
    ['State',['statecode','state','pwsstate']],
    ['Counties served',['countiesserved','county','countyname']],
    ['Quarters with violations',['qtrswithviol','qtrswithviolations','countquarterswithviolations']],
    ['Quarters with serious violations',['qtrswithsnc','qtrswithsncviolations']],
    ['Reporting period',['reportingperiod','reportingcycle','fiscalyear']]
  ];
  const labels={GW:'Groundwater',SW:'Surface water',GU:'Groundwater under the direct influence of surface water',GWP:'Purchased groundwater',SWP:'Purchased surface water',CWS:'Community water system',NTNCWS:'Non-transient non-community system',TNCWS:'Transient non-community system',A:'Active',I:'Inactive',true:'Active',false:'Not marked active'};
  return pairs.map(([label,keys])=>{let value=pick(keys);if(value!==null){if(label==='Population served'&&/^\d+$/.test(value))value=Number(value).toLocaleString('en-US');else if(['Primary source','System type','System status'].includes(label))value=labels[value]||value;}return {label,value};}).filter(x=>x.value!==null);
}
function statusSummary(status){
  const raw=status?.national_unique_observations_ingested;
  const valid=typeof raw==='number'?Number.isSafeInteger(raw)&&raw>=0:typeof raw==='string'&&/^\d+$/.test(raw);
  const count=valid?BigInt(raw).toLocaleString('en-US'):'Unavailable';
  return {count,date:readableDate(status?.last_ingested_at??status?.updated_at),scope:status?.count_scope||'Unique observations stored in the national dataset.',verified:status?.coverage_verified===true};
}
function formatAnalyteSummary(analyte){
  const count=value=>/^\d+$/.test(String(value))?BigInt(value).toLocaleString('en-US'):'Not supplied';
  const min=analyte.minimum_detected,max=analyte.maximum_detected;
  const isNumber=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0;
  let range='No quantified detection reported';
  if(isNumber(min)&&isNumber(max)&&Number(min)<=Number(max))range=(Number(min)===Number(max)?String(min):min+' – '+max)+(analyte.unit?' '+analyte.unit:' (unit not supplied)');
  else if(min!==null&&min!==undefined||max!==null&&max!==undefined)range='Detected range not established';
  return {name:String(analyte.analyte||'Unnamed analyte'),range,samples:count(analyte.sample_results),nonDetects:count(analyte.non_detects),first:readableDate(analyte.first_sample),last:readableDate(analyte.last_sample)};
}

function nationalClient(){
  const form=document.querySelector('#lookup-form'),results=document.querySelector('#results'),message=document.querySelector('#message'),submit=document.querySelector('#lookup-button');
  const supply=form.elements.supply_type,pwsid=form.elements.pwsid,street=form.elements.street;
  let requestSerial=0,lookupController=null;
  const sourceLinks={
    local:'https://www.epa.gov/ground-water-and-drinking-water/local-drinking-water-information',
    labs:'https://www.epa.gov/dwlabcert/contact-information-certification-programs-and-certified-laboratories-drinking-water',
    wells:'https://www.epa.gov/privatewells',
    cdc:'https://www.cdc.gov/drinking-water/safety/guidelines-for-testing-well-water.html'
  };
  function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text);if(className)element.className=className;return element;}
  function link(label,url){const target=safeSourceUrl(url),element=node(target?'a':'span',label);if(target){element.href=target;element.target='_blank';element.rel='noopener noreferrer';}return element;}
  function card(title,kicker){const element=node('section',undefined,'card');if(kicker)element.append(node('p',kicker,'eyebrow'));element.append(node('h2',title));results.append(element);return element;}
  function paragraph(parent,text,className){parent.append(node('p',text,className));}
  function list(parent,items){const ul=node('ul',undefined,'plain-list');for(const text of items)ul.append(node('li',text));parent.append(ul);}
  function facts(parent,pairs){if(!pairs.length)return;const dl=node('dl',undefined,'facts');for(const {label,value}of pairs){const row=node('div');row.append(node('dt',label),node('dd',value));dl.append(row);}parent.append(dl);}
  function resource(parent,label,url,description){const item=node('div',undefined,'resource');item.append(link(label,url));if(description)item.append(node('p',description,'muted'));parent.append(item);}
  function sourceDetails(parent,data,label){const details=node('details');details.append(node('summary',label||'View source records'));details.append(node('pre',JSON.stringify(data,null,2)));parent.append(details);}
  function updateStatus(status){
    const summary=statusSummary(status);
    document.querySelector('#dataset-count').textContent=summary.count;
    document.querySelector('#dataset-date').textContent=summary.date;
    document.querySelector('#dataset-scope').textContent=summary.scope;
    document.querySelector('#coverage-note').textContent=summary.verified?'See source coverage and dates below.':'Record availability varies by location. A missing record does not establish that water is safe.';
    const container=document.querySelector('#dataset-details');container.replaceChildren();
    const datasets=Array.isArray(status.datasets)?status.datasets:Object.entries(status.datasets||{}).map(([name,value])=>typeof value==='object'?{name,...value}:{name,status:value});
    if(datasets.length){for(const dataset of datasets){const row=node('div',undefined,'dataset');row.append(node('strong',dataset.name||dataset.source||dataset.id||'Dataset'));const detail=[];const state=dataset.latest_attempt?.status??dataset.status;if(state)detail.push(String(state).replaceAll('-',' '));for(const [label,count]of [['observations',dataset.observation_count??dataset.unique_observations],['systems',dataset.system_count],['violations',dataset.violation_count]])if(count!==undefined&&/^\d+$/.test(String(count)))detail.push(BigInt(count).toLocaleString('en-US')+' '+label);if(dataset.observation_count===undefined&&dataset.unique_observations===undefined){const count=dataset.unique_records??dataset.row_count??dataset.records??dataset.count;if(count!==undefined&&/^\d+$/.test(String(count)))detail.push(BigInt(count).toLocaleString('en-US')+' records');}const date=dataset.completed_at??dataset.last_ingested_at??dataset.updated_at??dataset.retrieved_at;if(date)detail.push('updated '+readableDate(date));row.append(node('p',detail.join(' · ')||'Count and freshness not supplied.','muted'));container.append(row);}}
    else paragraph(container,'Per-source counts are not available in this status response.');
  }
  async function loadStatus(){
    try{const response=await fetch('/api/national/status',{signal:AbortSignal.timeout(10000),cache:'no-store'});if(!response.ok)throw new Error('Status unavailable');updateStatus(await response.json());}
    catch{document.querySelector('#dataset-count').textContent='Unavailable';document.querySelector('#dataset-date').textContent='Unavailable';document.querySelector('#dataset-scope').textContent='Dataset status could not be retrieved. This is not a zero-record finding.';}
  }
  function syncSupply(){
    const well=supply.value==='private-well';pwsid.disabled=well;if(well)pwsid.value='';
    street.required=well||!pwsid.value.trim();
    document.querySelector('#supply-help').textContent=well?'We will show the address match, available well evidence, and resources for testing your own well.':'If the mapped provider is unclear, compare the candidates with your water bill.';
  }
  supply.addEventListener('change',syncSupply);pwsid.addEventListener('input',syncSupply);syncSupply();
  function renderAddress(data){
    const address=data.address||{},provider=data.provider||{},candidates=provider.candidates||[];
    const box=card('Your address and water provider','1 · Find the right system');
    if(address.matched_address)paragraph(box,address.matched_address,'address-line');
    const statuses={matched:'Address matched',unresolved:'Address not matched',ambiguous:'More than one address match',unavailable:'Address source unavailable','not-requested':'System ID lookup; no address checked'};
    paragraph(box,statuses[address.status]||'Address match not established','muted');
    if(address.precision==='address-range-interpolation-not-rooftop')paragraph(box,'The map location is estimated along a street address range. It does not verify the building or its water connection.','muted');
    if(data.supply?.type==='private-well'){paragraph(box,'Private well selected. This is your reported supply type; a public utility has not been assigned.');return;}
    if(provider.user_selected_pwsid)paragraph(box,'System selected for this report: '+provider.user_selected_pwsid+'. Confirm this ID with your water bill or utility.','inline-note');
    if(provider.conflict)paragraph(box,'The selected system does not match the mapped candidates. Confirm the provider before using its records.','warning');
    if(!candidates.length)paragraph(box,provider.user_selected_pwsid?'No mapped household connection was established. The records below apply to the selected system.':'A water provider could not be established from the map. This does not establish that your home uses a private well. Enter the full public water system ID from your utility report if you know it.');
    if(candidates.length>1)paragraph(box,'Several service areas overlap this location. Choose a system only if you can confirm it from your bill or utility.','inline-note');
    const providers=node('div',undefined,'provider-grid');
    for(const candidate of candidates){const item=node('article',undefined,'provider');item.append(node('h3',candidate.name||candidate.pwsid),node('p','System ID: '+candidate.pwsid,'muted'));const labels={modeled:'Modeled service area','state-or-system-sourced':'State or utility service area',unclassified:'Service-area origin not classified'};paragraph(item,labels[candidate.provenance]||'Service-area origin not classified','pill');paragraph(item,'A mapped candidate; household connection is not verified.','muted');if(candidate.pwsid!==provider.user_selected_pwsid){const button=node('button','View this system','secondary small');button.type='button';button.addEventListener('click',()=>{pwsid.value=candidate.pwsid;supply.value='public';syncSupply();submitLookup();});item.append(button);}else paragraph(item,'Selected for this report','selected');providers.append(item);}
    box.append(providers);
    if(provider.nearby_screen?.candidates?.some(x=>!candidates.some(c=>c.pwsid===x.pwsid)))paragraph(box,'Another service area is close to the estimated address. Confirm your provider with the utility.','inline-note');
  }
  function renderSystems(data){
    if(data.supply?.type==='private-well')return;
    const box=card('Public water system records','2 · Understand the available records');
    paragraph(box,'These records describe a water system. They do not measure water at your tap.','muted');
    if(!data.systems?.length){paragraph(box,'No system records were retrieved for this lookup.');resource(box,'Find your utility and annual water report',sourceLinks.local,'Use your utility’s Consumer Confidence Report to confirm its system ID.');return;}
    for(const system of data.systems){
      const section=node('article',undefined,'system');
      const raw=system.records?.[0]?.data||system.warehouse?.system||{};
      const pairs=systemFacts(raw),name=pairs.find(x=>x.label==='System name')?.value;
      section.append(node('h3',name||system.pwsid),node('p','System ID: '+system.pwsid,'muted'));
      const statusLabels={'records-returned':'Federal system records retrieved','unavailable':'Federal source unavailable','no-matching-records':'No matching federal record returned'};
      paragraph(section,statusLabels[system.status]||String(system.status||'Record status not supplied').replaceAll('-',' '));
      facts(section,pairs.filter(x=>x.label!=='System name'));
      if(pairs.some(x=>/violations/.test(x.label)))paragraph(section,'Quarter counts summarize the source reporting period. They do not establish current advisory status or household exposure.','muted');
      const violations=system.warehouse?.violations||[];
      if(violations.length){const detail=node('details');detail.append(node('summary','Reported violation records ('+violations.length+')'));for(const violation of violations.slice(0,30)){const row=node('div',undefined,'violation');const name=violation.contaminant??violation.contaminant_name??violation.violation_type??violation.violation_code??'Reported violation';row.append(node('strong',String(name)));const date=violation.begin_date??violation.compliance_period_begin??violation.compliance_period_begin_date??violation.period_begin??violation.COMPL_PER_BEGIN_DATE;if(date)paragraph(row,'Period begins: '+readableDate(date),'muted');const description=violation.description??violation.violation_name;if(description)paragraph(row,description);if(violation.health_based===true)paragraph(row,'Listed as a health-based violation in the source record.','muted');if(violation.returned_to_compliance)paragraph(row,'Reported return to compliance: '+readableDate(violation.returned_to_compliance),'muted');detail.append(row);}if(violations.length>30)paragraph(detail,'Showing the first 30 returned violation records.');section.append(detail);}
      if(system.source)resource(section,'Open EPA drinking water data',system.source);
      sourceDetails(section,system,'View original system records and provenance');box.append(section);
    }
  }
  function renderOccurrence(data){
    const occurrence=data.occurrence||{},records=Array.isArray(occurrence.records)?occurrence.records:[];
    const groups=Array.isArray(occurrence.summary)?occurrence.summary.filter(x=>x.analytes?.length):[];
    if(data.supply?.type==='private-well'&&!records.length&&!groups.length)return;
    const box=card('Reported water measurements','3 · Results, units, and sample dates');
    if(!records.length&&!groups.length){paragraph(box,occurrence.status==='unavailable'?'The measurement source is unavailable. No concentration finding was made.':'No measured concentrations were returned for this lookup. This does not mean contaminants were absent.');return;}
    paragraph(box,'These are public water system samples, not samples from your home. A detected range summarizes the reported samples; it is not a household exposure estimate or a safety limit.','muted');
    function makeTable(parent,title,headers){const wrapper=node('div',undefined,'table-scroll');wrapper.tabIndex=0;wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label',title+'; scroll horizontally on smaller screens');const table=node('table');table.append(node('caption',title));const head=node('thead'),hr=node('tr');for(const text of headers){const th=node('th',text);th.scope='col';hr.append(th);}head.append(hr);table.append(head);const body=node('tbody');table.append(body);wrapper.append(table);parent.append(wrapper);return body;}
    for(const group of groups){
      const body=makeTable(box,'Contaminant summary · '+group.pwsid,['Contaminant','Detected range','Sample results','Below reporting limit','Sampling period']);
      for(const analyte of group.analytes){const value=formatAnalyteSummary(analyte),row=node('tr'),period=node('td');period.append(node('span',value.first),node('br'),node('span','to '+value.last));row.append(node('td',value.name),node('td',value.range),node('td',value.samples),node('td',value.nonDetects),period);body.append(row);}
      const total=group.counts?.observation;
      if(total!==undefined&&/^\d+$/.test(String(total)))paragraph(box,'Summary includes '+BigInt(total).toLocaleString('en-US')+' stored sample results for '+group.pwsid+'.','muted');
      if(group.truncated?.observations)paragraph(box,'The summary uses all stored sample results for this system. The individual sample list below is limited to recent returned records.','muted');
      for(const source of data.systems?.find(x=>x.pwsid===group.pwsid)?.warehouse?.sources||[])if(source.source_url)resource(box,'Open '+String(source.source||'measurement')+' source data',source.source_url,'Import completed: '+readableDate(source.completed_at));
    }
    paragraph(box,'Below reporting limit and “not detected” do not mean zero. A contaminant absent from this list may not have been tested or its records may not be connected.','muted');
    if(records.length){
      const samples=node('details');samples.append(node('summary','View individual reported samples ('+Math.min(records.length,100).toLocaleString('en-US')+' shown)'));
      const body=makeTable(samples,'Individual reported measurements',['Contaminant','Reported result','Sample date','System / source']);
      for(const record of records.slice(0,100)){const value=formatOccurrence(record),row=node('tr'),name=node('td',value.name),result=node('td');result.append(node('strong',value.value));if(value.note)result.append(node('p',value.note,'muted'));const date=node('td',value.date),source=node('td');if(value.pwsid)source.append(node('span',value.pwsid));if(value.source){source.append(node('br'),link('Source record',value.source));}else source.append(node('p','Source link not supplied','muted'));row.append(name,result,date,source);body.append(row);}
      paragraph(samples,'Showing '+Math.min(records.length,100).toLocaleString('en-US')+' returned measurements'+(records.length>100?' of '+records.length.toLocaleString('en-US'):'')+'. The individual sample list may not include every stored sample or contaminant.','muted');box.append(samples);
    }
    if(occurrence.summary)sourceDetails(box,occurrence.summary,'Dataset scope and measurement summary');
  }
  function renderNextSteps(data){
    const isWell=data.supply?.type==='private-well';
    const box=card(isWell?'What to do for your private well':'Your next steps',isWell?'2 · Check the water you actually use':'Make the results useful');
    if(isWell){paragraph(box,'A nearby well sample, aquifer map, or industrial site cannot determine the quality of water from your own well.');resource(box,'Find a state-certified drinking water laboratory',sourceLinks.labs,'Ask which tests are appropriate for your well and how to collect a sample.');resource(box,'CDC guide to well-water testing',sourceLinks.cdc,'Use the testing guidance and discuss local concerns with your health department.');resource(box,'EPA private well resources',sourceLinks.wells,'Find guidance for private well owners.');}
    else {resource(box,'Confirm your provider and find its annual water report',sourceLinks.local,'Compare the system name and ID with your water bill or ask your utility.');resource(box,'Find a state-certified drinking water laboratory',sourceLinks.labs,'Testing your tap can address questions that utility-wide records cannot answer.');paragraph(box,'Check your utility or health department for current advisories. Follow their instructions when an advisory is in effect.');}
  }
  function renderResults(data){
    results.replaceChildren();
    const title=node('h2','Your water records','results-title');title.tabIndex=-1;title.id='results-heading';results.append(title);
    const summary=node('div',undefined,'finding');summary.append(node('strong','Your household water safety is not determined by this lookup.'));paragraph(summary,'Review the provider match, the actual sample dates, and the evidence available for your location. No household water sample was authenticated in this lookup.');results.append(summary);
    renderAddress(data);renderSystems(data);renderOccurrence(data);renderNextSteps(data);
    const gaps=card('What is still unknown','Evidence gaps');list(gaps,data.gaps||['Source coverage has not been established.']);
    const checks=node('details');checks.append(node('summary','Source checks and report details'));const audit=data.audit||[];for(const item of audit)paragraph(checks,String(item.agent).replaceAll('-',' ')+': '+String(item.status).replaceAll('-',' ')+' · retrieved '+readableDate(item.retrieved_at),'muted');paragraph(checks,'Report generated: '+readableDate(data.generated_at)+'. Retrieval date and sample date are different.','muted');sourceDetails(checks,data,'View complete machine-readable response');gaps.append(checks);
    if(data.coverage)updateStatus(data.coverage);
    title.focus({preventScroll:true});results.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  }
  async function submitLookup(){
    if(!form.reportValidity())return;
    const thisRequest=++requestSerial;
    if(lookupController)lookupController.abort();lookupController=new AbortController();const controller=lookupController,timer=setTimeout(()=>controller.abort(),35000);
    submit.disabled=true;results.setAttribute('aria-busy','true');message.textContent='Checking your address and official water records…';message.className='message';
    try{
      const body=Object.fromEntries(new FormData(form));
      if(body.supply_type==='private-well')delete body.pwsid;
      const response=await fetch('/api/national/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      let data;try{data=await response.json();}catch{throw new Error('The service returned an unreadable response. Please try again.');}
      if(!response.ok)throw new Error(data.message||(response.status===429?'The service is busy. Please try again in a minute.':'The lookup could not be completed.'));
      if(thisRequest!==requestSerial)return;
      renderResults(data);message.textContent=(data.audit||[]).some(x=>x.status==='unavailable')?'Report ready. Some sources were unavailable; see the evidence gaps.':'Report ready. Review the source coverage and sample dates below.';
    }catch(error){if(thisRequest!==requestSerial)return;results.replaceChildren();message.textContent=(error.name==='AbortError'?'The lookup timed out. Please try again.':error.message)+' No water-safety conclusion was made.';message.className='message error';message.focus();}
    finally{clearTimeout(timer);if(thisRequest===requestSerial){submit.disabled=false;results.setAttribute('aria-busy','false');}}
  }
  form.addEventListener('submit',event=>{event.preventDefault();submitLookup();});
  loadStatus();
}

const CLIENT="'use strict';\n"+[safeSourceUrl,readableDate,formatOccurrence,systemFacts,statusSummary,formatAnalyteSummary].map(fn=>fn.toString()).join('\n')+'\n('+nationalClient.toString()+')();\n';
const REGION_NAMES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',AS:'American Samoa',GU:'Guam',MP:'Northern Mariana Islands',PR:'Puerto Rico',VI:'U.S. Virgin Islands'};
const HTML=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Look up U.S. water provider records and reported measurements. See sources, sample dates, service-area uncertainty, and private-well testing resources.">
<title>Check your water records | IsMyWaterOK</title>
<style>
:root{color-scheme:light;--ink:#163938;--muted:#526965;--green:#086b56;--line:#d4e2dc;--paper:#fff;--bg:#f3f7f3;--amber:#704b05}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--green);text-underline-offset:3px}a:hover{text-decoration-thickness:2px}button,input,select{font:inherit}button,a,input,select,summary{touch-action:manipulation}:focus-visible{outline:3px solid #c87517;outline-offset:4px}.skip-link{position:absolute;left:16px;top:-80px;background:white;padding:12px;z-index:2}.skip-link:focus{top:12px}.shell{max-width:1140px;margin:0 auto;padding:0 28px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:1px solid var(--line);padding:24px 0}.brand{font-size:21px;font-weight:780;text-decoration:none;letter-spacing:-.7px;display:flex;align-items:center;gap:10px}.brand-mark{width:18px;height:24px;background:var(--green);border-radius:70% 70% 70% 5%;transform:rotate(-40deg);display:inline-block}.topbar nav{display:flex;gap:24px;font-size:14px}.hero{padding:54px 0 22px;max-width:770px}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:760;color:var(--green);margin:0 0 10px}h1{font-size:clamp(35px,5.5vw,58px);font-weight:720;line-height:1.09;letter-spacing:-2px;margin:0 0 22px}h2{font-size:24px;line-height:1.3;letter-spacing:-.45px;margin:0 0 14px}h3{font-size:19px;line-height:1.35;margin:0 0 7px}p{margin:0 0 14px}.intro{font-size:19px;max-width:660px;color:var(--muted)}.start-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:24px;align-items:start;margin:18px 0 42px}.card{background:var(--paper);border:1px solid var(--line);border-radius:15px;padding:28px;margin:0 0 22px}.form-heading{display:flex;justify-content:space-between;align-items:baseline;gap:15px}.badge,.pill{font-size:12px;display:inline-block;padding:4px 9px;border:1px solid var(--line);border-radius:6px;background:#eef5f0;color:#365b4d;font-weight:630}.badge{white-space:nowrap}.grid{display:grid;grid-template-columns:1fr 1fr;gap:17px}.wide{grid-column:1/-1}label{display:block;font-size:14px;font-weight:650}input,select{display:block;width:100%;background:white;color:var(--ink);border:1px solid #94b0a5;border-radius:7px;padding:12px;margin-top:6px;min-height:48px}input::placeholder{color:#71817a}input:disabled{background:#f0f1ee;color:#728078}.muted{font-size:14px;color:var(--muted);line-height:1.6}.field-note{font-size:13px;color:var(--muted);margin:7px 0 0;font-weight:400}button{display:inline-block;cursor:pointer;min-height:46px;border:0;border-radius:7px;background:var(--green);padding:12px 22px;color:white;font-weight:700}button:hover{background:#07523f}button:disabled{opacity:.65;cursor:wait}.lookup-button{width:100%;margin:19px 0 10px}.secondary{background:white;color:var(--green);border:1px solid #92b4a3}.secondary:hover{background:#eff6f1}.small{font-size:14px;padding:8px 14px}.message{font-size:14px;margin:4px 0 0;min-height:0}.message:not(:empty){padding:12px 0}.error{color:#8a2b19;font-weight:650}.privacy{font-size:12px;line-height:1.6;color:var(--muted);margin:7px 0 0}.dataset-panel{padding:25px 23px;background:#e9f1e9;border:1px solid #d6e2d4;border-radius:15px}.dataset-number{display:block;font-size:30px;font-weight:740;line-height:1.25;letter-spacing:-1px;overflow-wrap:anywhere}.dataset-caption{font-size:13px;color:var(--muted);margin:5px 0 20px}.dataset-heading{font-size:15px}.dataset{border-top:1px solid #ccdace;padding:12px 0}.dataset p{margin:4px 0 0}.dataset-panel details{font-size:13px}.dataset-panel summary{font-size:13px}.how{border-top:1px solid var(--line);padding:28px 0 36px;display:grid;grid-template-columns:repeat(3,1fr);gap:28px}.how h2{font-size:17px}.how p{font-size:14px;color:var(--muted)}.step-number{font-size:12px;color:var(--green);font-weight:800;margin-bottom:8px;display:block}.finding{border:1px solid #ddcd9a;border-left:4px solid #9d791d;border-radius:7px;padding:20px 23px;background:#fff9e8;margin:0 0 25px}.finding p{font-size:14px;margin:7px 0 0;color:#68582f}.results-title{font-size:31px;margin-bottom:20px}#results{scroll-margin-top:24px}.inline-note,.warning{font-size:14px;background:#f3f5ee;padding:13px 16px;border-left:3px solid #8b9b72}.warning{background:#fff3dc;color:var(--amber);border-color:#b58827}.address-line{font-weight:700}.provider-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.provider{border:1px solid var(--line);border-radius:9px;padding:19px}.provider .pill{margin-bottom:10px}.selected{font-size:13px;color:var(--green);font-weight:700}.system+.system{border-top:1px solid var(--line);margin-top:25px;padding-top:25px}.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:17px;margin:18px 0}.facts dt{font-size:12px;color:var(--muted)}.facts dd{margin:3px 0 0;font-size:15px;font-weight:600;overflow-wrap:anywhere}.resource{margin:16px 0}.resource a{font-weight:650}.resource p{margin:3px 0 0}.plain-list{padding-left:22px;font-size:14px}.plain-list li{padding:4px 0}details{border-top:1px solid var(--line);padding-top:13px;margin-top:16px}summary{cursor:pointer;color:var(--green);font-size:14px;font-weight:600}details[open]>summary{margin-bottom:15px}pre{background:#f3f6f3;border-radius:7px;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:360px;overflow:auto}.violation{padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}.table-scroll{overflow:auto;border:1px solid var(--line);border-radius:8px;margin:16px 0}table{border-collapse:collapse;width:100%;text-align:left;min-width:620px;font-size:14px}caption{text-align:left;font-weight:700;padding:13px 16px;background:#f4f7f3}th,td{padding:12px 16px;border-top:1px solid var(--line);vertical-align:top}th{font-size:12px;background:#f4f7f3;color:var(--muted)}td p{margin:4px 0 0;font-size:12px}footer{border-top:1px solid var(--line);padding:24px 0 35px;font-size:12px;color:var(--muted);display:flex;gap:30px;justify-content:space-between}footer nav{display:flex;gap:18px}noscript p{padding:20px;background:#fff3dc} @media(max-width:860px){.start-layout{grid-template-columns:1fr}.dataset-panel{display:grid;grid-template-columns:1fr 1fr;gap:8px 25px}.dataset-panel>h2,.dataset-panel>details{grid-column:1/-1}.dataset-panel p{margin-bottom:8px}.facts{grid-template-columns:1fr 1fr}}@media(max-width:620px){.shell{padding:0 18px}.topbar{padding:20px 0;align-items:flex-start}.brand{font-size:19px}.topbar nav{gap:12px;font-size:12px;flex-wrap:wrap;justify-content:flex-end}.hero{padding-top:36px}h1{letter-spacing:-1.2px}.intro{font-size:17px}.card{padding:22px 18px}.grid,.provider-grid,.how{grid-template-columns:1fr}.form-heading{display:block}.badge{margin-bottom:18px}.dataset-panel{padding:21px 18px}.facts{grid-template-columns:1fr 1fr;gap:15px}footer{flex-direction:column;gap:8px}.how{gap:10px}.start-layout{margin-bottom:28px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style><script defer src="/national-client.js"></script></head>
<body><a class="skip-link" href="#lookup-form">Skip to water lookup</a><div class="shell">
<header class="topbar"><a class="brand" href="/" aria-label="IsMyWaterOK home"><span class="brand-mark" aria-hidden="true"></span>IsMyWaterOK</a><nav aria-label="Main navigation"><a href="/seminole">Seminole County</a><a href="/account.html">My account</a></nav></header>
<main><section class="hero" aria-labelledby="page-title"><p class="eyebrow">Public water records · Across the United States</p><h1 id="page-title">Know what’s in your<br>water records.</h1><p class="intro">Find your potential water provider, explore reported results, and understand what the available evidence means for your home.</p></section>
<noscript><p>JavaScript is required for this lookup. You can also <a href="https://www.epa.gov/ground-water-and-drinking-water/local-drinking-water-information">find local drinking water information through EPA</a>.</p></noscript>
<div class="start-layout"><form id="lookup-form" class="card"><div class="form-heading"><h2>Check your address</h2><span class="badge">Free · No account required</span></div><div class="grid">
<label class="wide" for="street">Street address<input id="street" name="street" maxlength="180" autocomplete="street-address" placeholder="123 Main Street" required></label>
<label for="city">City<input id="city" name="city" maxlength="100" autocomplete="address-level2" placeholder="City or town"></label>
<label for="state">State or territory<select id="state" name="state" required autocomplete="address-level1"><option value="">Select a state or territory</option>${REGION_CODES.map(code=>'<option value="'+code+'">'+REGION_NAMES[code]+'</option>').join('')}</select></label>
<label for="zip">ZIP code<input id="zip" name="zip" maxlength="10" autocomplete="postal-code" inputmode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" placeholder="12345"><span class="field-note">Enter a city or ZIP code.</span></label>
<label for="supply">Water supply<select id="supply" name="supply_type" aria-describedby="supply-help"><option value="unknown">I’m not sure</option><option value="public">Public water utility</option><option value="private-well">Private well</option></select></label>
</div><p id="supply-help" class="field-note">If the mapped provider is unclear, compare the candidates with your water bill.</p>
<details><summary>Know your public water system ID?</summary><label for="pwsid">Full system ID (PWSID)<input id="pwsid" name="pwsid" maxlength="9" minlength="9" pattern="[A-Za-z0-9]{9}" autocapitalize="characters" spellcheck="false" placeholder="Nine letters and numbers" aria-describedby="pwsid-help"></label><p id="pwsid-help" class="field-note">Find this ID on your utility’s annual water report. You can search by ID and state without entering an address. Private wells do not have a public system ID.</p></details>
<button id="lookup-button" class="lookup-button" type="submit">Find my water records</button><p id="message" class="message" role="status" aria-live="polite" tabindex="-1"></p><p class="privacy">Your address is sent to the U.S. Census geocoder and its coordinates to EPA’s service-area map. The national lookup does not save your address or send it to an AI model.</p></form>
<aside class="dataset-panel" aria-labelledby="dataset-title"><h2 id="dataset-title" class="dataset-heading">What powers this lookup</h2><div><strong id="dataset-count" class="dataset-number">Loading…</strong><p class="dataset-caption">stored national observations</p></div><div><strong>Latest ingestion</strong><p id="dataset-date" class="muted">Checking…</p></div><p id="dataset-scope" class="muted">Checking the live dataset inventory.</p><p id="coverage-note" class="muted">Record availability varies by location. A missing record does not establish that water is safe.</p><details><summary>Dataset coverage and freshness</summary><div id="dataset-details"></div></details></aside></div>
<div id="results" aria-busy="false"></div>
<section class="how" aria-label="How to use this lookup"><div><span class="step-number">01 / MATCH</span><h2>Confirm your provider</h2><p>A mapped service area offers a candidate. Your water bill or utility can confirm your actual connection.</p></div><div><span class="step-number">02 / READ</span><h2>Follow the evidence</h2><p>See the result, its units, the sampling date, and its source. Utility records describe the system, not your individual tap.</p></div><div><span class="step-number">03 / ACT</span><h2>Get the next answer</h2><p>Find official reports and certified testing resources. For current advisories, check your utility or health department.</p></div></section>
</main><footer><span>Independent public-interest tool. Household water safety cannot be certified from these records.</span><nav aria-label="Footer links"><a href="/contact.html">Contact</a><a href="/feedback.html">Feedback</a></nav></footer></div></body></html>`;

module.exports={HTML,CLIENT,safeSourceUrl,readableDate,formatOccurrence,systemFacts,statusSummary,formatAnalyteSummary};
