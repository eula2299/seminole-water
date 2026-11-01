'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {agencies,createLocalHelp}=require('../justice/local-help');
const {REGION_CODES}=require('../national/evidence');
test('every US state, DC and territory has sourced direct water and assistance routes',()=>{
 assert.equal(agencies().jurisdictions.length,56);for(const state of REGION_CODES){const r=agencies({state}).region;assert.ok(r,state);for(const kind of ['water','social','health','local','consumer']){assert.match(r.routes[kind].url,/^https:\/\//);assert.match(r.routes[kind].source,/^https:\/\/(www\.)?(epa|usa|asepa)\.gov\//);}}
});
test('local finder displays only grounded pages with independently matched quotes; no address is sent',async()=>{
 let calls=0;const url='https://fixture.gov/water';const ai={enabled:true,discover:async input=>{calls++;assert.equal(input.address,undefined);assert.equal(input.city,'Example');return {result:{items:[{url,quote:'Apply for water assistance at the city office.',deadline_label:'Made up date'},{url:'https://unrelated.test',quote:'Invented'}]},grounding:{groundingChunks:[{web:{uri:url}}],searchEntryPoint:{renderedContent:'<a href="https://google.com/search?q=water">Water</a>'}}};}};
 const finder=createLocalHelp({ai,readPage:async url=>({url,title:'City water help',text:'Apply for water assistance at the city office.'})});const input={city:'Example',state:'NY',kind:'assistance',address:'Private address'};
 const r=await finder.search(input);assert.equal(r.items.length,1);assert.equal(r.items[0].deadline_label,null);assert.ok(r.suggestions);await finder.search(input);assert.equal(calls,1);
});
test('fabricated quotes and nonofficial source hosts cannot become verified assistance',async()=>{
 const url='https://fixture.gov/help';const finder=createLocalHelp({ai:{enabled:true,discover:async()=>({result:{items:[{url,quote:'Everyone is paid $500 today.'}]},grounding:{groundingChunks:[{web:{uri:url}}]}})},readPage:async()=>({url,title:'Help',text:'Call the office for program details.'})});assert.deepEqual((await finder.search({city:'Example',state:'NY'})).items,[]);
});
test('official-directory reading continues when the search provider rejects its quota',async()=>{
 let reads=0;const finder=createLocalHelp({ai:{enabled:true,discover:async()=>{throw Error('SEARCH_PAUSED');},discoverPages:async({pages})=>({items:[{url:pages[0].url,quote:'Call our office for help paying your water bill.',date_label:'',deadline_label:''}]})},readPage:async url=>{reads++;return {url,title:'Official assistance',text:'Call our office for help paying your water bill.',links:[]};}});
 const r=await finder.search({city:'Example',state:'NY',kind:'assistance'});assert.equal(r.items.length,1);assert.equal(r.status,'verified_pages');assert.ok(reads>=1);
});
