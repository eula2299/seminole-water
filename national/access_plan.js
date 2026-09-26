'use strict';

const LABS='https://www.epa.gov/dwlabcert/contact-information-certification-programs-and-certified-laboratories-drinking-water';
const CCR='https://www.epa.gov/ccr';
const LOCAL='https://www.epa.gov/ground-water-and-drinking-water/local-drinking-water-information';
const TESTING_HELP='https://www.epa.gov/ground-water-and-drinking-water/forms/contact-us-about-ground-water-and-drinking-water-0';
const SERVICE_LINES='https://www.epa.gov/ground-water-and-drinking-water/planning-and-developing-service-line-inventory';
const WELL='https://www.cdc.gov/drinking-water/safety/guidelines-for-testing-well-water.html';
const {chooseCheapest}=require('./access_catalog');

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
  const servingProvider=providers.length===1?providers[0].name:(contacts[0]?.name||'');
  const accessTargets=[
    ...(!privateWell&&!exactLine?['Service line material']:[]),
    ...tests.map(x=>x.name)
  ];
  const verifiedOptions=chooseCheapest({
    state,
    county,
    supply:privateWell?'private-well':'public',
    provider:servingProvider,
    tests:accessTargets
  });
  const bestVerified=verifiedOptions[0]||null;
  const currentNotice=(data.current_advisories?.records||[])[0]||null;
  const provider=contacts[0]||null;
  const issues=(compliance||[]).flatMap(x=>x.issues||[]);
  const elevated=findings.find(x=>x.comparison?.above_reference)||findings.find(x=>x.detected)||null;
  const localSearch=(q)=>'https://www.google.com/search?q='+encodeURIComponent([q,county,state].filter(Boolean).join(' '));

  const steps=[];
  const add=(title,cost,why,url,kind='official')=>steps.push({title,cost,why,url,kind});

  if(currentNotice){
    add('Follow the current water notice','$0','This matters before anything else. Follow the issuing utility or health department instructions first.',currentNotice.source_url||LOCAL);
  }else if(privateWell){
    add('Check for free or reduced-cost well testing','$0 to check','Your local health department is the best first place to ask about free, subsidized, or community well-testing programs.',localSearch('free private well water testing health department'),'local-search');
    add('Ask what your well actually needs tested','$0','CDC recommends a basic yearly well panel and your local health department can add tests based on local risks.',WELL);
  }else if(exactLine){
    add('Use the free pipe record we already found','$0','You already have a public record for the pipe serving this property, so do not pay just to learn the recorded material.',exactLine.source_url||SERVICE_LINES);
    if(provider) add('Ask your water provider what they will check for free','$0 to ask','Utilities may already have current sampling, pipe information, or local assistance that can answer part of the question before you pay.',LOCAL);
  }else if(elevated){
    if(provider) add('Ask your water provider for the latest follow-up result','$0','Because something relevant appeared in connected records, first ask for the newest result and whether they offer household sampling or assistance.',LOCAL);
    else add('Check your provider’s latest water report','$0','Start with the newest official report before buying a household test.',CCR);
  }else{
    add('Use the free records already checked for you','$0','You already have a first-pass water picture. Do not buy a broad test panel just because one is available.',CCR);
    if(provider) add('Ask your water provider what they can check for free','$0 to ask','Ask whether they offer sampling, pipe checks, or local assistance before paying a private company.',LOCAL);
  }

  if(!privateWell&&!exactLine){
    add('Check the public lead-pipe record','$0','Water systems maintain public service-line inventories. Check that before paying anyone just to identify the outside pipe.',SERVICE_LINES);
  }

  if(privateWell||elevated||!exactLine){
    add('If you still need a home test, compare only the specific tests below','Price varies','At this point a household sample may add evidence that public records cannot. Ask certified labs for itemized prices for only the tests listed below.',LABS,'paid');
  }

  let primary=steps[0]||{title:'Start with the free information already available',cost:'$0',why:'Use the public records first.',url:LOCAL};
  let fallback=steps.slice(1,3);
  if(!currentNotice&&bestVerified&&(privateWell||bestVerified.best.price===0)){
    const b=bestVerified.best;
    primary={
      title:b.provider,
      cost:b.price_label,
      why:'For '+bestVerified.test+': '+b.note,
      url:b.url,
      phone:b.phone||null,
      verified_option:true,
      test:bestVerified.test,
      verified_at:b.verified_at
    };
    const alt=bestVerified.alternatives?.[0];
    fallback=[
      ...(alt?[{
        title:alt.provider,
        cost:alt.price_label,
        why:'Also verified for '+bestVerified.test+'. '+alt.note,
        url:alt.url,
        phone:alt.phone||null,
        verified_option:true,
        test:bestVerified.test,
        verified_at:alt.verified_at
      }]:[]),
      ...steps.filter(x=>x.url!==b.url&&(!alt||x.url!==alt.url)).slice(0,2-(alt?1:0))
    ];
  }
  const issueCount=issues.length;
  const recordsTranslated=(findings?.length||0)+issueCount+(data.current_advisories?.records?.length||0)+(exactLine?1:0)+(data.environment?.records?.length||0)+(data.archived_environment?.records?.length||0);
  const gaps=(data.gaps||[]).length;
  const equity=data.equity_context||null;
  const barrierSignals=[];
  if(equity?.poverty_percent!=null&&equity.poverty_percent>=20)barrierSignals.push('higher neighborhood poverty');
  if(equity?.renter_percent!=null&&equity.renter_percent>=50)barrierSignals.push('many renter-occupied homes');
  if(equity?.pre_1980_housing_percent!=null&&equity.pre_1980_housing_percent>=50)barrierSignals.push('a large share of older housing');

  return {
    version:'water-access-plan/2',
    state,county,
    headline:'Cheapest path for your home',
    summary:'We start with the free option most likely to answer your question. Only move to paid testing if the free steps still leave something important unknown.',
    primary_path:primary,
    next_paths:fallback,
    verified_options:verifiedOptions,
    price_finder:{
      status:verifiedOptions.length?'published-options-found':'no-comparable-published-price-found',
      checked_targets:accessTargets,
      published_matches:verifiedOptions.length,
      best_test:bestVerified?.test||null,
      best_price:bestVerified?.best?.price??null,
      best_price_label:bestVerified?.best?.price_label||null,
      best_provider:bestVerified?.best?.provider||null,
      potential_savings:bestVerified?.potential_savings??null,
      potential_savings_range:bestVerified?.potential_savings_range||null,
      comparison_provider:bestVerified?.comparison_provider||null,
      comparison_price:bestVerified?.comparison_price??null,
      wording:verifiedOptions.length?'Cheapest published option in our verified catalog for this exact test and location.':'We could not verify a comparable published price for the exact test needed, so we will not pretend we found the cheapest option.'
    },
    targeted_tests:tests,
    provider_contacts:contacts,
    home_summary:{
      water_source:privateWell?'Private well':providers.length===1?providers[0].name:providers.length>1?'More than one possible water provider':'Water provider not fully confirmed',
      pipe_record:exactLine?String(exactLine.material||'Public pipe record found'):'No exact pipe record found yet'
    },
    can_avoid_broad_panel:tests.length>0,
    broad_panel_message:tests.length?'You do not need to start with a huge “test everything” package. Ask for these specific tests first.':'There is no reason from the current records alone to start with an expensive broad panel.',
    neighborhood_context:equity,
    barrier_context:barrierSignals.length?{signals:barrierSignals}:null,
    quote_check:{
      service_line_free_record_available:!!exactLine,
      target_tests:tests.map(x=>x.name)
    },
    impact:{
      free_options_identified:steps.filter(x=>String(x.cost).startsWith('$0')).length,
      records_translated:recordsTranslated,
      gaps_identified:gaps
    },
    sources:{certified_labs:LABS,service_line_inventory:SERVICE_LINES,local_help:TESTING_HELP}
  };
}
module.exports={parseAcsContext,buildAccessPlan,providerContacts,targetedTests};
