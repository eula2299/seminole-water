/* Five practical actions, editable drafts, and an explicit external-sharing review. */
(()=>{
 'use strict';let current=null;
 const e=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,fn,cls='')=>{const n=e('button',text,cls);n.type='button';n.addEventListener('click',fn);return n;};
 function mount(parent,data){
  const D=window.WaterActionData;if(!D)return;
  const context=D.context(data),address=data.resident_report?.address||data.address?.matched_address||data.entered_address||'',contactCache=new Map();let generation=0;
  const section=e('section',null,'water-actions');section.id='water-action-help';section.setAttribute('aria-labelledby','water-actions-title');
  const title=e('h2','What do you need help with?');title.id='water-actions-title';section.append(e('p','LET’S GET SOMETHING DONE','action-kicker'),title,e('p','Choose one. We’ll prepare the next step with you. You review anything before sharing it.','action-intro'));
  const choices=e('div',null,'action-choices'),panel=e('div',null,'action-workspace');panel.hidden=true;section.append(choices,panel);parent.append(section);
  let selected=null,active=null,bodyInput,subjectInput,toInput,review,status,answers={},drafts={};
  function save(){if(selected&&bodyInput)drafts[selected]={body:bodyInput.value,subject:subjectInput.value,to:toInput.value};}
  function show(lane,fromVoice){
   if(!D.labels[lane])return;save();const version=++generation;selected=lane;active=D.forAddress(D.prepare(context,lane,answers[lane]||{}),address);if(fromVoice)active=D.forAddress({...active,body:fromVoice.body||active.body,subject:fromVoice.subject||active.subject},address);panel.replaceChildren();panel.hidden=false;
   for(const b of choices.children)b.setAttribute('aria-pressed',String(b.dataset.lane===lane));
   const head=e('div',null,'action-work-head');head.append(e('h3',active.title),button('Talk this through',()=>window.WaterVoice?.focusLane(lane),'action-talk'));panel.append(head,e('p',active.description,'action-description'));
   if(!data.voice_token)head.lastElementChild.hidden=true;
   const custom=e('details',null,'action-customize');custom.append(e('summary','Make this fit my situation'));
   const fields=e('div',null,'action-fields');const controls={};
   const select=(key,label,items)=>{const l=e('label',label),s=e('select');for(const [value,text]of items){const o=e('option',text);o.value=value;s.append(o);}s.value=answers[lane]?.[key]||items[0][0];controls[key]=s;l.append(s);fields.append(l);};
   const input=(key,label,type='text')=>{const l=e('label',label),v=e(type==='textarea'?'textarea':'input');if(type!=='textarea')v.type=type;v.value=answers[lane]?.[key]||'';v.maxLength=key==='request'?1200:200;controls[key]=v;l.append(v);fields.append(l);};
   if(lane==='afford'){select('goal','What do you need?',[['testing','Help paying for testing'],['repair','Help repairing pipes or water equipment']]);select('housing','Your housing — optional',[['unknown','Prefer not to say'],['rent','I rent'],['own','I own and live here']]);}
   if(lane==='followup'){input('contact','Who did you contact?');input('date','When?','date');input('request','What did you ask for?','textarea');select('goal','Next step',[['reply','Ask for an update'],['visit','Request a phone or in-person appointment']]);}
   if(fields.children.length){custom.append(fields,button('Update my draft',()=>{answers[lane]=Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.value]));delete drafts[lane];bodyInput=null;show(lane);}));panel.append(custom);}
   const list=e('div',null,'action-sources');
   for(const item of active.options){if(!D.url(item.url))continue;const card=e('article');card.append(e('strong',item.title));if(item.price_label)card.append(e('span',item.price_label,'action-price'));if(item.test)card.append(e('p','For: '+item.test));card.append(e('p',item.note||'Ask this organization whether it serves your address and what you need to apply.'));const link=e('a','Check source and contact details ↗');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);if(item.phone&&/^[+\d ()-]+$/.test(item.phone)){const call=e('a','Call '+item.phone);call.href='tel:'+item.phone.replace(/[^+\d]/g,'');card.append(call);}if(item.checked)card.append(e('small','Source reviewed '+item.checked));list.append(card);}
   if(list.children.length)panel.append(list);
   const checklist=e('ul',null,'action-checklist');for(const item of active.checklist)checklist.append(e('li',item));panel.append(checklist);
   const editor=e('div',null,'action-editor');editor.append(e('h4',lane==='neighbors'?'Your printable sheet':lane==='explain'?'Your explanation and questions':'Your prepared request'));
   editor.append(e('p','Edit anything below. Nothing is sent to anyone until you choose to share it.','action-small'));
   function field(label,tag){const l=e('label',label),f=e(tag);l.append(f);editor.append(l);return f;}
   subjectInput=field('Subject / title','input');subjectInput.value=drafts[lane]?.subject||active.subject;subjectInput.maxLength=180;
   bodyInput=field('Draft','textarea');bodyInput.value=drafts[lane]?.body||active.body;bodyInput.rows=12;bodyInput.maxLength=8000;
   toInput=field('Send to — email address (optional)','input');toInput.type='email';toInput.value=drafts[lane]?.to||'';toInput.placeholder='Enter the contact’s email address';toInput.maxLength=254;
   const contactBox=e('div',null,'action-contact');editor.append(contactBox);
   const actions=e('div',null,'action-buttons');status=e('p','Nothing has been sent.','action-status');status.setAttribute('role','status');review=e('div',null,'action-review');review.hidden=true;
   function text(){return subjectInput.value+'\n\n'+bodyInput.value;}
   function download(){const b=new Blob([text()],{type:'text/plain;charset=utf-8'}),u=URL.createObjectURL(b),a=e('a');a.href=u;a.download='my-water-'+lane+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);status.textContent='Your document was downloaded. Nothing was sent.';}
   function print(){document.getElementById('water-action-print')?.remove();const page=e('article');page.id='water-action-print';page.append(e('h1',subjectInput.value),e('pre',bodyInput.value));document.body.append(page);document.body.classList.add('printing-water-action');const cleanup=()=>{page.remove();document.body.classList.remove('printing-water-action');window.removeEventListener('afterprint',cleanup);};window.addEventListener('afterprint',cleanup);window.print();}
   function reviewDraft(){review.replaceChildren();review.hidden=false;const snapshot={to:toInput.value.trim(),subject:subjectInput.value,body:bodyInput.value};review.append(e('h4','Review before sharing'),e('p','Nothing is sent by IsMyWaterOK. Approving below opens this exact draft in your email service. You still press Send there.'),e('p','To: '+(snapshot.to||'Add a verified email address above.')),e('strong',snapshot.subject),e('pre',snapshot.body));
    const buttons=e('div',null,'action-buttons');
    for(const [label,base]of [['Approve and open Gmail','https://mail.google.com/mail/?view=cm&fs=1&'],['Approve and open email app','mailto:']]){const b=button(label,()=>{if(toInput.value.trim()!==snapshot.to||subjectInput.value!==snapshot.subject||bodyInput.value!==snapshot.body){reviewDraft();return;}const params=new URLSearchParams({su:snapshot.subject,body:snapshot.body,to:snapshot.to});const href=base==='mailto:'?'mailto:'+encodeURIComponent(snapshot.to)+'?'+new URLSearchParams({subject:snapshot.subject,body:snapshot.body}):base+params;window.open(href,'_blank','noopener,noreferrer');status.textContent='Draft opened for your review. This site has not sent it.';});b.disabled=!snapshot.to||!toInput.checkValidity();buttons.append(b);}buttons.append(button('Keep editing',()=>{review.hidden=true;}));review.append(buttons);review.scrollIntoView({behavior:'smooth',block:'nearest'});
   }
   actions.append(button('Download',download),button('Print',print),button('Review email',reviewDraft,'action-primary'));editor.append(actions,status,review);panel.append(editor);
   for(const f of [bodyInput,subjectInput,toInput])f.addEventListener('input',()=>{review.hidden=true;status.textContent='Draft changed. Review it again before sharing.';});
   panel.append(e('p',active.source_note,'action-small'));
   let editedTo=false;toInput.addEventListener('input',()=>{editedTo=true;});
   async function findContact(){
    contactBox.replaceChildren(e('p','Finding the right contact for this water check…'));const key=lane+':'+(answers[lane]?.goal||'');
    try{
     let result=contactCache.get(key);
     if(!result){if(!data.action_token)throw Error('No lookup token');const response=await fetch('/api/national/action-contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:data.action_token,lane,goal:answers[lane]?.goal}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Lookup failed');result=await response.json();if(result.status!=='busy'&&result.status!=='expired')contactCache.set(key,result);}
     if(version!==generation||!section.isConnected)return;
     contactBox.replaceChildren();
     const choices=(result.contacts||[]).filter(x=>x.email);
     if(choices.length){
      const label=e('label','Contact found for your request'),select=e('select');const placeholder=e('option','Choose who should receive this');placeholder.value='';select.append(placeholder);
      for(const [i,c]of choices.entries()){const option=e('option',c.name+' — '+c.email);option.value=String(i);select.append(option);}label.append(select);contactBox.append(label);
      const source=e('p',null,'action-small');contactBox.append(source);
      const apply=c=>{if(bodyInput.value===active.body){active=D.forAddress(active,address,c);bodyInput.value=active.body;}toInput.value=c.email;review.hidden=true;status.textContent='Contact filled in. Review the address and message before sharing.';source.replaceChildren(e('span',c.source_label||'Published contact'));if(c.source_url&&D.url(c.source_url)){const a=e('a',' View contact source ↗');a.href=c.source_url;a.target='_blank';a.rel='noopener noreferrer';source.append(a);}if(c.role==='water-provider'&&lane==='rent')source.append(e('span',' This is your water provider, not your landlord.'));};
      select.addEventListener('change',()=>{if(select.value!==''){editedTo=true;apply(choices[Number(select.value)]);}});
      // Fill only an unambiguous destination. A choice is preferable to a guessed recipient.
      const recommended=choices.findIndex(c=>c.recommended&&!c.ambiguous);
      if(!editedTo&&!toInput.value&&(recommended>=0||choices.length===1&&!choices[0].ambiguous)){const index=recommended>=0?recommended:0;select.value=String(index);apply(choices[index]);}
      else if(!toInput.value)source.textContent='We found more than one possible contact. Choose the office you want to reach.';
     }else contactBox.append(e('p',result.status==='expired'?'Run the water check again to refresh contact details.':'This office uses a contact page or phone. Use the verified route below with your prepared message.'));
     for(const route of result.routes||[]){if(!D.url(route.url))continue;const link=e('a','Contact '+route.name+' ↗');link.href=route.url;link.target='_blank';link.rel='noopener noreferrer';contactBox.append(link);}
    }catch{if(version!==generation)return;contactBox.replaceChildren(e('p','Contact lookup could not finish.'),button('Try finding the contact again',findContact));}
   }
   if(lane!=='neighbors')findContact();

   if(fromVoice){bodyInput.value=active.body;subjectInput.value=active.subject;status.textContent='The AI prepared this draft. Check the details before sharing. Nothing has been sent.';}
  }
  for(const [lane,label]of Object.entries(D.labels)){const b=button(label,()=>{show(lane);panel.scrollIntoView({behavior:'smooth',block:'start'});});b.dataset.lane=lane;b.setAttribute('aria-pressed','false');choices.append(b);}
  current={present(action){show(action.lane,action);panel.scrollIntoView({behavior:'smooth',block:'start'});},choose(lane){show(lane);panel.scrollIntoView({behavior:'smooth',block:'start'});}};
 }
 window.WaterActions={mount,present:a=>current?.present(a),choose:lane=>current?.choose(lane)};
})();
