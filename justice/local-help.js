'use strict';
const crypto=require('node:crypto');
const catalog=require('./agencies.json');
const {page,plain}=require('./public-pages');
const clean=(v,n=120)=>typeof v==='string'?v.trim().replace(/[\x00-\x1f]/g,' ').slice(0,n):'';
const normalizeUrl=v=>{try{const u=new URL(v);u.hash='';return u.href;}catch{return '';}};
function agencies({state='',tribal=false}={}){
 const code=clean(state,2).toUpperCase(),region=catalog.jurisdictions.find(r=>r.code===code);
 return {checked_at:catalog.checked_at,jurisdictions:catalog.jurisdictions.map(r=>({code:r.code,name:r.name})),region:region||null,tribal:tribal?catalog.tribal_directory:null,tribes:tribal?catalog.tribes:[]};
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
   const direct=agencies({state}),result={...direct,city,kind,items:[],checked_at:new Date(now()).toISOString(),status:'official_routes',suggestions:null};
   if(!ai?.enabled)return result;
   let response;
   try{response=await ai.discover({city,state,kind,language,official:direct.region.routes});}catch{return result;}
   result.suggestions=suggestion(response.grounding?.searchEntryPoint?.renderedContent);
   const grounded=(response.grounding?.groundingChunks||[]).map(r=>r.web).filter(r=>r&&/^https:\/\//.test(r.uri)).slice(0,8);
   if(!grounded.length)return result;
   const pages=await Promise.allSettled(grounded.map(async source=>({source,page:await readPage(source.uri)})));
   const fetched=pages.filter(r=>r.status==='fulfilled').map(r=>r.value);
   const known=new Set(Object.values(direct.region.routes).map(r=>new URL(r.url).hostname));
   const permitted=host=>host.endsWith('.gov')||host.endsWith('.us')||known.has(host)||['211.org','www.211.org','lsc.gov','www.lsc.gov','rd.usda.gov'].includes(host);
   for(const item of (response.result?.items||[]).slice(0,8)){
    const matched=fetched.find(r=>normalizeUrl(r.page.url)===normalizeUrl(item.url)||normalizeUrl(r.source.uri)===normalizeUrl(item.url));
    if(!matched||!permitted(new URL(matched.page.url).hostname))continue;
    const quote=plain(clean(item.quote,550));
    if(quote.length<15||!matched.page.text.toLowerCase().includes(quote.toLowerCase()))continue;
    const dateLabel=clean(item.date_label,70),deadline=clean(item.deadline_label,100);
    const verifiedDate=dateLabel&&quote.includes(dateLabel)?dateLabel:null;
    const verifiedDeadline=deadline&&quote.includes(deadline)?deadline:null;
    if(result.items.some(i=>i.url===matched.page.url))continue;
    result.items.push({title:matched.page.title.slice(0,200),url:matched.page.url,quote,date_label:verifiedDate,deadline_label:verifiedDeadline,checked_at:result.checked_at});
   }
   if(result.items.length)result.status='verified_pages';
   const value=result;cache.set(key,{value,expires:now()+6*3600000});if(cache.size>256)cache.delete(cache.keys().next().value);return value;
  })().then(value=>{cache.set(key,{value,expires:now()+6*3600000});if(cache.size>256)cache.delete(cache.keys().next().value);return value;});pending.set(key,work);try{return await work;}finally{pending.delete(key);}
 }
 return {search,agencies,getSuggestions:id=>{const r=suggestions.get(id);return r&&r.expires>now()?r.html:null;}};
}
module.exports={agencies,createLocalHelp};
