'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {REGION_CODES}=require('../national/evidence');
const {offersFor}=require('../national/access_catalog');
const {buildAccessPlan}=require('../national/access_plan');
const {applyProduct}=require('../national/testing_catalog');
const {createServer}=require('../national/server');
const tests=['Lead at the tap','Arsenic','Nitrate','Cadmium','PFAS panel including PFOA/PFOS','Total coliform and E. coli','pH and total dissolved solids'];
test('every supported US region has direct published laboratory options for every targeted analyte',()=>{
 for(const state of REGION_CODES){for(const name of tests){
  const found=offersFor({state,county:'A county without a local catalog',supply:'private-well',tests:[name]});
  assert.ok(found.some(x=>x.delivery==='mail-in'&&x.price>0&&x.shipping_included),state+': '+name);
  assert.ok(found.every(x=>!/(google|bing)\.com\/search/.test(x.url)));
 }}
});
test('free programs respect city, county, state and water-source boundaries',()=>{
 const find=(state,city,county,supply='public')=>offersFor({state,city,county,supply,tests:['Lead at the tap']}).filter(x=>x.price===0);
 assert.ok(find('IL','Chicago','Cook County').some(x=>x.id==='chicago-free-lead'));
 assert.equal(find('IL','Evanston','Cook County').length,0);
 assert.equal(find('IL','Chicago','Cook County','private-well').length,0);
 assert.ok(find('NY','Brooklyn','Kings County').some(x=>x.id==='nyc-free-lead'));
 assert.equal(find('NY','Albany','Albany County').length,0);
 assert.equal(find('OR','Chicago','Cook County').length,0);
});
test('unknown provider never matches a named utility and shipping extras do not create fake savings',()=>{
 const found=offersFor({state:'FL',county:'Seminole County',supply:'public',provider:'',tests:['Service line material']});
 assert.equal(found.length,0);
 const plan=buildAccessPlan({address:{state:'TX',city:'Austin'},systems:[]});
 assert.equal(plan.option_inventory.best_paid.price,55);
 assert.equal(plan.money_summary.potential_savings_low,null);
 assert.doesNotMatch(JSON.stringify(plan),/google\.com\/search/);
 assert.equal(plan.option_inventory.provider_count,2);
});
test('price refresh validates product and variant identity, integer cents and stock state',()=>{
 const offer={product_id:1,variant_id:2,price:55,verified_at:'2026-10-17',shipping_included:true};
 const result=applyProduct(offer,{id:1,variants:[{id:2,price:5900,available:true}]},new Date('2026-10-18'));
 assert.equal(result.price,59);assert.equal(result.verified_at,'2026-10-18');
 assert.throws(()=>applyProduct(offer,{id:99,variants:[]}));
 assert.throws(()=>applyProduct(offer,{id:1,variants:[{id:2,price:null,available:true}]}));
 applyProduct(offer,{id:1,variants:[{id:2,price:5900,available:false}]});assert.equal(offer.available,false);
});
test('backup testing endpoint works without geocoding or evidence-service availability',async()=>{
 let calls=0;const server=createServer({engine:{lookup:()=>{calls++;throw Error('offline');}},testingCatalog:{refresh:async()=>{}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const res=await fetch(base+'/api/national/testing-options?state=AK&city=Juneau&supply=private-well');
  assert.equal(res.status,200);const body=await res.json();
  assert.equal(calls,0);assert.equal(body.address.status,'not-verified');
  assert.ok(body.resident_report.access_plan.option_inventory.paid.length>=3);
  assert.equal(body.resident_report.findings.length,0);
  assert.equal((await fetch(base+'/api/national/testing-options?state=ZZ')).status,400);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
