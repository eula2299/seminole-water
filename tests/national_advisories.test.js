'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SOURCES,createAdvisories,sourceReader,oregonRecord,clevelandRecord,guidance}=require('../national/advisories');
const {createEngine}=require('../national/service');
const {buildResidentReport}=require('../national/resident');
const AT='2026-09-18T10:00:00Z',now=()=>new Date(AT),epoch=Date.parse(AT);
const or={PWS_Number:'00466',PWS_Name:'Synthetic District',Advisory_Type:'Do Not Drink Water',Advisory_Label:'System-wide Do Not Drink Water Advisory',Advisory_Reason:'Nitrate',Area_Affected:'System-wide',Affected_Population:'Vulnerable',Begin_Date:epoch-86400000,Link_to_Details_Page:'https://yourwater.oregon.gov/advisorydetails.php?ISN=100',ObjectId:1};
const oh={OBJECTID:1,ADVISESTART:epoch-3600000,ADVISEEND:null,ADVISETYPE:'Boil Water'};
const metadata=(s,age=0)=>({fields:s.fields.map(name=>({name})),editingInfo:{dataLastEditDate:epoch-age}});
function reader({oregon=[or],cleveland=[oh],age=0,fail=false,extra={}}={}){return async value=>{if(fail)throw Error('Source unavailable');const u=new URL(value),s=u.href.includes('/advisories/')?SOURCES.oregon:SOURCES.cleveland;return u.pathname.endsWith('/query')?{features:(s===SOURCES.oregon?oregon:cleveland).map(attributes=>({attributes})),...extra}:metadata(s,age);};}
const oregonLookup={address:{status:'matched',state:'OR'},pwsids:['OR4100466'],supplyType:'public'};
const ohioLookup={address:{status:'matched',state:'OH',latitude:41.50,longitude:-81.69},pwsids:[],supplyType:'unknown'};
test('Oregon exact system ID retains affected population and chemical-notice type',async()=>{
 const r=await createAdvisories({request:reader(),now})(oregonLookup);
 assert.equal(r.status,'checked-sources');assert.equal(r.records.length,1);assert.equal(r.records[0].pwsid,'OR4100466');assert.equal(r.records[0].type,'do-not-drink');assert.equal(r.records[0].affected_population,'Vulnerable');assert.equal(r.records[0].household_applies_verified,false);assert.equal(r.comprehensive,false);assert.match(r.records[0].guidance,/Do not assume boiling/);
 const other=await createAdvisories({request:reader(),now})({...oregonLookup,pwsids:['OR4100657']});assert.deepEqual(other.records,[]);assert.equal(other.status,'checked-sources');assert.equal(other.household_safety,'not-determined');
});
test('missing, stale, changed and truncated sources never imply no active notices',async()=>{
 for(const opts of [{fail:true},{extra:{exceededTransferLimit:true}},{oregon:[{...or,Advisory_Type:'Changed'}]},{oregon:[{...or,Begin_Date:null}]},{oregon:[or,or]}]){const r=await createAdvisories({request:reader(opts),now})(oregonLookup);assert.equal(r.status,'unavailable');assert.deepEqual(r.records,[]);assert.equal(r.checks[0].status,'unavailable');}
 const stale=await createAdvisories({request:reader({age:3*86400000}),now})(oregonLookup);assert.equal(stale.status,'source-not-recent');assert.equal(stale.records[0].source_is_recent,false);assert.equal(stale.records[0].title,or.Advisory_Label);
});
test('Cleveland distinguishes open, ended, future and invalid intervals',()=>{
 assert.equal(clevelandRecord({attributes:oh},AT).type,'boil-water');
 assert.equal(clevelandRecord({attributes:{...oh,ADVISEEND:epoch}},AT),null);
 assert.equal(clevelandRecord({attributes:{...oh,ADVISESTART:epoch+1}},AT),null);
 assert.throws(()=>clevelandRecord({attributes:{...oh,ADVISEEND:epoch-86400000}},AT));
 assert.throws(()=>clevelandRecord({attributes:{...oh,ADVISEEND:''}},AT));
 const missing={...oh};delete missing.ADVISEEND;assert.throws(()=>clevelandRecord({attributes:missing},AT));
 assert.match(guidance('do-not-use'),/other water uses/);assert.doesNotMatch(guidance('do-not-drink'),/required boiling time/);
});
test('Cleveland lookup uses the estimated-address envelope, never a facility distance match',async()=>{
 const calls=[],request=reader();const r=await createAdvisories({request:async u=>{calls.push(new URL(u));return request(u);},now})(ohioLookup);
 const query=calls.find(u=>u.pathname.endsWith('/query'));assert.equal(query.searchParams.get('geometryType'),'esriGeometryEnvelope');assert.equal(query.searchParams.get('inSR'),'4326');assert.equal(query.searchParams.get('spatialRel'),'esriSpatialRelIntersects');assert.equal(r.records[0].match_method,'30m-envelope-intersects-publisher-advisory-polygon');assert.equal(r.records[0].household_applies_verified,false);
});
test('private wells, unresolved providers and uncovered states do not borrow a notice',async()=>{
 let requests=0;const get=createAdvisories({request:async()=>{requests++;throw Error();},now});
 assert.equal((await get({...oregonLookup,supplyType:'private-well'})).status,'not-applicable-private-well');
 assert.equal((await get({...oregonLookup,pwsids:[]})).status,'provider-unresolved');
 assert.equal((await get({address:{status:'matched',state:'TX'},pwsids:['TX2270001']})).status,'coverage-unavailable');assert.equal(requests,0);
});
test('cached Oregon notices retain their retrieval time and a failed refresh cannot reuse them as current',async()=>{
 let time=epoch,requests=0,fail=false;const real=reader(),get=createAdvisories({now:()=>new Date(time),request:async u=>{requests++;if(fail)throw Error('outage');return real(u);},cacheMs:60000});
 const a=await get(oregonLookup);time+=1000;const b=await get(oregonLookup);assert.equal(requests,2);assert.equal(a.records[0].checked_at,b.records[0].checked_at);
 time+=60000;fail=true;const c=await get(oregonLookup);assert.equal(c.status,'unavailable');assert.deepEqual(c.records,[]);
});
test('advisory transport rejects unapproved URLs, redirects, oversized and error responses',async()=>{
 const endpoint=SOURCES.oregon.layer+'?f=json';
 for(const bad of ['http://127.0.0.1/','https://example.org/','https://user@services.arcgis.com/uUvqNMGPm7axC2dD/arcgis/rest/services/advisories/FeatureServer/0',SOURCES.oregon.layer+'/deleteFeatures'])await assert.rejects(sourceReader()(bad));
 let opts;const data=await sourceReader({fetchImpl:async(u,o)=>{opts=o;return new Response('{"fields":[]}');}})(endpoint);assert.deepEqual(data,{fields:[]});assert.equal(opts.redirect,'error');
 for(const body of ['{"error":{"message":"failed"}}','not-json'])await assert.rejects(sourceReader({fetchImpl:async()=>new Response(body)})(endpoint));
 await assert.rejects(sourceReader({maxBytes:5,fetchImpl:async()=>new Response('123456789')})(endpoint));
 assert.throws(()=>oregonRecord({attributes:{...or,Link_to_Details_Page:'https://example.org/advisorydetails.php?ISN=100'}},AT));
});
test('engine and resident report prioritize official notices without certifying household safety',async()=>{
 const get=createAdvisories({request:reader(),now}),engine=createEngine({advisories:get,now,request:async()=>({Results:{WaterSystems:[]}})});
 const result=await engine.lookup({state:'OR',pwsid:'OR4100466',supply_type:'public'}),r=result.resident_report;
 assert.equal(result.current_advisories.records.length,1);assert.equal(r.current_advisories_checked,true);assert.equal(r.advisories_comprehensive,false);assert.equal(r.household_safety,'not-determined');assert.match(r.actions[0].title,/notice/);assert.equal(result.audit.find(x=>x.agent==='current-official-advisories').status,'completed');
 const well=buildResidentReport({...result,supply:{type:'private-well'}});assert.deepEqual(well.advisories.records,[]);assert.equal(well.current_advisories_checked,false);
});
