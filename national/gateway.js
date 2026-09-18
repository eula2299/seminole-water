'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {fork}=require('node:child_process');
const {createApplication}=require('./application');
const {EvidenceError}=require('./evidence');
const {createContext}=require('./context');
const STATIC={'/':'index.html','/national':'index.html','/national/':'index.html','/national-app.js':'app.js','/national-style.css':'style.css'};
function createGateway({engine=createApplication({context:createContext()}),legacyPort=8081,publicDir=path.join(__dirname,'web'),maxConcurrent=8,trustProxy=false}={}){
 const buckets=new Map();let active=0;
 function security(res){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");}
 function json(res,code,value){if(res.headersSent||res.destroyed)return;security(res);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
 function allowed(req){const now=Date.now();for(const[k,v]of buckets)if(v.until<=now)buckets.delete(k);const key=trustProxy?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim():req.socket.remoteAddress;if(buckets.size>=10000&&!buckets.has(key))return false;const b=buckets.get(key)||{until:now+60000,n:0};b.n++;buckets.set(key,b);return b.n<=30;}
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname==='/healthz'&&req.method==='GET')return json(res,200,{process:'up',version:'national-production/1',source_data_health:'see-/api/national/status'});
   if(STATIC[u.pathname]&&['GET','HEAD'].includes(req.method)){
    const file=STATIC[u.pathname];security(res);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
    if(req.method==='HEAD')return res.end();return fs.createReadStream(path.join(publicDir,file)).on('error',()=>json(res,503,{message:'Interface unavailable.'})).pipe(res);
   }
   if(u.pathname.startsWith('/api/national/')){
    if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{return json(res,403,{message:'Invalid origin.'});}if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host)return json(res,403,{message:'Origin not permitted.'});}
    if(!allowed(req)){res.setHeader('Retry-After','60');return json(res,429,{message:'Too many requests. Try again after one minute.'});}
    if(u.pathname==='/api/national/status'&&req.method==='GET')return json(res,200,await engine.status());
    if(u.pathname!=='/api/national/lookup'||req.method!=='POST')return json(res,404,{message:'Not found.'});
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return json(res,415,{message:'Send application/json.'});
    if(active>=maxConcurrent){res.setHeader('Retry-After','10');return json(res,503,{message:'Evidence sources are busy. Try again shortly.'});}
    active++;
    try{let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>8192)throw new EvidenceError('BODY_TOO_LARGE','Request exceeds 8 KiB.',413);parts.push(chunk);}let input;try{input=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new EvidenceError('BAD_JSON','Invalid JSON.',400);}return json(res,200,await engine.lookup(input));}finally{active--;}
   }
   const forward={...req.headers};
   if(!trustProxy){delete forward['x-forwarded-host'];delete forward['x-forwarded-for'];delete forward['x-forwarded-proto'];}
   const upstreamPath=['/seminole','/seminole/'].includes(u.pathname)?'/'+u.search:req.url;
   const upstream=http.request({hostname:'127.0.0.1',port:legacyPort,path:upstreamPath,method:req.method,headers:forward},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res);});
   upstream.setTimeout(60000,()=>upstream.destroy(new Error('Legacy request timeout')));upstream.on('error',()=>json(res,502,{message:'Local application unavailable. Try again shortly.'}));req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);
  }catch(e){json(res,e instanceof EvidenceError?e.status:502,{error:e instanceof EvidenceError?e.code:'EVIDENCE_UNAVAILABLE',message:e instanceof EvidenceError?e.message:'Evidence is temporarily unavailable. No water-safety conclusion was made.'});}
 });
 server.headersTimeout=10000;server.requestTimeout=45000;server.keepAliveTimeout=5000;
 return server;
}
if(require.main===module){
 const port=Number(process.env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65533)throw new Error('Invalid port');
 const child=fork(path.join(__dirname,'../platform.js'),[],{env:{...process.env,PORT:String(port+1),INTERNAL_APP_PORT:String(port+2)},stdio:'inherit'});
 const server=createGateway({legacyPort:port+1,trustProxy:process.env.TRUST_PROXY==='true'});let ending=false;
 function stop(code){if(ending)return;ending=true;server.close();child.kill('SIGTERM');setTimeout(()=>process.exit(code),1500).unref();}
 child.on('error',()=>stop(1));child.on('exit',code=>{if(!ending)stop(code||1);});server.on('error',()=>stop(1));for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>stop(0));
 server.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'national-gateway-ready',port,legacy_path:'/seminole',warehouse_configured:!!process.env.WAREHOUSE_URL})));
}
module.exports={createGateway};
