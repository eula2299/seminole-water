'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../national/service');
test('an unexecuted nearby-boundary screen is not marked completed',async()=>{
 const request=async()=>({Results:{Systems:[{PWSID:'NY1234567'}]}});
 const result=await createEngine({request}).lookup({state:'NY',pwsid:'NY1234567'});
 assert.equal(result.provider.nearby_screen.status,'not-requested');
});

const knownSystem={state:'NY',pwsid:'NY1234567'};
const systemResponse=async url=>({Results:{Systems:[{PWSID:new URL(url).searchParams.get('p_pid')||'NY1234567'}]}});

test('warehouse failure is unavailable evidence, never a successful empty query',async()=>{
 const warehouse={
  async lookupSystem(){throw Object.assign(new Error('database unavailable'),{code:'ECONNREFUSED'});},
  async status(){throw new Error('database unavailable');}
 };
 const result=await createEngine({request:systemResponse,warehouse}).lookup(knownSystem);
 assert.equal(result.occurrence.status,'unavailable');
 assert.deepEqual(result.occurrence.records,[]);
 assert.equal(result.coverage.occurrence_database,'unavailable');
 assert.equal(result.coverage.national_unique_observations_ingested,null);
 assert.equal(result.household_safety.status,'not-determined');
 assert.equal(result.audit.find(x=>x.agent==='stored-evidence:NY1234567').status,'unavailable');
});

test('unconfigured warehouse stays not connected rather than no records',async()=>{
 const warehouse={
  async lookupSystem(){return {status:'not-connected',observations:[]};},
  async status(){return {status:'not-connected',sources:[]};}
 };
 const result=await createEngine({request:systemResponse,warehouse}).lookup(knownSystem);
 assert.equal(result.occurrence.status,'not-connected');
 assert.equal(result.coverage.occurrence_database,'not-connected');
});

test('an available warehouse can explicitly return an empty requested system result',async()=>{
 const warehouse={
  async lookupSystem(){return {status:'no-matching-records',observations:[]};},
  async status(){return {status:'available',sources:[]};}
 };
 const result=await createEngine({request:systemResponse,warehouse}).lookup(knownSystem);
 assert.equal(result.occurrence.status,'no-records-returned');
 assert.equal(result.household_safety.status,'not-determined');
});

test('overlapping providers with a failed warehouse query produce partial evidence',async()=>{
 const request=async url=>{
  const u=new URL(url);
  if(u.hostname.includes('census'))return {result:{addressMatches:[{addressComponents:{state:'NY'},coordinates:{x:-74,y:41},matchedAddress:'SYNTHETIC TEST ADDRESS'}]}};
  if(u.hostname==='services.arcgis.com')return {features:['NY1234567','NY7654321'].map(pwsid=>({attributes:{PWSID:pwsid,PWS_Name:'Synthetic '+pwsid,Data_Provider_Type:'State'}}))};
  return systemResponse(url);
 };
 const warehouse={
  async lookupSystem(pwsid){
   if(pwsid==='NY7654321')throw new Error('query unavailable');
   return {status:'records-returned',observations:[{analyte:'Synthetic analyte',value:1,unit:'ug/L'}]};
  },
  async status(){return {status:'available',sources:[]};}
 };
 const result=await createEngine({request,warehouse}).lookup({state:'NY',street:'1 Synthetic Street',city:'Example'});
 assert.equal(result.occurrence.status,'partial');
 assert.equal(result.provider.candidates.length,2);
 assert.equal(result.occurrence.records.length,1);
 assert.equal(result.occurrence.records[0].pwsid,'NY1234567');
 assert.equal(result.occurrence.household_sample,false);
});

test('private well results do not pretend a utility warehouse query occurred',async()=>{
 let queried=false;
 const warehouse={
  async lookupSystem(){queried=true;return {status:'records-returned',observations:[]};},
  async status(){return {status:'available',sources:[]};}
 };
 const request=async()=>({result:{addressMatches:[]}});
 const result=await createEngine({request,warehouse}).lookup({state:'NY',street:'1 Synthetic Street',city:'Example',supply_type:'private-well'});
 assert.equal(result.occurrence.status,'not-applicable');
 assert.equal(queried,false);
 assert.deepEqual(result.occurrence.records,[]);
});
