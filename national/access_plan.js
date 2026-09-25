'use strict';

const LABS='https://www.epa.gov/dwlabcert/contact-information-certification-programs-and-certified-laboratories-drinking-water';
const CCR='https://www.epa.gov/ccr';
const LOCAL='https://www.epa.gov/ground-water-and-drinking-water/local-drinking-water-information';
const TESTING_HELP='https://www.epa.gov/ground-water-and-drinking-water/forms/contact-us-about-ground-water-and-drinking-water-0';
const SERVICE_LINES='https://www.epa.gov/ground-water-and-drinking-water/planning-and-developing-service-line-inventory';
const WELL='https://www.cdc.gov/drinking-water/safety/guidelines-for-testing-well-water.html';

function finite(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
}
function percent(part,total){
  const a=finite(part),b=finite(total);return a!==null&&b>0?Math.round(a/b*1000)/10:null;
}
function parseAcsContext(payload,address={}){
  if(!Array.isArray(payload)||payload.length<2||!Array.isArray(payload[0])||!Array.isArray(payload[1]))return null;
  const header=payload[0],row=payload[1],values={};for(let i=0;i<header.length;i++)values[header[i]]=row[i];
  const housingTotal=finite(values.B25034_001E);
  const older=['B25034_007E','B25034_008E','B25034_009E','B25034_010E','B25034_011E'].reduce((sum,key)=>sum+(finite(values[key])||0),0);
  const median=finite(values.B19013_001E);
  return {
    source:'U.S. Census Bureau 2024 ACS 5-year estimates',
    geography:'census-tract',
    tract_geoid:address.geography?.tract?.geoid||null,
    tract_name:values.NAME||address.geography?.tract?.name||null,
    median_household_income:median,
    poverty_percent:percent(values.B17001_002E,values.B17001_001E),
    renter_percent:percent(values.B25003_003E,values.B25003_001E),
    pre_1980_housing_percent:housingTotal>0?Math.round(older/housingTotal*1000)/10:null,
    household_inference:false,
    note:'Neighborhood-level estimates only. They do not identify this household\'s income, race, tenure, or ability to pay.'
  };
}
function normalizedFields(record){
  const out={};for(const [key,value] of Object.entries(record||{}))out[key.replace(/[^a-z0-9]/gi,'').toLowerCase()]=value;return out;
}
function pick(fields,keys){
  for(const key of keys){const v=fields[key.replace(/[^a-z0-9]/gi,'').toLowerCase()];if(v!==null&&v!==undefined&&String(v).trim()!=='')return String(v).trim();}
  return null;
}
function providerContacts(data){
  const out=[];for(const system of data.systems||[]){
    const rows=(system.records||[]).map(x=>x.data).filter(Boolean),fields=normalizedFields(rows[0]||{});
    const pwsid=String(system.pwsid||'');
    const name=(data.provider?.candidates||[]).find(x=>x.pwsid===pwsid)?.name||pick(fields,['PWSName','PWS_NAME','ORG_NAME'])||pwsid;
    const phone=pick(fields,['PHONE_NUMBER','PhoneNumber','PWSPhone','Phone']);
    const email=pick(fields,['EMAIL_ADDR','EmailAddress','Email']);
    const admin=pick(fields,['ADMIN_NAME','AdminName','ContactName']);
    out.push({pwsid,name,phone,email,admin});
  }
  return out;
}
function targetedTests(privateWell,findings,serviceLine){
  const out=[],seen=new Set(),add=(name,why)=>{const key=name.toLowerCase();if(!seen.has(key)){seen.add(key);out.push({name,why});}};
  if(privateWell){
    add('Total coliform and E. coli','Routine microbial screening for private wells.');
    add('Nitrate','Routine private-well screening and especially important for infants.');
    add('pH and total dissolved solids','Basic indicators that help interpret well-water conditions.');
  }
  for(const f of findings||[]){
    if(!(f.detected||f.comparison?.above_reference))continue;
    const key=String(f.name||'').toLowerCase();
    if(/pfoa|pfos|pfas/.test(key))add('PFAS panel including PFOA/PFOS','Connected records contain a PFAS signal.');
    else if(/lead/.test(key))add('Lead at the tap','Connected records contain a lead-related signal.');
    else if(/arsenic/.test(key))add('Arsenic','Connected records contain an arsenic signal.');
    else if(/nitrate/.test(key))add('Nitrate','Connected records contain a nitrate signal.');
    else if(/cadmium/.test(key))add('Cadmium','Connected records contain a cadmium signal.');
  }
  const material=String(serviceLine?.records?.[0]?.material||'').toLowerCase();
  if(!privateWell&&(/lead|galvanized|unknown|unverified|not known/.test(material)||!out.length))add('Lead at the tap','Premise plumbing and service-line material can affect lead at the household tap.');
  return out.slice(0,6);
}
function buildAccessPlan(data,{privateWell=false,findings=[],compliance=[],providers=[],serviceLine=null}={}){
  const contacts=providerContacts(data),state=data.address?.state||data.address?.components?.state||'',county=data.address?.geography?.county?.name||null;
  const exactLine=serviceLine?.status==='address-record-match'&&serviceLine.records?.[0];
  const tests=targetedTests(privateWell,findings,serviceLine);
  const free=[];
  free.push({
    id:'records-first',title:'Use the public evidence already assembled here',cost_label:'$0',verified_zero_cost:true,
    text:'Review the connected water-system, infrastructure and environmental records before paying for a broad test that may include things you do not need.'
  });
  if(!privateWell){
    free.push({
      id:'service-line-inventory',title:exactLine?'Review the service-line record already found':'Check the public service-line inventory first',cost_label:'$0',verified_zero_cost:true,
      text:exactLine?'A public address-level service-line record was found. Review it before paying only to identify the recorded pipe material.':'Public water systems are required to maintain a service-line inventory. Check that record before paying only to identify whether the line is lead, galvanized, non-lead, or unknown.',
      url:exactLine?.source_url||SERVICE_LINES,category:'service-line-information',comparable_to_paid_identification:!!exactLine
    });
    free.push({
      id:'annual-report',title:'Read the annual water-quality report',cost_label:'$0',verified_zero_cost:true,
      text:'Use the provider report and current notices to narrow what deserves attention before buying household testing.',
      url:CCR,category:'water-system-information'
    });
  }else{
    free.push({
      id:'testing-assistance',title:'Ask about local testing assistance before paying',cost_label:'$0 to check',verified_zero_cost:true,
      text:'EPA directs households seeking possible testing assistance to their local health department or water program. Availability varies by location; the request itself does not commit you to a paid test.',
      url:TESTING_HELP,category:'testing-assistance'
    });
    free.push({
      id:'well-guidance',title:'Build the well test around the risks that matter',cost_label:'$0 guidance',verified_zero_cost:true,
      text:'Use CDC well-testing guidance plus the address profile to ask labs for the specific tests you need instead of automatically buying the largest panel.',
      url:WELL,category:'testing-plan'
    });
  }
  if(!privateWell&&contacts.length)free.push({
    id:'provider-contact',title:'Ask the water provider what is already available',cost_label:'$0 to ask',verified_zero_cost:true,
    text:'Before paying for testing or pipe identification, ask whether the provider has current sampling, service-line information, or a local assistance program.',
    url:LOCAL,category:'provider-assistance'
  });
  const priced=[{
    id:'certified-labs',title:'If you still need a household test, compare certified labs',cost_label:'Price varies',
    text:'Ask for the targeted tests below and compare itemized prices. EPA recommends using a state-certified drinking-water laboratory for independent testing.',
    url:LABS,verified_zero_cost:false
  }];
  const issueCount=(compliance||[]).reduce((sum,g)=>sum+(g.issues?.length||0),0);
  const recordsTranslated=(findings?.length||0)+issueCount+(data.current_advisories?.records?.length||0)+(exactLine?1:0)+(data.environment?.records?.length||0)+(data.archived_environment?.records?.length||0);
  const gaps=(data.gaps||[]).length;
  const equity=data.equity_context||null;
  const barrierSignals=[];
  if(equity?.poverty_percent!=null&&equity.poverty_percent>=20)barrierSignals.push('higher neighborhood poverty');
  if(equity?.renter_percent!=null&&equity.renter_percent>=50)barrierSignals.push('many renter-occupied homes');
  if(equity?.pre_1980_housing_percent!=null&&equity.pre_1980_housing_percent>=50)barrierSignals.push('a large share of older housing');
  return {
    version:'water-access-plan/1',
    state,county,
    headline:'Make protecting your water easier',
    summary:'Start with the useful $0 steps, then spend only where a household-specific test or professional check adds evidence that public records cannot.',
    free_first:free,
    paid_if_needed:priced,
    verified_zero_cost_options:free.filter(x=>x.verified_zero_cost).length,
    targeted_tests:tests,
    provider_contacts:contacts,
    home_profile:{
      water_source:privateWell?'Private well':providers.length===1?providers[0].name:providers.length>1?'Multiple possible public water providers':'Water source not fully resolved',
      service_line:exactLine?String(exactLine.material||'Recorded material available'):'No address-level material confirmed in the connected inventory',
      county:county||'County not resolved',
      state:state||'State not resolved',
      records_translated:recordsTranslated,
      information_gaps:gaps
    },
    neighborhood_context:equity,
    barrier_context:barrierSignals.length?{signals:barrierSignals,note:'These are census-tract conditions, not assumptions about the household. They are used to explain why free-first access matters, never to restrict help.'}:null,
    money:{
      verified_potential_savings:null,
      status:'needs-comparable-price',
      note:'Dollar savings are shown only when a paid quote and a genuinely comparable lower-cost option can be established. We do not invent a savings number.'
    },
    quote_check:{
      service_line_free_record_available:!!exactLine,
      target_tests:tests.map(x=>x.name),
      note:'A quote can be checked against the plan without saving the quote or address.'
    },
    impact:{free_options_identified:free.filter(x=>x.verified_zero_cost).length,records_translated:recordsTranslated,gaps_identified:gaps},
    sources:{certified_labs:LABS,service_line_inventory:SERVICE_LINES,local_help:TESTING_HELP}
  };
}
module.exports={parseAcsContext,buildAccessPlan,providerContacts,targetedTests};
