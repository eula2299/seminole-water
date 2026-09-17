'use strict';
const http=require('node:http');
const {createEngine}=require('./service');
const {EvidenceError,REGION_CODES}=require('./evidence');
const CLIENT=`'use strict';
const form=document.querySelector('form'),results=document.querySelector('#results'),message=document.querySelector('#message'),button=document.querySelector('button');
function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
function section(title){const n=document.createElement('section');n.className='card';n.append(node('h2',title));results.append(n);return n;}
form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;results.replaceChildren();message.textContent='Checking official address and water-system records…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),24000);
try{const r=await fetch('/api/national/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form))),signal:controller.signal});const data=await r.json();if(!r.ok)throw new Error(data.message||'Lookup failed.');
let box=section('Household water safety: not determined');box.append(node('p','This lookup does not contain an authenticated laboratory sample from your tap. Utility records and mapped provider candidates are different evidence.'));
box=section('Address and provider evidence');box.append(node('p','Address status: '+data.address.status));if(data.address.matched_address)box.append(node('p',data.address.matched_address));if(data.address.precision)box.append(node('p','Position: '+data.address.precision));
for(const p of data.provider.candidates)box.append(node('p',p.name+' ('+p.pwsid+'): '+p.provenance+'. Household connection not verified.'));
if(!data.provider.candidates.length)box.append(node('p','No mapped provider was established. This does not prove that the property uses a private well.'));
if(data.provider.user_selected_pwsid)box.append(node('p','User-selected PWSID: '+data.provider.user_selected_pwsid));if(data.provider.conflict)box.append(node('p','The selected PWSID conflicts with the mapped candidates. Confirm it with the utility.'));
box=section('Official water-system records');for(const s of data.systems){box.append(node('h3',s.pwsid+' — '+s.status));const detail=document.createElement('details');detail.append(node('summary','Original system records and provenance'),node('pre',JSON.stringify(s,null,2)));box.append(detail);}if(!data.systems.length)box.append(node('p','No federal system records were retrieved.'));
box=section('Known gaps');for(const gap of data.gaps)box.append(node('p',gap));
box=section('Evidence audit');for(const a of data.audit)box.append(node('p',a.agent+': '+a.status+'; retrieved '+a.retrieved_at+(a.error_code?' ('+a.error_code+')':'')));
const detail=document.createElement('details');detail.append(node('summary','Complete machine-readable response'),node('pre',JSON.stringify(data,null,2)));box.append(detail);message.textContent='Source checks complete. Review their scope and limitations.';
}catch(e){message.textContent=(e.name==='AbortError'?'The request timed out.':e.message)+' No water-safety finding was made.';}finally{clearTimeout(timer);button.disabled=false;}});
`;
const HTML=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>National water evidence | IsMyWaterOK</title><style>
*{box-sizing:border-box}body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#eff4f3;color:#183841}main{max-width:1020px;margin:auto;padding:36px 24px}h1{font-size:clamp(30px,5vw,50px);line-height:1.15;margin:16px 0}h2{font-size:23px}header{border-bottom:1px solid #bdd2ce;margin-bottom:24px;padding-bottom:20px}.brand{font-weight:750;letter-spacing:.06em;color:#086b61}.card{background:white;border:1px solid #d5e2df;border-radius:8px;padding:24px;margin:22px 0}.note{background:#fff2d4;padding:16px 20px;border-left:4px solid #ad7b23}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}label{font-size:14px;font-weight:650}input,select,button{font:inherit}input,select{display:block;width:100%;border:1px solid #93b0aa;border-radius:5px;padding:11px;margin-top:6px}button{background:#086b61;color:white;border:0;border-radius:5px;padding:13px 23px;font-weight:650}button:disabled{opacity:.5}.muted{color:#536b70;font-size:14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;font-size:12px}summary{cursor:pointer;color:#086b61}footer{font-size:13px;border-top:1px solid #bdd2ce;padding-top:20px}@media(max-width:620px){.grid{grid-template-columns:1fr}main{padding:24px 16px}.card{padding:20px}}</style><script defer src="/national-client.js"></script></head><body><main>
<header><div class="brand">IsMyWaterOK</div><h1>National water evidence</h1><p>Find potential water providers and their official system records, with sources and uncertainty kept visible.</p></header>
<aside class="note"><strong>National expansion is not complete.</strong> This interface does not yet include nationwide laboratory results, current advisories, private-well inventories, or validated predictive models. It is not a household water-safety certification.</aside>
<form class="card"><h2>Address or known public water system</h2><div class="grid"><label>Street address<input name="street" maxlength="180" autocomplete="street-address"></label><label>City<input name="city" maxlength="100" autocomplete="address-level2"></label><label>State or territory<select name="state" required><option value="">Select</option>${REGION_CODES.map(x=>'<option>'+x+'</option>').join('')}</select></label><label>ZIP code<input name="zip" maxlength="10" autocomplete="postal-code" pattern="[0-9]{5}(-[0-9]{4})?"></label><label>Water supply<select name="supply_type"><option value="unknown">Unknown</option><option value="public">Public water system</option><option value="private-well">Private well</option></select></label><label>Complete PWSID, when known<input name="pwsid" maxlength="9" pattern="[A-Za-z0-9]{9}" placeholder="Optional: nine characters"></label></div><p class="muted">An address is sent to the Census geocoder, and its coordinates to EPA's mapping service. This service does not persist addresses or send them to an AI model. A PWSID lookup can be made without a street address.</p><button type="submit">Find evidence</button><p id="message" role="status" aria-live="polite"></p></form><div id="results" aria-live="polite"></div><footer>Check current advisories with your utility or health department. Missing records are not evidence of safe water.</footer></main></body></html>`;
function createServer({engine=createEngine(),maxConcurrent=8}={}){
 const buckets=new Map();let active=0;
 const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'Permissions-Policy':'geolocation=(), camera=(), microphone=()'};
 function send(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{...security,'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(body):body);}
 function allowed(req){const now=Date.now();for(const[k,v]of buckets)if(v.expires<now)buckets.delete(k);const key=req.socket.remoteAddress||'unknown';if(!buckets.has(key)&&buckets.size>=10000)return false;const b=buckets.get(key)||{expires:now+60000,count:0};b.count++;buckets.set(key,b);return b.count<=30;}
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&['/','/national','/national/'].includes(u.pathname))return send(res,200,HTML,'text/html; charset=utf-8');
   if(req.method==='GET'&&u.pathname==='/national-client.js')return send(res,200,CLIENT,'application/javascript; charset=utf-8');
   if(req.method==='GET'&&u.pathname==='/healthz')return send(res,200,{process:'up',national_data_ready:false});
   if(req.method==='GET'&&u.pathname==='/api/national/status')return send(res,200,engine.status());
   if(req.method!=='POST'||u.pathname!=='/api/national/lookup')return send(res,404,{message:'Not found.'});
   if(req.headers.origin){let host;try{const origin=new URL(req.headers.origin);if(!['https:','http:'].includes(origin.protocol))throw new Error();host=origin.host;}catch{return send(res,403,{message:'Invalid origin.'});}if(host!==req.headers.host)return send(res,403,{message:'Origin not permitted.'});}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(res,415,{message:'Send application/json.'});
   if(!allowed(req)||active>=maxConcurrent){res.setHeader('Retry-After','60');return send(res,429,{message:'Query capacity reached. Try again later.'});}
   active++;
   try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192)throw new EvidenceError('BODY_TOO_LARGE','Request exceeds the 8 KiB limit.',413);chunks.push(chunk);}let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new EvidenceError('BAD_JSON','Invalid JSON.',400);}return send(res,200,await engine.lookup(body));}finally{active--;}
  }catch(e){if(!res.headersSent)send(res,e instanceof EvidenceError?e.status:500,{error:e instanceof EvidenceError?e.code:'INTERNAL_ERROR',message:e instanceof EvidenceError?e.message:'Lookup failed. No water-safety conclusion was made.'});else res.end();}
 });
 server.headersTimeout=10000;server.requestTimeout=25000;server.keepAliveTimeout=5000;
 return server;
}
if(require.main===module){const port=Number(process.env.NATIONAL_PORT||process.env.PORT||3001);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');const server=createServer();server.listen(port,'0.0.0.0',()=>console.log(`National evidence service on ${port}; full coverage not established.`));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),25000).unref();});}
module.exports={createServer};
