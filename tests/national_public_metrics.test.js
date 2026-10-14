'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPublicMetrics,savingsEvent}=require('../national/public_metrics');
const {chooseCheapest,OFFERS}=require('../national/access_catalog');
const id='75d074e0-4330-46af-9a71-87d586687250';
const report=amount=>({access_plan:{money_summary:{potential_savings_low:amount,savings_test:'Lead at the tap'}}});
test('savings use server report, ignore invalid amounts, and retain retry identity',()=>{
 assert.equal(savingsEvent({verified_savings:100},id),null);
 for(const amount of [null,undefined,'100',NaN,-1,0,Infinity])assert.equal(savingsEvent(report(amount),id),null);
 assert.deepEqual(savingsEvent(report(12.34),id),{id,cents:1234,test:'Lead at the tap'});
});
test('durable savings inserts deduplicate retries and contain no household data',async()=>{
 const records=new Map();const pool={async query(sql,args){if(sql.startsWith('INSERT')){assert.match(sql,/ON CONFLICT/);if(!records.has(args[0]))records.set(args[0],args[1]);assert.deepEqual(args,[id,1234,'Lead at the tap']);}if(sql.startsWith('SELECT'))return {rows:[{cents:String([...records.values()].reduce((a,b)=>a+b,0)),since:'2026-10-14',opportunities:String(records.size)}]};return {};}};
 const m=createPublicMetrics({env:{},pool});await m.record(report(12.34),id);await m.record(report(12.34),id);
 assert.equal((await m.totals()).savings.potential_savings,12.34);assert.equal((await m.totals()).savings.opportunities,1);
});
test('analytics are unavailable without configuration, not invented',async()=>{
 assert.deepEqual(await createPublicMetrics({env:{}}).totals(),{savings:null,analytics:null});
});
test('GA4 requests lifetime totals once per cache window without summing daily users',async()=>{
 let calls=0;const auth={async getClient(){return {async request(req){calls++;assert.equal(req.data.dateRanges[0].endDate,'today');assert.deepEqual(req.data.metrics,[{name:'screenPageViews'},{name:'totalUsers'}]);assert.equal(req.data.dimensions,undefined);return {data:{rows:[{metricValues:[{value:'31234'},{value:'17123'}]}]}};}};}};
 const m=createPublicMetrics({env:{GA4_PROPERTY_ID:'123'},auth});const first=await m.totals();await m.totals();assert.equal(calls,1);assert.equal(first.analytics.views,31234);assert.equal(first.analytics.users,17123);
});
test('free compares with first paid; paid compares with second even for equal prices',()=>{
 const base={state:'ZZ',counties:['*'],supply:['unknown'],tests:['Fixture'],price_kind:'published'};
 const options=[{...base,id:'fixture-a',provider:'A',price:10},{...base,id:'fixture-b',provider:'B',price:10},{...base,id:'fixture-c',provider:'C',price:30}];
 {const query={state:'ZZ',supply:'unknown',tests:['Fixture']};assert.equal(chooseCheapest(query,options)[0].potential_savings,0);options[0].price=0;const free=chooseCheapest(query,options)[0];assert.equal(free.potential_savings,10);assert.equal(free.comparison_provider,'B');}
});
