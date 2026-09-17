'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {HTML,CLIENT,safeSourceUrl,readableDate,formatOccurrence,systemFacts,statusSummary,formatAnalyteSummary}=require('../national/ui');

test('national client compiles without inline event handlers or unsafe HTML insertion',()=>{
  assert.doesNotThrow(()=>new Function(CLIENT));
  assert.doesNotMatch(CLIENT,/innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(HTML,/\son(?:click|submit|change)=/);
  assert.match(HTML,/href="\/seminole"/);
  assert.match(HTML,/href="\/account\.html"/);
  assert.match(HTML,/name="supply_type"/);
  assert.match(HTML,/value="private-well"/);
});

test('source links reject active content, credentials, and nonsecure schemes',()=>{
  assert.equal(safeSourceUrl('https://www.epa.gov/a?x=1'),'https://www.epa.gov/a?x=1');
  for(const value of ['javascript:alert(1)','data:text/html,hello','http://epa.gov','https://user:pass@example.org','bad-url'])assert.equal(safeSourceUrl(value),null);
});

test('non-detects are distinct from zero and preserve the stated reporting limit',()=>{
  const undetected=formatOccurrence({contaminant:'PFOS',value:0,qualifier:'ND',unit:'ng/L',reporting_limit:4,sampled_at:'2026-02-01',pwsid:'FL1234567'});
  assert.equal(undetected.value,'Not detected');
  assert.equal(undetected.note,'Reporting limit: 4 ng/L');
  assert.equal(undetected.date,'Feb 1, 2026');
  assert.equal(formatOccurrence({value:0,unit:'mg/L'}).value,'0 mg/L');
  assert.match(formatOccurrence({value:'ND'}).note,/does not mean zero/);
});

test('censored measurements keep inequality operators, unknown units, and missing values explicit',()=>{
  assert.equal(formatOccurrence({value:2,qualifier:'<',unit:'ng/L'}).value,'< 2 ng/L');
  assert.equal(formatOccurrence({value:'<2',qualifier:'<',unit:'ng/L'}).value,'<2 ng/L');
  assert.equal(formatOccurrence({value:null,unit:'mg/L'}).value,'Not reported');
  assert.equal(formatOccurrence({value:'',unit:'mg/L'}).value,'Not reported');
  assert.equal(formatOccurrence({value:1}).note,'Unit not supplied.');
  assert.equal(formatOccurrence({value:2,qualifier:'estimated',unit:'ug/L'}).note,'Qualifier: estimated');
  assert.equal(formatOccurrence({value:2}).date,'Not supplied');
  assert.equal(readableDate('not-a-date'),'Not supplied');
  assert.equal(readableDate('2026-02-30'),'Not supplied');
  assert.equal(readableDate('01/02/2026'),'Not supplied');
});

test('the actual UCMR censored-record contract displays the bound without inventing a measurement',()=>{
  const result=formatOccurrence({analyte:'PFOS',censored:true,qualifier:'<',value:null,reported_value:'',reporting_limit:0.004,unit:'µg/L',sample_date:'2025-06-12'});
  assert.equal(result.value,'Below reporting limit');
  assert.equal(result.note,'Reporting limit: 0.004 µg/L');
  assert.equal(result.name,'PFOS');
  assert.equal(result.date,'Jun 12, 2025');
  const distinctBound=formatOccurrence({analyte:'PFOS',censored:true,qualifier:'<',value:null,reported_value:'1',reported_bound:1,reporting_limit:10,unit:'µg/L'});
  assert.equal(distinctBound.value,'< 1 µg/L');
  assert.equal(distinctBound.note,'Reporting limit: 10 µg/L');
});

test('complete contaminant summaries preserve detected zeros and exclude ND results from ranges',()=>{
  const result=formatAnalyteSummary({analyte:'PFOS',unit:'µg/L',sample_results:'30',non_detects:'30',minimum_detected:null,maximum_detected:null,first_sample:'2024-01-01',last_sample:'2025-12-31'});
  assert.equal(result.range,'No quantified detection reported');
  assert.equal(result.samples,'30');assert.equal(result.nonDetects,'30');
  assert.equal(result.first,'Jan 1, 2024');
  assert.equal(formatAnalyteSummary({minimum_detected:'0',maximum_detected:'0',unit:'µg/L'}).range,'0 µg/L');
  assert.equal(formatAnalyteSummary({minimum_detected:'0.004',maximum_detected:'0.006',unit:'µg/L'}).range,'0.004 – 0.006 µg/L');
  assert.equal(formatAnalyteSummary({minimum_detected:'3',maximum_detected:'2',unit:'µg/L'}).range,'Detected range not established');
});

test('official system fields retain zero violation values without declaring the water safe',()=>{
  const facts=systemFacts({PWSName:'Example Water',PopulationServedCount:'12000',PrimarySourceCode:'GW',PWS_TYPE_CODE:'CWS',PWSActivityCode:'A',QtrsWithViol:0,UnknownField:'ignored'});
  assert.deepEqual(facts,[{label:'System name',value:'Example Water'},{label:'Population served',value:'12,000'},{label:'Primary source',value:'Groundwater'},{label:'System type',value:'Community water system'},{label:'System status',value:'Active'},{label:'Quarters with violations',value:'0'}]);
  assert.doesNotMatch(JSON.stringify(facts),/safe/i);
});

test('inventory counts do not round large integers, or turn unavailable counts into zero',()=>{
  assert.equal(statusSummary({national_unique_observations_ingested:'12345678901234567'}).count,'12,345,678,901,234,567');
  assert.equal(statusSummary({national_unique_observations_ingested:'0'}).count,'0');
  assert.equal(statusSummary({}).count,'Unavailable');
  assert.equal(statusSummary({national_unique_observations_ingested:-1}).count,'Unavailable');
  assert.equal(statusSummary({national_unique_observations_ingested:Number.MAX_SAFE_INTEGER+1}).count,'Unavailable');
  assert.equal(statusSummary({last_ingested_at:'2026-01-05T17:00:00Z'}).date,'Jan 5, 2026');
});

test('page exposes accessible form labels, status messaging, reduced motion and keyboard paths',()=>{
  for(const field of ['street','city','state','zip','supply','pwsid'])assert.match(HTML,new RegExp('for="'+field+'"'));
  assert.match(HTML,/role="status" aria-live="polite"/);
  assert.match(HTML,/class="skip-link"/);
  assert.match(HTML,/:focus-visible/);
  assert.match(HTML,/prefers-reduced-motion/);
  assert.match(CLIENT,/reportValidity/);
  assert.match(CLIENT,/No water-safety conclusion was made/);
});

test('browser client renders source summaries, reruns a chosen provider, and resets the private-well route',async()=>{
  // A small DOM double executes the actual distributed browser bundle. It tests
  // rendering and event behavior without introducing a production dependency.
  const vm=require('node:vm');
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};this.value='';this.disabled=false;this._text='';}
    set textContent(value){this._text=String(value);this.children=[];}
    get textContent(){return this._text+this.children.map(x=>x.textContent).join(' ');}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this._text='';this.children=[...nodes];}
    setAttribute(key,value){this.attrs[key]=value;}
    addEventListener(name,fn){this.listeners[name]=fn;}
    focus(){}scrollIntoView(){}reportValidity(){return true;}
  }
  const ids=['lookup-form','results','message','lookup-button','dataset-count','dataset-date','dataset-scope','coverage-note','dataset-details','supply-help'];
  const elements=Object.fromEntries(ids.map(id=>['#'+id,new Element('div')]));
  const form=elements['#lookup-form'];form.elements=Object.fromEntries(['street','city','state','zip','supply_type','pwsid'].map(name=>[name,new Element('input')]));
  Object.assign(form.elements.street,{value:'123 Main St'});form.elements.city.value='Sanford';form.elements.state.value='FL';form.elements.supply_type.value='public';
  const status={national_unique_observations_ingested:'8888888',last_ingested_at:'2026-09-17T12:00:00Z',datasets:[{source:'ucmr5',observation_count:'8888888',system_count:'4000',completed_at:'2026-09-17T12:00:00Z',latest_attempt:{status:'complete'}}]};
  const submitted=[];
  const context={document:{querySelector:selector=>elements[selector],createElement:tag=>new Element(tag)},URL,Date,BigInt,AbortSignal,AbortController,setTimeout,clearTimeout,window:{matchMedia:()=>({matches:true})},FormData:class {constructor(form){this.entries=Object.entries(form.elements).filter(([,v])=>!v.disabled).map(([k,v])=>[k,v.value]);}*[Symbol.iterator](){yield* this.entries;}},fetch:async(url,options)=>{
    if(url.endsWith('/status'))return {ok:true,json:async()=>status};
    const input=JSON.parse(options.body);submitted.push(input);const well=input.supply_type==='private-well';
    return {ok:true,json:async()=>({address:{status:'matched',matched_address:'123 MAIN ST',precision:'address-range-interpolation-not-rooftop'},supply:{type:input.supply_type},provider:{candidates:well?[]:[{pwsid:'FL1234567',name:'Example Water',provenance:'modeled'}],user_selected_pwsid:input.pwsid||null},systems:well?[]:[{pwsid:'FL1234567',status:'records-returned',records:[{data:{PWSName:'Example Water',PopulationServedCount:'25000',QtrsWithViol:'0'}}],warehouse:{sources:[]}}],occurrence:{records:well?[]:[{pwsid:'FL1234567',analyte:'PFOS',value:null,reported_value:'',unit:'µg/L',censored:true,qualifier:'<',reporting_limit:0.004,sample_date:'2025-06-12'}],summary:well?[]:[{pwsid:'FL1234567',analytes:[{analyte:'PFOS',unit:'µg/L',sample_results:'130',non_detects:'130',first_sample:'2024-01-01',last_sample:'2025-12-31',minimum_detected:null,maximum_detected:null}],counts:{observation:'130'},truncated:{observations:true}}]},coverage:status,gaps:['No household sample supplied.'],audit:[],generated_at:'2026-09-17T12:00:00Z'})};
  }};
  vm.runInNewContext(CLIENT,context);
  const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
  await settle();assert.equal(elements['#dataset-count'].textContent,'8,888,888');assert.match(elements['#dataset-details'].textContent,/4,000 systems/);
  form.listeners.submit({preventDefault(){}});await settle();
  assert.match(elements['#results'].textContent,/Contaminant summary/);
  assert.match(elements['#results'].textContent,/130 stored sample results/);
  assert.match(elements['#results'].textContent,/Reporting limit: 0.004 µg\/L/);
  assert.match(elements['#results'].textContent,/No quantified detection reported/);
  function find(element,predicate){if(predicate(element))return element;for(const child of element.children){const match=find(child,predicate);if(match)return match;}return null;}
  const candidate=find(elements['#results'],x=>x.tag==='button'&&x.textContent==='View this system');assert.ok(candidate);candidate.listeners.click();await settle();
  assert.equal(submitted.at(-1).pwsid,'FL1234567');assert.match(elements['#results'].textContent,/Selected for this report/);
  form.elements.supply_type.value='private-well';form.elements.supply_type.listeners.change();form.listeners.submit({preventDefault(){}});await settle();
  assert.equal(submitted.at(-1).pwsid,undefined);assert.match(elements['#results'].textContent,/What to do for your private well/);assert.doesNotMatch(elements['#results'].textContent,/Example Water/);
  assert.equal(elements['#lookup-button'].disabled,false);assert.equal(elements['#results'].attrs['aria-busy'],'false');
});
