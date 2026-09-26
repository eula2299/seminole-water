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
    id:'fl-seminole-lead-utility',
    state:'FL',
    counties:['Seminole County','Seminole'],
    supply:['public','unknown'],
    tests:['Lead at the tap','Service line material'],
    provider:'Seminole County Utilities',
    price:0,
    price_label:'$0 to contact',
    price_kind:'contact-first',
    scope:'lead-utility',
    url:'https://www.seminolecountyfl.gov/departments-services/utilities/lead-copper-rule-revision',
    phone:'407-665-2795',
    note:'The 2025 county water-quality report directs customers concerned about lead testing to this utility contact. The county does not publish a household test fee on that report, so confirm whether testing is offered at no charge before paying a private lab.',
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
  const matches=offersFor({state,county,supply,provider,tests});
  const byTest=[];
  for(const test of tests){
    const options=matches.filter(o=>testMatches(o,test)).sort((a,b)=>a.price-b.price||a.provider.localeCompare(b.provider));
    if(!options.length)continue;
    const best=options[0],privatePaid=options.find(o=>o.price_kind==='published'&&o.price>best.price);
    byTest.push({
      test,
      best,
      alternatives:options.slice(1,3),
      potential_savings:privatePaid?Math.max(0,privatePaid.price-best.price):null,
      comparison_provider:privatePaid?.provider||null,
      comparison_price:privatePaid?.price??null
    });
  }
  return byTest;
}
module.exports={OFFERS,offersFor,chooseCheapest};
