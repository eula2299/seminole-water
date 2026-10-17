'use strict';
// Product IDs and test scopes are curated from the providers' own pages.
// Prices/availability refresh from those providers without an AI or search API.
const seed=require('./testing_products.json');
const products=seed.map(x=>({...x}));
const programs=[
 {id:'nyc-free-lead',state:'NY',service_area:{cities:['New York','New York City','Manhattan','Brooklyn','Queens','Bronx','Staten Island'],counties:['New York County','Kings County','Queens County','Bronx County','Richmond County']},provider:'NYC DEP — free lead test kit',url:'https://www.nyc.gov/content/leadfree/pages/request-water-test-kit',phone:'311',note:'For New York City residents. Request the kit online or through 311; collect the samples following the kit instructions and use the prepaid return label.',location_label:'New York City'},
 {id:'chicago-free-lead',state:'IL',service_area:{cities:['Chicago'],providers:['CHICAGO','CITY OF CHICAGO']},provider:'Chicago Department of Water Management — free lead test kit',url:'https://www.chicagowaterquality.org/',phone:'311',note:'For residential homes within Chicago. Request a free kit online or through 311 and follow the city’s sample pickup instructions.',location_label:'Chicago',source_url:'https://downloads.regulations.gov/EPA-HQ-OW-2022-0801-0663/content.pdf'},
 {id:'denver-free-lead',state:'CO',service_area:{cities:['Denver'],providers:['DENVER WATER','DENVER WATER BOARD']},provider:'Denver Water — free lead test kit',url:'https://www.denverwater.org/your-water/water-quality/lead/request-lead-test',phone:'303-893-2444',note:'For Denver Water customers; one test per household. Use an unfiltered kitchen faucet and follow the kit instructions. Published turnaround: 4–6 weeks after the lab receives the sample.',location_label:'Denver Water service area'},
 {id:'dc-free-lead',state:'DC',service_area:{cities:['Washington','Washington DC'],providers:['DC WATER','DISTRICT OF COLUMBIA WATER AND SEWER AUTHORITY']},provider:'DC Water — free lead test kit',url:'https://leadtesting.dcwater.com/',note:'Annual free lead testing for DC Water customers. Tenants and owner-occupants may request a kit directly.',location_label:'DC Water service area',source_url:'https://www.dcwater.com/resources/lead/partners-removing-lead/home-owner-tools-0'},
 {id:'philadelphia-free-lead',state:'PA',service_area:{cities:['Philadelphia'],counties:['Philadelphia County'],providers:['PHILADELPHIA WATER DEPARTMENT','PHILADELPHIA WATER']},provider:'Philadelphia Water Department — free lead and copper testing',url:'https://www.phila.gov/services/water-gas-utilities/get-your-water-tested/',phone:'215-685-6300',note:'For homes served by Philadelphia Water. Request a lead/copper kit on the linked official page; PWD collects the filled bottles. Call about other water-quality concerns to arrange an investigation when needed.',location_label:'Philadelphia'},
 {id:'pittsburgh-free-lead',state:'PA',service_area:{cities:['Pittsburgh'],providers:['PITTSBURGH WATER','PITTSBURGH WATER AND SEWER AUTHORITY']},provider:'Pittsburgh Water — free lead test kit',url:'https://www.pgh2o.com/leadform',phone:'412-255-8987',note:'For Pittsburgh Water drinking-water customers. Request a kit using the official form or Lead Help Desk. The utility offers a certified filter pitcher if the test shows elevated lead.',location_label:'Pittsburgh Water service area'}
].map(x=>({counties:['*'],supply:['public'],tests:['Lead at the tap'],price:0,price_label:'$0 · free testing',price_kind:'published-free-testing',scope:'lead',comparable:false,verified_at:'2026-10-17',...x}));
programs.push(...[
 {id:'ca-self-help-well',provider:'Self-Help Enterprises — well testing and water assistance',counties:['Fresno','Kern','Kings','Madera','Mariposa','Merced','Stanislaus','Tulare','San Joaquin'],phone:'559-802-1285',note:'California Water Board-listed help for disadvantaged households using domestic wells or small water systems. Ask the water-quality team about well testing, treatment, and repairs; they check program requirements. Email: waterquality@selfhelpenterprises.org.'},
 {id:'ca-community-water-center',provider:'Community Water Center — domestic well assistance',counties:['Kern','Monterey','San Benito','San Luis Obispo','San Mateo','Santa Barbara','Santa Clara','Santa Cruz','Ventura'],phone:'831-500-2162',note:'California Water Board-listed well testing and bottled-water assistance for disadvantaged households on domestic wells or small water systems. Call to check the program requirements and arrange help.'}
].map(x=>({...x,state:'CA',counties:x.counties.flatMap(c=>[c,c+' County']),supply:['private-well'],tests:['*'],price:null,price_label:'Testing assistance program',price_kind:'contact-first',scope:'assistance-program',comparable:false,url:'https://www.waterboards.ca.gov/water_issues/programs/grants_loans/drinking_water_well.html',location_label:'California — listed counties',verified_at:'2026-10-17'})));
let lastAttempt=0,inflight=null;
function applyProduct(offer,payload,now=new Date()){
 if(!payload||payload.id!==offer.product_id||!Array.isArray(payload.variants))throw new Error('Product identity changed');
 const v=payload.variants.find(v=>v.id===offer.variant_id);
 if(!v||typeof v.available!=='boolean'||!Number.isSafeInteger(v.price)||v.price<=0||v.price>1000000)throw new Error('Invalid product price');
 offer.price=v.price/100;offer.available=v.available;offer.verified_at=now.toISOString().slice(0,10);
 offer.price_label=offer.price.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2})+(offer.shipping_included?' · shipping included':' + shipping');
 return offer;
}
async function refresh(fetcher=fetch,now=Date.now()){
 if(inflight)return inflight;
 if(now-lastAttempt<6*60*60*1000)return;
 lastAttempt=now;
 inflight=(async()=>{let updated=0;
  for(let i=0;i<products.length;i+=3){
   const results=await Promise.allSettled(products.slice(i,i+3).map(async offer=>{
    const u=new URL(offer.price_feed);
    if(!['mytapscore.com','watercheck.com'].includes(u.hostname)||u.protocol!=='https:')throw new Error('Unexpected price source');
    const response=await fetcher(u.href,{signal:AbortSignal.timeout(6000),redirect:'error',headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('Price feed unavailable');
    const raw=await response.text();if(raw.length>500000)throw new Error('Price feed too large');
    applyProduct(offer,JSON.parse(raw),new Date(now));return true;
   }));updated+=results.filter(x=>x.status==='fulfilled').length;
  }return {updated,total:products.length};
 })().finally(()=>{inflight=null;});return inflight;
}
function offers(){return [...products.filter(x=>x.available!==false),...programs];}
module.exports={offers,refresh,applyProduct};
