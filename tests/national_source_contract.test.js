'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine,transport,ENDPOINTS}=require('../national/service');
test('ECHO exact-system query uses the supported p_pid filter, not ignored p_pwsid',async()=>{
 const calls=[];
 const request=async url=>{const u=new URL(url);calls.push(u);return {Results:{Systems:[{PWSId:'MD0150005',PWSName:'Synthetic fixture utility'}]}};};
 const result=await createEngine({request}).lookup({state:'MD',pwsid:'MD0150005'});
 assert.equal(result.systems[0].status,'records-returned');
 assert.equal(calls[0].searchParams.get('p_pid'),'MD0150005');
 assert.equal(calls[0].searchParams.has('p_pwsid'),false);
 assert.equal(calls[0].searchParams.get('queryset'),'10');
});
test('nested EPA queryset-limit errors are source errors, not empty-success',async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({Results:{Error:{ErrorMessage:'Queryset Limit would be exceeded - please make search parameters more selective.'}}}));
 await assert.rejects(transport({fetchImpl})(ENDPOINTS.systems),error=>error.code==='SOURCE_ERROR');
});
