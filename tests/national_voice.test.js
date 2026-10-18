'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {EventEmitter,once}=require('node:events');
const {WebSocket}=require('ws');
const {createVoiceService,voiceReport}=require('../national/voice');
const sample={resident_report:{address:'PRIVATE ADDRESS',generated_at:'2026-10-17',findings:[{name:'Arsenic',result:'2–4 ug/L',scope:'system-monitoring',detected:true,first_sample:'2022-01-01',last_sample:'2024-12-01',reported_results:9,non_detects:2,health:{text:'Public educational context',private_name:'SECRET'},comparison:{reference_text:'10 ug/L',description:'At or below reference',private_income:12345}}],access_plan:{personalized:{address:'PRIVATE ADDRESS'},income:12345},advisories:{records:[]}},address:{latitude:30,longitude:-81},private_name:'SECRET'};
class Upstream extends EventEmitter{constructor(){super();this.readyState=1;this.bufferedAmount=0;this.sent=[];queueMicrotask(()=>this.emit('open'));}send(value){this.sent.push(JSON.parse(value));}close(){this.readyState=3;this.emit('close');}terminate(){this.close();}receive(value){this.emit('message',Buffer.from(JSON.stringify(value)));}}
async function harness(t,options={}){const ups=[];const voice=createVoiceService({env:{GEMINI_VOICE_ENABLED:'true',GEMINI_API_KEY:'TEST-ONLY'},upstreamFactory:()=>{const up=new Upstream();ups.push(up);return up;},...options});const server=http.createServer();server.on('upgrade',(r,s,h)=>voice.upgrade(r,s,h));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;const clients=[];t.after(async()=>{clients.forEach(c=>c.terminate());voice.close();await new Promise(resolve=>server.close(resolve));});return {voice,ups,origin,async client(){const client=new WebSocket(origin.replace('http:','ws:')+'/api/national/voice',{origin});clients.push(client);await once(client,'open');return client;}};}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<50;i++){if(fn())return;await sleep(5);}throw Error('Timed out');}
test('voice context keeps measurements and uncertainty without household identifiers',()=>{const r=voiceReport(sample),raw=JSON.stringify(r);assert.equal(r.findings[0].scope,'system-monitoring');assert.equal(r.findings[0].result,'2–4 ug/L');assert.equal(r.findings[0].non_detects,2);assert.equal(r.findings[0].first_sample,'2022-01-01');assert.doesNotMatch(raw,/PRIVATE|SECRET|12345|latitude|longitude|private_name/);assert.match(r.scope_note,/not a laboratory test/);});
test('voice stays disabled without both configuration and a key',()=>{for(const env of [{},{GEMINI_API_KEY:'x'},{GEMINI_VOICE_ENABLED:'true'}]){const s=createVoiceService({env});assert.equal(s.config().enabled,false);assert.equal(s.remember(sample),null);s.close();}});
test('live bridge owns report instructions and forwards only microphone PCM',async t=>{const h=await harness(t),token=h.voice.remember(sample),c=await h.client();c.send(JSON.stringify({type:'start',token,consent:true,model:'evil',report:{address:'ATTACK'}}));await until(()=>h.ups[0]?.sent.length);const up=h.ups[0],setup=up.sent[0].setup;assert.equal(setup.model,'models/gemini-3.1-flash-live-preview');assert.match(JSON.stringify(setup),/2–4 ug/);assert.doesNotMatch(JSON.stringify(setup),/PRIVATE|ATTACK|SECRET|evil/);let received=[];c.on('message',m=>received.push(JSON.parse(m)));up.receive({setupComplete:{}});await until(()=>received.some(m=>m.type==='ready'));assert.equal(received.find(m=>m.type==='ready').seconds,900);assert.equal(h.voice.config().duration_seconds,900);c.send(Buffer.alloc(4096));await until(()=>up.sent.some(m=>m.realtimeInput?.audio));assert.equal(up.sent.find(m=>m.realtimeInput?.audio).realtimeInput.audio.mimeType,'audio/pcm;rate=16000');up.receive({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AAAAAA=='}}]},outputTranscription:{text:'An explanation'},interrupted:true}});await until(()=>received.some(m=>m.type==='audio'));assert.ok(received.some(m=>m.type==='caption'));assert.ok(received.some(m=>m.type==='interrupted'));c.send(JSON.stringify({setup:{model:'bad'}}));await once(c,'close');assert.equal(up.readyState,3);});
test('expired reports and missing consent never open a provider call',async t=>{let now=100;const h=await harness(t,{now:()=>now});const token=h.voice.remember(sample);for(const message of [{type:'start',token,consent:false},null]){const c=await h.client();c.send(JSON.stringify(message));await once(c,'close');}now+=1800001;const c=await h.client();c.send(JSON.stringify({type:'start',token,consent:true}));await once(c,'close');assert.equal(h.ups.length,0);});
test('server ends calls at the time limit and releases the report',async t=>{const h=await harness(t,{durationMs:30}),token=h.voice.remember(sample),c=await h.client();c.send(JSON.stringify({type:'start',token,consent:true}));await until(()=>h.ups.length);h.ups[0].receive({setupComplete:{}});await once(c,'close');assert.equal(h.ups[0].readyState,3);assert.equal(h.voice._reports.get(token).active,false);});
test('daily capacity fails closed without creating paid fallback calls',async t=>{const h=await harness(t,{maxDaily:0}),token=h.voice.remember(sample),c=await h.client();c.send(JSON.stringify({type:'start',token,consent:true}));const [m]=await once(c,'message');assert.match(JSON.parse(m).message,/Calls are paused for today/);await once(c,'close');assert.equal(h.ups.length,0);});
test('cross-origin websocket connections are rejected',async t=>{const h=await harness(t);const c=new WebSocket(h.origin.replace('http:','ws:')+'/api/national/voice',{origin:'https://attacker.example'});const [error]=await once(c,'error');assert.match(error.message,/403/);assert.equal(h.ups.length,0);});

test('microphone resampling preserves one second and clips PCM safely across device rates',()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 for(const rate of [16000,44100,48000]){let Processor;const packets=[];const sandbox={AudioWorkletProcessor:class{constructor(){this.port={postMessage:b=>packets.push(new Int16Array(b))};}},sampleRate:rate,registerProcessor:(name,p)=>{Processor=p;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/water-voice-worklet.js'),'utf8'),sandbox);
 const p=new Processor();for(let left=rate;left>0;left-=128)p.process([[new Float32Array(Math.min(128,left)).fill(2)]]);
 assert.equal(packets.reduce((n,a)=>n+a.length,0)+p.offset,16000);assert.ok(packets.every(a=>a.every(x=>x===32767)));
 }
});

test('voice tool calls create reviewable drafts and acknowledge only preparation',async t=>{const h=await harness(t),token=h.voice.remember(sample),c=await h.client();const received=[];c.on('message',m=>received.push(JSON.parse(m)));c.send(JSON.stringify({type:'start',token,consent:true}));await until(()=>h.ups[0]?.sent.length);const up=h.ups[0];assert.equal(up.sent[0].setup.tools[0].functionDeclarations.length,2);up.receive({setupComplete:{}});up.receive({toolCall:{functionCalls:[{id:'draft-1',name:'prepare_water_action',args:{lane:'rent',subject:'Testing request',draft_body:'Please arrange an arsenic test.'}}]}});await until(()=>received.some(x=>x.type==='action'));assert.equal(received.find(x=>x.type==='action').action.lane,'rent');const response=up.sent.find(x=>x.toolResponse).toolResponse.functionResponses[0];assert.equal(response.response.not_sent,true);assert.equal(response.response.prepared,true);c.send(JSON.stringify({type:'focus',lane:'followup'}));await until(()=>up.sent.some(x=>JSON.stringify(x).includes('Nobody is answering me')));});

test('provider refresh resumes the same call without a new greeting or a fresh time budget',async t=>{
 let now=1000;const h=await harness(t,{now:()=>now}),token=h.voice.remember(sample),c=await h.client(),received=[];
 c.on('message',m=>received.push(JSON.parse(m)));c.send(JSON.stringify({type:'start',token,consent:true}));
 await until(()=>h.ups[0]?.sent.length);const first=h.ups[0];
 assert.deepEqual(first.sent[0].setup.sessionResumption,{});assert.deepEqual(first.sent[0].setup.contextWindowCompression,{slidingWindow:{}});
 first.receive({setupComplete:{}});await until(()=>received.some(m=>m.type==='ready'));
 now+=600000;first.receive({sessionResumptionUpdate:{resumable:true,newHandle:'PRIVATE-RESUME-HANDLE'}});first.receive({goAway:{timeLeft:'30s'}});
 await until(()=>h.ups[1]?.sent.length);const second=h.ups[1];assert.equal(first.readyState,3);assert.equal(second.sent[0].setup.sessionResumption.handle,'PRIVATE-RESUME-HANDLE');
 second.receive({setupComplete:{}});await until(()=>received.filter(m=>m.type==='ready').length===2);
 assert.equal(received.filter(m=>m.type==='ready')[1].seconds,300);assert.equal(second.sent.filter(m=>m.clientContent).length,0);
 assert.doesNotMatch(JSON.stringify(received),/PRIVATE-RESUME-HANDLE/);assert.equal(h.voice._reports.get(token).calls,1);
 c.send(Buffer.alloc(4096));await until(()=>second.sent.some(m=>m.realtimeInput?.audio));
});

test('a resumed connection still ends at the original call deadline',async t=>{
 const h=await harness(t,{durationMs:120}),token=h.voice.remember(sample),c=await h.client();
 c.send(JSON.stringify({type:'start',token,consent:true}));await until(()=>h.ups[0]?.sent.length);
 h.ups[0].receive({setupComplete:{}});h.ups[0].receive({sessionResumptionUpdate:{resumable:true,newHandle:'resume'}});h.ups[0].receive({goAway:{}});
 await until(()=>h.ups[1]?.sent.length);h.ups[1].receive({setupComplete:{}});await once(c,'close');
 assert.equal(h.ups[1].readyState,3);assert.equal(h.voice._reports.get(token).active,false);
});
