'use strict';
const https=require('node:https'),dns=require('node:dns/promises');
const {safeUrl,publicIp}=require('../national/action_contacts');
const decode=s=>String(s).replace(/&#(x[\da-f]+|\d+);?/gi,(_,v)=>String.fromCodePoint(Math.min(0x10ffff,v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v)))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ');
const plain=html=>decode(String(html).replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
async function page(url,depth=0){
 if(!safeUrl(url)||depth>3)throw Error('SOURCE_ROUTE');
 const ips=await dns.lookup(new URL(url).hostname,{all:true});if(!ips.length||ips.some(i=>!publicIp(i.address)))throw Error('SOURCE_ROUTE');
 return new Promise((resolve,reject)=>{
  const ip=ips[0];const req=https.get(url,{lookup:(_h,opts,cb)=>opts.all?cb(null,[ip]):cb(null,ip.address,ip.family),headers:{Accept:'text/html,text/plain','User-Agent':'IsMyWaterOK-HelpFinder/1.0'}},res=>{
   if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();let next;try{next=new URL(res.headers.location,url).href;}catch{return reject(Error('SOURCE_ROUTE'));}return resolve(page(next,depth+1));}
   if(res.statusCode!==200||!/^text\/(html|plain)/i.test(res.headers['content-type']||'')){res.resume();return reject(Error('SOURCE_CONTENT'));}
   let size=0,parts=[];res.on('data',b=>{size+=b.length;if(size>900000)res.destroy(Error('SOURCE_LIMIT'));else parts.push(b);});res.on('error',reject);res.on('end',()=>{const html=Buffer.concat(parts).toString('utf8');resolve({url,text:plain(html),title:plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||new URL(url).hostname)});});
  });const timer=setTimeout(()=>req.destroy(Error('SOURCE_TIME')),6500);req.on('close',()=>clearTimeout(timer));req.on('error',reject);
 });
}
module.exports={page,plain};
