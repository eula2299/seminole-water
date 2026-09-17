'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../national/service');
test('an unexecuted nearby-boundary screen is not marked completed',async()=>{
 const request=async()=>({Results:{Systems:[{PWSID:'NY1234567'}]}});
 const result=await createEngine({request}).lookup({state:'NY',pwsid:'NY1234567'});
 assert.equal(result.provider.nearby_screen.status,'not-requested');
});
