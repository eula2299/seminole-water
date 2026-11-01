'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
class Element {
 constructor(tag,text=''){this.tag=tag;this.textContent=text;this.children=[];this.listeners={};}
 append(...nodes){this.children.push(...nodes);}
 prepend(...nodes){this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 contains(node){return this===node||this.children.some(child=>child.contains?.(node));}
 setAttribute(){}
 addEventListener(event,fn){this.listeners[event]=fn;}
}
function harness({place={address:'1 Old Street',city:'Old City',state:'NY'},api}={}){
 const main=new Element('main'),fields={},buttons={},requests=[],notices=[],window={};
 const el=(tag,text)=>new Element(tag,text),box=parent=>{const n=el('section');parent.append(n);return n;};
 const field=(parent,key,type,value)=>{const n=el('input');n.value=value||'';fields[key]=n;parent.append(n);return n;};
 const c={main,I:{t:k=>k,language:'en'},getLocation:()=>place,publicContext:()=> '1 Old Street, Old City, NY\nLead: published source',home(){},el,box,field,
  page(){main.replaceChildren();},text(parent,key){parent.append(el('p',key));},toast:key=>notices.push(key),
  select(parent,key,items,value){const n=field(parent,key,'select',value??items[0][0]);return n;},check(parent,key){const n=field(parent,key);n.checked=false;return n;},
  button(parent,key,fn){const n=el('button',key);n.run=fn;buttons[key]=n;parent.append(n);return n;},link(parent,key,url){const n=el('a',key);n.href=url;parent.append(n);return n;},
  api:api|| (async url=>url==='/api/help/agencies'?{jurisdictions:[{code:'NY',name:'New York'},{code:'CO',name:'Colorado'}]}:url.startsWith('/api/help/agencies?')?{region:{name:'Example',routes:{water:{title:'Water',url:'https://example.gov/water'}}}}:{items:[]}),
  requestWizard:(kind,values)=>requests.push({kind,values})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/help/local-help.js'),'utf8'),{window,URLSearchParams});
 return {main,fields,buttons,requests,notices,run:window.WaterHelpLocal.create(c)};
}
const pause=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('local-help requests preserve home evidence only for the same searched place',async()=>{
 const h=harness();await h.run();await h.buttons.assistance.run();
 assert.equal(h.requests[0].values.useAddressContext,true);assert.match(h.requests[0].values.facts,/1 Old Street/);
 h.fields.city.value='New City';h.fields.chooseState.value='CO';await h.buttons.findLocalHelp.run();await h.buttons.assistance.run();
 assert.equal(h.requests[1].values.facts,'New City, CO');assert.equal(h.requests[1].values.useAddressContext,false);assert.doesNotMatch(h.requests[1].values.facts,/Old Street|Lead/);
});
test('changing search controls discards an old in-flight result without requesting the wrong topic',async()=>{
 const gate=pause(),calls=[];
 const h=harness({place:{city:'',state:'NY'},api:async(url,body)=>{calls.push({url,body});if(url==='/api/help/agencies')return {jurisdictions:[]};if(url.startsWith('/api/help/agencies?'))return gate.promise;return {items:[]};}});
 await h.run();h.fields.city.value='Example';const pending=h.buttons.findLocalHelp.run();h.fields.helpTopic.value='meetings';h.main.children[0].listeners.change();
 gate.resolve({region:{name:'Example',routes:{}}});await pending;
 assert.equal(calls.filter(x=>x.url==='/api/help/local').length,0);assert.equal(h.buttons.assistance,undefined);assert.equal(h.buttons.writeComment,undefined);
});
test('leaving local help while its directory loads does not append stale controls to another page',async()=>{
 const gate=pause(),h=harness({api:async()=>gate.promise});const pending=h.run();h.main.replaceChildren(new Element('h1','Different page'));gate.resolve({jurisdictions:[]});await pending;
 assert.equal(h.main.children.length,1);assert.equal(h.main.children[0].textContent,'Different page');assert.equal(h.buttons.findLocalHelp,undefined);
});
test('directory failure stops the loading indicator and retains the search for retry',async()=>{
 const h=harness({place:{city:'',state:'NY'},api:async url=>{if(url==='/api/help/agencies')return {jurisdictions:[]};throw Error('private backend stack trace');}});
 await h.run();h.fields.city.value='Example';await h.buttons.findLocalHelp.run();
 const status=h.main.children[0].children.find(n=>n.tag==='p');assert.equal(status.textContent,'sourceUnavailable');assert.ok(h.buttons.findLocalHelp);assert.equal(h.fields.city.value,'Example');
});
test('an AI-source failure retains real official routes and offers their links',async()=>{
 const h=harness({api:async url=>{if(url==='/api/help/agencies')return {jurisdictions:[]};if(url.startsWith('/api/help/agencies?'))return {region:{name:'Example',routes:{water:{title:'Office',url:'https://example.gov'}}}};throw Error('AI_BUSY');}});
 await h.run();assert.ok(h.buttons.assistance);const status=h.main.children[0].children.find(n=>n.tag==='p');assert.equal(status.textContent,'officialReady');
});
async function startApp(route){
 const main=new Element('main'),elements={main};
 for(const id of ['language','large','speak','notice','footer'])elements[id]=new Element('div');
 Element.prototype.focus=function(){};
 const skip=new Element('a'),document={getElementById:id=>elements[id],createElement:tag=>new Element(tag),querySelector:()=>skip};
 const window={scrollTo(){}};let context;
 const scripts={document,window,URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout,location:{pathname:'/help/status',hash:'',origin:'https://example.test'},sessionStorage:{getItem:()=>null,removeItem(){}},
  WaterHelpI18n:{set:async()=>{},preferred:()=> 'en',t:k=>k,language:'en',snapshot:()=>({})},WaterHelpLogic:{},WaterHelpVault:{},WaterHelpDocuments:{},
  WaterHelpExtended:{create(c){context=c;return {repairStatus:()=>route(c),directory:()=>{c.page('allTools');}};}},fetch:async()=>new Response(JSON.stringify({ai:false,groups:false,promises:false,forms:[]}))};
 const completion=vm.runInNewContext(fs.readFileSync(require.resolve('../public/help/app.js'),'utf8'),scripts);await completion;
 const collect=(node,tag)=>[...(node.tag===tag?[node]:[]),...node.children.flatMap(child=>collect(child,tag))];
 return {main,context,buttons:()=>collect(main,'button'),paragraphs:()=>collect(main,'p')};
}
test('direct async help route failures preserve navigation and provide a working retry without exposing errors',async()=>{
 let attempts=0;
 const h=await startApp(async c=>{c.page('repairStatus');if(++attempts===1)throw Error('internal database secret');c.main.append(c.el('p','Recovered result'));});
 assert.ok(h.paragraphs().some(n=>n.textContent==='error'));assert.ok(!h.paragraphs().some(n=>/database/.test(n.textContent)));
 const retry=h.buttons().find(n=>n.textContent==='tryAgain');assert.ok(retry);await retry.listeners.click();
 assert.equal(attempts,2);assert.ok(h.paragraphs().some(n=>n.textContent==='Recovered result'));assert.ok(!h.buttons().some(n=>n.textContent==='tryAgain'));
});
test('direct synchronous tool failures are also recoverable',async()=>{
 const h=await startApp(c=>{c.page('repairStatus');throw Error('internal exception');});assert.ok(h.buttons().some(n=>n.textContent==='tryAgain'));assert.ok(h.buttons().some(n=>n.textContent==='allTools'));
});
