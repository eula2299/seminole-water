const http=require('http');
const PORT=process.env.LT_PORT||3050;
const CONC=Number(process.env.LT_CONC||50);
const TOTAL=Number(process.env.LT_TOTAL||600);
const cities=['Sanford','Lake Mary','Oviedo','Longwood','Casselberry','Altamonte Springs'];
let done=0,ok=0,rate=0,err=0,inflight=0;const lat=[];
const t0=Date.now();
function one(){
  if(done+inflight>=TOTAL)return;
  inflight++;
  const body=JSON.stringify({address:`${100+Math.floor(Math.random()*20)} Main St`,city:cities[Math.floor(Math.random()*cities.length)],online_address_search:false});
  const s=Date.now();
  const req=http.request({host:'127.0.0.1',port:PORT,path:'/api/lookup',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
    res.resume();res.on('end',()=>{
      lat.push(Date.now()-s);
      if(res.statusCode===200)ok++;else if(res.statusCode===429)rate++;else err++;
      inflight--;done++;next();
    });
  });
  req.on('error',()=>{err++;inflight--;done++;next();});
  req.end(body);
}
function next(){ if(done>=TOTAL)return finish(); while(inflight<CONC&&done+inflight<TOTAL)one(); }
function finish(){
  if(finish.called)return;finish.called=true;
  const el=(Date.now()-t0)/1000;lat.sort((a,b)=>a-b);
  const p=q=>lat[Math.floor(lat.length*q)]||0;
  console.log(`  requests:      ${done} in ${el.toFixed(1)}s  (${(done/el).toFixed(0)} req/s)`);
  console.log(`  200 OK:        ${ok}`);
  console.log(`  429 limited:   ${rate}   <- rate limiter working`);
  console.log(`  errors/5xx:    ${err}`);
  console.log(`  latency p50:   ${p(.5)}ms   p95: ${p(.95)}ms   p99: ${p(.99)}ms   max: ${lat[lat.length-1]}ms`);
  process.exit(err>0?1:0);
}
next();
