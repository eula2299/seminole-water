'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {HTML,CLIENT,safeSourceUrl,readableDate,formatOccurrence,systemFacts,statusSummary,formatAnalyteSummary,archiveStatusSummary,formatArchiveSummary,matchedHealthContexts}=require('../national/ui');

test('bacterial presence and absence remain distinct from concentrations and nondetects',()=>{
  const row=formatArchiveSummary({analyte:'COLIFORM (TCR)',result_kind:'presence-absence',n:21,present_results:1,absent_results:20,detects:0,nondetects:0,min_detect:null,max_detect:null,first_date:'2014-01-01',last_date:'2014-12-31'});
  assert.equal(row.range,'Qualitative presence / absence');assert.equal(row.resultCounts,'1 present / 20 absent');assert.equal(row.samples,'21');
  assert.doesNotMatch(row.range+row.resultCounts,/No quantified|non-detection|safe|mg\/L/);
});

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

test('archive counts remain exact and distinct from current observation counts',()=>{
  assert.deepEqual(archiveStatusSummary({retained_source_records:'12345678901234567',eligible_source_records:'110000000',published_archives:6,ingestion_status:'in-progress'}),{retained:'12,345,678,901,234,567',eligible:'110,000,000',published:'6',status:'in progress'});
  assert.equal(archiveStatusSummary({retained_source_records:Number.MAX_SAFE_INTEGER+1}).retained,'Unavailable');
  assert.equal(archiveStatusSummary({}).retained,'Unavailable');
});

test('archive summaries preserve source and scope and quarantine invalid identity/date rows',()=>{
  const raw={analyte:'Arsenic',unit:'µg/L',scope:'source-water',n:'25',detects:'20',nondetects:'5',first_date:'2012-01-01',last_date:'2019-12-31',min_detect:'0.1',max_detect:'2',source_id:'EPA-SYR4',invalid_identity_date:0};
  const formatted=formatArchiveSummary(raw);
  assert.equal(formatted.scope,'Source water');assert.equal(formatted.rawScope,'source-water');assert.equal(formatted.source,'EPA-SYR4');assert.equal(formatted.range,'0.1 – 2 µg/L');assert.equal(formatted.detects,'20');assert.equal(formatted.samples,'25');
  assert.equal(formatArchiveSummary({...raw,invalid_identity_date:1}),null);
  assert.equal(formatArchiveSummary({...raw,scope:'unclassified'}).scope,'Scope not established');
  assert.equal(formatArchiveSummary({...raw,scope:'system-monitoring'}).scope,'System monitoring');
});

test('health context renders only source-backed contexts attached to actual returned analytes',()=>{
  const context={matched:true,id:'arsenic',label:'Arsenic',summary:'Source-backed test explanation.',scope:'general-contaminant-information-not-household-risk',sources:[{title:'EPA',url:'https://www.epa.gov/ground-water-and-drinking-water'}]};
  assert.deepEqual(matchedHealthContexts({health_context:[context]}),[]);
  const data={occurrence:{summary:[{analytes:[{analyte:'Arsenic',health_context:context},{analyte:'Unmapped substance',health_context:{matched:false}}]}],records:[{contaminant:'ARSENIC',health_context:context}]},systems:[{archive:{summaries:[{analyte:'Invalid historical analyte',invalid_identity_date:1,health_context:context}]}}]};
  const result=matchedHealthContexts(data);assert.equal(result.length,1);assert.deepEqual(result[0].analytes,['ARSENIC','Arsenic']);
  assert.deepEqual(matchedHealthContexts({...data,supply:{type:'private-well'}}),[]);
  assert.deepEqual(matchedHealthContexts({occurrence:{records:[{analyte:'Arsenic',health_context:{...context,sources:[{url:'javascript:alert(1)'}]}}]}}),[]);
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

