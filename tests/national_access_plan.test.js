'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseAcsContext,buildAccessPlan,providerContacts,targetedTests}=require('../national/access_plan');

test('ACS access context stays tract-level and never claims household demographics',()=>{
 const payload=[
  ['NAME','B19013_001E','B17001_001E','B17001_002E','B25003_001E','B25003_003E','B25034_001E','B25034_007E','B25034_008E','B25034_009E','B25034_010E','B25034_011E','state','county','tract'],
  ['Census Tract 1; Fixture County; Florida','42000','1000','260','500','310','600','100','90','80','40','30','12','117','000100']
 ];
 const result=parseAcsContext(payload,{geography:{tract:{geoid:'12117000100'}}});
 assert.equal(result.median_household_income,42000);
 assert.equal(result.poverty_percent,26);
 assert.equal(result.renter_percent,62);
 assert.equal(result.pre_1980_housing_percent,56.7);
 assert.equal(result.household_inference,false);
 assert.match(result.note,/do not identify this household/i);
});

test('Water Access Plan is free-first, targeted and refuses invented dollar savings',()=>{
 const data={
  address:{state:'FL',geography:{county:{name:'Fixture County'}}},
  gaps:['gap one','gap two'],
  provider:{candidates:[{pwsid:'FL1234567',name:'Fixture Water'}]},
  systems:[{pwsid:'FL1234567',records:[{data:{PWSName:'Fixture Water',PHONE_NUMBER:'407-555-0100',EMAIL_ADDR:'water@example.gov'}}]}],
  current_advisories:{records:[]},
  environment:{records:[{parameter:'Arsenic'}]},
  archived_environment:{records:[]},
  equity_context:{poverty_percent:24,renter_percent:58,pre_1980_housing_percent:61,household_inference:false}
 };
 const serviceLine={status:'address-record-match',records:[{material:'Unknown',address:'100 Fixture St',source_url:'https://example.gov/inventory'}]};
 const findings=[{name:'Arsenic',detected:true,comparison:null}];
 const plan=buildAccessPlan(data,{privateWell:false,findings,compliance:[],providers:[{id:'FL1234567',name:'Fixture Water'}],serviceLine});
 assert.ok(plan.verified_zero_cost_options>=3);
 assert.equal(plan.money.verified_potential_savings,null);
 assert.match(plan.money.note,/do not invent/i);
 assert.equal(plan.quote_check.service_line_free_record_available,true);
 assert.ok(plan.targeted_tests.some(x=>x.name==='Arsenic'));
 assert.ok(plan.targeted_tests.some(x=>/Lead/.test(x.name)));
 assert.equal(plan.provider_contacts[0].phone,'407-555-0100');
 assert.ok(plan.barrier_context.signals.length>=2);
});

test('private well access plan never substitutes public utility assistance for a household well test',()=>{
 const plan=buildAccessPlan({address:{state:'GA',geography:{county:{name:'Fixture County'}}},gaps:[],systems:[],provider:{candidates:[]},environment:{records:[]},archived_environment:{records:[]}}, {privateWell:true,findings:[],compliance:[],providers:[],serviceLine:null});
 assert.ok(plan.targeted_tests.some(x=>/coliform/i.test(x.name)));
 assert.ok(plan.free_first.some(x=>x.id==='testing-assistance'));
 assert.ok(!plan.free_first.some(x=>x.id==='annual-report'));
 assert.equal(plan.money.verified_potential_savings,null);
});

test('provider contact extraction is public-system scoped and bounded',()=>{
 const contacts=providerContacts({provider:{candidates:[{pwsid:'TX7654321',name:'Fixture Utility'}]},systems:[{pwsid:'TX7654321',records:[{data:{PHONE_NUMBER:'512-555-0101',ADMIN_NAME:'Fixture Admin',EMAIL_ADDR:'admin@example.gov'}}]}]});
 assert.deepEqual(contacts,[{pwsid:'TX7654321',name:'Fixture Utility',phone:'512-555-0101',email:'admin@example.gov',admin:'Fixture Admin'}]);
});

test('targeted test list is bounded and deduplicated',()=>{
 const items=targetedTests(false,[{name:'PFOA',detected:true},{name:'PFOS',detected:true},{name:'Arsenic',detected:true},{name:'Nitrate as N',detected:true},{name:'Cadmium',detected:true}],{status:'address-record-match',records:[{material:'Lead'}]});
 assert.ok(items.length<=6);
 assert.equal(new Set(items.map(x=>x.name)).size,items.length);
});
