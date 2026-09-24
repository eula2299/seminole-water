'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {CLIENT}=require('../national/ui');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};this.value='';this._text='';}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join(' ');}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this._text='';this.children=nodes;}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.listeners[k]=v;}focus(){}scrollIntoView(){}reportValidity(){return true;}
}
async function render(privateWell){
 let client=CLIENT;
 if(process.env.LIVE_ORIGIN){assert.equal(process.env.LIVE_ORIGIN,'https://www.ismywaterok.com');const r=await fetch(process.env.LIVE_ORIGIN+'/national-client.js',{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);client=await r.text();assert.ok(client.length<100000);}
 const ids=['lookup-form','address','supply','lookup-button','message','results','how-it-works','progress'];const nodes=Object.fromEntries(ids.map(id=>[id,new Element('div')]));nodes.address.value='Synthetic test only';nodes.supply.value=privateWell?'private-well':'public';
 const report={headline:'Fixture report',summary:'Fixture only',private_well:privateWell,providers:[],actions:[{title:'Concrete next step',text:'Contact the verified source.'}],findings:privateWell?[]:[{name:'Example analyte',provider:'Fixture system',result:'Below reporting limit',scope:'system-monitoring',first_sample:'2020-01-01',last_sample:'2020-01-01'}],risk_profile:{overall:'watch',risks:[{title:'Example analyte',level:'watch',meaning:'Fixture meaning',action:'Fixture action',evidence:'Fixture source'}]},compliance:[],generated_at:'2026-09-18',advisories:{records:[{title:'Fixture urgent notice',area:'Fixture area',affected_population:'All',guidance:'Follow the source',source_is_recent:true}],checks:[]}};
 vm.runInNewContext(client,{document:{getElementById:id=>nodes[id],createElement:t=>new Element(t)},URL,Date,Map,AbortController,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({resident_report:report})})});
 nodes['lookup-form'].listeners.submit({preventDefault(){}});for(let i=0;i<5;i++)await new Promise(setImmediate);
 assert.equal(nodes.message.textContent,'Your report is ready.');return nodes.results.children.map(x=>x.children[0]?.textContent);
}
test('main result stays concise and puts see-all before next steps',async()=>{const headings=await render(false);assert.match(headings[0],/YOUR WATER RESULTS/);assert.ok(!headings.includes('What the water tests found'));assert.ok(!headings.includes('Evidence behind this address profile'));});
test('private-well main result stays concise',async()=>{const headings=await render(true);assert.match(headings[0],/YOUR WATER RESULTS/);assert.ok(!headings.includes('What to test in your well'));assert.ok(!headings.includes('Water notices to check now'));});
