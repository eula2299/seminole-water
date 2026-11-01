'use strict';
const crypto=require('node:crypto');
const catalog=require('./agencies.json');
const governments=require('./governments.json');
const {page,plain}=require('./public-pages');
const clean=(v,n=120)=>typeof v==='string'?v.trim().replace(/[\x00-\x1f]/g,' ').slice(0,n):'';
const normalizeUrl=v=>{try{const u=new URL(v);u.hash='';return u.href;}catch{return '';}};
const place=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const hostOf=url=>new URL(url).hostname.replace(/^www\./,'');
function linkScore(link,kind){
 const value=link.title+' '+link.url;
 const specific={assistance:/assistan|discount|affordab|financial|relief|help.*pay/i,meetings:/agenda|calendar|public.comment|public.hearing|council.meeting/i,pipes:/lead|service.line|pipe.*map|inventory/i,repairs:/replacement|repair|inspection|lead/i,bill:/rates|tariff|bill.*help|payment.*assistan/i,support:/customer|contact|water.*help/i}[kind];
 return (specific.test(value)?20:0)+(/water|utilit/i.test(value)?8:0)+(/services|programs|departments/i.test(value)?2:0)-(/news|blog|award|\/20\d\d\//i.test(value)?15:0);
}
function localOffices(city,state,tribal=false){
 const name=place(city);if(!name)return [];
 return governments.records.filter(r=>r[4]===state&&place(r[3])===name&&(r[1]!=='Tribal'||tribal)&&(r[1]!=='Special district'||/water|sewer|utilit/i.test(r[2]))).sort((a,b)=>Number(b[0]===name+'.gov')-Number(a[0]===name+'.gov')||Number(b[1]==='City')-Number(a[1]==='City')||a[0].length-b[0].length).slice(0,3).map(r=>({title:r[2],url:'https://'+r[0]+'/',type:r[1],city:r[3],state:r[4],source:governments.source,checked_at:governments.checked_at}));
}
function agencies({state='',city='',tribal=false}={}){
 const code=clean(state,2).toUpperCase(),region=catalog.jurisdictions.find(r=>r.code===code);
 return {local_offices:localOffices(city,code,tribal),checked_at:catalog.checked_at,jurisdictions:catalog.jurisdictions.map(r=>({code:r.code,name:r.name})),region:region||null,tribal:tribal?catalog.tribal_directory:null,tribes:tribal?catalog.tribes:[]};
}
function createLocalHelp({ai,readPage=page,now=Date.now}={}){
 const cache=new Map(),suggestions=new Map(),pending=new Map();
 function suggestion(html){
  if(typeof html!=='string'||html.length>100000)return null;
  // Trusted search-provider markup is isolated in a sandboxed document with no scripts or forms.
  const id=crypto.randomBytes(18).toString('base64url');
  suggestions.set(id,{html,expires:now()+1800000});
  for(const [key,v]of suggestions)if(v.expires<now())suggestions.delete(key);
  if(suggestions.size>256)suggestions.delete(suggestions.keys().next().value);
  return '/help/search-suggestions/'+id;
 }
 async function search(input){
  const city=clean(input.city,100),state=clean(input.state,2).toUpperCase(),kind=clean(input.kind,20)||'assistance',language=clean(input.language,8)||'en';
  if(city.length<2||!catalog.jurisdictions.some(r=>r.code===state)||!['assistance','meetings','pipes','repairs','bill','support'].includes(kind))throw Object.assign(Error('LOCATION_REQUIRED'),{status:400});
  const key=JSON.stringify([city.toLowerCase(),state,kind,language]);const old=cache.get(key);if(old&&old.expires>now())return old.value;if(pending.has(key))return pending.get(key);
  const work=(async()=>{
   const direct=agencies({state,city}),result={...direct,city,kind,items:[],checked_at:new Date(now()).toISOString(),status:'official_routes',suggestions:null};
   if(!ai?.enabled)return result;
   let response,fetched=[];
   try{response=await ai.discover({city,state,kind,language,official:direct.region.routes});}catch(e){console.warn(JSON.stringify({event:"local-help-discovery-failed",reason:e.message,kind}));}
   result.suggestions=suggestion(response?.grounding?.searchEntryPoint?.renderedContent);
   const grounded=(response?.grounding?.groundingChunks||[]).map(r=>r.web).filter(r=>r&&/^https:\/\//.test(r.uri)).slice(0,8);
   if(grounded.length){
    const pages=await Promise.allSettled(grounded.map(async source=>({source,page:await readPage(source.uri)})));
    fetched=pages.filter(r=>r.status==='fulfilled').map(r=>r.value);
   }
   // Read the official directories directly when the search provider has no quota or no usable sources.
   // This uses public agency pages and the ordinary explanation API, not another search key/model.
   if(!fetched.length&&ai.discoverPages){
    const kinds=kind==='meetings'?['local','state']:kind==='pipes'||kind==='repairs'?['water','local','social']:['local','social','water','consumer'];
    const officeUrls=new Set(direct.local_offices.slice(0,2).map(r=>r.url));
    const seed=await Promise.allSettled([...new Set([...officeUrls,...kinds.map(k=>direct.region.routes[k]?.url)].filter(Boolean))].map(async url=>({...await readPage(url),cityOffice:officeUrls.has(url),localDirectory:url===direct.region.routes.local?.url})));
    const pages=seed.filter(r=>r.status==='fulfilled').map(r=>r.value),chosen=[];
    const cityLinks=new Set(pages.filter(p=>p.localDirectory).flatMap(p=>(p.links||[]).filter(l=>place(l.title).replace(/^(cityof|townof|villageof)/,'')===place(city)).map(l=>l.url)));
    for(const p of pages){
     const score=link=>linkScore(link,kind)+(cityLinks.has(link.url)?100:0);
     const links=(p.links||[]).filter(l=>score(l)>0);
     links.sort((a,b)=>score(b)-score(a));
     for(const link of links.slice(0,2))if(!chosen.includes(link.url)&&!pages.some(p=>p.url===link.url))chosen.push(link.url);
    }
    chosen.sort((a,b)=>Number(cityLinks.has(b))-Number(cityLinks.has(a)));
    const extra=await Promise.allSettled(chosen.slice(0,4).map(async url=>({...await readPage(url),cityOffice:cityLinks.has(url)})));pages.push(...extra.filter(r=>r.status==='fulfilled').map(r=>r.value));
    const cityHosts=new Set(direct.local_offices.map(r=>new URL(r.url).hostname.replace(/^www\./,'')));
    const cityPages=pages.filter(p=>p.cityOffice||cityHosts.has(hostOf(p.url)));
    const deeper=[...new Set(cityPages.flatMap(p=>(p.links||[]).filter(l=>linkScore(l,kind)>0&&!pages.some(p=>p.url===l.url))).sort((a,b)=>linkScore(b,kind)-linkScore(a,kind)).map(l=>l.url))].slice(0,4);
    const more=await Promise.allSettled(deeper.map(url=>readPage(url)));pages.push(...more.filter(r=>r.status==='fulfilled').map(r=>r.value));
    if(pages.length){
     try{
      let items=await ai.discoverPages({pages,city,state,kind});
      // Model-proposed routes are only search hints. Fetch and quote-check them before display.
      // Keep these reads on the exact official hosts already matched to this city/state.
      const hosts=new Set([...direct.local_offices.map(r=>hostOf(r.url)),...cityPages.map(p=>hostOf(p.url)),...Object.values(direct.region.routes).map(r=>hostOf(r.url))]);
      const hints=[...new Set((Array.isArray(items.candidate_urls)?items.candidate_urls:[]).filter(url=>{
       try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&hosts.has(hostOf(url))&&!pages.some(p=>normalizeUrl(p.url)===normalizeUrl(url));}catch{return false;}
      }))].slice(0,4);
      const hinted=await Promise.allSettled(hints.map(url=>readPage(url)));
      const extraPages=hinted.filter(r=>r.status==='fulfilled'&&hosts.has(hostOf(r.value.url))).map(r=>r.value);
      if(extraPages.length){
       pages.push(...extraPages);
       try{const more=await ai.discoverPages({pages:extraPages,city,state,kind,final:true});items={items:[...(more.items||[]),...(items.items||[])]};}catch(e){console.warn(JSON.stringify({event:'local-help-extra-reading-failed',reason:e.message}));}
      }
      response={result:items};fetched=pages.map(page=>({source:{uri:page.url},page,directoryLinked:true}));
     }catch(e){console.warn(JSON.stringify({event:'local-help-page-reading-failed',reason:e.message}));}
    }
   }
   if(!response?.result)return result;
   const known=new Set(Object.values(direct.region.routes).map(r=>new URL(r.url).hostname));
   const permitted=host=>host.endsWith('.gov')||host.endsWith('.us')||known.has(host)||['211.org','www.211.org','lsc.gov','www.lsc.gov','rd.usda.gov'].includes(host);
   for(const item of (response.result?.items||[]).slice(0,8)){
    const matched=fetched.find(r=>normalizeUrl(r.page.url)===normalizeUrl(item.url)||normalizeUrl(r.source.uri)===normalizeUrl(item.url));
    if(!matched||!matched.directoryLinked&&!permitted(new URL(matched.page.url).hostname))continue;
    const quote=plain(clean(item.quote,550));
    if(quote.length<15||!matched.page.text.toLowerCase().includes(quote.toLowerCase()))continue;
    if(['assistance','bill'].includes(kind)&&/technical assistance for|assistance for (?:public )?(?:water|wastewater).*systems|water restoration assistance|state revolving fund/i.test(matched.page.title))continue;
    const dateLabel=clean(item.date_label,70),deadline=clean(item.deadline_label,100);
    const verifiedDate=dateLabel&&quote.includes(dateLabel)?dateLabel:null;
    const verifiedDeadline=deadline&&quote.includes(deadline)?deadline:null;
    if(result.items.some(i=>i.url===matched.page.url))continue;
    result.items.push({title:matched.page.title.slice(0,200),url:matched.page.url,quote,date_label:verifiedDate,deadline_label:verifiedDeadline,checked_at:result.checked_at});
   }
   if(result.items.length)result.status='verified_pages';
   else console.warn(JSON.stringify({event:'local-help-verification-empty',grounded:grounded.length,fetched:fetched.length,proposed:(response.result?.items||[]).length}));
   const value=result;cache.set(key,{value,expires:now()+6*3600000});if(cache.size>256)cache.delete(cache.keys().next().value);return value;
  })().then(value=>{cache.set(key,{value,expires:now()+6*3600000});if(cache.size>256)cache.delete(cache.keys().next().value);return value;});pending.set(key,work);try{return await work;}finally{pending.delete(key);}
 }
 return {search,agencies,getSuggestions:id=>{const r=suggestions.get(id);return r&&r.expires>now()?r.html:null;}};
}
module.exports={agencies,localOffices,createLocalHelp};
