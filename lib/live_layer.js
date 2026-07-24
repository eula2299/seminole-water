'use strict';
const https=require('https');
const {URL}=require('url');
const {classifyLiveEvidence}=require('./verification');
const {canonical,classifyAddressEvidence,evidenceExcerpt,htmlDecode}=require('./address_evidence');

function fetchText(url,timeout=15000,extraHeaders={},redirects=0){
  return new Promise((resolve,reject)=>{
    let u;try{u=new URL(url);}catch(e){return reject(e);}
    if(u.protocol!=='https:')return reject(new Error('Only HTTPS live sources are allowed'));
    const req=https.get(u,{family:4,headers:{'User-Agent':'Mozilla/5.0 SeminoleWaterGodMode/13.4 address-evidence','Accept':'text/html,application/json,text/plain,*/*',...extraHeaders}},res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();if(redirects>=4)return reject(new Error('Too many redirects'));return fetchText(new URL(res.headers.location,u).toString(),timeout,extraHeaders,redirects+1).then(resolve,reject);}
      let body='';res.setEncoding('utf8');res.on('data',d=>{if(body.length<3_000_000)body+=d});res.on('end',()=>{if(res.statusCode<200||res.statusCode>=400)return reject(new Error(`HTTP ${res.statusCode}`));resolve({url:u.toString(),status:res.statusCode,content_type:res.headers['content-type']||'',body,checked_at:new Date().toISOString()});});
    });
    req.setTimeout(timeout,()=>req.destroy(new Error('timeout')));req.on('error',reject);
  });
}
function stripHtml(s){return htmlDecode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());}
function relevantExcerpt(text,terms,max=1200){return evidenceExcerpt(text,terms,max);}
function sourceApplies(src,context){
  const city=canonical(context.city),provider=canonical(context.system_name),pwsid=String(context.pwsid||'');
  if(Array.isArray(src.pwsids)&&src.pwsids.length&&!src.pwsids.includes(pwsid))return false;
  if(Array.isArray(src.cities)&&src.cities.length&&!src.cities.some(x=>city.includes(canonical(x))||canonical(x).includes(city)))return false;
  if(Array.isArray(src.provider_patterns)&&src.provider_patterns.length&&!src.provider_patterns.some(x=>provider.includes(canonical(x))))return false;
  return true;
}
function dedupe(items){const seen=new Set();return items.filter(x=>{const k=String(x.url||'').replace(/#.*$/,'')+'|'+String(x.title||'');if(seen.has(k))return false;seen.add(k);return true;});}

async function scrapeConfiguredSources(config,context){
  const out=[],errors=[];const terms=[context.pwsid,context.system_name,context.street,...(context.neighborhoods||[]),'boil water','lead','arsenic','manganese','water quality'].filter(Boolean);
  const sources=(config.sources||[]).filter(src=>sourceApplies(src,context));
  const settled=await Promise.allSettled(sources.map(async src=>{
    if(src.requires_key&&!process.env[src.requires_key])throw Object.assign(new Error(`Missing ${src.requires_key}`),{source:src.id});
    let target=src.url_template||src.url;for(const [k,v] of Object.entries(context))target=String(target||'').replaceAll(`{${k}}`,encodeURIComponent(v||''));
    const r=await fetchText(target,src.timeout_ms||10000);const text=stripHtml(r.body);
    return {id:src.id,title:src.title||src.id,publisher:src.publisher||'',url:r.url,checked_at:r.checked_at,content_type:r.content_type,excerpt:relevantExcerpt(text,terms),text,tier:classifyLiveEvidence({url:r.url,publisher:src.publisher,title:src.title}),source_kind:src.source_kind||'official-system-context'};
  }));
  for(const [i,r] of settled.entries()){if(r.status==='fulfilled')out.push(r.value);else errors.push({source:sources[i]?.id||r.reason.source,error:r.reason.message});}
  return {items:out,errors,checked_at:new Date().toISOString()};
}


function officialWaterLinks(html,baseUrl,max=4){
  const out=[],seen=new Set();let base;try{base=new URL(baseUrl);}catch{return out;}
  const re=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(String(html||'')))&&out.length<max){
    const label=stripHtml(m[2]);if(!/(boil water|water quality|drinking water|lead service|PFAS|public notice|bacteriological)/i.test(label))continue;
    let u;try{u=new URL(htmlDecode(m[1]),base);}catch{continue;}
    if(u.protocol!=='https:'||u.hostname!==base.hostname)continue;
    u.hash='';const key=u.toString();if(seen.has(key)||key===base.toString())continue;seen.add(key);out.push({url:key,label});
  }
  return out;
}

async function scrapeAddressSources(config,context){
  const out=[],errors=[];
  const sources=(config.address_sources||[]).filter(src=>sourceApplies(src,context)).slice(0,Number(config.max_address_sources||6));
  const terms=[context.full_address,context.street,...(context.neighborhoods||[]),'boil water','water quality','lead service line'].filter(Boolean);
  const settled=await Promise.allSettled(sources.map(async src=>{
    const r=await fetchText(src.url,src.timeout_ms||9000);const text=stripHtml(r.body);
    const base={id:src.id,title:src.title||src.id,publisher:src.publisher||'',url:r.url,checked_at:r.checked_at,content_type:r.content_type,excerpt:relevantExcerpt(text,terms),text,tier:classifyLiveEvidence({url:r.url,publisher:src.publisher,title:src.title}),source_kind:src.source_kind||'official-address-notice'};
    const items=[classifyAddressEvidence(base,context)];
    const links=officialWaterLinks(r.body,r.url,Number(src.follow_links||4));
    const children=await Promise.allSettled(links.map(async(link,j)=>{const child=await fetchText(link.url,src.child_timeout_ms||6500);const childText=stripHtml(child.body);const childBase={id:`${src.id}-detail-${j+1}`,title:link.label||src.title||src.id,publisher:src.publisher||'',url:child.url,checked_at:child.checked_at,content_type:child.content_type,excerpt:relevantExcerpt(childText,terms),text:childText,tier:classifyLiveEvidence({url:child.url,publisher:src.publisher,title:link.label}),source_kind:'official-address-notice-detail'};return classifyAddressEvidence(childBase,context); }));
    for(const child of children)if(child.status==='fulfilled')items.push(child.value);
    return items;
  }));
  for(const [i,r] of settled.entries()){if(r.status==='fulfilled')out.push(...r.value);else errors.push({source:sources[i]?.id,error:r.reason.message});}
  return {items:out,errors,checked_at:new Date().toISOString(),sources_checked:sources.length};
}

function ddgTarget(href){
  try{const u=new URL(htmlDecode(href),'https://duckduckgo.com');const encoded=u.searchParams.get('uddg');return encoded?decodeURIComponent(encoded):u.toString();}catch{return htmlDecode(href);}
}
function parseDuckDuckGo(html,checkedAt){
  const rows=[];const resultRe=/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=resultRe.exec(html))&&rows.length<10){
    const after=html.slice(resultRe.lastIndex,resultRe.lastIndex+2200);const sm=after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const target=ddgTarget(m[1]);rows.push({id:`ddg-${rows.length+1}`,title:stripHtml(m[2]),url:target,publisher:(()=>{try{return new URL(target).hostname;}catch{return ''}})(),excerpt:stripHtml(sm?.[1]||''),checked_at:checkedAt,source_kind:'public-web-search'});
  }
  return rows;
}
async function searchDuckDuckGo(query,context){
  const u=`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;const r=await fetchText(u,9000,{'Accept-Language':'en-US,en;q=0.9'});
  return parseDuckDuckGo(r.body,r.checked_at).map(x=>classifyAddressEvidence({...x,tier:classifyLiveEvidence(x)},context));
}
async function searchJsonProvider(provider,query,context){
  let target=String(provider.url_template||'').replace('{query}',encodeURIComponent(query));
  const headers={};if(provider.requires_key){const key=process.env[provider.requires_key];if(!key)throw new Error(`Missing ${provider.requires_key}`);headers[provider.header_name||'Ocp-Apim-Subscription-Key']=key;}
  const r=await fetchText(target,10000,headers);const body=JSON.parse(r.body);const rows=provider.id==='brave'?(body.web?.results||[]):body.webPages?.value||body.items||body.web?.results||[];
  return rows.slice(0,10).map((x,i)=>{const base={id:`search-${provider.id}-${x.id||i}`,title:x.name||x.title,url:x.url||x.link,publisher:x.displayUrl||x.profile?.long_name||'',excerpt:x.snippet||x.description||'',checked_at:r.checked_at,source_kind:'public-web-search'};return classifyAddressEvidence({...base,tier:classifyLiveEvidence(base)},context);});
}
async function searchExactAddress(config,context){
  if(context.allow_public_search===false)return {items:[],errors:[],skipped:true,reason:'User disabled third-party exact-address web search.'};
  const providers=config.search_providers||[];const keyed=providers.find(p=>p.type!=='duckduckgo-html'&&(!p.requires_key||process.env[p.requires_key]));const fallback=providers.find(p=>p.type==='duckduckgo-html');
  const terms='("water quality" OR "boil water" OR "lead service line" OR arsenic OR manganese OR PFAS OR coliform OR contamination)';
  const query=`"${context.full_address}" ${terms}`;
  try{const items=keyed?await searchJsonProvider(keyed,query,context):fallback?await searchDuckDuckGo(query,context):[];return {items:dedupe(items),errors:items.length?[]:[{stage:'address-web-search',error:'The public search returned no matching results.'}],query,provider:keyed?.id||fallback?.id||null};}
  catch(e){return {items:[],errors:[{stage:'address-web-search',error:e.message}],query,provider:keyed?.id||fallback?.id||null};}
}
module.exports={fetchText,stripHtml,scrapeConfiguredSources,scrapeAddressSources,searchExactAddress,parseDuckDuckGo,sourceApplies,officialWaterLinks};
