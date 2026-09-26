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

function cleanPlace(value){return String(value||'').replace(/\s+/g,' ').trim();}
function webSearch(query){return 'https://www.google.com/search?q='+encodeURIComponent(query);}
function concernLabel(tests,findings,serviceLine,privateWell){
  if(privateWell)return tests.length?tests.map(x=>x.name).slice(0,3).join(', '):'routine well-water testing';
  const line=String(serviceLine?.records?.[0]?.material||'').toLowerCase();
  if(/lead|galvanized|unknown|unverified|not known/.test(line))return 'lead and your home plumbing';
  const important=(findings||[]).find(x=>x.comparison?.above_reference)||(findings||[]).find(x=>x.detected);
  return important?.name||'your household tap water';
}
function plainWhy({privateWell,providerName,county,tests,findings,serviceLine,currentNotice}){
  if(currentNotice)return 'There is a current water notice connected to this area, so that comes before price shopping or extra testing.';
  if(privateWell)return 'This home uses a private well, so utility-wide test results cannot tell you what is coming out of your tap. We use your county, state and the risks near this address to narrow the tests.';
  const line=String(serviceLine?.records?.[0]?.material||'').trim();
  if(line)return 'We matched this address to '+(providerName||'its water provider')+' and found a pipe record listed as “'+line+'”. That changes what is worth paying for.';
  const important=(findings||[]).find(x=>x.comparison?.above_reference)||(findings||[]).find(x=>x.detected);
  if(important)return 'We matched this address to '+(providerName||'its water provider')+' and found '+important.name+' in connected water records. That is why we are focusing your next step on '+important.name+', not a random full test package.';
  return 'We matched this address to '+(providerName||'its likely water provider')+'. Nothing in the connected records says you should immediately buy a large test package, so we start with the free information already available.';
}

function plainGapList({privateWell,providerName,serviceLine,currentNotice,data}){
 const gaps=[];
 const add=(title,why,question)=>{if(!gaps.some(x=>x.title===title))gaps.push({title,why,question});};
 if(!privateWell&&!providerName)add('Water provider not confirmed','Without the provider, utility-wide records may not match this home.','Who is the water provider for this exact address?');
 if(!privateWell&&serviceLine?.status!=='address-record-match')add('Pipe material not confirmed','The public records we checked do not confirm the service-line material for this exact address.','What material is the service line serving this property, and when was it last verified?');
 if(privateWell)add('No household well sample on file here','Nearby wells and environmental records cannot tell us the chemistry of this private well.','Which tests does the county recommend for this well location, and are any free or reduced-cost?');
 if(!currentNotice&&data.current_advisories?.status!=='checked-sources')add('Today’s notice status not fully confirmed','Historical records do not replace a current boil-water or do-not-drink notice.','Are there any current drinking-water notices for this address today?');
 if(!(data.address?.status==='matched'))add('Address match needs confirmation','A precise address match is needed before household-level records can be trusted.','Can this exact street address be confirmed?');
 return gaps.slice(0,4);
}
function healthProtectionPlan({privateWell,tests}){
 const priorities=[];
 const add=(id,title,plain,when)=>{if(!priorities.some(x=>x.id===id))priorities.push({id,title,plain,when});};
 const names=tests.map(x=>x.name.toLowerCase());
 if(names.some(x=>x.includes('lead')))add('lead','Lead','Lead can enter water from service lines or household plumbing. Testing the tap is the clearest way to know what is reaching the home.','Especially useful for homes with young children, pregnancy, or older plumbing.');
 if(names.some(x=>x.includes('nitrate')))add('nitrate','Nitrate','Nitrate is especially important for private wells and can be harmful to infants at high levels.','Especially useful for homes using infant formula or private wells.');
 if(names.some(x=>x.includes('coliform')||x.includes('e. coli')))add('bacteria','Bacteria','Private wells can develop microbial contamination that utility testing does not cover.','Especially useful after flooding, repairs, or changes in taste, smell, or color.');
 if(names.some(x=>x.includes('pfas')))add('pfas','PFAS','The address records point to PFAS as something worth checking more closely rather than buying a broad test blindly.','Useful when connected records show PFAS or when a local source is relevant.');
 if(names.some(x=>x.includes('arsenic')))add('arsenic','Arsenic','Arsenic can occur naturally in groundwater and may also appear in drinking-water records.','Most useful when records or local geology make arsenic relevant.');
 if(!priorities.length&&!privateWell)add('baseline','Tap-water baseline','Nothing in the connected records justifies an expensive broad panel as the first move.','Use targeted testing if there is an older home, plumbing concern, active notice, unusual water change, or a specific health concern.');
 return priorities.slice(0,4);
}
function buildPassport({data,privateWell,providerName,tests,serviceLine,currentNotice,verifiedOptions,recordsTranslated,gapsCount,freeOptions}){
 const price=verifiedOptions[0]||null;
 const verifiedSaving=price?.potential_savings??null;
 const range=price?.potential_savings_range||null;
 const gaps=plainGapList({privateWell,providerName,serviceLine,currentNotice,data});
 const health=healthProtectionPlan({privateWell,tests});
 let moneyText='We put free and lower-cost steps before paid testing and only count savings when two options answer the same question.';
 if(verifiedSaving!=null)moneyText='We found a cheaper comparable published option and verified the price difference.';
 else if(range)moneyText='We found a lower published local price range and verified the comparison range.';
 return {version:'household-water-passport/1',promise:'One place to understand your water, avoid unnecessary spending, expose what is still unknown, and protect the people in your home.',pillars:{
  money:{title:'Save money',status:verifiedOptions.length?'personalized':'guided',plain:moneyText,verified_savings:verifiedSaving,verified_savings_range:range,barrier_reduced:verifiedOptions.length>0||Number(freeOptions)>0},
  information:{title:'Explain my water',status:'personalized',plain:recordsTranslated>0?'We organized the connected water records into the few things that matter for this home.':'We organize available records into a short household plan instead of making you read agency reports.',records_translated:recordsTranslated,barrier_reduced:true},
  neglect:{title:'Show what is still unknown',status:gaps.length?'needs-follow-up':'checked',plain:gaps.length?'We found important things that public records still do not confirm for this home.':'The main provider, pipe and notice questions we could check were covered by the connected records.',gaps:gaps,gap_count:Math.max(gaps.length,gapsCount||0),barrier_exposed:gaps.length>0},
  health:{title:'Protect my household',status:'personalized',plain:'We narrow health-protection steps to the contaminants and infrastructure that are actually relevant here, without diagnosing anyone.',priorities:health,guidance_delivered:health.length>0}
 },local_only_profiles:[
  {id:'young-child',label:'Young child in the home',note:'Prioritize lead and nitrate guidance when relevant.'},
  {id:'pregnancy',label:'Pregnancy',note:'Prioritize lead and other contaminant guidance when relevant.'},
  {id:'infant',label:'Infant / formula',note:'Prioritize nitrate and microbial guidance when relevant.'},
  {id:'renter',label:'Renter',note:'Emphasize actions that do not require owning the property.'}
 ],privacy_note:'These optional household selections stay in the browser and are not sent with the impact event.'};
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
  const addressLabel=cleanPlace(data.address?.matched_address||'this address');
  const providerName=servingProvider||provider?.name||'your water provider';
  const concern=concernLabel(tests,findings,serviceLine,privateWell);
  const countyLabel=cleanPlace(county)||'your county';
  const providerOfficialSearch=webSearch('"'+providerName+'" official water utility '+state);
  const countyWellSearch=webSearch('"'+countyLabel+'" '+state+' health department private well water testing');
  const personalizedWhy=plainWhy({privateWell,providerName,county:countyLabel,tests,findings,serviceLine,currentNotice});
  const callScript=privateWell
    ? 'Hi, I live in '+countyLabel+', '+state+'. I use a private well and need to test for '+(tests.map(x=>x.name).slice(0,3).join(', ')||'routine well-water contaminants')+'. Do you offer free or reduced-cost testing, and what will it cost before I collect the sample?'
    : 'Hi, I live at '+addressLabel+'. My water provider appears to be '+providerName+'. I am checking '+concern+'. Do you offer free testing, a service-line check, or another no-cost option before I pay a private lab?';

  const steps=[];
  const add=(title,cost,why,url,kind='official')=>steps.push({title,cost,why,url,kind});

  if(currentNotice){
    add('Follow the current water notice','$0','This matters before anything else. Follow the issuing utility or health department instructions first.',currentNotice.source_url||LOCAL);
  }else if(privateWell){
    add('Ask '+countyLabel+' about free or reduced-cost well testing','$0 to check','We are starting locally because county health programs can be much cheaper than private lab packages. Use this search to open the county or state health department result for your area.',countyWellSearch,'local-search');
    add('Ask what your well actually needs tested','$0','CDC recommends a basic yearly well panel and your local health department can add tests based on local risks.',WELL);
  }else if(exactLine){
    add('Use the free pipe record we already found','$0','You already have a public record for the pipe serving this property, so do not pay just to learn the recorded material.',exactLine.source_url||SERVICE_LINES);
    if(provider) add('Ask '+providerName+' what they will check for free','$0 to ask','This is your matched water provider. Ask about free testing, service-line checks, or recent sampling before paying a private lab.',providerOfficialSearch,'provider-specific');
  }else if(elevated){
    if(provider) add('Ask '+providerName+' for the latest '+concern+' result','$0','Because '+concern+' appeared in records connected to this address, ask the matched provider for its newest result and whether it offers household testing or assistance.',providerOfficialSearch,'provider-specific');
    else add('Check your provider’s latest water report','$0','Start with the newest official report before buying a household test.',CCR);
  }else{
    add('Use the free records already checked for you','$0','You already have a first-pass water picture. Do not buy a broad test panel just because one is available.',CCR);
    if(provider) add('Ask '+providerName+' what they can check for free','$0 to ask','Ask the matched provider whether it offers sampling, pipe checks, or local assistance before paying a private company.',providerOfficialSearch,'provider-specific');
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
  const passport=buildPassport({data,privateWell,providerName,tests,serviceLine,currentNotice,verifiedOptions,recordsTranslated,gapsCount:gaps,freeOptions:steps.filter(x=>String(x.cost).startsWith('$0')).length});
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
    passport,
    personalized:{
      address:addressLabel,
      provider:privateWell?'Private well':providerName,
      county:countyLabel,
      state,
      concern,
      why_this_is_for_you:personalizedWhy,
      call_script:callScript,
      local_lab_search:webSearch('state certified drinking water laboratory '+countyLabel+' '+state+' '+(tests.map(x=>x.name).slice(0,3).join(' ')||concern)),
      local_help_search:privateWell?countyWellSearch:providerOfficialSearch,
      how_it_works:[
        'We use your address to identify your water source, provider and local public records.',
        'We narrow the problem to the tests or checks that actually make sense for this home.',
        'We look for free local help and published prices for those exact needs, then put the lowest-cost useful option first.'
      ],
      checked_for_you:[
        privateWell?'Private-well testing needs':'Your likely water provider',
        serviceLine?.status==='address-record-match'?'Your service-line record':'Available pipe/service-line information',
        tests.length?tests.map(x=>x.name).join(', '):'Whether a paid household test is justified',
        countyLabel+' / '+state+' local options'
      ]
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
