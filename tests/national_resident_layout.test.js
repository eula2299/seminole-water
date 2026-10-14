'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {CLIENT}=require('../national/ui');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};this.value='';this._text='';}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join(' ');}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this._text='';this.children=nodes;}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.listeners[k]=v;}focus(){}scrollIntoView(){}reportValidity(){return true;}
}
async function render(privateWell,extraFindings=[]){
 let client=CLIENT;
 if(process.env.LIVE_ORIGIN){assert.equal(process.env.LIVE_ORIGIN,'https://www.ismywaterok.com');const r=await fetch(process.env.LIVE_ORIGIN+'/national-client.js',{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);client=await r.text();assert.ok(client.length<100000);}
 const ids=['lookup-form','address','supply','lookup-button','message','results','how-it-works','progress'];const nodes=Object.fromEntries(ids.map(id=>[id,new Element('div')]));nodes.address.value='Synthetic test only';nodes.supply.value=privateWell?'private-well':'public';
 const report={headline:'Fixture report',summary:'Fixture only',private_well:privateWell,providers:[],actions:[{title:'Concrete next step',text:'Contact the verified source.'}],findings:privateWell?[]:[...extraFindings,{name:'Example analyte',provider:'Fixture system',result:'Below reporting limit',scope:'system-monitoring',first_sample:'2020-01-01',last_sample:'2020-01-01'}],risk_profile:{overall:'watch',risks:[{title:'Example analyte',level:'watch',meaning:'Fixture meaning',action:'Fixture action',evidence:'Fixture source'}]},compliance:[],generated_at:'2026-09-18',advisories:{records:[{title:'Fixture urgent notice',area:'Fixture area',affected_population:'All',guidance:'Follow the source',source_is_recent:true}],checks:[]}};
 vm.runInNewContext(client,{document:{getElementById:id=>nodes[id],createElement:t=>new Element(t)},URL,Date,Map,AbortController,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({resident_report:report})})});
 nodes['lookup-form'].listeners.submit({preventDefault(){}});for(let i=0;i<5;i++)await new Promise(setImmediate);
 assert.equal(nodes.message.textContent,'Your report is ready.');return nodes.results.children;
}
test('main result stays concise and puts see-all before next steps',async()=>{const headings=(await render(false)).map(x=>x.children[0]?.textContent);assert.match(headings[0],/YOUR WATER RESULTS/);assert.ok(!headings.includes('What the water tests found'));assert.ok(!headings.includes('Evidence behind this address profile'));});
test('private-well main result stays concise',async()=>{const headings=(await render(true)).map(x=>x.children[0]?.textContent);assert.match(headings[0],/YOUR WATER RESULTS/);assert.ok(!headings.includes('What to test in your well'));assert.ok(!headings.includes('Water notices to check now'));});

test('results paginate four at a time, reveal all, and keep full records before actions',async()=>{
 const fixtures=Array.from({length:10},(_,i)=>({name:'Result '+i,result:i+' µg/L',health:{text:'Health context '+i}}));
 const [main]=await render(false,fixtures);
 const tiles=main.children.find(x=>x.className==='risk-tiles');
 const controls=main.children.find(x=>x.className==='result-controls');
 assert.equal(tiles.children.length,1);
 controls.children[1].listeners.click();assert.equal(tiles.children.length,5);
 controls.children[1].listeners.click();assert.equal(tiles.children.length,9);
 controls.children[2].listeners.click();assert.equal(tiles.children.length,12);
 assert.equal(controls.children[1].hidden,true);assert.equal(controls.children[2].hidden,true);
 assert.match(tiles.textContent,/Health context 9/);
 assert.ok(main.children.findIndex(x=>x.className==='complete-evidence collapsed-evidence')<main.children.findIndex(x=>x.className==='what-now'));
});
