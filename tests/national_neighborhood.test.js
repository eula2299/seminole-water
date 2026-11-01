'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createNeighborhood}=require('../national/neighborhood');
const address={geography:{tract:{geoid:'53033008102'}}};
function request({foreign=false,vintage='2020-2024'}={}){return async url=>{
 if(url.includes('/items/'))return {owner:'esri_demographics',description:'Current Vintage: '+vintage};
 return {features:[{attributes:{GEOID:foreign?'53033000000':'53033008102',NAME:'Test tract',B17020_001E:200,B17020_002E:40,B19049_001E:50000,B25003_001E:100,B25003_003E:80,B25034_001E:100,B25034_007E:10,B25034_008E:10,B25034_009E:10,B25034_010E:10,B25034_011E:10}}]};
};}
test('published ACS context uses exact tract and preserves aggregate-only meaning',async()=>{const r=await createNeighborhood()(address,request());assert.equal(r.median_household_income,50000);assert.equal(r.poverty_percent,20);assert.equal(r.renter_percent,80);assert.equal(r.pre_1980_housing_percent,50);assert.equal(r.household_inference,false);assert.equal(r.available_topics.length,4);});
test('changed vintage and wrong-tract data are never used as neighborhood facts',async()=>{await assert.rejects(createNeighborhood()(address,request({foreign:true})));await assert.rejects(createNeighborhood()(address,request({vintage:'2021-2025'})));});
