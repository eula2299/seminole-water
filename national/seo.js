'use strict';

const BASE='https://www.ismywaterok.com';
const GUIDES=Object.freeze({
  '/water-quality-by-address':{
    title:'Water Quality by Address: Check What Matters at Your Home',
    description:'Enter your address to connect public water records, pipe information, local environmental context, health meaning, and lower-cost next steps.',
    h1:'Water quality by address',
    intro:'Water quality is not just a citywide number. Your provider, service line, plumbing, well status, and nearby conditions can all change what matters at one home.',
    sections:[
      ['What an address check can tell you','IsMyWaterOK uses the address to identify the likely water source and provider, connect available testing and infrastructure records, and explain what deserves attention. It does not claim that public records are a laboratory sample from your tap.'],
      ['Why this is more useful than a ZIP-code score','A ZIP code can contain multiple water systems, private wells, different pipe materials, and very different housing. Address-level matching lets the site narrow the evidence and the next step without pretending to know what has not been measured.'],
      ['What happens after the check','The result shows what stands out, what is still unknown, what to do next, and the lowest-cost useful path we can verify before you buy testing you may not need.']
    ]
  },
  '/is-tap-water-safe':{
    title:'Is My Tap Water Safe? What You Can Actually Check',
    description:'Learn what public records can and cannot tell you about tap water, then check the water records and next steps for your address.',
    h1:'Is my tap water safe?',
    intro:'No website can certify the water coming from your faucet without a household sample. But you can check current notices, your likely water provider, historical test records, pipe information, and what a home test should focus on.',
    sections:[
      ['Start with current instructions','A boil-water or do-not-drink notice matters more than an old compliance result. IsMyWaterOK checks connected notice sources where available and tells you when today’s status still needs confirmation.'],
      ['Then check the source and pipes','Utility records describe the water system, while service lines and household plumbing can change what reaches the tap. Lead is the clearest example of why both layers matter.'],
      ['Test only when it adds new evidence','A home test is most useful when it answers something public records cannot: what is actually in water collected from your faucet or private well.']
    ]
  },
  '/lead-in-drinking-water':{
    title:'Lead in Drinking Water: Check Pipes, Records, and Testing Options',
    description:'Check whether lead-related pipe or water records matter for your address and find the lowest-cost useful next step before paying for testing.',
    h1:'Lead in drinking water',
    intro:'Lead often comes from service lines or household plumbing rather than the water source itself. That makes the address and pipe record especially important.',
    sections:[
      ['Why the home matters','Two homes served by the same utility can have different lead risk because their service lines, fixtures, solder, and plumbing history differ.'],
      ['What to check first','Look for an address-level service-line record and ask the matched water provider whether it offers free line identification or household sampling before paying a private laboratory.'],
      ['When a tap test helps','If pipe material is lead, galvanized, unknown, or the household has a specific concern, a properly collected lead-at-the-tap sample can answer what public records cannot.']
    ]
  },
  '/private-well-water-testing':{
    title:'Private Well Water Testing: What to Test and How to Spend Less',
    description:'Get a private-well test plan based on your address, county, and local context, with free or lower-cost options checked before private lab packages.',
    h1:'Private well water testing',
    intro:'Private wells are different from public water: the homeowner is responsible for knowing what is in the well, and nearby utility records do not describe the household supply.',
    sections:[
      ['The basic yearly checks','Routine private-well screening commonly includes bacteria, nitrate, pH, and total dissolved solids. Local geology, flooding, septic systems, agriculture, and nearby contamination can justify additional tests.'],
      ['Do not automatically buy the largest panel','A broad package can cost much more than a targeted plan. IsMyWaterOK starts with the tests supported by the address context and checks county or state options before private lab pricing.'],
      ['Use local health programs','County and state health departments may offer lower-cost sampling, test kits, or guidance. Availability and price vary, so the site tries to route the household to the local program rather than a generic national page.']
    ]
  },
  '/pfas-in-drinking-water':{
    title:'PFAS in Drinking Water: What the Records Mean for Your Home',
    description:'Understand PFAS water records, when household testing adds value, and how to compare targeted PFAS testing instead of buying unrelated panels.',
    h1:'PFAS in drinking water',
    intro:'PFAS results can come from utility monitoring, source-water studies, or environmental sampling. The location and sampling scope matter before treating a result as evidence about one household.',
    sections:[
      ['Read the sampling scope','A PFAS detection in a nearby environmental sample is not the same as a tap-water result. Utility monitoring is more relevant to served customers, but household plumbing and exact distribution conditions still matter.'],
      ['Use targeted testing','If PFAS is the concern, compare PFAS-specific certified testing instead of paying for a large unrelated water package.'],
      ['Keep the claim proportional to the evidence','IsMyWaterOK labels whether the record comes from the serving system, source water, nearby environment, or the property so the user can see what the result actually establishes.']
    ]
  },
  '/arsenic-in-water':{
    title:'Arsenic in Water: What to Check at Your Address',
    description:'See when arsenic records are relevant to your water source, what they mean, and when targeted household or well testing makes sense.',
    h1:'Arsenic in water',
    intro:'Arsenic can occur naturally in groundwater and is especially important for some private wells. Public-water systems also monitor regulated contaminants, but historical system results are not the same as a current tap sample.',
    sections:[
      ['Private wells need their own evidence','A nearby well or geology signal can make arsenic worth testing, but only a sample from the household well establishes the concentration in that water.'],
      ['Public-system records need dates and scope','The site keeps the provider, sampling period, unit, and comparison context together instead of reducing everything to a vague safe/unsafe label.'],
      ['Target the test','If arsenic is the relevant question, start with arsenic rather than paying for a broad package solely because it contains many analytes.']
    ]
  },
  '/nitrate-in-well-water':{
    title:'Nitrate in Well Water: Testing, Infant Risk, and Lower-Cost Options',
    description:'Understand why nitrate matters for private wells, especially for infants, and find targeted testing and local lower-cost options.',
    h1:'Nitrate in well water',
    intro:'Nitrate can enter groundwater from fertilizers, septic systems, agriculture, and other sources. It is a routine private-well test and is especially important when infants may consume the water.',
    sections:[
      ['Why nitrate is different','Nitrate is a household-supply question for a private well. Utility reports from a nearby public system do not establish the nitrate level in a private well.'],
      ['Who should pay extra attention','Infants are particularly sensitive to high nitrate exposure, so households using well water for infant formula should make nitrate testing a priority.'],
      ['Find the local price first','County health programs can sometimes cost much less than private laboratory packages. The address plan checks local and published options before recommending a paid route.']
    ]
  },
  '/water-testing-cost':{
    title:'Water Testing Cost: How to Avoid Paying for Tests You Do Not Need',
    description:'See what water testing can cost, how to narrow the right tests for your home, and how IsMyWaterOK searches for free and lower-cost options first.',
    h1:'How much does water testing cost?',
    intro:'The cheapest test is not always the cheapest useful answer. A $0 public record may answer a pipe question, while a household lab test may be the only way to answer what is actually coming from the tap.',
    sections:[
      ['Compare like with like','A free service-line inventory cannot replace a laboratory water test. IsMyWaterOK only calculates savings when two options answer the same question.'],
      ['Narrow the panel before shopping','The address result identifies the contaminants or infrastructure questions that deserve attention, so users can request itemized prices instead of automatically buying the largest package.'],
      ['Look for public programs first','Utilities, county health departments, and state programs may provide information or testing at lower cost. The household plan puts those options before private paid testing when they are truly comparable.']
    ]
  }
});

function esc(value){return String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function absolute(path){return BASE+path;}
function guidePaths(){return Object.keys(GUIDES);}
function guideHtml(path){
  const g=GUIDES[path];if(!g)return null;
  const canonical=absolute(path);
  const article=JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:g.h1,description:g.description,mainEntityOfPage:canonical,publisher:{'@type':'Organization',name:'IsMyWaterOK',url:BASE},dateModified:'2026-09-26'});
  const crumbs=JSON.stringify({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Home',item:BASE+'/'},{'@type':'ListItem',position:2,name:g.h1,item:canonical}]});
  const related=guidePaths().filter(x=>x!==path).slice(0,5).map(x=>'<a href="'+x+'">'+esc(GUIDES[x].h1)+'</a>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(g.title)+' | IsMyWaterOK</title><meta name="description" content="'+esc(g.description)+'"><link rel="canonical" href="'+canonical+'">'+
    '<meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="article"><meta property="og:site_name" content="IsMyWaterOK"><meta property="og:title" content="'+esc(g.title)+'"><meta property="og:description" content="'+esc(g.description)+'"><meta property="og:url" content="'+canonical+'">'+
    '<meta name="twitter:card" content="summary"><script type="application/ld+json">'+article+'</script><script type="application/ld+json">'+crumbs+'</script>'+
    '<style>body{margin:0;background:#f7faf8;color:#152e34;font:16px/1.7 system-ui,-apple-system,sans-serif}.shell{max-width:900px;margin:auto;padding:0 24px}.top{padding:24px 0;border-bottom:1px solid #dce7e4}.top a{font-weight:800;color:#152e34;text-decoration:none}.hero{padding:58px 0 30px}.eyebrow{font-size:11px;letter-spacing:.14em;font-weight:800;color:#076c66}.hero h1{font-size:clamp(38px,6vw,62px);line-height:1.05;letter-spacing:-2px;margin:8px 0 18px}.hero p{font-size:19px;color:#587078;max-width:760px}.cta{background:#fff;border:1px solid #cfe0da;border-radius:15px;padding:22px;margin:18px 0 34px}.cta h2{margin:0 0 7px}.button{display:inline-block;background:#076c66;color:white;text-decoration:none;border-radius:8px;padding:11px 16px;font-weight:700}.content section{padding:24px 0;border-top:1px solid #dce7e4}.content h2{font-size:25px}.content p{color:#405d56}.related{display:flex;flex-wrap:wrap;gap:9px;padding:28px 0}.related a{background:#e8f4ef;color:#285f59;text-decoration:none;border-radius:999px;padding:7px 11px;font-size:12px}footer{border-top:1px solid #dce7e4;padding:25px 0 40px;color:#587078;font-size:13px}</style></head><body><div class="shell"><header class="top"><a href="/">IsMyWaterOK</a></header><main><section class="hero"><p class="eyebrow">HOUSEHOLD WATER GUIDE</p><h1>'+esc(g.h1)+'</h1><p>'+esc(g.intro)+'</p></section><section class="cta"><h2>Check your own address</h2><p>Get the water source, records, missing information, targeted next steps, and lower-cost options for one home.</p><a class="button" href="/">Check my water →</a></section><div class="content">'+g.sections.map(s=>'<section><h2>'+esc(s[0])+'</h2><p>'+esc(s[1])+'</p></section>').join('')+'</div><nav class="related" aria-label="Related water guides">'+related+'</nav></main><footer>Independent water information backed by public sources. Public records do not replace a household laboratory sample or current utility instructions.</footer></div></body></html>';
}
function robots(){return 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /water-details\nSitemap: '+BASE+'/sitemap.xml\n';}
function sitemap(){
 const paths=['/',...guidePaths()];
 const body=paths.map(p=>'<url><loc>'+absolute(p)+'</loc><lastmod>2026-09-26</lastmod><changefreq>'+(p==='/'?'weekly':'monthly')+'</changefreq><priority>'+(p==='/'?'1.0':'0.8')+'</priority></url>').join('');
 return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+body+'</urlset>';
}
module.exports={BASE,GUIDES,guidePaths,guideHtml,robots,sitemap};
