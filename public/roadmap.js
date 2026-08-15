'use strict';

(function(){
  const D=window.WATER_ROADMAP;
  if(!D) return;
  const state={lang:localStorage.getItem('water_lang')==='es'?'es':'en', lookup:null, city:'', source:'not-sure', selectedProblem:null};
  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const t=(en,es)=>state.lang==='es'?(es||en):en;

  function ga(name,params={}){ if(typeof window.gtag==='function') window.gtag('event',name,{event_category:'impact',...params}); }
  function external(href,label,text){return `<a class="roadmap-link" href="${href}" target="_blank" rel="noopener noreferrer" data-roadmap-link="${esc(label)}">${esc(text)} <span aria-hidden="true">↗</span></a>`;}

  function addNav(){
    if($('.resident-nav'))return;
    document.body.insertAdjacentHTML('afterbegin',`<a class="skip-link" href="#main-content">${t('Skip to main content','Saltar al contenido principal')}</a>
      <nav class="resident-nav" aria-label="${t('Main navigation','Navegación principal')}">
        <a class="nav-brand" href="/">IsMyWaterOK</a>
        <div class="nav-links">
          <a href="#water-problems">${t('Water problems','Problemas del agua')}</a>
          <a href="#water-guides">${t('Health guides','Guías de salud')}</a>
          <a href="#community-pages">${t('Your city','Su ciudad')}</a>
          <a href="/impact.html">${t('Impact','Impacto')}</a>
          <button type="button" id="language-toggle" class="language-toggle" aria-label="${t('Switch to Spanish','Cambiar a inglés')}">${state.lang==='es'?'English':'Español'}</button>
        </div>
      </nav>`);
    const main=$('main'); if(main)main.id='main-content';
    $('#language-toggle')?.addEventListener('click',()=>{state.lang=state.lang==='en'?'es':'en';localStorage.setItem('water_lang',state.lang);location.reload();});
  }

  function addSourceChoice(){
    const form=$('#form'); if(!form||$('#water-source-choice'))return;
    const city=$('#city')?.closest('.field');
    const html=`<fieldset id="water-source-choice" class="source-choice">
      <legend>${t('Where does your water come from?','¿De dónde viene su agua?')}</legend>
      <label><input type="radio" name="water_source" value="public" checked> <span>${t('Public water utility','Servicio público de agua')}</span></label>
      <label><input type="radio" name="water_source" value="private-well"> <span>${t('Private well','Pozo privado')}</span></label>
      <label><input type="radio" name="water_source" value="not-sure"> <span>${t('Not sure','No estoy seguro')}</span></label>
    </fieldset>`;
    if(city)city.insertAdjacentHTML('afterend',html); else form.insertAdjacentHTML('afterbegin',html);
    form.querySelectorAll('input[name="water_source"]').forEach(el=>el.addEventListener('change',()=>{state.source=el.value;}));
  }

  function problemSection(){
    return `<section id="water-problems" class="roadmap-section" aria-labelledby="problem-title">
      <div class="roadmap-heading"><p>${t('START WITH WHAT YOU NOTICE','EMPIECE CON LO QUE NOTA')}</p><h2 id="problem-title">${t('What is happening with your water?','¿Qué está pasando con su agua?')}</h2><span>${t('Pick the closest match for a simple next step.','Elija lo que más se parezca para ver el siguiente paso.')}</span></div>
      <div class="problem-grid">${D.problems.map(p=>`<button type="button" class="problem-card" data-problem="${p.key}"><span class="problem-icon" aria-hidden="true">${p.icon}</span><strong>${esc(t(p.en,p.es))}</strong></button>`).join('')}</div>
      <div id="problem-answer" class="problem-answer" hidden></div>
    </section>`;
  }

  function issueSection(){
    return `<section id="water-guides" class="roadmap-section" aria-labelledby="guide-title">
      <div class="roadmap-heading"><p>${t('HEALTH GUIDES','GUÍAS DE SALUD')}</p><h2 id="guide-title">${t('Understand the water issues people ask about most','Entienda los temas de agua más consultados')}</h2></div>
      <div class="guide-grid">${Object.entries(D.issues).map(([key,i])=>`<a class="guide-card" href="/issue.html?issue=${encodeURIComponent(key)}&lang=${state.lang}"><strong>${esc(t(i.name,i.nameEs))}</strong><span>${esc(t(i.blurb,i.blurbEs))}</span><em>${t('Open guide','Abrir guía')} →</em></a>`).join('')}</div>
    </section>`;
  }

  function citySection(){
    return `<section id="community-pages" class="roadmap-section" aria-labelledby="city-title">
      <div class="roadmap-heading"><p>${t('LOCAL TO SEMINOLE COUNTY','LOCAL DEL CONDADO DE SEMINOLE')}</p><h2 id="city-title">${t('Water information for your community','Información del agua para su comunidad')}</h2></div>
      <div class="city-grid">${D.cities.map(c=>`<a class="city-card" href="/city.html?city=${encodeURIComponent(c.key)}&lang=${state.lang}"><strong>${esc(c.name)}</strong><span>${esc(t(c.note,c.noteEs))}</span><em>${t('Open local page','Abrir página local')} →</em></a>`).join('')}</div>
    </section>`;
  }

  function reportSection(){
    return `<section class="roadmap-section compact-roadmap" aria-labelledby="report-problem-title">
      <div class="roadmap-heading"><p>${t('COMMUNITY SIGNALS','SEÑALES DE LA COMUNIDAD')}</p><h2 id="report-problem-title">${t('What are residents noticing?','¿Qué están notando los residentes?')}</h2><span>${t('Send an anonymous category-only report. No street address is collected here.','Envíe un informe anónimo solo por categoría. Aquí no se recopila la dirección.')}</span></div>
      <form id="resident-problem-form" class="resident-problem-form">
        <label><span>${t('What did you notice?','¿Qué notó?')}</span><select id="resident-problem" required><option value="">${t('Choose one','Elija uno')}</option>${D.problems.map(p=>`<option value="${p.key}">${esc(t(p.en,p.es))}</option>`).join('')}</select></label>
        <label><span>${t('Community','Comunidad')}</span><select id="resident-city" required><option value="">${t('Choose city/area','Elija ciudad/zona')}</option>${D.cities.map(c=>`<option value="${c.key}">${esc(c.name)}</option>`).join('')}</select></label>
        <button class="primary-button" type="submit">${t('Submit anonymous report','Enviar informe anónimo')}</button>
      </form><p id="resident-problem-status" class="form-status" aria-live="polite"></p>
    </section>`;
  }

  function insertRoadmapHome(){
    if($('#roadmap-home'))return;
    const out=$('#out'); if(!out)return;
    out.insertAdjacentHTML('beforebegin',`<div id="roadmap-home">${problemSection()}${issueSection()}${citySection()}${reportSection()}</div>`);
    document.querySelectorAll('.problem-card').forEach(btn=>btn.addEventListener('click',()=>showProblem(btn.dataset.problem)));
    $('#resident-problem-form')?.addEventListener('submit',e=>{
      e.preventDefault(); const problem=$('#resident-problem').value,city=$('#resident-city').value;
      ga('resident_water_problem_reported',{event_label:`${problem}|${city}`});
      $('#resident-problem-status').textContent=t('Thank you. Your anonymous category report was counted. Use the local contact buttons after a water check if you also want to notify your utility.','Gracias. Su informe anónimo por categoría fue contado. Use los botones de contacto local después de revisar su agua si también desea avisar a su servicio.');
      e.currentTarget.reset();
    });
  }

  function showProblem(key){
    const p=D.problems.find(x=>x.key===key); if(!p)return; state.selectedProblem=key;
    const city=D.cityFrom(state.city||'Seminole County');
    const target=$('#problem-answer'); if(!target)return;
    target.hidden=false; target.innerHTML=`<div><p class="micro-label">${t('WHY THIS CAN HAPPEN','POR QUÉ PUEDE PASAR')}</p><h3>${esc(t(p.en,p.es))}</h3><p>${esc(t(p.why,p.whyEs))}</p></div><div><p class="micro-label">${t('WHAT TO DO NEXT','QUÉ HACER AHORA')}</p><p>${esc(t(p.do,p.doEs))}</p><div class="inline-actions"><a class="mini-button" href="#search-title">${t('Check my address','Revisar mi dirección')}</a>${external(city.water,'problem-provider',t('My local water utility','Mi servicio local de agua'))}</div></div>`;
    target.scrollIntoView({behavior:'smooth',block:'nearest'}); ga('water_problem_selected',{event_label:key});
  }

  function noticeItems(data){
    const a=data?.live_web?.address_evidence||{};
    const combined=[...(a.matches||[]),...(data?.live_web?.items||[])];
    const seen=new Set(); return combined.filter(x=>{
      const title=String(x?.title||x?.name||''); const url=String(x?.url||''); const key=title+'|'+url;
      if(seen.has(key))return false; seen.add(key);
      const scope=String(x?.scope||''); return /notice|boil|water|advis|alert|street|address|neighborhood/i.test(title+' '+scope);
    }).slice(0,5);
  }
  function noticeCount(data){const c=data?.live_web?.address_evidence?.counts||{};return Number(c.exact_address||0)+Number(c.affected_address_range||0)+Number(c.street||0)+Number(c.neighborhood||0);}

  function alertPanel(data){
    const count=noticeCount(data),items=noticeItems(data);
    const matched=count>0;
    return `<section class="post-lookup-card ${matched?'urgent-card':'calm-card'}"><div class="post-card-heading"><p>${t('LOCAL WATER ALERTS','ALERTAS LOCALES DEL AGUA')}</p><h3>${matched?t('A local water notice matched this area','Un aviso local coincide con esta zona'):t('No matched local water alert was found','No se encontró una alerta local coincidente')}</h3></div>${matched?`<p>${t('Open the matched notice or the official alert page before using the water normally.','Abra el aviso coincidente o la página oficial de alertas antes de usar el agua normalmente.')}</p>`:`<p>${t('This lookup did not find an address, street, or neighborhood notice for the location checked.','Esta búsqueda no encontró un aviso para la dirección, calle o vecindario revisado.')}</p>`}${items.length?`<div class="notice-list">${items.map(i=>`<a href="${esc(i.url||D.sources.alerts)}" target="_blank" rel="noopener noreferrer"><strong>${esc(i.title||i.name||t('Local water notice','Aviso local de agua'))}</strong><span>${esc(i.scope||'')}</span></a>`).join('')}</div>`:''}<div class="inline-actions">${external(D.sources.alerts,'alerts',t('Check official current alerts','Revisar alertas oficiales actuales'))}</div></section>`;
  }

  function cityPanel(data){
    const provider=data?.provider?.system?.name||''; const city=D.cityFrom(provider+' '+state.city);
    return `<section class="post-lookup-card"><div class="post-card-heading"><p>${t('YOUR LOCAL WATER CONTACT','SU CONTACTO LOCAL DE AGUA')}</p><h3>${esc(city.name)}</h3></div><p>${esc(t(city.note,city.noteEs))}</p><div class="contact-strip"><a class="call-button" href="tel:${city.phone.replace(/\D/g,'')}">☎ ${esc(city.phone)}</a>${external(city.quality,'city-quality',t('Water quality page','Página de calidad del agua'))}<a class="roadmap-link" href="/city.html?city=${encodeURIComponent(city.key)}&lang=${state.lang}">${t('Open community page','Abrir página de la comunidad')} →</a></div></section>`;
  }

  function wellPanel(data){
    const wells=data?.local_data?.private_well_context||{}; const samples=wells.nearby_dioxane_well_samples||[]; const detections=Number(wells.nearby_dioxane_detections||0); const mapped=Number(wells.nearby_well_points||0);
    const emphasized=state.source==='private-well'||state.selectedProblem==='well';
    return `<section class="post-lookup-card ${emphasized?'well-focus':''}"><div class="post-card-heading"><p>${t('PRIVATE WELL PATH','RUTA PARA POZO PRIVADO')}</p><h3>${t('Private-well information near this address','Información de pozos privados cerca de esta dirección')}</h3></div>${wells.synced?`<div class="well-stats"><div><strong>${samples.length}</strong><span>${t('nearby wells in the local 1,4-dioxane study','pozos cercanos en el estudio local de 1,4-dioxano')}</span></div><div><strong>${detections}</strong><span>${t('with a reported detection','con una detección reportada')}</span></div><div><strong>${mapped}</strong><span>${t('mapped well points nearby','puntos de pozo mapeados cerca')}</span></div></div>`:`<p>${t('Use the official private-well and 1,4-dioxane resources below for the latest local information.','Use los recursos oficiales de pozos privados y 1,4-dioxano para la información local más reciente.')}</p>`}<div class="well-action"><strong>${t('Recommended routine','Rutina recomendada')}</strong><p>${t('Private-well owners should use a state-approved laboratory and choose tests based on local conditions, well history, and any nearby groundwater concern.','Los propietarios de pozos privados deben usar un laboratorio aprobado por el estado y elegir pruebas según las condiciones locales, el historial del pozo y cualquier preocupación cercana de agua subterránea.')}</p></div><div class="inline-actions">${external(D.sources.well,'private-well',t('Florida Health private-well help','Ayuda de Florida Health para pozos'))}${external(D.sources.dioxane,'dioxane-well',t('Seminole 1,4-dioxane results','Resultados de 1,4-dioxano'))}<a class="roadmap-link" href="/issue.html?issue=well&lang=${state.lang}">${t('Private-well guide','Guía de pozo privado')} →</a></div></section>`;
  }

  function labsPanel(){
    const city=D.cityFrom(state.city); const sorted=[...D.labs].sort((a,b)=>(a.city===city.name?-1:0)-(b.city===city.name?-1:0));
    return `<section class="post-lookup-card"><div class="post-card-heading"><p>${t('STATE-APPROVED WATER LABS','LABORATORIOS APROBADOS POR EL ESTADO')}</p><h3>${t('Local testing directory','Directorio local de pruebas')}</h3></div><p>${t('Call before collecting a sample so the lab can tell you which bottle, timing, and test panel to use.','Llame antes de recoger una muestra para saber qué frasco, horario y panel de pruebas usar.')}</p><div class="lab-grid">${sorted.map(l=>`<article><strong>${esc(l.name)}</strong><span>${esc(l.address)}</span><a href="tel:${l.phone.replace(/\D/g,'')}">${esc(l.phone)}</a></article>`).join('')}</div><div class="inline-actions">${external(D.sources.labs,'lab-directory',t('See the official Florida Health list','Ver la lista oficial de Florida Health'))}</div></section>`;
  }

  function dioxanePanel(data){
    const provider=String(data?.provider?.system?.name||''); const local=/sanford|lake mary|seminole/i.test(provider+' '+state.city); const wells=data?.local_data?.private_well_context||{};
    if(!local&&!Number(wells.nearby_dioxane_detections||0))return '';
    const city=D.cityFrom(provider+' '+state.city);
    return `<section class="post-lookup-card dioxane-focus"><div class="post-card-heading"><p>1,4-DIOXANE</p><h3>${t('Local 1,4-dioxane information for this area','Información local de 1,4-dioxano para esta zona')}</h3></div><p>${t('Northwest Seminole County has an ongoing 1,4-dioxane groundwater issue. Use the current county and provider pages below for the newest local sampling information.','El noroeste del Condado de Seminole tiene un problema continuo de 1,4-dioxano en agua subterránea. Use las páginas actuales del condado y del proveedor para la información más reciente.')}</p><p class="health-callout"><strong>${t('Long-term health concern:','Preocupación de salud a largo plazo:')}</strong> ${t('federal health reviews identify liver toxicity and cancer risk as the main concerns from repeated drinking-water exposure.','evaluaciones federales identifican toxicidad hepática y riesgo de cáncer como las principales preocupaciones de exposición repetida por agua potable.')}</p><div class="inline-actions">${external(D.sources.dioxane,'dioxane-county',t('County 1,4-dioxane results','Resultados del condado'))}${city.dioxane&&city.dioxane!==D.sources.dioxane?external(city.dioxane,'dioxane-provider',t(`${city.name} update`,`Actualización de ${city.name}`)):''}<a class="roadmap-link" href="/issue.html?issue=dioxane&lang=${state.lang}">${t('Health guide','Guía de salud')} →</a></div></section>`;
  }

  function surveyPanel(){
    return `<section class="post-lookup-card survey-card"><div class="post-card-heading"><p>${t('ONE QUESTION','UNA PREGUNTA')}</p><h3>${t('Did this help you understand what to do about your water?','¿Esto le ayudó a entender qué hacer con su agua?')}</h3></div><div class="survey-buttons" role="group" aria-label="${t('Feedback options','Opciones de opinión')}"><button data-feedback="yes">${t('Yes','Sí')}</button><button data-feedback="somewhat">${t('Somewhat','Algo')}</button><button data-feedback="no">${t('No','No')}</button></div><p id="survey-status" class="form-status" aria-live="polite"></p></section>`;
  }

  function renderLookupRoadmap(data){
    state.lookup=data; state.city=$('#city')?.value||state.city;
    const anchor=$('#resident-action-report')||$('#out .report-header'); if(!anchor)return;
    $('#post-lookup-roadmap')?.remove();
    anchor.insertAdjacentHTML('afterend',`<div id="post-lookup-roadmap" class="post-lookup-roadmap">${alertPanel(data)}${cityPanel(data)}${wellPanel(data)}${dioxanePanel(data)}${labsPanel()}${surveyPanel()}</div>`);
    document.querySelectorAll('[data-feedback]').forEach(btn=>btn.addEventListener('click',()=>{
      const value=btn.dataset.feedback; ga('impact_understanding_feedback',{event_label:value}); localStorage.setItem('water_feedback_last',value); document.querySelectorAll('[data-feedback]').forEach(b=>b.disabled=true); $('#survey-status').textContent=t('Thank you — your response was counted.','Gracias — su respuesta fue contada.');
    }));
    applyLanguageToCoreResult();
  }

  function applyLanguageToCoreResult(){
    if(state.lang!=='es')return;
    const replacements=new Map([
      ['YOUR WATER HEALTH SUMMARY','RESUMEN DE SALUD DEL AGUA'],['Your water provider','Su proveedor de agua'],['Substances found','Sustancias encontradas'],['Current health concerns','Preocupaciones actuales de salud'],['Local water alerts','Alertas locales del agua'],['What this means now','Qué significa ahora'],['What this could mean long term','Qué podría significar a largo plazo'],['What to do','Qué hacer'],['What the four levels mean','Qué significan los cuatro niveles'],['What was found in testing','Qué se encontró en las pruebas'],['Why it matters','Por qué importa'],['Possible long-term health effects','Posibles efectos de salud a largo plazo'],['Who should pay closest attention','Quién debe prestar más atención'],['Last tested:','Última prueba:']
    ]);
    $('#out')?.querySelectorAll('p,h2,h3,strong,span,em').forEach(el=>{const txt=el.textContent.trim();if(replacements.has(txt))el.textContent=replacements.get(txt);else if(txt.startsWith('Last tested:'))el.textContent=txt.replace('Last tested:','Última prueba:');});
  }

  function captureLookup(){
    const original=window.fetch.bind(window);
    window.fetch=async function(...args){
      const response=await original(...args); const req=args[0]; const url=typeof req==='string'?req:req?.url||'';
      if(String(url).includes('/api/lookup')) response.clone().json().then(data=>{if(data&&!data.error)setTimeout(()=>renderLookupRoadmap(data),120);}).catch(()=>{});
      return response;
    };
  }

  function wireTracking(){
    document.addEventListener('click',e=>{const link=e.target.closest?.('[data-roadmap-link]');if(link)ga('official_resource_clicked',{event_label:link.dataset.roadmapLink});});
    $('#form')?.addEventListener('submit',()=>{state.city=$('#city')?.value||'';state.source=document.querySelector('input[name="water_source"]:checked')?.value||'not-sure';});
  }

  addNav(); addSourceChoice(); insertRoadmapHome(); captureLookup(); wireTracking();
})();
