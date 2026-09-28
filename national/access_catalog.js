'use strict';

const OFFERS = Object.freeze([
  {
    id:'fl-county-microbiology',
    state:'FL',
    counties:['*'],
    supply:['private-well'],
    tests:['Total coliform and E. coli'],
    provider:'Florida Department of Health — county health department',
    price:17,
    price_label:'$17',
    price_kind:'published',
    scope:'microbiology',
    url:'https://www.floridahealth.gov/community-environmental-public-health/public-health-laboratories/laboratory-services/environmental-laboratory-services/well-water-testing/',
    phone:null,
    note:'Florida DOH publishes a $17 county-health-department price for private well microbiology testing. Confirm pickup/drop-off instructions with your county.',
    verified_at:'2026-09-25'
  },
  {
    id:'fl-county-routine-nitrate',
    state:'FL',
    counties:['*'],
    supply:['private-well'],
    tests:['Nitrate'],
    provider:'Florida county health department',
    price:20,
    price_max:30,
    price_label:'usually $20–$30 per sample',
    price_kind:'published-range',
    scope:'routine-private-well',
    url:'https://www.floridahealth.gov/community-environmental-public-health/environmental-public-health/water-quality/drinking-water/private-wells/',
    phone:null,
    note:'Florida DOH says county health department private-well testing is usually $20–$30 per sample and recommends annual nitrate testing. Confirm the exact local charge before collecting the sample.',
    verified_at:'2026-09-25'
  },
  {
    id:'fl-seminole-water-sample',
    state:'FL',
    counties:['Seminole County','Seminole'],
    supply:['private-well'],
    tests:['Water sample'],
    provider:'Florida Department of Health in Seminole County',
    price:20,
    price_label:'$20 per sample',
    price_kind:'published',
    scope:'general-water-sample',
    url:'https://seminole.floridahealth.gov/programs-and-services/environmental-public-health/_documents/Fees.pdf',
    phone:'407-665-3611',
    note:'The current Seminole County environmental-health fee schedule lists water lab analysis at $20 per sample. Call first to confirm that the analyte you need is covered.',
    verified_at:'2026-09-25'
  },
  {
    id:'ael-lead',
    state:'FL',
    counties:['*'],
    supply:['public','private-well','unknown'],
    tests:['Lead at the tap'],
    provider:'Advanced Environmental Laboratories (AEL)',
    price:120,
    price_label:'$120',
    price_kind:'published',
    scope:'lead',
    url:'https://orders.aellab.com/products/lead-pb-only',
    phone:null,
    note:'State-certified laboratory test. Published standard turnaround: 7 business days. Orlando pickup is available.',
    verified_at:'2026-09-25'
  },
  {
    id:'ael-nitrate',
    state:'FL',
    counties:['*'],
    supply:['public','private-well','unknown'],
    tests:['Nitrate','Nitrate & Nitrite'],
    provider:'Advanced Environmental Laboratories (AEL)',
    price:120,
    price_label:'$120',
    price_kind:'published',
    scope:'nitrate-nitrite',
    url:'https://orders.aellab.com/products/nitrate-no3-nitrite-no2-only',
    phone:null,
    note:'State-certified laboratory test for nitrate and nitrite. Published standard turnaround: 5 business days.',
    verified_at:'2026-09-25'
  },
  {
    id:'ael-bacteria',
    state:'FL',
    counties:['*'],
    supply:['public','private-well','unknown'],
    tests:['Total coliform and E. coli'],
    provider:'Advanced Environmental Laboratories (AEL)',
    price:120,
    price_label:'$120',
    price_kind:'published',
    scope:'microbiology',
    url:'https://orders.aellab.com/products/total-coliform-ecoli-bacteria-only',
    phone:null,
    note:'State-certified laboratory test for total coliform and E. coli. Published standard turnaround: 5 business days.',
    verified_at:'2026-09-25'
  },
  {
    id:'ael-lead-nitrate',
    state:'FL',
    counties:['*'],
    supply:['public','private-well','unknown'],
    tests:['Lead at the tap','Nitrate'],
    provider:'Advanced Environmental Laboratories (AEL)',
    price:150,
    price_label:'$150',
    price_kind:'published',
    scope:'lead-nitrate',
    url:'https://orders.aellab.com/products/lead-pb-nitrate-no3-only',
    phone:null,
    note:'State-certified combined lead and nitrate test. Published standard turnaround: 7 business days.',
    verified_at:'2026-09-25'
  },
  {
    id:'ael-pfas',
    state:'FL',
    counties:['*'],
    supply:['public','private-well','unknown'],
    tests:['PFAS panel including PFOA/PFOS'],
    provider:'Advanced Environmental Laboratories (AEL)',
    price:395,
    price_label:'$395',
    price_kind:'published',
    scope:'pfas',
    url:'https://orders.aellab.com/products/pfas-national-primary-drinking-water-regulation-npwdr',
    phone:null,
    note:'Published certified PFAS package price for the federal drinking-water PFAS panel.',
    verified_at:'2026-09-25'
  },
  {
    id:'fl-bphl-bacteria',
    state:'FL',
    counties:['*'],
    supply:['private-well'],
    tests:['Total coliform and E. coli'],
    provider:'Florida Bureau of Public Health Laboratories',
    price:40,
    price_label:'$40',
    price_kind:'published',
    scope:'microbiology',
    url:'https://www.floridahealth.gov/community-environmental-public-health/public-health-laboratories/laboratory-services/environmental-laboratory-services/well-water-testing/',
    phone:'904-791-1600',
    note:'Florida DOH publishes a $40 private-testing price through BPHL for E. coli and coliform testing. Samples are handled through Jacksonville or Miami and have same-day delivery requirements.',
    verified_at:'2026-09-27',
    priority:20,
    location_label:'Florida'
  },
  {
    id:'emsl-orlando-lead',
    state:'FL',
    counties:['Seminole County','Seminole','Orange County','Orange','Osceola County','Osceola','Lake County','Lake','Volusia County','Volusia'],
    supply:['public','private-well','unknown'],
    tests:['Lead at the tap','Arsenic','Cadmium','Nitrate','Total coliform and E. coli'],
    provider:'EMSL Analytical — Orlando',
    price:null,
    price_label:'Call for current price',
    price_kind:'contact-first',
    scope:'certified-local-lab',
    url:'https://www.emsl.com/Locations.aspx?laboratoryid=10',
    phone:'407-599-5887',
    note:'Orlando drinking-water laboratory with current Florida accreditation covering lead, arsenic, cadmium, nitrate and microbiology methods. Ask for a quote for only the tests listed in your plan.',
    verified_at:'2026-09-27',
    priority:10,
    location_label:'Orlando'
  },
  {
    id:'eurofins-orlando-lead',
    state:'FL',
    counties:['Seminole County','Seminole','Orange County','Orange','Osceola County','Osceola','Lake County','Lake','Volusia County','Volusia'],
    supply:['public','private-well','unknown'],
    tests:['Lead at the tap','Arsenic','Cadmium','Nitrate'],
    provider:'Eurofins Environment Testing — Orlando',
    price:null,
    price_label:'Call for current price',
    price_kind:'contact-first',
    scope:'certified-local-lab',
    url:'https://location.eurofins.com/en/',
    phone:'407-339-5984',
    note:'Altamonte Springs drinking-water laboratory. Ask for an itemized quote for only the tests listed in your plan and confirm current Florida certification for each analyte.',
    verified_at:'2026-09-27',
    priority:9,
    location_label:'Altamonte Springs'
  },
  {
    id:'orlando-inspex-well-panel',
    state:'FL',
    counties:['Seminole County','Seminole','Orange County','Orange','Osceola County','Osceola','Lake County','Lake'],
    supply:['private-well'],
    tests:['Total coliform and E. coli','Nitrate','Lead at the tap'],
    provider:'Orlando Inspex — FHA/VA Water Testing',
    price:null,
    price_label:'Call / book for current price',
    price_kind:'contact-first',
    scope:'local-testing-service',
    url:'https://www.orlandoinspex.com/fha-va-watertest/',
    phone:'407-605-6332',
    note:'Local service using certified Florida labs. Its basic panel includes coliform, E. coli, lead, nitrate/nitrite, pH and turbidity. Useful if you prefer a bundled private-well panel.',
    verified_at:'2026-09-27',
    priority:12,
    location_label:'Orlando'
  },
  {
    id:'pace-ormond-lead',
    state:'FL',
    counties:['Seminole County','Seminole','Volusia County','Volusia','Flagler County','Flagler'],
    supply:['public','private-well','unknown'],
    tests:['Lead at the tap'],
    provider:'Pace Analytical Services — Ormond Beach',
    price:null,
    price_label:'Call for current price',
    price_kind:'contact-first',
    scope:'certified-regional-lab',
    url:'https://www.pacelabs.com/',
    phone:'386-672-5668',
    note:'Listed in Florida-certified lead laboratory directories. Confirm current certification and ask for a drinking-water lead quote and sampling kit instructions.',
    verified_at:'2026-09-27',
    priority:30,
    location_label:'Ormond Beach'
  },
  {
    id:'fl-seminole-lead-utility',
    state:'FL',
    counties:['Seminole County','Seminole'],
    providers:['SEMINOLE COUNTY UTILITIES','SEMINOLE COUNTY'],
    supply:['public','unknown'],
    tests:['Lead at the tap'],
    provider:'Seminole County Utilities',
    price:null,
    price_label:'Cost not published — call first',
    price_kind:'contact-first',
    scope:'lead-utility',
    url:'https://www.seminolecountyfl.gov/departments-services/utilities/lead-copper-rule-revision',
    phone:'407-665-2795',
    note:'The 2025 county water-quality report directs customers concerned about lead testing to this utility contact. The county does not publish a household test fee on that report, so confirm whether testing is offered at no charge before paying a private lab.',
    verified_at:'2026-09-25'
  },
  {
    id:'fl-seminole-service-line',
    state:'FL',
    counties:['Seminole County','Seminole'],
    providers:['SEMINOLE COUNTY UTILITIES','SEMINOLE COUNTY'],
    supply:['public','unknown'],
    tests:['Service line material'],
    provider:'Seminole County Utilities — Service Line Inventory',
    price:0,
    price_label:'$0',
    price_kind:'published-free-information',
    scope:'service-line',
    url:'https://www.seminolecountyfl.gov/departments-services/utilities/lead-copper-rule-revision',
    phone:'407-665-2110',
    note:'The county publishes a service-line inventory for Seminole County Utilities customers. Check this before paying anyone only to identify the outside service-line material.',
    verified_at:'2026-09-25'
  },
  {
    id:'fl-sanford-service-line',
    state:'FL',
    counties:['Seminole County','Seminole'],
    providers:['CITY OF SANFORD','SANFORD, CITY OF','City of Sanford'],
    supply:['public','unknown'],
    tests:['Service line material'],
    provider:'City of Sanford — Lead Safe Community',
    price:0,
    price_label:'$0',
    price_kind:'published-free-information',
    scope:'service-line',
    url:'https://sanfordfl.gov/lead-safe-community/',
    phone:'407-688-5102',
    note:'Use the city service-line inventory before paying anyone only to identify the outside service-line material.',
    verified_at:'2026-09-25'
  }
]);

function norm(value){return String(value||'').trim().toLowerCase();}
function countyMatches(offer,county){
  return (offer.counties||['*']).some(x=>x==='*'||norm(x)===norm(county));
}
function providerMatches(offer,provider){
  if(!offer.providers?.length)return true;
  const value=norm(provider);
  return offer.providers.some(x=>value.includes(norm(x))||norm(x).includes(value));
}
function testMatches(offer,test){
  const t=norm(test);
  return (offer.tests||[]).some(x=>norm(x)===t);
}
function offersFor({state,county,supply,provider,tests=[]}){
  const s=norm(supply||'unknown');
  return OFFERS.filter(o=>o.state===state&&countyMatches(o,county)&&(o.supply||[]).some(x=>norm(x)===s||norm(x)==='unknown')&&providerMatches(o,provider)&&tests.some(t=>testMatches(o,t)));
}
function chooseCheapest({state,county,supply,provider,tests=[]}){
  const allMatches=offersFor({state,county,supply,provider,tests});
  const hasPrice=o=>o.price!==null&&o.price!==undefined&&String(o.price).trim()!==''&&Number.isFinite(Number(o.price));
  const priced=allMatches.filter(hasPrice);
  const byTest=[];
  for(const test of tests){
    const options=priced.filter(o=>testMatches(o,test)).sort((a,b)=>a.price-b.price||a.provider.localeCompare(b.provider)||a.id.localeCompare(b.id));
    const contacts=allMatches.filter(o=>testMatches(o,test)&&!hasPrice(o)).sort((a,b)=>(Number(a.priority)||100)-(Number(b.priority)||100)||a.provider.localeCompare(b.provider)||a.id.localeCompare(b.id));
    if(!options.length&&!contacts.length)continue;
    const best=options[0]||null;
    const privatePaid=best?options.find(o=>o.price_kind==='published'&&o.price>best.price):null;
    const bestMax=best?(Number.isFinite(Number(best.price_max))?Number(best.price_max):best.price):null;
    const savingLow=privatePaid&&bestMax!==null?Math.max(0,privatePaid.price-bestMax):null;
    const savingHigh=privatePaid&&best?Math.max(0,privatePaid.price-best.price):null;
    byTest.push({
      test,
      best,
      all_options:options,
      alternatives:options.slice(1),
      contact_options:contacts,
      potential_savings:savingLow!==null&&savingLow===savingHigh?savingLow:null,
      potential_savings_range:savingLow!==null&&savingLow!==savingHigh?[savingLow,savingHigh]:null,
      comparison_provider:privatePaid?.provider||null,
      comparison_price:privatePaid?.price??null
    });
  }
  return byTest;
}
module.exports={OFFERS,offersFor,chooseCheapest};
