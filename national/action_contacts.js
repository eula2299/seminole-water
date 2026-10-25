'use strict';
const {randomBytes}=require('node:crypto');
const https=require('node:https'),dns=require('node:dns/promises'),net=require('node:net');
const D=require('../public/water-actions-data');
const email=v=>typeof v==='string'&&v.length<=254&&/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(v)&&!/[\r\n]/.test(v)?v:'';
const host=u=>new URL(u).hostname.replace(/^www\./,'');
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!net.isIP(u.hostname)&&u.hostname.includes('.')?u.href:null;}catch{return null;}}
function publicIp(ip){if(net.isIP(ip)===6)return !/^(?:0|::|fc|fd|fe[89ab]|ff|2001:db8)/i.test(ip)&&!ip.includes('.');const p=ip.split('.').map(Number);return net.isIP(ip)===4&&![0,10,127].includes(p[0])&&p[0]<224&&!(p[0]===169&&p[1]===254)&&!(p[0]===172&&p[1]>=16&&p[1]<=31)&&!(p[0]===192&&[0,168].includes(p[1]))&&!(p[0]===100&&p[1]>=64&&p[1]<=127)&&!(p[0]===198&&[18,19].includes(p[1]));}
async function readPage(url,redirects=0){
 if(!safeUrl(url))throw Error('Invalid source');const ips=await dns.lookup(new URL(url).hostname,{all:true});if(!ips.length||ips.some(x=>!publicIp(x.address)))throw Error('Private source');
 // Pin the checked DNS answer for the connection, including TLS host verification.
 return new Promise((resolve,reject)=>{const ip=ips[0];const req=https.get(url,{lookup:(_h,opts,cb)=>opts.all?cb(null,[ip]):cb(null,ip.address,ip.family),headers:{Accept:'text/html','User-Agent':'IsMyWaterOK-ContactLookup/1.0'}},res=>{
  if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();let next;try{next=new URL(res.headers.location,url).href;}catch{return reject(Error('Bad redirect'));}if(redirects>=3||!safeUrl(next)||host(next)!==host(url))return reject(Error('Off-site redirect'));return resolve(readPage(next,redirects+1));}
  if(res.statusCode!==200||!/^text\/(html|plain)/i.test(res.headers['content-type']||'')){res.resume();return reject(Error('Source unavailable'));}
  let size=0,parts=[];res.on('data',b=>{size+=b.length;if(size>700000)res.destroy(Error('Source too large'));else parts.push(b);});res.on('error',reject);res.on('end',()=>resolve({url,html:Buffer.concat(parts).toString('utf8')}));
 });const timer=setTimeout(()=>req.destroy(Error('Source timed out')),4500);req.on('close',()=>clearTimeout(timer));req.on('error',reject);});
}
const decode=s=>String(s).replace(/&#(x[\da-f]+|\d+);?/gi,(_,v)=>String.fromCodePoint(Math.min(0x10ffff,v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v)))).replace(/&amp;/g,'&').replace(/&commat;/g,'@').replace(/&nbsp;/g,' ');
function extract(page){
 const html=page.html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' '),found=[],links=[];
 for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const href=decode(m[1]),label=decode(m[2].replace(/<[^>]+>/g,' ')).trim();
  if(/^mailto:/i.test(href)){let value;try{value=decodeURIComponent(href.slice(7).split('?')[0]);}catch{continue;}if(email(value)&&!/(?:privacy|webmaster|accessibility|press|media|noreply|no-reply|careers|recruit|security|abuse|librarian|geographic|\bgis\b)/i.test(value+' '+label))found.push({email:value,label});}
  else{try{const u=new URL(href,page.url);if(safeUrl(u.href)&&host(u.href)===host(page.url)&&!/geographic|\bgis\b|privacy|accessibility|press|media|careers/i.test(label+' '+u.pathname)&&(/water|drinking|testing|laboratory|customer.service/i.test(label+' '+u.pathname)||/^contact(?:\s+us|\s+information|\s+details)?$/i.test(label.trim()))&&!/[.#](pdf|jpg|png|zip)$/i.test(u.pathname))links.push(u.href);}catch{}}
 }
 const text=decode(html.replace(/<[^>]+>/g,' '));
 for(const m of text.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)){if(email(m[0])&&!/(privacy|webmaster|accessibility|press|media|noreply|careers|security|abuse|librarian|geographic|\bgis\b)/i.test(m[0]))found.push({email:m[0],label:''});}
 return {emails:[...new Map(found.map(x=>[x.email.toLowerCase(),x])).values()].slice(0,8),links:[...new Set(links)].slice(0,3)};
}
function createContactService({fetchPage=readPage,now=Date.now}={}){
 const reports=new Map(),cache=new Map();let active=0;
 function remember(data){for(const[k,v]of reports)if(v.expires<now())reports.delete(k);if(reports.size>=512)reports.delete(reports.keys().next().value);const token=randomBytes(24).toString('base64url');reports.set(token,{context:D.context(data),expires:now()+1800000});return token;}
 async function discover(source){
  if(!safeUrl(source.url))return [];
  const old=cache.get(source.url);if(old&&old.expires>now())return old.contacts;
  const contacts=[];try{const first=await fetchPage(source.url);const parsed=extract(first);const pages=[first];
   {const more=await Promise.allSettled(parsed.links.slice(0,2).map(x=>fetchPage(x)));for(const r of more)if(r.status==='fulfilled')pages.push(r.value);}
   for(const page of pages){const emails=extract(page).emails;for(const x of emails)contacts.push({name:source.title,email:x.email,source_url:page.url,source_label:'Published on the organization’s website',checked_at:new Date(now()).toISOString(),role:source.role||'water-help',phone:source.phone||null});}
  }catch{}
  if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(source.url,{contacts,expires:now()+(contacts.length?21600000:300000)});return contacts;
 }
 async function resolve(token,lane,goal){
  const entry=reports.get(token);if(!entry||entry.expires<now())return {status:'expired',contacts:[]};
  if(!Object.hasOwn(D.labels,lane))throw Error('Invalid help option');
  if(active>=6)return {status:'busy',contacts:[]};active++;
  try{const c=entry.context,plan=D.prepare(c,lane,{goal}),contacts=[];
   // A possible provider is never silently treated as a confirmed landlord.
   if(!c.private_well&&goal!=='repair')for(const p of c.provider_contacts||[]){if(email(p.email))contacts.push({name:p.name,email:p.email,source_url:p.source_url||null,source_label:'Public water-provider record '+(p.pwsid||''),role:'water-provider',ambiguous:c.provider_ambiguous,phone:p.phone||null});}
   let sources=lane==='afford'?plan.options.filter(x=>x.price===0||x.price===null||x===D.resources.repair):[];
   if(goal==='repair')sources=[D.resources.repair];
   if(lane!=='afford'||!sources.length)sources=[c.agency||D.resources.agency];
   // Do not crawl result PDFs, private addresses, or URLs supplied by the caller.
   sources=[...new Map(sources.filter(x=>safeUrl(x.url)).map(x=>[x.url,x])).values()].slice(0,3);
   const results=await Promise.allSettled(sources.map(discover));
   let discovered=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
   if(!discovered.length&&!contacts.length&&c.agency&&!sources.some(x=>x.url===c.agency.url)){sources.push(c.agency);discovered=await discover(c.agency);}
   const ordered=lane==='afford'?[...discovered,...contacts]:[...contacts,...discovered];
   const seen=new Map();for(const x of ordered)if(!seen.has(x.email.toLowerCase()))seen.set(x.email.toLowerCase(),{...x,recommended:false});const unique=[...seen.values()].slice(0,8);
   const preferred=lane==='afford'&&discovered.length?discovered:contacts.length?contacts:discovered;
   const top=preferred[0];if(top&&new Set(preferred.filter(x=>x.name===top.name).map(x=>x.email.toLowerCase())).size===1&&!top.ambiguous){const match=unique.find(x=>x.email===top.email);if(match)match.recommended=true;}
   return {status:unique.length?'found':'contact-page',contacts:unique,routes:sources.map(x=>({name:x.title,url:x.url,phone:x.phone||null})),note:lane==='rent'?'These are water-provider or water-help contacts, not a verified landlord.':null};
  }finally{active--;}
 }
 return {remember,resolve};
}
module.exports={createContactService,extract,email,safeUrl,publicIp};
