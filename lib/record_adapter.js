'use strict';

const MONTHS={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function num(v){
  if(typeof v==='number'&&Number.isFinite(v))return v;
  const m=String(v==null?'':v).match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  return m?Number(m[0]):null;
}

function normalizePwsid(v){
  const digits=String(v==null?'':v).toUpperCase().replace(/^US-?/,'').replace(/^FL/,'').replace(/\D/g,'');
  return digits.length>=7?digits.slice(-7):digits;
}

function normalizeDate(v){
  const s=String(v==null?'':v).trim();
  if(!s)return '';
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  let m=s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if(m){const mm=MONTHS[m[2].toUpperCase()];if(mm)return `${m[3]}-${mm}-${String(m[1]).padStart(2,'0')}`;}
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m)return `${m[3]}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
  const d=new Date(s);
  return Number.isNaN(d.getTime())?s:d.toISOString().slice(0,10);
}

function isNonDetect(r){
  const s=String(r.result==null?'':r.result).trim();
  if(/^<|^ND$|^BDL$|^NON[- ]?DETECT/i.test(s))return true;
  const rem=String(r.remarks||'').toUpperCase();
  return /\bND\b|NON-?DETECT|BELOW (THE )?(MDL|DETECTION|REPORTING)|<\s*(MDL|RL|RDL)/.test(rem);
}

function deriveDetected(r){
  if(isNonDetect(r))return false;
  const v=num(r.result);
  if(v==null)return false;
  const dl=num(r.mdl)??num(r.rdl)??0;
  return v>0&&v>=(dl||0);
}

function adaptContaminantRecord(r){
  const sampleDate=normalizeDate(r.sample_date);
  const reportedAt=normalizeDate(r.sample_timestamp||r.reported_at||r.analysis_date);
  return {
    ...r,
    pwsid:normalizePwsid(r.pwsid),
    raw_sample_date:r.sample_date||null,
    sample_date:sampleDate,
    reported_at:reportedAt||null,
    metal:r.analyte||r.metal||r.contaminant||'UNKNOWN',
    analyte:r.analyte||r.metal||r.contaminant||'UNKNOWN',
    contaminant:r.analyte||r.contaminant||r.metal||'UNKNOWN',
    contam_code:r.analyte_code||r.contam_code||null,
    detected:deriveDetected(r),
    detection_limit:num(r.mdl)??num(r.rdl)??r.detection_limit??null,
    sample_point:r.location_code||r.entry_point||r.sample_point||null,
    facility_id:r.entry_point||r.location_code||r.facility_id||null,
    location_code:r.location_code||null,
    source_id:r.source_id||'fdep-chemical-current',
    source_family:r.source_family||r.publisher||'Florida DEP',
    source_year:(sampleDate.match(/^\d{4}/)||[String(r.source_year||'')])[0]||null,
    source_file:r.source_file||'Chem_Report_2024.xlsx',
    source_level:r.source_level||'public-water-system/compliance sample',
    lab_id:r.lab_id||null,
    method_id:r.method_id||null,
    record_fingerprint:r.record_fingerprint||null
  };
}

function adaptAll(records){return (records||[]).map(adaptContaminantRecord);}

function cleanName(v){
  const s=String(v==null?'':v).trim();
  if(!s||/^(NA|N\/A|NULL|NONE|UNKNOWN)$/i.test(s))return '';
  return s;
}
function addAlias(system,name){
  name=cleanName(name); if(!name)return;
  const key=name.toUpperCase().replace(/\s+/g,' ');
  system.aliases=Array.isArray(system.aliases)?system.aliases:[];
  if(key===String(system.name||'').toUpperCase().replace(/\s+/g,' '))return;
  if(!system.aliases.some(x=>String(x).toUpperCase().replace(/\s+/g,' ')===key))system.aliases.push(name);
}
function rowPwsid(row){return normalizePwsid(row?.pwsid||row?.PWSID||row?.pws_id||row?.PWS_ID||row?.public_water_system_id||row?.water_system_id);}
function supplementalNameCandidates(row={}){
  const keys=[
    'pws_name','system_name','water_system_name','public_water_system_name','mailing_name','name',
    'PWS_NAME','SYSTEM_NAME','WATER_SYSTEM_NAME','PUBLIC_WATER_SYSTEM_NAME','MAILING_NAME','NAME'
  ];
  const out=[];
  for(const k of keys){const v=cleanName(row[k]);if(v)out.push(v);}
  return [...new Set(out)];
}

/**
 * Merge the chemistry registry, the current FDEP facility registry, and the
 * locally synchronized SDWIS system table. Supplemental names are retained as
 * aliases instead of overwriting one another, because the same PWS can appear
 * under a city name, a subdivision name, and an owner/operator name.
 */
function deriveSystems(baseSystems=[],records=[],supplementalRows=[]){
  const map=new Map();
  function ensure(pid,seed={}){
    pid=normalizePwsid(pid); if(!pid)return null;
    let current=map.get(pid);
    if(!current){
      current={pwsid:pid,name:cleanName(seed.name)||`PWS ${pid}`,system_type:seed.system_type||null,population:Number.isFinite(Number(seed.population))?Number(seed.population):null,aliases:[]};
      map.set(pid,current);
    }
    return current;
  }
  for(const s of baseSystems||[]){
    const cur=ensure(s.pwsid,s); if(!cur)continue;
    Object.assign(cur,{...s,pwsid:cur.pwsid,aliases:Array.isArray(s.aliases)?[...s.aliases]:cur.aliases});
  }
  for(const r of records||[]){
    const pwsid=normalizePwsid(r.pwsid); if(!pwsid)continue;
    const existing=ensure(pwsid,{name:r.system_name,system_type:r.system_type,population:r.population});
    const nm=cleanName(r.system_name);
    if((!cleanName(existing.name)||/PUBLIC WATER SYSTEM\s+\d{6,7}$/i.test(existing.name||''))&&nm)existing.name=nm;
    else addAlias(existing,nm);
    if(existing.population==null&&Number.isFinite(Number(r.population)))existing.population=Number(r.population);
    if(!existing.system_type&&r.system_type)existing.system_type=r.system_type;
  }
  for(const r of supplementalRows||[]){
    const pid=rowPwsid(r); if(!pid)continue;
    const names=supplementalNameCandidates(r);
    const population=num(r.population??r.population_served_count??r.population_served??r.population_count);
    const type=r.system_type||r.pws_type_code||r.system_type_code||null;
    const existing=ensure(pid,{name:names[0],system_type:type,population});
    for(const nm of names){
      if(!cleanName(existing.name)||/^PWS\s+\d+$/i.test(existing.name)||/PUBLIC WATER SYSTEM\s+\d{6,7}$/i.test(existing.name))existing.name=nm;
      else addAlias(existing,nm);
    }
    if(existing.population==null&&population!=null)existing.population=population;
    if(!existing.system_type&&type)existing.system_type=type;
    for(const [k,v] of Object.entries(r||{})){
      if(['pwsid','PWSID','pws_id','PWS_ID'].includes(k))continue;
      if(/registry_source|registry_status|address|city|state|zip|phone|contact|source/i.test(k)&&v!=null&&existing[k]==null)existing[k]=v;
    }
  }
  return [...map.values()].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))||a.pwsid.localeCompare(b.pwsid));
}

/** Build authoritative provider aliases from synchronized SDWIS/FDEP rows. */
function deriveProviderAliases(baseAliases={},rows=[],systems=[]){
  const valid=new Set((systems||[]).map(s=>String(s.pwsid)));
  const out={};
  const add=(label,pid)=>{
    label=cleanName(label); pid=normalizePwsid(pid);
    if(!label||!valid.has(pid)||label.length<3||/^\d+$/.test(label))return;
    const key=label.toUpperCase().replace(/\s+/g,' ');
    out[key]=out[key]||[];
    if(!out[key].includes(pid))out[key].push(pid);
  };
  for(const [label,ids] of Object.entries(baseAliases||{}))for(const pid of (Array.isArray(ids)?ids:[ids]))add(label,pid);
  for(const r of rows||[]){
    const pid=rowPwsid(r); if(!pid)continue;
    for(const [k,v] of Object.entries(r||{})){
      const label=cleanName(v);
      const providerField=/(^|_)(pws|system|water_system|utility|owner|operator|provider|organization|agency|company|mailing)(_|$)/i.test(k);
      // A contact is not a system identity. For example, DOVERA (3594240)
      // lists CITY OF WINTER SPRINGS as its contact, which must not make a
      // Winter Springs service-area polygon resolve to DOVERA.
      if(!providerField)continue;
      if(/type|code|id|status|activity|source/i.test(k))continue;
      if(!label||label.length>140||/^(PUBLIC|PRIVATE|LOCAL GOVERNMENT|FEDERAL GOVERNMENT|STATE GOVERNMENT)$/i.test(label))continue;
      add(label,pid);
    }
  }
  return out;
}

module.exports={adaptContaminantRecord,adaptAll,deriveSystems,deriveProviderAliases,deriveDetected,isNonDetect,normalizeDate,normalizePwsid,num};
