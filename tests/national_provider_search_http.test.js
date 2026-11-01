'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../national/server');
const {EvidenceError}=require('../national/evidence');
test('provider-name endpoint returns deliberate choices without running a water lookup',async t=>{
 const calls=[];let lookup=0;
 const server=createServer({engine:{searchProviders:async args=>{calls.push(args);if(args.query.length<2)throw new EvidenceError('BAD_PROVIDER_SEARCH','Enter a provider name.');return [{id:'NY7003493',name:'NEW YORK CITY SYSTEM',state:'NY'}];},lookup:async()=>{lookup++;},status:async()=>({})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/api/national/providers?state=NY&query=New%20York');assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{providers:[{id:'NY7003493',name:'NEW YORK CITY SYSTEM',state:'NY'}]});
 assert.deepEqual(calls,[{state:'NY',query:'New York'}]);assert.equal(lookup,0);
 const bad=await fetch(base+'/api/national/providers?state=NY&query=x');assert.equal(bad.status,422);
});
