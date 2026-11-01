'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildResidentReport,comparison}=require('../national/resident');
const {HTML,CLIENT}=require('../national/ui');
const {createEngine,ENDPOINTS}=require('../national/service');
const {validateInput,censusMatch}=require('../national/evidence');
const {createPropertyContext,sourceReader,streetKey}=require('../national/property');
const {getHealthContext}=require('../national/health_context');
const source={id:'syr4',url:'https://www.epa.gov/dwsixyearreview'},summary={analyte:'Arsenic',scope:'system-monitoring',source_id:'syr4',unit:'µg/L',n:20,detects:8,nondetects:12,min_detect:2,max_detect:12,first_date:'2012-01-01',last_date:'2019-01-01',invalid_identity_date:0};
function report(){return {address:{status:'matched',matched_address:'SYNTHETIC FIXTURE'},supply:{type:'public'},provider:{candidates:[{pwsid:'NY1234567',name:'Fixture Water'}]},systems:[{pwsid:'NY1234567',archive:{summaries:[summary],sources:[source],compliance:{status:'records-returned',distinct_violation_ids:1,records:[{VIOLATION_ID:'01',IS_HEALTH_BASED_IND:'Y',VIOLATION_STATUS:'Resolved',NON_COMPL_PER_BEGIN_DATE:'01/01/2020',code_descriptions:{VIOLATION_CODE:'Test violation'}},{VIOLATION_ID:'01',IS_HEALTH_BASED_IND:'Y',VIOLATION_STATUS:'Resolved',code_descriptions:{VIOLATION_CODE:'Test violation'}},{ENFORCEMENT_ID:'2',VIOLATION_ID:'',IS_HEALTH_BASED_IND:'Y',VIOLATION_STATUS:'Unresolved'}],source:{documentation_url:'https://echo.epa.gov/'}}}}],generated_at:'2026-09-18T00:00:00Z'};}
test('one full address does not require a second state or utility ID field',async()=>{const input=validateInput({address:'100 Synthetic St, Example, NY 10001'});assert.equal(input.state,'NY');const calls=[];const result=await createEngine({request:async(url)=>{calls.push(url);if(url.startsWith(ENDPOINTS.censusOneLine))return {result:{addressMatches:[{matchedAddress:input.address,addressComponents:{state:'NY'},coordinates:{x:-74,y:41},geographies:{Counties:[{NAME:'Fixture County',GEOID:'00000'}]}}]}};return {features:[]};}}).lookup(input);assert.equal(result.address.state,'NY');assert.equal(result.address.geography.county.name,'Fixture County');assert.ok(calls[0].includes('onelineaddress'));assert.ok(result.resident_report.actions.length);});

test('city field is accepted with a street-only address and used by the Census retry',async()=>{const calls=[];const result=await createEngine({request:async url=>{calls.push(url);if(url.startsWith(ENDPOINTS.censusOneLine))return {result:{addressMatches:[]}};if(url.startsWith(ENDPOINTS.census))return {result:{addressMatches:[{matchedAddress:'100 SYNTHETIC ST, EXAMPLE, NY, 10001',addressComponents:{state:'NY',city:'EXAMPLE',zip:'10001'},coordinates:{x:-74,y:41}}]}};return {features:[]};}}).lookup({address:'100 Synthetic St',city:'Example',state:'NY'});assert.equal(result.address.status,'matched');assert.ok(calls.some(url=>url.includes('city=Example')));});
test('an unrecognized country/state and ambiguous address cannot select a house',()=>{assert.equal(censusMatch({result:{addressMatches:[{addressComponents:{state:'ON'},coordinates:{x:-75,y:45}}]}},{state:''}).status,'unresolved');const h={addressComponents:{state:'NY'},matchedAddress:'Fixture',coordinates:{x:-74,y:41}};const r=censusMatch({result:{addressMatches:[h,h]}},{state:''});assert.equal(r.status,'ambiguous');assert.equal(r.candidates.length,2);assert.equal(r.latitude,undefined);});
test('Census aliases for the same numbered address and TIGER point do not trap a resident in repeated choices',()=>{
 const a={matchedAddress:'100 SAINT FIXTURE ST, EXAMPLE, NY, 10001',addressComponents:{state:'NY',city:'EXAMPLE',zip:'10001'},coordinates:{x:-74,y:41},tigerLine:{tigerLineId:'12345',side:'R'}},b={...a,matchedAddress:'100 ST FIXTURE ST, EXAMPLE, NY, 10001'};
 const match=(x,y)=>censusMatch({result:{addressMatches:[x,y]}},{state:''});
 assert.equal(match(a,b).status,'matched');assert.equal(match(a,b).household_connection_verified,false);
 for(const changed of [{...b,coordinates:{x:-74.001,y:41}},{...b,matchedAddress:'102 ST FIXTURE ST, EXAMPLE, NY, 10001'},{...b,tigerLine:{tigerLineId:'999',side:'R'}},{...b,tigerLine:{tigerLineId:'12345',side:'L'}},{...b,addressComponents:{...b.addressComponents,zip:'10002'}}])assert.equal(match(a,changed).status,'ambiguous');
});
test('comparisons preserve sampling scope, chemical basis and units',()=>{assert.equal(comparison(summary).above_reference,true);assert.equal(comparison({...summary,unit:'mg/L',max_detect:.012}).above_reference,true);assert.equal(comparison({...summary,unit:'ng/L',max_detect:12000}).above_reference,true);assert.equal(comparison({...summary,scope:'source-water'}),null);assert.equal(comparison({...summary,unit:'pCi/L'}),null);assert.equal(comparison({...summary,max_detect:null}),null);assert.equal(comparison({...summary,analyte:'Nitrate'}),null);assert.equal(comparison({...summary,analyte:'Nitrate as N',unit:'mg/L',max_detect:11}).above_reference,true);assert.equal(comparison({...summary,analyte:'Lead'}),null);});
test('health explanations preserve chemical form and isomer identity',()=>{
 assert.equal(getHealthContext('1,4-dioxane').matched,true);assert.equal(getHealthContext('1,3-dioxane').matched,false);
 assert.equal(getHealthContext('total chromium').matched,true);assert.equal(getHealthContext('hexavalent chromium').matched,false);
 assert.equal(getHealthContext('inorganic mercury').matched,true);assert.equal(getHealthContext('methylmercury').matched,false);
 assert.equal(getHealthContext('chlorite').matched,true);assert.equal(getHealthContext('chlorate').matched,false);
 const manganese=getHealthContext('manganese');assert.equal(manganese.scope,'general-contaminant-information-not-household-risk');assert.match(manganese.sources[0].url,/iris\.epa\.gov/);
 assert.equal(comparison({...summary,analyte:'manganese',max_detect:106}),null);
});
test('historical compliance events are deduplicated and never become current alerts',()=>{const r=buildResidentReport(report());assert.equal(r.compliance[0].issues.length,1);assert.ok(r.accuracy_check);assert.equal(r.current_advisories_checked,false);assert.equal(r.household_safety,'not-determined');assert.equal(r.risk_profile.overall,'elevated');assert.ok(r.risk_profile.risks.some(x=>x.title==='Arsenic'));assert.ok(r.findings[0].health.text);assert.ok(r.actions.length);assert.ok(r.access_plan);assert.ok(r.access_plan.primary_path);assert.match(r.access_plan.headline,/Cheapest path/);assert.doesNotMatch(JSON.stringify(r.actions),/unresolved/);});
test('private well never inherits utility chemistry, compliance or health findings',()=>{const d=report();d.supply.type='private-well';const r=buildResidentReport(d);assert.deepEqual(r.findings,[]);assert.deepEqual(r.providers,[]);assert.deepEqual(r.compliance,[]);assert.match(r.actions[0].text,/annual/);});
test('source outages preserve next steps without inventing screened result tiles',()=>{const r=buildResidentReport({address:{status:'unavailable'},provider:{candidates:[]},systems:[],supply:{type:'unknown'}});assert.ok(r.actions.length>=2);assert.match(r.headline,/address/);assert.equal(r.findings.length,0);assert.equal(r.household_safety,'not-determined');assert.equal(r.risk_profile.priority_risks.length,0);assert.ok(['screened','verify'].includes(r.address_risk_level));});
test('broad nearby environmental records cannot displace address and serving-source results',()=>{const d={address:{status:'matched',matched_address:'100 TEST ST',latitude:28.5,longitude:-81.3},provider:{candidates:[{pwsid:'FL1234567',name:'Test Water',provenance:'state-or-system-sourced'}]},systems:[],supply:{type:'public'},environment:{records:[{parameter:'Far signal',latitude:28.518,longitude:-81.3},{parameter:'Very local signal',latitude:28.504,longitude:-81.3}]},archived_environment:{records:[]},property:{cleanup_sites:{records:[]},wells:{records:[]},service_line:{status:'address-record-needed',records:[]}},well_records:{records:[]},current_advisories:{records:[],checks:[]}};const r=buildResidentReport(d);assert.equal(r.risk_profile.priority_risks.length,1);assert.ok(r.risk_profile.priority_risks.some(x=>x.title==='Very local signal'));assert.ok(!r.risk_profile.priority_risks.some(x=>x.title==='Far signal'));assert.ok(r.risk_profile.risks.some(x=>x.title==='Far signal'));for(const x of r.risk_profile.priority_risks)assert.ok(x.specificity>=3);});
test('property lookup isolates failures and does not attach a neighboring service line',async()=>{const result=await createPropertyContext({request:async url=>{if(url.includes('monitoring-locations'))throw Error('outage');if(url.includes('efpoints'))return {features:[]};if(url.includes('/api/views/'))return {id:'jqfp-uff7',rowsUpdatedAt:1769786025,columns:[]};return [{address:'102 FAKE STREET',material:'Lead',record_ty:'Fixture',tbbl:'1000010001'}];}})({state:'NY',latitude:40.71,longitude:-74.0,matched_address:'100 FAKE ST, NEW YORK, NY'},{supplyType:'public'});assert.equal(result.wells.status,'unavailable');assert.equal(result.cleanup_sites.status,'no-records-in-search');assert.equal(result.service_line.household_match,false);assert.equal(result.service_line.records.length,0);assert.equal(streetKey('100 E 74TH ST'),streetKey('100 EAST 74 STREET'));});
test('property queries reject redirects and unapproved destinations',async()=>{await assert.rejects(sourceReader()('https://example.org/'));let called;await sourceReader({fetchImpl:async(u,opts)=>{called=opts;return new Response('[]');}})('https://data.cityofnewyork.us/resource/jqfp-uff7.json');assert.equal(called.redirect,'error');});
test('the home page asks for one address and contains no ingestion or schema dashboard',()=>{assert.match(HTML,/for="address"/);assert.match(HTML,/role="status" aria-live="polite"/);assert.match(HTML,/prefers-reduced-motion/);assert.doesNotMatch(HTML,/PWSID|ingestion|dataset-count|Postgres|archive-count|name="state"/);assert.doesNotMatch(CLIENT,/innerHTML|insertAdjacentHTML|JSON\.stringify\(data|createElement\('pre'/);assert.doesNotThrow(()=>new Function(CLIENT));});
test('distributed resident client submits an address, renders health context and resets private-well selection',async()=>{
 const vm=require('node:vm');class Element{constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};this.value='';this.disabled=false;this._text='';}set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join(' ');}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this._text='';this.children=[...nodes];}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.listeners[k]=v;}focus(){}scrollIntoView(){}reportValidity(){return true;}}
 const ids=['lookup-form','address','supply','lookup-button','message','results','how-it-works','progress'];const nodes=Object.fromEntries(ids.map(id=>[id,new Element('div')]));nodes.address.value='100 Synthetic Street, Example, NY';nodes.supply.value='public';const calls=[];
 vm.runInNewContext(CLIENT,{document:{getElementById:id=>nodes[id],createElement:tag=>new Element(tag)},URL,Date,Map,AbortController,setTimeout,clearTimeout,fetch:async(url,opts)=>{const body=JSON.parse(opts.body);calls.push(body);const d=report();d.supply.type=body.supply_type;d.current_advisories={status:'checked-sources',checks:[{status:'checked',name:'Fixture authority',source_url:'https://www.epa.gov',checked_at:'2026-09-18T10:00:00Z'}],records:[{provider:'Fixture Water',title:'Do Not Drink advisory',type:'do-not-drink',area:'Partial system',affected_population:'Vulnerable',guidance:'Do not assume boiling makes the water safe.',source_url:'https://www.epa.gov',source_is_recent:true,issued_at:'2026-09-17',checked_at:'2026-09-18',source_updated_at:'2026-09-18'}]};d.resident_report=buildResidentReport(d);return {ok:true,json:async()=>d};}});
 await nodes['lookup-form'].listeners.submit({preventDefault(){}});for(let i=0;i<4;i++)await new Promise(setImmediate);
 assert.equal(calls[0].address,nodes.address.value);assert.equal(calls[0].include_environment,true);assert.match(nodes.results.textContent,/YOUR WATER RESULTS/);assert.match(nodes.results.textContent,/Arsenic/);assert.match(nodes.results.textContent,/Health over time:/);assert.match(nodes.results.textContent,/YOUR WATER PLAN/);assert.match(nodes.results.textContent,/Here is what to do next/);assert.match(nodes.results.textContent,/DO YOU NEED TO TEST/);assert.match(nodes.results.textContent,/A LAB TEST FOR YOUR HOME|IF YOU WANT A HOME TEST/);assert.match(nodes.results.textContent,/START HERE/);assert.match(nodes.results.textContent,/WHAT TO SAY/);assert.match(nodes.results.textContent,/What not to waste money on/);assert.match(nodes.results.textContent,/See everything we found/);assert.match(nodes.results.textContent,/All records for this address/);assert.match(nodes.results.textContent,/Where these results came from/);assert.doesNotMatch(nodes.results.textContent,/Census-tract|verified \$0 starting points|information gaps identified|Past water-system issues|What the water tests found|sha256|raw_rows|syr4|trained_prediction/);
 nodes.supply.value='private-well';nodes.supply.listeners.change();nodes['lookup-form'].listeners.submit({preventDefault(){}});for(let i=0;i<4;i++)await new Promise(setImmediate);assert.match(nodes.results.textContent,/YOUR WATER RESULTS/);assert.doesNotMatch(nodes.results.textContent,/Fixture Water|Do Not Drink advisory/);assert.equal(nodes['lookup-button'].disabled,false);assert.equal(nodes.results.attrs['aria-busy'],'false');
});

test('main result keeps full evidence collapsed by default and exposes one simple options control',()=>{
 assert.match(CLIENT,/collapsed-evidence/);
 assert.match(CLIENT,/See everything we found/);
 assert.match(CLIENT,/See all ['"]?\+?all\.length|See all /);
 assert.doesNotMatch(CLIENT,/YOUR HOUSEHOLD WATER PASSPORT/);
});

test('a corrected UCMR publication replaces the older edition instead of resurrecting removed chemicals',()=>{
 const data=report(),system=data.systems[0];
 const fresh={id:'ucmr5',url:'https://www.epa.gov/data',retrieved_at:'2026-10-31',sha256:'fresh'};
 system.archive.sources=[fresh];system.archive.checked_sources=[fresh];
 system.archive.summaries=[{...summary,source_id:'ucmr5',max_detect:3,min_detect:3}];
 system.warehouse={sources:[{source:'ucmr5',completed_at:'2026-09-18',source_sha256:'older'}],counts:{observation:30}};
 data.occurrence={summary:[{pwsid:system.pwsid,analytes:[{analyte:'Arsenic',unit:'µg/L',sample_results:2,non_detects:0,minimum_detected:99,maximum_detected:99},{analyte:'Removed by correction',unit:'µg/L',sample_results:1,non_detects:0,minimum_detected:88,maximum_detected:88}]}]};
 let r=buildResidentReport(data);assert.equal(r.findings.length,1);assert.equal(r.findings[0].result,'3 µg/L');assert.equal(r.findings[0].source_sha256,'fresh');assert.equal(r.findings[0].source_checked_at,'2026-10-31');assert.equal(r.complete_evidence.water_findings,1);assert.equal(r.complete_evidence.underlying_water_observation_rows,30);
 // A verified refreshed source with no matching rows must not resurrect the old copy either.
 system.archive.summaries=[];system.archive.sources=[];r=buildResidentReport(data);assert.equal(r.findings.length,0);
 // A later completed stored publication becomes the single chosen edition.
 system.warehouse.sources[0].completed_at='2026-11-01';r=buildResidentReport(data);assert.equal(r.findings.length,2);assert.equal(r.findings[0].source_sha256,'older');
});
test('saved records and source gaps never acquire a fresh all-clear label',()=>{
 const data=report();data.systems[0].archive.summaries=[{...summary,detects:0,nondetects:20,min_detect:null,max_detect:null}];data.systems[0].archive.compliance={status:'no-records-in-snapshot',records:[]};
 data.systems[0].archive.retrieval={status:'saved',checked_at:'2026-10-30T12:00:00Z'};
 let r=buildResidentReport(data);assert.equal(r.data_status.status,'saved');assert.equal(r.data_status.last_verified_at,'2026-10-30T12:00:00Z');assert.equal(r.address_risk_level,'verify');
 delete data.systems[0].archive.retrieval;data.systems[0].archive.compliance.status='unavailable';
 r=buildResidentReport(data);assert.equal(r.data_status.status,'partial');assert.equal(r.address_risk_level,'verify');assert.equal(r.findings.length,1);
});
test('a refreshed provider listing cannot hide missing testing records',()=>{
 const data=report(),system=data.systems[0];system.warehouse={status:'records-returned',observation_status:'unavailable',sources:[]};
 let r=buildResidentReport(data);assert.equal(r.data_status.status,'partial');
 system.archive.checked_sources=[{id:'ucmr5',retrieved_at:'2026-10-31'}];
 r=buildResidentReport(data);assert.equal(r.data_status.status,'available');
 system.archive.truncated=true;r=buildResidentReport(data);assert.equal(r.data_status.status,'partial');assert.equal(r.complete_evidence.truncation.historical_water_summaries,true);
});

test('first four tiles use distinct substances without removing source histories or combining ranges',()=>{
 const data=report();data.systems[0].archive.compliance={status:'no-records-in-snapshot',records:[]};
 data.systems[0].archive.summaries=[
  {...summary,analyte:'Chlorate',min_detect:120,max_detect:470,last_date:'2015-01-01'},
  {...summary,analyte:' CHLORATE ',min_detect:120,max_detect:430,last_date:'2025-01-01',source_id:'syr3'},
  ...['PFHxA','PFOS','Radium 226','Radium 228'].map(analyte=>({...summary,analyte,min_detect:1,max_detect:2,last_date:'2024-01-01'}))
 ];
 const r=buildResidentReport(data),tiles=r.risk_profile.priority_risks;
 assert.equal(r.findings.length,6);assert.equal(r.complete_evidence.water_findings,6);
 assert.equal(r.risk_profile.risks.filter(x=>x.key.startsWith('finding:')).length,6);assert.equal(tiles.length,4);
 const chlorate=tiles.filter(x=>/chlorate/i.test(x.title));assert.equal(chlorate.length,1);assert.equal(chlorate[0].result,'120–430 µg/L');
 assert.ok(r.findings.some(x=>x.result==='120–470 µg/L'));assert.ok(r.findings.some(x=>x.result==='120–430 µg/L'));
 assert.ok(r.findings.some(x=>x.name==='Radium 226'));assert.ok(r.findings.some(x=>x.name==='Radium 228'));
});

test('a single mailing-directory candidate still asks for the provider on the bill without implying proximity or service',()=>{
 const data=report();data.systems=[];
 data.provider={method:'local-directory',status:'provider-selection-needed',requires_selection:true,candidates:[{pwsid:'NY1234567',name:'Fixture Water',provenance:'published-contact-directory',candidate_basis:'mailing-contact-address'}]};
 const r=buildResidentReport(data);
 assert.equal(r.headline,'Choose the water provider on your bill');assert.match(r.summary,/mailing address does not show which homes/);
 assert.doesNotMatch(r.summary+' '+r.headline,/near you|retrieved their water records|matched this address/);
 assert.deepEqual(r.providers,[]);assert.deepEqual(r.findings,[]);assert.equal(r.provider_ambiguity,true);
 assert.ok(r.accuracy_check.notes.includes('water-provider-needs-selection'));assert.equal(r.accuracy_check.score,25);
 assert.match(r.access_plan.primary_path.title,/provider on your bill/);
 const chosen=report();chosen.provider={...data.provider,requires_selection:false,user_selected_pwsid:'NY1234567'};
 const selected=buildResidentReport(chosen);
 assert.ok(selected.findings.length>0);assert.equal(selected.providers[0].name,'Fixture Water');
 assert.doesNotMatch(selected.headline,/Choose the water provider/);
});
