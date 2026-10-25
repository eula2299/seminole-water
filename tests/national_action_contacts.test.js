'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createContactService,extract,publicIp,email}=require('../national/action_contacts');
const D=require('../public/water-actions-data');
const report={resident_report:{address:'123 Example Street, Example, FL',providers:[{name:'Example Water'}],findings:[{name:'Arsenic',result:'2 ug/L',scope:'system-monitoring'}],access_plan:{personalized:{state:'FL',provider:'Example Water'},provider_contacts:[{name:'Example Water',pwsid:'FL123',email:'water@example.gov'}],what_to_ask_for:[{name:'Arsenic'}],option_inventory:{}}}};
test('published provider contact is recommended without claiming to be the landlord',async()=>{
 const service=createContactService({fetchPage:async()=>{throw Error('offline')}});const r=await service.resolve(service.remember(report),'rent');
 assert.equal(r.contacts[0].email,'water@example.gov');assert.equal(r.contacts[0].recommended,true);assert.match(r.note,/not a verified landlord/);assert.doesNotMatch(JSON.stringify(r),/123 Example/);
});
test('contact lookup reads official pages and keeps email source proof',async()=>{
 const data=structuredClone(report);data.resident_report.access_plan.provider_contacts=[];
 const urls=[];const service=createContactService({fetchPage:async url=>{urls.push(url);return {url,html:url.includes('/contact')?'<a href="mailto:drinkingwater@example.gov">Water testing help</a>':'<a href="/contact">Contact water staff</a>'};}});
 const token=service.remember(data);const r=await service.resolve(token,'afford');assert.equal(r.contacts[0].email,'drinkingwater@example.gov');assert.match(r.contacts[0].source_url,/contact/);assert.equal(r.contacts[0].recommended,true);assert.ok(urls.every(x=>x.startsWith('https://floridadep.gov/')));
 const count=urls.length;await service.resolve(token,'afford');assert.equal(urls.length,count);
});
test('multiple possible water providers are never silently recommended',async()=>{
 const data=structuredClone(report);data.resident_report.provider_ambiguity=true;const service=createContactService({fetchPage:async()=>{throw Error('offline')}});const r=await service.resolve(service.remember(data),'rent');assert.equal(r.contacts[0].ambiguous,true);assert.ok(!r.contacts[0].recommended);
});
test('expired lookup cannot fetch arbitrary sources',async()=>{let now=0,calls=0;const service=createContactService({now:()=>now,fetchPage:async()=>{calls++;throw Error('offline')}});const token=service.remember(report);now=1800001;assert.equal((await service.resolve(token,'rent')).status,'expired');assert.equal(calls,0);});
test('extractor ignores scripts, unrelated inboxes, and off-site crawl links',()=>{
 const r=extract({url:'https://water.example.gov/',html:'<script>const x="evil@evil.example";</script><a href="mailto:privacy@example.gov">Privacy</a><a href="mailto:water&#64;example.gov?subject=test">Testing</a><a href="https://evil.example/contact">Contact</a><a href="/contact">Contact water staff</a>'});assert.deepEqual(r.emails.map(x=>x.email),['water@example.gov']);assert.deepEqual(r.links,['https://water.example.gov/contact']);assert.equal(email('water@example.gov\r\nBcc:x@evil.com'),'');
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fd00::1'])assert.equal(publicIp(ip),false);assert.equal(publicIp('8.8.8.8'),true);
});
test('private drafts use the water-check address; neighbor sheets never do',()=>{
 const c=D.context(report),address=report.resident_report.address;
 for(const lane of ['rent','afford','followup','explain']){const p=D.forAddress(D.prepare(c,lane),address,{name:'Example Water'});assert.ok(p.body.includes(address));assert.ok(p.subject.includes(address));assert.doesNotMatch(p.body,/\[your address|Please note:|Nothing has been sent|Evidence note:/);assert.match(p.body,/Arsenic/);}
 const neighbors=D.forAddress(D.prepare(c,'neighbors'),address);assert.ok(!neighbors.body.includes(address));assert.ok(!neighbors.subject.includes(address));
 assert.equal(D.cleanDraft('Hello,\n\nPlease test my water.\n\nPlease note: Public records... Nothing has been sent.'),'Hello,\n\nPlease test my water.');
});

test('HTTP lookup issues a contact token and the contact endpoint rejects untrusted calls',async t=>{
 const {createServer}=require('../national/server');const {once}=require('node:events');
 const contacts=createContactService({fetchPage:async()=>{throw Error('offline')}});
 const server=createServer({engine:{lookup:async()=>structuredClone(report)},contacts,testingCatalog:{refresh:async()=>{}}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const data=await(await fetch(base+'/api/national/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();assert.ok(data.action_token);
 const response=await fetch(base+'/api/national/action-contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:data.action_token,lane:'rent',url:'http://127.0.0.1/private'})});assert.equal(response.status,200);assert.equal((await response.json()).contacts[0].email,'water@example.gov');
 const blocked=await fetch(base+'/api/national/action-contact',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({token:data.action_token,lane:'rent'})});assert.equal(blocked.status,403);
});
