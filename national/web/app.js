'use strict';
const $=id=>document.getElementById(id),form=$('lookup-form'),results=$('results'),message=$('message'),submit=$('submit');
const STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',AS:'American Samoa',GU:'Guam',MP:'Northern Mariana Islands',PR:'Puerto Rico',VI:'U.S. Virgin Islands'};
for(const [code,name]of Object.entries(STATES)){const option=new Option(name,code);$('state').add(option);}
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;}
function link(text,url){const a=node('a',text);try{const u=new URL(url);if(u.protocol!=='https:')return node('span',text);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}catch{return node('span',text);}return a;}
function number(v){return typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('en-US',{maximumSignificantDigits:6}).format(v):'—';}
function section(title){const s=document.createElement('section');s.className='result-card';s.append(node('h2',title));results.append(s);return s;}
function detail(title,data){const d=node('details');d.append(node('summary',title),node('pre',JSON.stringify(data,null,2)));return d;}
function coverage(data){
 const o=data.observations||{},n=o.retained_source_records;
 $('record-count').textContent=typeof n==='number'?n.toLocaleString('en-US')+' retained source records · '+number(o.published_archives)+' published archives':'National archive count temporarily unavailable';
 const box=$('coverage-body');box.replaceChildren();box.append(node('p','Ingestion: '+(o.ingestion_status||'unavailable')+(o.current_archive?' · Processing '+o.current_archive:'')),node('p',o.count_definition||'The archive does not establish safety at every household.'),node('p','Hundred-million scale target: '+number(o.target_minimum_records)+' records. Target reached: '+(o.target_met?'yes':'not yet')+'.'));
 for(const source of o.sources||[]){const p=node('p');p.append(link(source.id,source.source_url),document.createTextNode(' · '+number(source.records)+' records · retrieved '+String(source.retrieved_at||'unknown').slice(0,10)));box.append(p);}
 const missing=Object.entries(data.capabilities||{}).filter(([,v])=>/not-|required/.test(String(v))).map(([k,v])=>k.replaceAll('_',' ')+': '+String(v).replaceAll('-',' '));box.append(node('p','Coverage still requiring additional evidence: '+missing.join('; ')+'.'));
 if(Object.keys(o.errors||{}).length)box.append(detail('Ingestion errors retained for review',o.errors));
}
fetch('/api/national/status').then(r=>{if(!r.ok)throw Error();return r.json();}).then(coverage).catch(()=>$('record-count').textContent='National archive status temporarily unavailable');
function sourceName(row){return String(row.source_id||'Official monitoring').toUpperCase().replace('UCMR','UCMR ');}
function render(data){
 results.replaceChildren();if(data.coverage)coverage(data.coverage);
 const identity=section('Your address and possible provider');
 identity.append(node('p',data.address?.matched_address||'The address could not be uniquely resolved. A known PWSID still allows a utility-level search.'));
 if(data.provider?.conflict)identity.append(node('p','The entered PWSID conflicts with mapped providers. Confirm it with your utility before applying these results to your home.','notice'));
 const candidates=data.provider?.candidates||[];
 for(const p of candidates){const row=node('div',undefined,'provider'),text=node('div');text.append(node('strong',p.name),node('p',p.pwsid+' · '+p.provenance.replaceAll('-',' ')),node('small','Map evidence is not proof of a connected service line.'));row.append(text);const button=node('button','Use this ID from my bill','secondary');button.type='button';button.addEventListener('click',()=>{$('pwsid').value=p.pwsid;$('supply').value='public';form.requestSubmit();});row.append(button);identity.append(row);}
 if(data.provider?.user_selected_pwsid)identity.append(node('p','Selected utility: '+data.provider.user_selected_pwsid+'. Connection remains user-reported.'));
 if(!candidates.length)identity.append(node('p',data.supply?.type==='private-well'?'Private well selected. Public utility records are not substituted for your well.':'No mapped provider was established. This does not prove that the property uses a private well.'));
 const nearby=data.provider?.nearby_screen;if(nearby?.candidates?.some(p=>!candidates.some(c=>c.pwsid===p.pwsid)))identity.append(node('p','Additional provider boundaries occur within the 30-meter screening area. Address precision matters here.','notice'));
 const found=section('What was found in utility monitoring');
 found.append(node('p','These are reported system-level monitoring records, including historical data. They are not measurements from your kitchen tap. A detected substance is not automatically a violation or a personal health-risk determination.','notice'));
 let count=0;
 for(const report of data.occurrence||[]){
  const rows=report.summaries||[];count+=rows.length;const name=candidates.find(c=>c.pwsid===report.pwsid)?.name||report.pwsid;found.append(node('h3',name+' · '+report.pwsid));
  if(!rows.length){found.append(node('p',report.status==='unavailable'?'The occurrence archive could not be read. No clean-water finding is implied.':'No measurements for this ID were found in the currently loaded archives. This is a coverage gap, not proof of zero contamination.'));continue;}
  found.append(node('p','Historical range among reported numerical detections; non-detects remain separate. Source-water or unspecified-context rows are explicitly labeled.','muted'));
  const search=node('input');search.placeholder='Filter by contaminant';search.setAttribute('aria-label','Filter contaminants for '+report.pwsid);search.className='filter';found.append(search);
  const wrap=node('div',undefined,'table-wrap'),table=node('table'),head=node('thead'),tr=node('tr');for(const text of ['Contaminant / context','Detected range','Records / non-detects','Sample period','Source'])tr.append(node('th',text));head.append(tr);table.append(head);const body=node('tbody');table.append(body);wrap.append(table);found.append(wrap);
  const renderRows=()=>{body.replaceChildren();const matches=rows.filter(r=>String(r.analyte).toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>Number(b.detects>0)-Number(a.detects>0)||String(b.last_date||'').localeCompare(a.last_date||''));for(const r of matches){const row=node('tr'),name=node('td',r.analyte);name.append(node('small',String(r.scope||'scope not documented').replaceAll('-',' ')));if(r.invalid_identity_date>0)name.append(node('small','Includes '+number(r.invalid_identity_date)+' identity/date flags—review original records.'));row.append(name);const detected=r.detects>0?number(r.min_detect)+(r.max_detect!==r.min_detect?' – '+number(r.max_detect):'')+' '+(r.unit||'(unit missing)'):'No numerical detections reported';row.append(node('td',detected),node('td',number(r.n)+' records; '+number(r.nondetects)+' non-detects'),node('td',(r.first_date||'unknown')+' to '+(r.last_date||'unknown')));const src=node('td'),ref=(report.sources||[]).find(x=>x.id===r.source_id);src.append(ref?link(sourceName(r),ref.url):node('span',sourceName(r)));row.append(src);body.append(row);}if(!matches.length){const row=node('tr'),cell=node('td','No rows match this filter.');cell.colSpan=5;row.append(cell);body.append(row);}};search.addEventListener('input',renderRows);renderRows();
  found.append(detail('Original records, dates, units and source receipts for '+report.pwsid,report));
 }
 if(!count)found.append(node('p',data.supply?.type==='private-well'?'A well-specific laboratory result is needed. No concentration has been guessed.':'No applicable occurrence records could be displayed. Confirm a full utility ID or review the source-status section.'));
 const federal=section('Federal utility record');federal.append(node('p','EPA compliance reporting can lag current events. No reported violation is not a current household safety clearance.'));
 for(const system of data.systems||[]){federal.append(node('h3',system.pwsid+' · '+String(system.status).replaceAll('-',' ')));federal.append(detail('View EPA record and fingerprint',system));}
 if(!data.systems?.length)federal.append(node('p','No public-system record applies to this lookup.'));
 if(data.health_context?.length){const meaning=section('What these findings can mean');meaning.append(node('p','General health context—not a diagnosis or an estimate of your exposure. Effects depend on the substance, concentration and duration of exposure.'));for(const x of data.health_context){meaning.append(node('h3',x.title),node('p',x.text),link('Read the EPA explanation',x.source));}}
 if(data.environment&&data.environment.status!=='not-requested'){const environment=section('Nearby environmental measurements');environment.append(node('p','These nearby water bodies or monitoring wells are not your household water sample. No connection through an aquifer or treatment system has been established.','notice'));for(const r of (data.environment.records||[]).slice(0,20)){environment.append(node('h4',r.station+' · '+r.parameter),node('p',String(r.original_value??'not reported')+' '+(r.unit||'')+' · sampled '+r.sampled_at+' · '+(r.approval_status||'status unknown')+(r.not_recent?' · older than 30 days':'')));}environment.append(detail('Environmental source records',data.environment));}
 const steps=section('What to check next');for(const step of data.next_steps||[]){steps.append(node('h3',step.title),node('p',step.text),link('Official guidance',step.url));}
 const gaps=section('What is not established');gaps.append(node('p','Current household water safety: not determined.','notice'));for(const gap of data.gaps||[])gaps.append(node('p',gap));gaps.append(detail('Complete evidence package and executed checks',data));
 results.scrollIntoView({behavior:'auto',block:'start'});
}
form.addEventListener('submit',async event=>{
 event.preventDefault();if(submit.disabled)return;submit.disabled=true;message.textContent='Checking the address, provider evidence and national monitoring archive…';
 const body=Object.fromEntries(new FormData(form));body.pwsid=String(body.pwsid||'').toUpperCase();body.include_environment=$('context').checked;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),40000);
 try{const response=await fetch('/api/national/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.message||'Evidence lookup failed.');render(data);message.textContent='Source checks complete. Sampling dates and remaining gaps are shown below.';}
 catch(e){message.textContent=(e.name==='AbortError'?'The source request timed out.':e.message)+' No water-safety conclusion was made.';}
 finally{clearTimeout(timer);submit.disabled=false;}
});
for(const id of ['street','city','state','zip'])$(id).addEventListener('input',()=>{$('pwsid').value='';});
$('supply').addEventListener('change',()=>{if($('supply').value==='private-well')$('pwsid').value='';});
