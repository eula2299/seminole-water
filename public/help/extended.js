window.WaterHelpExtended = { create(c) {
  'use strict';
  const {I,L,V,D,main,page,el,text,box,field,select,check,button,link,actions,detail,save,toast,api,tile,money,requestWizard,home,editStep,progress,configReady,getConfig}=c;
  const E=WaterHelpExtendedLogic,t=(k,v)=>I.t(V.isSessionOnly?.()&&k==='saved'?'keptForNow':V.isSessionOnly?.()&&k==='save'?'keepForVisit':k,v);
  let previousModule='water',lastAdvice='';
  const today=()=>new Date().toISOString().slice(0,10);
  async function ensure(fn){if((await V.state()).locked)return vault(fn);return fn();}
  async function vault(resume=progress){
    const state=await V.state();page(state.configured?'unlockVault':'protectVault','vaultExplained',home);
    if(!state.secure){text(main,'backupSecure','card warning');text(main,'sessionOnlyWarning','fine');button(main,'continueUnsaved',()=>{V.startSession();resume();},'quiet');return;}
    const password=field(main,'password','password','','passwordHelp');password.minLength=12;password.autocomplete=state.configured?'current-password':'new-password';
    let again;if(!state.configured)again=field(main,'repeatPassword','password');
    text(main,'passwordLost','fine');
    button(main,'continueUnsaved',()=>{V.startSession();resume();},'quiet');
    text(main,'sessionOnlyWarning','fine');
    button(main,state.configured?'unlockVault':'protectVault',async()=>{
      if(password.value.length<12||again&&password.value!==again.value){toast(t('passwordMismatch'));return;}
      try{await V.unlock(password.value);}catch{toast(t('backupError'));return;}
      password.value='';if(again)again.value='';await resume();
    });
  }
  function reminder(parent,event){
    button(parent,'calendarReminder',()=>{
      D.download(E.calendar(event),'water-help-reminder.ics','text/calendar;charset=utf-8');
      text(main,'calendarReminderHelp','card soft');
    },'quiet');
  }
  async function forms(){
    page('formHelp','formHelpIntro',home);
    button(main,'repairForm',c.repairIntake,'quiet');
    const b=box(main),file=field(b,'uploadForm','file');file.accept='.pdf';
    text(b,'formSensitive','fine');
    file.addEventListener('change',async()=>{try{
      if(!file.files[0]){toast(t('required'));return;}
      const spec=await D.inspectForm(file.files[0]);
      const location=c.getLocation();
      const values=Object.fromEntries(spec.fields.map(f=>[f.id,f.value || (f.type==='text'&&!f.sensitive?({city:location.city,state:location.state,'street address':location.address,'property address':location.address})[f.label?.toLowerCase()]||'':f.value)]));
      if(!spec.fields.length){text(b,'flatForm','card');button(b,'askAdvocate',()=>advocate('form'),'quiet');return;}
      const url=URL.createObjectURL(new Blob([spec.bytes],{type:'application/pdf'}));
      const usable=spec.fields.filter(f=>!f.sensitive&&f.label);
      if(!usable.length){text(b,'unlabeledForm','card');return;}
      function step(index){
        if(index>=usable.length)return review();
        const f=usable[index];page('formHelp','formKeepOriginal',()=>index?step(index-1):forms());
        main.append(el('p',(index+1)+' / '+usable.length,'step'));
        const original=el('a',t('openOriginal'),'button quiet');original.href=url;original.target='_blank';original.rel='noopener';main.append(original);
        const b=box(main);b.append(el('h2',f.label||t('questionNumber',{number:index+1})));
        if(!f.label)text(b,'formNoLabel','fine');
        let input;
        if(f.type==='checkbox')input=check(b,'tickBox',!!values[f.id]);
        else if(f.type==='choice')input=select(b,'yourAnswer',[['','skip'],...f.options.map(v=>[v,v])],values[f.id]);
        else {input=field(b,'yourAnswer','textarea',values[f.id]||'');input.maxLength=Math.min(f.maxLength,8000);}
        button(b,index===usable.length-1?'review':'continue',()=>{values[f.id]=f.type==='checkbox'?input.checked:input.value;step(index+1);});
        button(b,'skip',()=>step(index+1),'quiet');
        button(main,'askAdvocate',()=>advocate('form',f.label||t('formNoLabel')),'quiet');
      }
      function review(){
        page('review','formReview',()=>step(Math.max(0,usable.length-1)));
        const table=el('dl');for(const f of usable){table.append(el('dt',f.label||t('questionNumber',{number:f.number})),el('dd',String(values[f.id]??'')));}main.append(table);
        text(main,'formSensitive','fine');
        if(usable.length<spec.fields.length)text(main,'unlabeledForm','fine');
        button(main,'downloadForm',async()=>D.download(await D.fillUploadedForm(spec,values),'completed-form-review.pdf'));
        button(main,'submissionHelp',()=>submission({title:spec.name,document:usable.map(f=>(f.label||t('questionNumber',{number:f.number}))+': '+(values[f.id]??'')).join('\n')}),'quiet');
      }
      step(0);
    }catch{toast(t('readFileError'));}});
    text(b,'readsAutomatically','fine');
  }
  async function maintenance(product=null,family=null,daily=1){
    page('maintenance','maintenanceIntro',c.costs);
    const catalog=await api('/api/help/filters');
    const selectProduct=select(main,'filterName',catalog.products.map(p=>[p.id,p.name]),product?.id);
    const b=box(main);let element,installed,volume;
    function show(){
      b.replaceChildren();product=catalog.products.find(p=>p.id===selectProduct.value);family=catalog.replacement_families[product.replacement_family];
      const elements=family.elements||[family];
      element=select(b,'cartridgeName',elements.map((f,i)=>[String(i),f.element||f.name||String(i+1)]),'0');
      installed=field(b,'installedDate','date',today());volume=field(b,'gallons','number',daily,'gallonsHelp');volume.min='.1';volume.max='100';
      button(b,'showReplacement',()=>{
        const f=elements[Number(element.value)],due=E.maintenance({installed:installed.value,months:f.max_months,gallons:f.capacity_gallons_each,daily:volume.value});
        if(!due){toast(t('required'));return;}
        const section=box(main,'card soft');section.append(el('h2',t('replaceBy')+': '+due.due));text(section,'maintenanceCaution','fine');
        if(f.performance_source||family.performance_source)link(section,'source',f.performance_source||family.performance_source,'source');
        reminder(section,{title:t('replaceFilter')+' · '+product.name,date:due.due,description:t('maintenanceCaution')});
        const item={kind:'maintenance',title:product.name+' · '+(f.element||f.name||''),status:'scheduled',follow_date:due.due,document:t('maintenanceCaution'),maintenance:{installed:installed.value,daily:Number(volume.value),months:f.max_months,gallons:f.capacity_gallons_each},events:[]};
        button(section,'save',()=>ensure(async()=>{await V.put(item);toast(t('saved'));}), 'quiet');
      });
    }
    selectProduct.addEventListener('change',show);show();
  }
  async function assistance(){
    page('assistanceTracker','assistanceTrackerIntro',c.costs);
    c.localOptions(main);
    button(main,'prepareRequest',()=>requestWizard('assistance'));
    button(main,'progress',()=>assistanceSaved(),'quiet');
  }
  async function assistanceSaved(){
    return ensure(async()=>{
      page('assistanceTracker','assistanceTrackerIntro',c.costs);
      const items=(await V.list()).filter(i=>i.kind==='assistance');
      const received=items.reduce((n,i)=>n+(L.amount(i.received)||0),0);
      main.append(el('p',t('totalReceived')+': '+money(received),'money'));
      button(main,'addProgram',()=>assistanceForm());
      button(main,'assistance',()=>requestWizard('assistance'),'quiet');
      for(const item of items){const b=box(main);b.append(el('h2',item.title),el('p',t(item.status)),el('p',t('received')+': '+money(item.received||0)));button(b,'edit',()=>assistanceForm(item),'quiet');if(item.follow_date)reminder(b,{title:item.title,date:item.follow_date,description:t('followDate')});}
      if(!items.length)text(main,'emptyProgress','empty');
    });
  }
  function assistanceForm(item={}){
    page('assistanceTracker','receivedHelp',assistance);
    const name=field(main,'programName','text',item.title||''),status=select(main,'status',['prepared','submitted','acknowledged','approved','receivedStatus','denied'].map(k=>[k,k]),item.status||'prepared'),requested=field(main,'amountRequested','number',item.requested??''),received=field(main,'received','number',item.received??''),date=field(main,'followDate','date',item.follow_date||''),notes=field(main,'notes','textarea',item.document||'');
    requested.min='0';received.min='0';
    button(main,'save',()=>ensure(async()=>{
      if(!name.value.trim()||!requested.checkValidity()||!received.checkValidity()){toast(t('required'));return;}
      await V.put({...item,kind:'assistance',title:name.value,status:status.value,requested:L.amount(requested.value),received:L.amount(received.value),follow_date:date.value,document:notes.value,events:item.events||[]});await assistanceSaved();
    }));
  }
  async function billRates(){
    page('rateCheck','rateCheckIntro',c.costs);
    const data=await api('/api/help/rates'),b=box(main);
    const utility=select(b,'waterProvider',data.rates.map(r=>[r.id,r.name]));
    const rate=data.rates[0];if(!rate){text(b,'notConnected');return;}
    const scope=check(b,'rateScope'),readDate=field(b,'readDate','date',today()),usage=field(b,'meterUsage','number'),water=field(b,'waterCharge','number');
    const intro=el('p',t('rateScopeDetails'),'fine');b.prepend(intro);const source=link(b,'officialRates',rate.source,'source');
    const extra=detail(b,'checkMeter',()=>{}),start=field(extra,'meterStart','number'),end=field(extra,'meterEnd','number'),days=field(extra,'billDays','number'),oldUsage=field(extra,'previousUsage','number'),oldDays=field(extra,'previousDays','number');
    utility.addEventListener('change',()=>{const r=data.rates.find(r=>r.id===utility.value);intro.textContent=t('rateScopeDetails');if(source)source.href=r.source;});
    button(b,'checkBill',()=>{
      const rate=data.rates.find(r=>r.id===utility.value);
      const result=E.auditBill({unit:rate.unit,readDate:readDate.value,scopeConfirmed:scope.checked,usage:usage.value,waterCharge:water.value,start:start.value,end:end.value,days:days.value,previousUsage:oldUsage.value,previousDays:oldDays.value},rate);
      const out=box(main,'card soft');
      if(result.rateCheck){out.append(el('h2',t('expectedWater')+': '+money(result.rateCheck.expected)),el('p',t('difference')+': '+money(result.rateCheck.difference)));}
      else text(out,'rateNotCompared');
      for(const issue of result.issues)text(out,issue.code);
      if(!result.issues.length&&result.rateCheck)text(out,'noMathIssue');
      text(out,'billNotVerdict','fine');
      button(out,'askBillQuestion',()=>requestWizard('bill',{facts:t('waterCharge')+': '+water.value+'\n'+t('meterUsage')+': '+usage.value+' '+rate.unit+'\n'+t('expectedWater')+': '+(result.rateCheck?.expected??t('notStated'))+'\n'+rate.source}));
    });
    button(main,'bill',c.billUpload,'quiet');
  }
  function treatment(){
    page('treatment','treatmentPrivate',c.rights);
    const date=field(main,'incidentDate','date',today()),office=field(main,'officeName'),facts=field(main,'whatHappened','textarea'),requested=field(main,'whatYouAsked','textarea');
    const extra=detail(main,'details',()=>{}),reason=field(extra,'whyUnequal','textarea'),witness=field(extra,'witnesses','textarea');
    button(main,'save',()=>ensure(async()=>{
      if(!facts.value.trim()){toast(t('required'));return;}
      const item=await V.put({kind:'treatment',title:office.value||t('treatment'),status:'prepared',document:[date.value,office.value,facts.value,requested.value,reason.value,witness.value].join('\n\n'),events:[{date:date.value,status:'prepared',note:facts.value}]});await editStep(item);
    }));
    button(main,'complaint',()=>requestWizard('treatment',{facts:[date.value,office.value,facts.value,requested.value,reason.value].join('\n\n')}),'quiet');
  }
  async function escalation(){
    page('escalation','escalationIntro',c.rights);
    const issue=select(main,'problemType',[['quality','waterQuality'],['pipes','repairs'],['bill','bill'],['housing','rentalHousing'],['discrimination','treatment']]);
    const contacted=check(main,'alreadyAsked'),response=select(main,'responseSoFar',[['none','noResponse'],['received','receivedResponse']]),provider=select(main,'providerType',[['unknown','notStated'],['regulated','regulatedUtility'],['municipal','cityUtility']]);
    button(main,'showNextOffice',async()=>{
      const data=await api('/api/help/advocacy'),routes=E.escalation({issue:issue.value,contacted:contacted.checked,response:response.value,providerType:provider.value});
      const out=box(main,'card soft');text(out,'escalationNotLegal','fine');
      routes.forEach((id,i)=>{const r=data.routes[id];if(!r)return;const b=box(out);b.append(el('h2',(i+1)+'. '+t(r.titleKey)));text(b,r.descriptionKey);if(r.url)link(b,'openOffice',r.url,'button quiet');});
      button(out,'complaint',()=>requestWizard('complaint'));
      button(out,'submissionHelp',()=>submission(),'quiet');
    });
  }
  function submission(item={}){
    page('submissionHelp','submissionIntro',c.rights);
    const title=field(main,'stepTitle','text',item.title||''),office=field(main,'officeName','text',item.recipient||''),url=field(main,'officialFormLink','url',item.url||''),reference=field(main,'receipt','text',item.receipt||''),date=field(main,'submittedDate','date',item.submittedDate||''),follow=field(main,'followDate','date',item.follow_date||'');
    const sent=check(main,'iSubmitted',item.status==='submitted');
    button(main,'openSubmission',()=>{try{const u=new URL(url.value);if(u.protocol!=='https:')throw Error();const a=link(main,'openSubmission',u.href,'button quiet');a?.focus();}catch{toast(t('required'));}});
    text(main,'submissionProof','fine');
    button(main,'save',()=>ensure(async()=>{
      if(!title.value.trim()){toast(t('required'));return;}
      await V.put({...item,kind:item.kind||'request',title:title.value,recipient:office.value,url:url.value,receipt:reference.value,submittedDate:date.value,follow_date:follow.value,status:sent.checked?'submitted':'prepared',events:[...(item.events||[]),{date:new Date().toISOString(),status:sent.checked?'submitted':'prepared',receipt:reference.value}]});await progress();
    }));
    button(main,'escalation',escalation,'quiet');
  }
  async function repairStatus(){
    page('repairStatus','repairStatusIntro',c.repairs);
    const data=await api('/api/help/status-sources');
    const search=box(main);search.append(el('h2','Pittsburgh 311'));
    const number=field(search,'caseNumber'),year=field(search,'caseYear','number',new Date().getFullYear());
    const out=el('section');
    button(search,'findCase',async()=>{
      out.replaceChildren(el('p',t('working')));let data;
      try{data=await api('/api/help/request-status',{number:number.value,year:year.value});}
      catch{out.replaceChildren(el('p',t('sourceUnavailable')));return;}
      out.replaceChildren();if(!data.records.length)text(out,'caseNotFound');
      for(const r of data.records){const b=box(out);b.append(el('h2',r.number+' · '+r.subject),el('p',t('officeRecord')+': '+r.status+' · '+r.office),el('p',t('lastUpdated')+': '+(r.updated||t('notStated'))));text(b,'statusDelay','fine');link(b,'source',data.source,'source');
        button(b,'save',()=>ensure(async()=>{await V.put({kind:'repair',title:r.number+' · '+r.subject,status:'followup',office_status:r.status,office_checked_at:data.checked_at,source:data.source,document:JSON.stringify(r,null,2),events:[]});toast(t('saved'));}),'quiet');}
    });
    search.append(out);
    for(const provider of data.providers){const b=box(main);b.append(el('h2',provider.name));text(b,'statusOfficial');link(b,'checkOfficialStatus',provider.url,'button');}
    button(main,'logRepairUpdate',()=>ensure(()=>editStep({kind:'repair',title:t('repairs'),status:'submitted',events:[]})),'quiet');
    text(main,'statusHonesty','fine');
  }
  async function commitments(){
    page('publicPromises','publicPromisesIntro',c.rights);await configReady;
    if(!getConfig().promises){text(main,'publicUnavailable','card');return;}
    const place=c.getLocation();
    const city=field(main,'city','text',place.city),state=field(main,'state','text',place.state);state.maxLength=2;
    button(main,'findPromises',async()=>{
      const data=await api('/api/help/promises/list',{city:city.value,state:state.value.toUpperCase()});
      const out=box(main);if(!data.records.length)text(out,'noPromises');
      for(const p of data.records){const b=box(out);b.append(el('h2',p.official),el('p',p.promise),el('span',t(p.status),'badge'));if(p.due)b.append(el('p',t('dueDate')+': '+String(p.due).slice(0,10)));link(b,'source',p.source,'source');text(b,'publicUnverified','fine');for(const e of p.updates||[]) {b.append(el('p',e.date.slice(0,10)+' · '+t(e.status)+' · '+e.note));link(b,'source',e.source,'source');}}
    });
    button(main,'recordPromise',()=>promiseForm(),'quiet');
  }
  function promiseForm(){
    page('recordPromise','publicPromisePrivacy',commitments);
    const place=c.getLocation();
    const city=field(main,'city','text',place.city),state=field(main,'state','text',place.state),official=field(main,'officialName'),promise=field(main,'promised','textarea'),source=field(main,'sourceLink','url'),due=field(main,'dueDate','date');state.maxLength=2;
    const consent=check(main,'publishPromiseConsent');
    button(main,'publishPromise',async()=>{
      if(!consent.checked){toast(t('required'));return;}
      const data=await api('/api/help/promises',{city:city.value,state:state.value.toUpperCase(),official:official.value,promise:promise.value,source:source.value,due:due.value,publishConsent:true});
      page('publicPromises','promisePublished',commitments);
      const owner=field(main,'ownerLink','text',location.origin+'/help/promises#'+new URLSearchParams({id:data.id,key:data.owner}));owner.readOnly=true;
      button(main,'copy',()=>D.copy(owner.value),'quiet');
      button(main,'save',()=>ensure(()=>V.put({kind:'commitment',title:official.value,status:'reported',promised:promise.value,document:source.value,follow_date:due.value,owner_key:data.owner,promise_id:data.id,events:[]})),'quiet');
    });
    button(main,'savePrivately',()=>ensure(async()=>{await V.put({kind:'commitment',title:official.value||t('commitment'),status:'followup',promised:promise.value,document:source.value,follow_date:due.value,events:[]});await progress();}),'quiet');
  }
  function updatePromise(id,key){
    page('updatePromise','publicPromisePrivacy',commitments);
    const status=select(main,'status',['reported','scheduled','in_progress','completed','overdue','withdrawn'].map(k=>[k,k])),note=field(main,'notes','textarea'),source=field(main,'sourceLink','url');
    button(main,'save',async()=>{await api('/api/help/promises/'+id+'/update',{status:status.value,note:note.value,source:source.value},{'X-Help-Key':key});toast(t('saved'));});
  }
  async function advocate(module=previousModule,context=''){
    const original=[...main.childNodes()],oldWords=I.snapshot();
    const back=()=>{main.replaceChildren(...original);const translated=new Map(Object.entries(oldWords).map(([k,v])=>[v,t(k)]));const walker=document.createTreeWalker(main,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode;if(translated.has(n.textContent)&&!n.parentElement.closest('input,textarea,pre,blockquote'))n.textContent=translated.get(n.textContent);}main.focus();};
    previousModule=module;page('advocate','advocateIntro',back);await configReady;
    const question=field(main,'yourQuestion','textarea'),facts=field(main,'optionalContext','textarea',context||c.publicContext()),consent=check(main,'aiConsent');
    link(main,'aiPrivacy','https://ai.google.dev/gemini-api/terms','source');
    if(!getConfig().ai){text(main,'aiUnavailable','card');return;}
    const out=box(main);
    button(main,'askAi',async()=>{
      if(!consent.checked||question.value.trim().length<5){toast(t('required'));return;}
      out.replaceChildren(el('p',t('working')));
      try{
        const r=await api('/api/help/advocate',{module,question:question.value,context:facts.value,language:I.language,consent:true});
        out.replaceChildren(el('p',r.answer));for(const s of r.steps)out.append(el('p',s));
        if(r.draft){lastAdvice=r.draft;const a=field(out,'draft','textarea',r.draft);button(out,'copy',()=>D.copy(a.value),'quiet');button(out,'submissionHelp',()=>submission({title:t('draft'),document:a.value}),'quiet');}
        for(const source of r.sources)link(out,source.title,source.url,'source');text(out,'aiReview','fine');
      }catch{out.replaceChildren(el('p',t('aiUnavailable')));}
    });
    button(main,'formHelp',forms,'quiet');button(main,'escalation',escalation,'quiet');
  }
  async function complaints(){
    page('complaintForms','complaintFormsIntro',c.rights);
    const data=await api('/api/help/advocacy');
    for(const route of data.complaints){const b=box(main),isEpa=route.id==='epa_external_civil_rights';
      b.append(el('h2',isEpa?t('epaComplaint'):t('pscComplaint')));
      text(b,isEpa?'epaScope':'pscScope','fine');text(b,'filingPrivacy','fine');
      link(b,'officialInstructions',route.official_url,'source');
      button(b,'prepareComplaint',()=>{
        const fields=isEpa?[
          {name:'name',key:'name',required:true},{name:'email',key:'email',type:'email'},{name:'phone',key:'phone'},
          {name:'organization',key:'organization',required:true},{name:'date',key:'incidentDate',type:'date',required:true},
          {name:'facts',key:'complaintFacts',type:'textarea',required:true},{name:'basis',key:'complaintBasis',type:'textarea',required:true},
          {name:'access',key:'accessNeeds',type:'textarea'}
        ]:[
          {name:'company',key:'organization',required:true},{name:'complaintType',key:'problemType',required:true},
          {name:'first',key:'firstName',required:true},{name:'last',key:'lastName',required:true},
          {name:'address',key:'street',required:true},{name:'city',key:'city',required:true},{name:'state',key:'state',required:true},{name:'zip',key:'zip',required:true},
          {name:'email',key:'email',type:'email'},{name:'phone',key:'phone'},
          {name:'serviceName',key:'serviceName',required:true},{name:'serviceAddress',key:'serviceAddress',required:true},
          {name:'serviceCity',key:'serviceCity',required:true},{name:'serviceState',key:'serviceState',required:true},{name:'serviceZip',key:'serviceZip',required:true},
          {name:'facts',key:'complaintFacts',type:'textarea',required:true}
        ];
        c.wizard('complaintForms','signatureNeeded',fields,(values)=>{
          page('reviewLetter','signatureNeeded',complaints);
          const content=fields.map(f=>t(f.key)+': '+(values[f.name]||'')).join('\n\n');
          const draft=field(main,'draft','textarea',content);draft.rows=12;
          text(main,isEpa?'epaScope':'pscScope','fine');
          button(main,'download',()=>D.download(draft.value+'\n\n'+t('signatureNeeded'),'complaint-review.txt'));
          button(main,'copy',()=>D.copy(draft.value),'quiet');
          if(isEpa){main.append(el('p',route.submit.email));text(main,'signatureNeeded','fine');}
          link(main,'officialInstructions',route.official_url,'button quiet');
          button(main,'submissionHelp',()=>submission({title:isEpa?t('epaComplaint'):t('pscComplaint'),document:draft.value,url:route.official_url}),'quiet');
        },{},complaints);
      });
    }
  }
  function pipeMaps(){
    page('pipeMap','pipeMapIntro',c.repairs);
    button(main,'pipes',c.pipeForm);
    text(main,'mapExactOnly','fine');
    link(main,'systemMap','https://gispub.epa.gov/serviceareas','button quiet');
    link(main,'source','https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas','source');
    link(main,'waterOffice','https://www.epa.gov/DWdata/primacy-agency-drinking-water-data','button quiet');
    button(main,'requestInspection',()=>requestWizard('inspection'),'quiet');
  }
  function directory(){
    page('allTools','toolIntro',home);
    const sections=[
      ['formHelp',[['formHelp',forms],['plainGuides',guideLibrary]]],
      ['report',[['report',c.reportUpload],['filters',c.filterForm],['maintenance',maintenance]]],
      ['moneyHelp',[['bill',c.billUpload],['rateCheck',billRates],['assistanceTracker',assistance],['assistance',()=>requestWizard('assistance')]]],
      ['rights',[['meetings',c.meetingForm],['joint',c.groupForm],['publicPromises',commitments],['advocate',advocate]]],
      ['repairs',[['pipeMap',pipeMaps],['pipes',c.pipeForm],['inspection',()=>requestWizard('inspection')],['repairForm',c.repairIntake],['repairStatus',repairStatus]]],
      ['treatment',[['treatment',treatment],['complaintForms',complaints],['progress',progress],['escalation',escalation]]]
    ];
    for(const [title,items] of sections){const b=box(main);b.append(el('h2',t(title)));const row=box(b,'directory-links');for(const [label,fn] of items)button(row,label,fn,'quiet');}
  }
  function guideLibrary(){
    page('plainGuides','guideIntro',home);
    for(const id of ['lead','nitrate','arsenic','pfas','forms','bills'])detail(main,'guideTitle_'+id,d=>text(d,'guideText_'+id));
    button(main,'askAdvocate',()=>advocate('guides'),'quiet');
  }
  return {directory,ensure,vault,forms,maintenance,assistance,billRates,treatment,escalation,submission,repairStatus,complaints,pipeMaps,commitments,promiseForm,updatePromise,advocate,reminder,guideLibrary};
}};
