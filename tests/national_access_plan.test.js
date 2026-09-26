'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseAcsContext,buildAccessPlan,providerContacts,targetedTests}=require('../national/access_plan');
const {chooseCheapest}=require('../national/access_catalog');

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
 assert.equal(plan.primary_path.cost,'$0');
 assert.match(plan.primary_path.title,/free pipe record/i);
 assert.ok(plan.next_paths.length>=1);
 assert.equal(plan.quote_check.service_line_free_record_available,true);
 assert.ok(plan.targeted_tests.some(x=>x.name==='Arsenic'));
 assert.ok(plan.targeted_tests.some(x=>/Lead/.test(x.name)));
 assert.equal(plan.provider_contacts[0].phone,'407-555-0100');
 assert.ok(plan.barrier_context.signals.length>=2);
 assert.match(plan.summary,/free option/i);
});

test('private well access plan never substitutes public utility assistance for a household well test',()=>{
 const plan=buildAccessPlan({address:{state:'GA',geography:{county:{name:'Fixture County'}}},gaps:[],systems:[],provider:{candidates:[]},environment:{records:[]},archived_environment:{records:[]}}, {privateWell:true,findings:[],compliance:[],providers:[],serviceLine:null});
 assert.ok(plan.targeted_tests.some(x=>/coliform/i.test(x.name)));
 assert.match(plan.primary_path.title,/free or reduced-cost well testing/i);
 assert.equal(plan.primary_path.cost,'$0 to check');
 assert.ok(plan.next_paths.some(x=>/what your well actually needs/i.test(x.title)));
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

test('Florida private-well bacteria returns an actual cheapest published option and savings',()=>{
 const found=chooseCheapest({state:'FL',county:'Seminole County',supply:'private-well',provider:'',tests:['Total coliform and E. coli']});
 assert.equal(found.length,1);
 assert.equal(found[0].best.provider,'Florida Department of Health — county health department');
 assert.equal(found[0].best.price,17);
 assert.equal(found[0].comparison_provider,'Advanced Environmental Laboratories (AEL)');
 assert.equal(found[0].comparison_price,120);
 assert.equal(found[0].potential_savings,103);
});

test('Florida private-well nitrate returns the published county price range before private lab pricing',()=>{
 const found=chooseCheapest({state:'FL',county:'Seminole County',supply:'private-well',provider:'',tests:['Nitrate']});
 assert.equal(found[0].best.provider,'Florida county health department');
 assert.equal(found[0].best.price_label,'usually $20–$30 per sample');
 assert.deepEqual(found[0].potential_savings_range,[90,100]);
 assert.equal(found[0].comparison_price,120);
});

test('Seminole public-water service line lookup returns the named free utility inventory',()=>{
 const found=chooseCheapest({state:'FL',county:'Seminole County',supply:'public',provider:'Seminole County Utilities',tests:['Service line material']});
 assert.equal(found[0].best.provider,'Seminole County Utilities — Service Line Inventory');
 assert.equal(found[0].best.price,0);
 assert.match(found[0].best.url,/seminolecountyfl\.gov/);
});
