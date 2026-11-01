'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine,ENDPOINTS,safeTarget}=require('../national/service');
const {createWarehouse}=require('../national/warehouse');
const input={address:'1 Synthetic Street',city:'Example',state:'NY',include_environment:false};
const listing={pwsid:'NY0000001',name:'Fixture Water',state:'NY',active:true};
const stored={status:'records-returned',observations:[{analyte:'Lead',value:2,unit:'ug/L'}],observation_summary:[],counts:{observation:'1'}};
const warehouse={findLocalSystems:async()=>[listing,{...listing,pwsid:'CA0000001',state:'CA'},{...listing,pwsid:'CA0000002',state:'NY'}],lookupSystem:async()=>stored,status:async()=>({status:'available',sources:[]})};
test('geocoder and map outage still searches official locality systems without claiming a household match',async()=>{
 const request=async url=>{if(url.startsWith(ENDPOINTS.systems))return {Results:{Systems:[{PWSID:'NY0000001'}]}};throw Error('Fixture outage');};
 const result=await createEngine({request,warehouse}).lookup(input);
 assert.equal(result.systems.length,1);assert.equal(result.systems[0].pwsid,'NY0000001');assert.equal(result.occurrence.records.length,1);
 assert.equal(result.provider.method,'local-directory');assert.equal(result.provider.household_connection_verified,false);assert.equal(result.resident_report.provider_ambiguity,true);
 assert.ok(result.audit.some(a=>a.agent==='published-local-water-systems'&&a.status==='completed'));
 assert.ok(!result.resident_report.risk_profile.priority_risks.some(r=>r.relation==='serving-water-system'));
});
test('failed first geocoder request retries structured address before provider-map search',async()=>{
 let attempts=0;
 const request=async url=>{if(url.startsWith(ENDPOINTS.censusOneLine)){attempts++;throw Error('Transient');}if(url.startsWith(ENDPOINTS.census)){attempts++;return {result:{addressMatches:[{addressComponents:{state:'NY',city:'Example'},coordinates:{x:-74,y:41},matchedAddress:'1 SYNTHETIC STREET'}]}};}if(url.startsWith(ENDPOINTS.boundaries))return {features:[]};throw Error('Unused source');};
 const r=await createEngine({request,warehouse}).lookup(input);assert.equal(attempts,2);assert.equal(r.address.status,'matched');assert.equal(r.systems.length,1);
});
test('private wells never use city-directory public-system records',async()=>{
 let calls=0;const r=await createEngine({request:async()=>({result:{addressMatches:[]}}),warehouse:{...warehouse,findLocalSystems:async()=>{calls++;return [listing];}}}).lookup({...input,supply_type:'private-well'});assert.equal(calls,0);assert.deepEqual(r.systems,[]);
});
test('Census access-context endpoint is allowed and unrelated endpoints remain blocked',()=>{
 assert.equal(safeTarget(ENDPOINTS.acs+'?get=NAME').hostname,'api.census.gov');assert.throws(()=>safeTarget('https://api.census.gov/anything'));
});
test('locality SQL returns active community systems in the exact state and city or ZIP only',async()=>{
 const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();const pool={query:async(sql,args)=>{if(!args&&sql.includes('CREATE SCHEMA')){await db.exec(sql);return {rows:[]};}return db.query(sql,args);}};
 const w=createWarehouse({pool});try{await w.initialize();const id='00000000-0000-4000-8000-000000000001';await db.query("INSERT INTO national_water.runs(id,source,status,source_url) VALUES($1,'sdwis','complete','https://echo.epa.gov')",[id]);await db.query("INSERT INTO national_water.sources(source,active_run) VALUES('sdwis',$1)",[id]);
 for(const [pwsid,state,city,active,system_type]of [['NY0000001','NY','Example',true,'CWS'],['CA0000001','CA','Example',true,'CWS'],['CA0000002','NY','Example',true,'CWS'],['NY0000002','NY','Other',true,'CWS'],['NY0000003','NY','Example',false,'CWS'],['NY0000004','NY','Example',true,'NTNCWS']])await db.query("INSERT INTO national_water.records(run_id,kind,record_key,pwsid,data) VALUES($1,'system',$2,$2,$3)",[id,pwsid,JSON.stringify({name:'Fixture',state,city,active,system_type})]);
 assert.deepEqual((await w.findLocalSystems({state:'NY',city:' example '})).map(x=>x.pwsid),['NY0000001']);
 }finally{await db.close();}
});

test('local directory preserves numeric tribal identifiers without accepting another state prefix',async()=>{
 const result=await createEngine({request:async()=>{throw Error('Offline');},warehouse:{...warehouse,findLocalSystems:async()=>[{...listing,pwsid:'010106001'},{...listing,pwsid:'CA0000002'}]}}).lookup(input);
 assert.deepEqual(result.provider.candidates.map(x=>x.pwsid),['010106001']);
 assert.equal(result.provider.household_connection_verified,false);
});
