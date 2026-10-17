'use strict';
const http=require('node:http');
const {createEngine}=require('./service');
const {EvidenceError,REGION_CODES}=require('./evidence');
const {HTML,CLIENT}=require('./ui');
const {clientKey,readJson,HttpInputError}=require('./http_safety');
const seo=require('./seo');
function createServer({engine=createEngine(),maxConcurrent=24,trustProxy=false,metrics=null,voice=null,testingCatalog=require('./testing_catalog')}={}){
 const buckets=new Map();let active=0;
 const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://www.ismywaterok.com wss://ismywaterok.com https://*.google-analytics.com https://analytics.google.com https://www.googletagmanager.com; img-src 'self' https://*.google-analytics.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'Permissions-Policy':'geolocation=(), camera=(), microphone=(self)'};
 function send(res,status,body,type='application/json; charset=utf-8',headers={}){res.writeHead(status,{...security,'Content-Type':type,...headers});res.end(type.startsWith('application/json')?JSON.stringify(body):body);}
 function allowed(req){const now=Date.now();for(const[k,v]of buckets)if(v.expires<now)buckets.delete(k);const key=clientKey(req,trustProxy);if(!buckets.has(key)&&buckets.size>=10000)return false;const b=buckets.get(key)||{expires:now+60000,count:0};b.count++;buckets.set(key,b);return b.count<=30;}
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   const voiceFiles={'/water-actions-data.js':'application/javascript; charset=utf-8','/water-actions.js':'application/javascript; charset=utf-8','/water-actions.css':'text/css; charset=utf-8','/water-voice.js':'application/javascript; charset=utf-8','/water-voice-worklet.js':'application/javascript; charset=utf-8','/water-voice.css':'text/css; charset=utf-8'};
   if(req.method==='GET'&&voiceFiles[u.pathname])return send(res,200,require('node:fs').readFileSync(require('node:path').join(__dirname,'..','public',u.pathname.slice(1)),'utf8'),voiceFiles[u.pathname],{'Cache-Control':'public, max-age=300'});
   if(req.method==='GET'&&u.pathname==='/api/national/voice-config')return send(res,200,voice?.config()||{enabled:false});
   if(req.method==='GET'&&(u.pathname==='/national'||u.pathname==='/national/')){res.writeHead(301,{Location:'/',...security});return res.end();}
   if(req.method==='GET'&&u.pathname==='/'){return send(res,200,HTML,'text/html; charset=utf-8',{'Cache-Control':'public, max-age=300, stale-while-revalidate=3600'});}
   if(req.method==='GET'&&u.pathname==='/water-details'){res.setHeader('X-Robots-Tag','noindex, nofollow');return send(res,200,HTML,'text/html; charset=utf-8');}
   if(req.method==='GET'&&u.pathname==='/robots.txt')return send(res,200,seo.robots(),'text/plain; charset=utf-8',{'Cache-Control':'public, max-age=3600'});
   if(req.method==='GET'&&u.pathname==='/sitemap.xml')return send(res,200,seo.sitemap(),'application/xml; charset=utf-8',{'Cache-Control':'public, max-age=3600'});
   if(req.method==='GET'&&seo.GUIDES[u.pathname])return send(res,200,seo.guideHtml(u.pathname),'text/html; charset=utf-8',{'Cache-Control':'public, max-age=1800, stale-while-revalidate=86400'});
   if(req.method==='GET'&&u.pathname==='/national-client.js')return send(res,200,CLIENT,'application/javascript; charset=utf-8',{'Cache-Control':'public, max-age=300, stale-while-revalidate=3600'});
   if(req.method==='GET'&&u.pathname==='/healthz')return send(res,200,{process:'up',national_data_ready:false});
   if(req.method==='GET'&&u.pathname==='/api/national/impact')return send(res,200,metrics?await metrics.totals():{savings:null,analytics:null});
   if(req.method==='GET'&&u.pathname==='/api/national/testing-options'){
    if(!allowed(req))return send(res,429,{message:'Please try again shortly.'});
    const state=(u.searchParams.get('state')||'').toUpperCase(),city=(u.searchParams.get('city')||'').slice(0,100),supply=u.searchParams.get('supply')||'unknown';
    if(!REGION_CODES.includes(state)||!['public','private-well','unknown'].includes(supply))return send(res,400,{message:'Choose your U.S. state and water source.'});
    const data={address:{status:'not-verified',state,city},supply:{type:supply,evidence:'user-reported'},systems:[],provider:{candidates:[]},current_advisories:{records:[]}};
    data.resident_report={private_well:supply==='private-well',findings:[],access_plan:require('./access_plan').buildAccessPlan(data,{privateWell:supply==='private-well'})};
    if(voice){const token=voice.remember(data);if(token)data.voice_token=token;}
    testingCatalog.refresh().catch(()=>{});return send(res,200,data);
   }
   if(req.method==='GET'&&u.pathname==='/api/national/status')return send(res,200,await engine.status());
   if(req.method!=='POST'||u.pathname!=='/api/national/lookup')return send(res,404,{message:'Not found.'});
   if(req.headers.origin){let host;try{const origin=new URL(req.headers.origin);if(!['https:','http:'].includes(origin.protocol))throw new Error();host=origin.host;}catch{return send(res,403,{message:'Invalid origin.'});}if(host!==req.headers.host)return send(res,403,{message:'Origin not permitted.'});}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(res,415,{message:'Send application/json.'});
   if(!allowed(req)||active>=maxConcurrent){res.setHeader('Retry-After','60');return send(res,429,{message:'Query capacity reached. Try again later.'});}
   active++;
   // This handler is also mounted on the gateway, so bound its body-read time
   // independently of the standalone server's transport settings.
   const bodyTimer=setTimeout(()=>req.destroy(),10000);bodyTimer.unref();
   try{const body=await readJson(req,8192);clearTimeout(bodyTimer);const result=await engine.lookup(body);testingCatalog.refresh().catch(()=>{});if(metrics)try{await metrics.record(result.resident_report,body.request_id);}catch{console.error("Potential savings could not be recorded");}if(voice){const token=voice.remember(result);if(token)result.voice_token=token;}return send(res,200,result);}finally{clearTimeout(bodyTimer);active--;}
  }catch(e){const expected=e instanceof EvidenceError||e instanceof HttpInputError;if(!res.headersSent)send(res,expected?e.status:500,{error:expected?e.code:'INTERNAL_ERROR',message:expected?e.message:'Lookup failed. No water-safety conclusion was made.'});else res.end();}
 });
 server.on('upgrade',(req,socket,head)=>{if(!voice?.upgrade(req,socket,head))socket.destroy();});
 server.headersTimeout=10000;server.requestTimeout=25000;server.keepAliveTimeout=5000;
 return server;
}
if(require.main===module){const port=Number(process.env.NATIONAL_PORT||process.env.PORT||3001);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');const server=createServer();server.listen(port,'0.0.0.0',()=>console.log(`National evidence service on ${port}; full coverage not established.`));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),25000).unref();});}
module.exports={createServer};
