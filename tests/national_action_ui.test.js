'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.value='';this._text='';this.dataset={};this.hidden=false;this.isConnected=true;}
 append(...xs){this.children.push(...xs);}replaceChildren(...xs){this._text='';this.children=xs;}set textContent(t){this._text=String(t);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join(' ');}get lastElementChild(){return this.children.at(-1);}setAttribute(){}addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}fire(k){for(const fn of this.listeners[k]||[])fn({});}scrollIntoView(){}checkValidity(){return this.value.includes('@');}
}
const walk=(root,fn)=>{if(fn(root))return root;for(const child of root.children){const found=walk(child,fn);if(found)return found;}};
async function tick(){for(let i=0;i<5;i++)await new Promise(setImmediate);}
function setup(fetch){const D=require('../public/water-actions-data'),window={WaterActionData:D,WaterVoice:{focusLane(){}},open(){throw Error('Must not open email during test');}};vm.runInNewContext(fs.readFileSync(require.resolve('../public/water-actions.js'),'utf8'),{window,document:{createElement:t=>new Element(t)},fetch,AbortSignal,URLSearchParams,setTimeout});const parent=new Element('main');window.WaterActions.mount(parent,{action_token:'report-token',resident_report:{address:'123 Fixture St, Austin, TX',access_plan:{personalized:{state:'TX',provider:'Fixture Water'},what_to_ask_for:[{name:'Lead'}],option_inventory:{}}}});return {window,parent};}
const field=(root,name)=>walk(root,n=>n.tag==='label'&&n._text===name)?.lastElementChild;
test('contact and address fill automatically; edits invalidate email approval',async()=>{
 let request;const {parent,window}=setup(async(url,opts)=>{request=JSON.parse(opts.body);return {ok:true,json:async()=>({contacts:[{name:'Fixture Water',email:'water@example.gov',recommended:true,role:'water-provider',source_url:'https://example.gov/contact',source_label:'Public source'}]})};});
 window.WaterActions.choose('rent');await tick();assert.deepEqual(request,{token:'report-token',lane:'rent'});
 const to=field(parent,'Send to — email address (optional)'),body=field(parent,'Draft');assert.equal(to.value,'water@example.gov');assert.match(body.value,/123 Fixture St/);assert.match(body.value,/Hello Fixture Water/);assert.doesNotMatch(body.value,/Please note|Nothing has been sent/);
 walk(parent,n=>n.tag==='button'&&n._text==='Review email').fire('click');const review=walk(parent,n=>n.className==='action-review');assert.equal(review.hidden,false);
 body.value+=' A new detail.';body.fire('input');assert.equal(review.hidden,true);
 window.WaterActions.present({lane:'rent',subject:'Please test my water',body:'Hello,\n\nPlease test the water at [your address].\n\nPlease note: These public records...'});await tick();assert.match(field(parent,'Draft').value,/123 Fixture St/);assert.doesNotMatch(field(parent,'Draft').value,/Please note:/);
});
test('late lookup never overwrites a recipient edited by the resident',async()=>{
 let done;const {parent,window}=setup(()=>new Promise(resolve=>{done=resolve;}));window.WaterActions.choose('rent');const to=field(parent,'Send to — email address (optional)');to.value='manager@example.org';to.fire('input');done({ok:true,json:async()=>({contacts:[{name:'Water Office',email:'water@example.gov',recommended:true}]})});await tick();assert.equal(to.value,'manager@example.org');
});
test('neighbor sheets neither look up recipients nor include the street address',()=>{const {parent,window}=setup(()=>{throw Error('No contact lookup expected');});window.WaterActions.choose('neighbors');assert.doesNotMatch(field(parent,'Draft').value,/123 Fixture St/);});
