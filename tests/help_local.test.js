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
test('official city registry matches city and state without importing security contacts',()=>{
 const {localOffices}=require('../justice/local-help');const registry=require('../justice/governments.json');
 assert.ok(localOffices('Seattle','WA').some(r=>r.url==='https://seattle.gov/'));assert.ok(!localOffices('Seattle','NY').some(r=>r.url==='https://seattle.gov/'));
 assert.ok(registry.records.length>10000);assert.ok(registry.records.every(r=>r.length===5));assert.ok(!registry.fields.some(f=>/email/i.test(f)));
});
test('program search hints must stay on matched official hosts and pass live-page quote verification',async()=>{
 const valid='https://seattle.gov/utilities/discounts',unrelated='https://different-city.gov/discounts',privateUrl='https://127.0.0.1/discounts',reads=[];
 const quote='Eligible customers may apply for a discount on their water bill.';
 const finder=createLocalHelp({ai:{enabled:true,discover:async()=>{throw Error('SEARCH_PAUSED');},discoverPages:async({final,pages})=>final?{items:[{url:valid,quote},{url:valid,quote:'Everyone receives $900 today.'}]}:{items:[],candidate_urls:[valid,unrelated,privateUrl,'https://seattle.gov/payment?amount=10']}},readPage:async url=>{reads.push(url);return {url,title:'Water bill help',text:url===valid?quote:'City public information.',links:[]};}});
 const r=await finder.search({city:'Seattle',state:'WA',kind:'assistance'});
 assert.equal(r.items.length,1);assert.equal(r.items[0].url,valid);assert.equal(r.items[0].quote,quote);
 assert.ok(!reads.includes(unrelated));assert.ok(!reads.includes(privateUrl));assert.ok(!reads.some(url=>url.includes('?amount=')));
});
test('specific program links outrank news and navigation, and page text excludes repeated menus',async()=>{
 const {articleText}=require('../justice/public-pages');
 assert.equal(articleText('<header>Menu</header><main><h1>Bill help</h1><p>Apply for assistance.</p><script>bad()</script></main><footer>More menus</footer>'),'Bill help Apply for assistance.');
 const target='https://seattle.gov/utilities/discounts',reads=[];
 const finder=createLocalHelp({ai:{enabled:true,discover:async()=>{throw Error('SEARCH_PAUSED');},discoverPages:async()=>({items:[]})},readPage:async url=>{reads.push(url);return {url,title:'Official page',text:'Public information.',links:url==='https://seattle.gov/'?[{title:'Seattle water wins award',url:'https://seattle.gov/news/award'},{title:'Seattle news',url:'https://seattle.gov/news'},{title:'Help paying your water bill',url:target}]:[]};}});
 await finder.search({city:'Seattle',state:'WA',kind:'assistance'});assert.ok(reads.includes(target));assert.ok(!reads.includes('https://seattle.gov/news/award'));
});
test('official state city directories and redirects can identify municipal .com websites',async()=>{
 const city='Lake Mary',cityUrl='https://www.lakemaryfl.com/',program=cityUrl+'178/Utility-Customer-Service',reads=[];
 const finder=createLocalHelp({ai:{enabled:true,discover:async()=>{throw Error('SEARCH_PAUSED');},discoverPages:async({final})=>final?{items:[{url:program,quote:'Call customer service for help with your water bill.'}]}:{items:[],candidate_urls:[program]}},readPage:async url=>{reads.push(url);return {url,title:'Utility customer service',text:url===program?'Call customer service for help with your water bill.':'Official city directory.',links:url.includes('fl-cities')?[{url:cityUrl,title:'Lake Mary'}]:[]};}});
 const r=await finder.search({city,state:'FL',kind:'assistance'});assert.ok(reads.includes(cityUrl));assert.equal(r.items[0].url,program);
});
test('municipal financing is never presented as household bill assistance',async()=>{
 const url='https://fixture.gov/funding',quote='Free financial assistance for public water and wastewater systems.';
 const finder=createLocalHelp({ai:{enabled:true,discover:async()=>({result:{items:[{url,quote}]},grounding:{groundingChunks:[{web:{uri:url}}]}})},readPage:async()=>({url,title:'Free Financial and Technical Assistance for Public Water and Wastewater Systems',text:quote})});
 assert.deepEqual((await finder.search({city:'Dallas',state:'TX',kind:'assistance'})).items,[]);
});
