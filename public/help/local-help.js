window.WaterHelpLocal={create(c){
 'use strict';
 const {I,main,page,el,text,box,field,select,check,button,link,api,toast,home}=c,t=k=>I.t(k);
 const kinds=['assistance','meetings','pipes','repairs','bill','support'];
 return async function local(initial='assistance'){
  page('localHelp','localHelpIntro',home);
  const location=c.getLocation(),form=box(main),city=field(form,'city','text',location.city),regions=await api('/api/help/agencies');
  if(!main.contains(form))return;
  const state=select(form,'chooseState',[['','choose'],...regions.jurisdictions.map(r=>[r.code,r.name])],location.state),kind=select(form,'helpTopic',kinds.map(k=>[k,'localKind_'+k]),kinds.includes(initial)?initial:'assistance');
  const tribal=check(form,'tribalHelp'),output=box(main,'local-results');
  const busy=el('p','');busy.setAttribute('role','status');form.append(busy);
  let generation=0;
  function request(kind,search){
   const original=c.getLocation(),samePlace=original.city.trim().toLowerCase()===search.city.toLowerCase()&&original.state.toUpperCase()===search.state;
   c.requestWizard(kind,{facts:samePlace?c.publicContext():[search.city,search.state].join(', '),useAddressContext:samePlace});
  }
  function routes(data,search){
   if(!data.region)return;
   if(data.programs?.length){const programs=box(output);programs.append(el('h2',t('nearYou')));for(const program of data.programs){const row=box(programs,'official-route');link(row,program.title,program.url,'button quiet');}}
   const section=box(output);section.append(el('h2',t('officialHelp')+' · '+data.region.name));
   for(const office of data.local_offices||[]){const row=box(section,'official-route');link(row,office.title,office.url,'button quiet');}
   const order={assistance:['social','water','consumer'],meetings:['local','state'],pipes:['water','local'],repairs:['water','social','local'],bill:['consumer','social','water'],support:['water','health','consumer']}[search.kind];
   for(const key of order){const route=data.region.routes[key];if(!route)continue;const row=box(section,'official-route');link(row,'agency_'+key,route.url,'button quiet');row.append(el('p',route.title,'fine'));}
   if(['pipes','repairs'].includes(search.kind))button(section,'requestInspection',()=>request('inspection',search),'quiet');
   if(search.kind==='meetings')button(section,'writeComment',()=>request('meeting',search),'quiet');
   if(search.kind==='assistance')button(section,'assistance',()=>request('assistance',search),'quiet');
   if(data.tribal){link(section,'tribalHelp',data.tribal.url,'button quiet');for(const tribe of data.tribes||[])for(const route of Object.values(tribe.routes||{}))link(section,tribe.name,route.url,'source');}
  }
  async function run(){
   if(!state.value||city.value.trim().length<2){toast(t('required'));return;}
   const thisRun=++generation,search={city:city.value.trim(),state:state.value,kind:kind.value,language:I.language};
   const active=()=>thisRun===generation&&main.contains(form);
   output.replaceChildren();busy.textContent=t('findingLocalHelp');
   try{
    const direct=await api('/api/help/agencies?'+new URLSearchParams({...search,tribal:String(tribal.checked)}));if(!active())return;routes(direct,search);
    const data=await api('/api/help/local',search);if(!active())return;
    if(data.items.length){const section=box(output);output.prepend(section);section.append(el('h2',t('nearYou')));
     for(const item of data.items){const row=box(section);const a=link(row,item.title,item.url,'source');if(a)a.textContent=item.title;row.append(el('blockquote',item.quote));if(item.deadline_label)row.append(el('p',t('sourceDeadline')+': '+item.deadline_label));else if(search.kind==='meetings')text(row,'checkSpeakingTime','fine');
      row.append(el('p',t('checkedOn')+' '+new Date(item.checked_at).toLocaleDateString(I.language),'fine'));
      if(I.language!=='en')button(row,'translatePage',async()=>{const translated=await api('/api/help/translate',{consent:true,language:I.language,texts:[item.title,item.quote]});const values=translated.translations;if(Array.isArray(values))row.append(el('p',values.join('\n'),'card soft'));},'quiet');
     }
    }else text(output,'useOfficialHelp','fine');
    if(data.suggestions){const frame=el('iframe');frame.src=data.suggestions;frame.title=t('searchLinks');frame.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');frame.referrerPolicy='no-referrer';frame.className='search-attribution';output.append(frame);}
    busy.textContent=t('localReady');
   }catch{if(active())busy.textContent=t(output.children.length?'officialReady':'sourceUnavailable');}
  }
  const changed=()=>{generation++;output.replaceChildren();busy.textContent='';};
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  button(form,'findLocalHelp',run);text(form,'cityOnlySearch','fine');
  if(location.city&&location.state)await run();
 };
}};
