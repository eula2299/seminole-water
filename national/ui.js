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
function archiveStatusSummary(archive){
  const count=value=>(typeof value==='number'?Number.isSafeInteger(value)&&value>=0:typeof value==='string'&&/^\d+$/.test(value))?BigInt(value).toLocaleString('en-US'):'Unavailable';
  return {retained:count(archive?.retained_source_records),eligible:count(archive?.eligible_source_records),published:count(archive?.published_archives),status:typeof archive?.ingestion_status==='string'?archive.ingestion_status.replaceAll('-',' '):'Not supplied'};
}
function formatArchiveSummary(record){
  if(Number(record.invalid_identity_date)>0)return null;
  const value=formatAnalyteSummary({analyte:record.analyte,unit:record.unit,sample_results:record.n,non_detects:record.nondetects,minimum_detected:record.min_detect,maximum_detected:record.max_detect,first_sample:record.first_date,last_sample:record.last_date});
  const count=x=>/^\d+$/.test(String(x))?BigInt(x).toLocaleString('en-US'):'Not supplied';
  const qualitative=record.result_kind==='presence-absence';
  return {...value,range:qualitative?'Qualitative presence / absence':value.range,resultCounts:qualitative?count(record.present_results)+' present / '+count(record.absent_results)+' absent':count(record.detects)+' detections / '+value.nonDetects+' non-detections',source:String(record.source_id||'Source ID not supplied'),scope:record.scope==='source-water'?'Source water':record.scope==='system-monitoring'?'System monitoring':'Scope not established',rawScope:String(record.scope||'unspecified'),detects:count(record.detects)};
}
function matchedHealthContexts(data){
  if(data.supply?.type==='private-well')return [];
  const rows=[...(data.occurrence?.records||[]),...(data.occurrence?.summary||[]).flatMap(group=>group.analytes||[]),...(data.systems||[]).flatMap(system=>(system.archive?.summaries||[]).filter(row=>!(Number(row.invalid_identity_date)>0)))];
  const matched=new Map();
  for(const row of rows){const context=row.health_context,name=row.analyte||row.contaminant||row.contaminant_name;
    if(!name||context?.matched!==true||!context.id||!context.label||!context.summary||context.scope!=='general-contaminant-information-not-household-risk')continue;
    const sources=(context.sources||[]).filter(source=>safeSourceUrl(source.url));if(!sources.length)continue;
    const current=matched.get(context.id);if(current){if(!current.analytes.includes(String(name)))current.analytes.push(String(name));}
    else matched.set(context.id,{...context,sources,analytes:[String(name)]});
  }
  return [...matched.values()];
}

const residentUI=require('./resident-ui');
const HTML=residentUI.HTML;
const CLIENT=residentUI.bundle([safeSourceUrl,readableDate]);
module.exports={HTML,CLIENT,safeSourceUrl,readableDate,formatOccurrence,systemFacts,statusSummary,formatAnalyteSummary,archiveStatusSummary,formatArchiveSummary,matchedHealthContexts};
