'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {CLIENT,HTML}=require('../national/ui');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};this.value='';this._text='';}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join(' ');}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this._text='';this.children=nodes;}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.listeners[k]=v;}focus(){}scrollIntoView(){}reportValidity(){return true;}
}
async function render(privateWell,extraFindings=[],reportFields={},fixture={}){
 let client=CLIENT;
 if(process.env.LIVE_ORIGIN){assert.equal(process.env.LIVE_ORIGIN,'https://www.ismywaterok.com');const r=await fetch(process.env.LIVE_ORIGIN+'/national-client.js',{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);client=await r.text();assert.ok(client.length<100000);}
 const ids=['lookup-form','address','supply','lookup-button','message','results','how-it-works','progress','public-impact','city','state'];const nodes=Object.fromEntries(ids.map(id=>[id,new Element('div')]));nodes.address.value='Synthetic test only';nodes.supply.value=privateWell?'private-well':'public';
 const report={headline:'Fixture report',summary:'Fixture only',private_well:privateWell,providers:[],access_plan:{money_summary:{potential_savings_low:10,potential_savings_high:10,savings_test:'Fixture test'},personalized:{},option_inventory:{}},actions:[{title:'Concrete next step',text:'Contact the verified source.'}],findings:privateWell?[]:[...extraFindings,{name:'Example analyte',provider:'Fixture system',result:'Below reporting limit',scope:'system-monitoring',first_sample:'2020-01-01',last_sample:'2020-01-01'}],risk_profile:{overall:'watch',risks:[{title:'Example analyte',level:'watch',meaning:'Fixture meaning',action:'Fixture action',evidence:'Fixture source'}]},compliance:[],generated_at:'2026-09-18',advisories:{records:[{title:'Fixture urgent notice',area:'Fixture area',affected_population:'All',guidance:'Follow the source',source_is_recent:true}],checks:[]}};
 Object.assign(report,reportFields);
 vm.runInNewContext(client,{document:{getElementById:id=>nodes[id],createElement:t=>new Element(t)},URL,URLSearchParams,Date,Map,AbortController,setTimeout,clearTimeout,fetch:async (url,options)=>{fixture.requests?.push({url,body:options?.body?JSON.parse(options.body):null});return {ok:true,json:async()=>url==='/api/national/impact'?{analytics:{views:12345,users:6789,updated_at:'2026-10-14T12:00:00Z'},savings:{potential_savings:25,since:'2026-10-14'}}:url.startsWith('/api/national/providers?')?{providers:fixture.providers||[]}:{...fixture.data,resident_report:report}};}});
 nodes['lookup-form'].listeners.submit({preventDefault(){}});for(let i=0;i<5;i++)await new Promise(setImmediate);
 assert.equal(nodes.message.textContent,'Your report is ready.');assert.match(nodes['public-impact'].textContent,/Lifetime views 12,345 Total users 6,789/);assert.doesNotMatch(nodes['public-impact'].textContent,/savings|\$/i);return nodes.results.children;
}
test('main result stays concise and puts see-all before next steps',async()=>{const headings=(await render(false)).map(x=>x.children[0]?.textContent);assert.match(headings[0],/YOUR WATER RESULTS/);assert.ok(!headings.includes('What the water tests found'));assert.ok(!headings.includes('Evidence behind this address profile'));});
test('private-well main result stays concise',async()=>{const headings=(await render(true)).map(x=>x.children[0]?.textContent);assert.match(headings[0],/YOUR WATER RESULTS/);assert.ok(!headings.includes('What to test in your well'));assert.ok(!headings.includes('Water notices to check now'));});

test('results reveal only four additional entries per click, and keep full records before actions',async()=>{
 const fixtures=Array.from({length:10},(_,i)=>({name:'Result '+i,result:i+' µg/L',health:{text:'Health context '+i}}));
 const [main]=await render(false,fixtures);
 const tiles=main.children.find(x=>x.className==='risk-tiles');
 const controls=main.children.find(x=>x.className==='result-controls');
 assert.equal(tiles.children.length,4);
 controls.children[1].listeners.click();assert.equal(tiles.children.length,8);
 controls.children[1].listeners.click();assert.equal(tiles.children.length,12);
 assert.equal(controls.children.length,2);
 assert.equal(controls.children[1].hidden,true);
 assert.match(tiles.textContent,/Health context 9/);
 assert.ok(main.children.findIndex(x=>x.className==='complete-evidence collapsed-evidence')<main.children.findIndex(x=>x.className==='what-now'));
});

test('GA4 follows exact introduction and site-wide savings never appear in the personal plan',async()=>{
 assert.match(HTML,/Public records do not replace a test of your own tap water\.<\/p><aside id="public-impact"/);
 const [main]=await render(false);
 const plan=main.children.find(x=>x.className==='access-plan action-plan-clean');
 assert.equal(plan.children[1].textContent,'Here is what to do next');
 const savings=plan.children.filter(x=>x.className==='clean-money aggregate-savings');
 assert.equal(savings.length,0);assert.match(plan.textContent,/Your potential testing savings.*\$10/);
 assert.doesNotMatch(plan.textContent,/Across completed lookups|\$25/);
});

test('saved records show a simple dated notice and keep different counts distinct',async()=>{
 const [main]=await render(false,[],{data_status:{status:'saved',refresh_available:true,last_verified_at:'2026-10-30T12:00:00Z'},complete_evidence:{water_findings:200,underlying_water_observation_rows:30,historical_water_summaries:200,source_availability:[{source:'historical-archive:NY0000001',status:'completed',retrieval_status:'saved',verified_at:'2026-10-30T12:00:00Z'}]}});
 const notice=main.children.find(x=>x.className==='record-status');assert.match(notice.textContent,/Showing verified records last checked on.*2026/);assert.equal(notice.children[1].textContent,'Check again');
 assert.match(main.textContent,/200 water findings/);assert.match(main.textContent,/30 individual test records in saved copies/);assert.doesNotMatch(main.textContent,/records checked|unique water findings|historical-archive|NY0000001/);
 assert.ok(main.children.indexOf(notice)<main.children.findIndex(x=>x.className==='risk-tiles'));
});

test('unconfirmed provider lookup offers name search and requires a deliberate selection',async()=>{
 const fixture={requests:[],providers:[{id:'NY7003493',name:'NEW YORK CITY SYSTEM',state:'NY'}],data:{address:{state:'NY',status:'not-found'},provider:{requires_selection:true}}};
 const [main]=await render(false,[],{providers:[],provider_match_method:'local-directory',findings:[],risk_profile:{overall:'verify',risks:[]}},fixture);
 assert.match(main.textContent,/could not confirm the exact address/);
 const picker=main.children.find(x=>x.className==='provider-picker clean-decision');assert.ok(picker);
 const input=picker.children.find(x=>x.tag==='input'),search=picker.children.find(x=>x.tag==='button');
 input.value='New York';await search.listeners.click();
 assert.match(picker.textContent,/NEW YORK CITY SYSTEM/);assert.match(picker.textContent,/mailing address does not show which homes it serves/);
 const list=picker.children.at(-1);assert.equal(list.children.length,1);
 const before=fixture.requests.filter(x=>x.body).length;assert.equal(before,1);
 list.children[0].children[1].listeners.click();for(let i=0;i<5;i++)await new Promise(setImmediate);
 const body=fixture.requests.filter(x=>x.body).at(-1).body;assert.equal(body.pwsid,'NY7003493');
});
