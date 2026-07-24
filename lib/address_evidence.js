'use strict';

const SUFFIXES={
  STREET:'ST',ST:'ST',ROAD:'RD',RD:'RD',DRIVE:'DR',DR:'DR',LANE:'LN',LN:'LN',
  AVENUE:'AVE',AVE:'AVE',BOULEVARD:'BLVD',BLVD:'BLVD',COURT:'CT',CT:'CT',
  PLACE:'PL',PL:'PL',CIRCLE:'CIR',CIR:'CIR',TRAIL:'TRL',TRL:'TRL',
  PARKWAY:'PKWY',PKWY:'PKWY',TERRACE:'TER',TER:'TER',HIGHWAY:'HWY',HWY:'HWY',
  TURNPIKE:'TPKE',WAY:'WAY',LOOP:'LOOP',RUN:'RUN',PASS:'PASS',COVE:'CV',CV:'CV'
};
const DIRECTIONS={NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW'};
const WATER_RE=/\b(WATER QUALITY|DRINKING WATER|BOIL WATER|WATER ADVISOR(?:Y|IES)|WATER NOTICE|LEAD|COPPER|ARSENIC|MANGANESE|PFAS|PFOA|PFOS|NITRATE|NITRITE|THM|HALOACETIC|COLIFORM|BACTERIA|TURBIDITY|DISCOLOR(?:ED|ATION)|WATER MAIN|SERVICE LINE|HYDRANT FLUSH|CONTAMINANT|LAB(?:ORATORY)? SAMPLE|WATER TEST)\b/i;
const LIFTED_RE=/\b(LIFTED|RESCINDED|DISCONTINUED|CLEARED|NO LONGER IN EFFECT|CANCELLED|CANCELED)\b/i;
const ACTIVE_RE=/\b(ISSUED|IN EFFECT|ACTIVE|PRECAUTIONARY BOIL WATER|BOIL WATER NOTICE|BOIL WATER ADVISORY)\b/i;

function htmlDecode(s){return String(s||'').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));}
function canonical(value){
  const raw=htmlDecode(value).toUpperCase().replace(/[’']/g,'').replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  return raw.map(t=>DIRECTIONS[t]||SUFFIXES[t]||t).join(' ');
}
function escapeRegExp(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function parseAddress(fullAddress){
  const line=String(fullAddress||'').split(',')[0].trim();
  const c=canonical(line); const m=c.match(/^(\d+[A-Z]?)\s+(.+)$/);
  return {line,canonical:c,house_number:m?m[1].replace(/[^0-9]/g,''):null,street:m?m[2]:c};
}
function nearby(text,index,radius=340){return text.slice(Math.max(0,index-radius),Math.min(text.length,index+radius));}
function addressRangeMatch(text,parts){
  if(!parts.house_number||!parts.street)return null;
  const number=Number(parts.house_number); if(!Number.isFinite(number))return null;
  const street=escapeRegExp(parts.street).replace(/\\ /g,'\\s+');
  const patterns=[
    new RegExp(`\\b(\\d{1,6})\\s*(?:-|–|—|TO|THRU|THROUGH|\\s)\\s*(\\d{1,6})\\s+${street}\\b`,'gi'),
    new RegExp(`\\b${street}\\s*[:,-]?\\s*(\\d{1,6})\\s*(?:-|–|—|TO|THRU|THROUGH|\\s)\\s*(\\d{1,6})\\b`,'gi')
  ];
  for(const re of patterns){let m;while((m=re.exec(text))){const a=Number(m[1]),b=Number(m[2]),lo=Math.min(a,b),hi=Math.max(a,b);if(number>=lo&&number<=hi)return {range:[lo,hi],matched:m[0],index:m.index};}}
  return null;
}
function noticeStatus(fragment){if(LIFTED_RE.test(fragment))return 'lifted-or-rescinded';if(ACTIVE_RE.test(fragment))return 'active-or-unspecified';return 'not-stated';}
function evidenceExcerpt(text,terms,max=1000){
  const c=String(text||'').replace(/\s+/g,' ').trim(); const upper=canonical(c); let idx=-1;
  for(const term of terms.filter(Boolean)){const i=upper.indexOf(canonical(term));if(i>=0&&(idx<0||i<idx))idx=i;}
  if(idx<0)return c.slice(0,max);
  // canonical offsets are approximate; use a proportional location to avoid returning an unrelated start.
  const rawIndex=Math.max(0,Math.floor((idx/Math.max(upper.length,1))*c.length)-220);
  return c.slice(rawIndex,rawIndex+max);
}
function classifyAddressEvidence(item,context={}){
  const raw=[item.title,item.publisher,item.excerpt,item.text].filter(Boolean).join(' ');
  const text=canonical(raw),parts=parseAddress(context.full_address||context.address||'');
  const neighborhoods=(context.neighborhoods||[]).map(canonical).filter(x=>x.length>=5);
  const water_relevant=WATER_RE.test(raw);
  let scope='system-context',score=.2,reason='The source provides utility or drinking-water context but does not name the submitted address, street, or neighborhood.',matchIndex=-1,matchedTerms=[];
  if(parts.canonical&&text.includes(parts.canonical)){
    scope='exact-address';score=1;reason='The online source explicitly contains the submitted street address.';matchIndex=text.indexOf(parts.canonical);matchedTerms=[parts.canonical];
  }else{
    const range=addressRangeMatch(text,parts);
    if(range){scope='affected-address-range';score=.96;reason=`The submitted house number falls within the address range ${range.range[0]}–${range.range[1]} listed for this street.`;matchIndex=range.index;matchedTerms=[range.matched];}
    else if(parts.house_number&&parts.street){
      const exactRe=new RegExp(`\\b${escapeRegExp(parts.house_number)}\\s+${escapeRegExp(parts.street).replace(/\\ /g,'\\s+')}\\b`,'i');
      const m=text.match(exactRe);
      if(m){scope='exact-address';score=1;reason='The online source explicitly contains the submitted house number and street.';matchIndex=m.index||0;matchedTerms=[m[0]];}
    }
  }
  if(scope==='system-context'&&parts.street&&text.includes(parts.street)){
    scope='street';score=.78;reason='The online source names the submitted street but not the exact house number.';matchIndex=text.indexOf(parts.street);matchedTerms=[parts.street];
  }
  if(scope==='system-context'){
    for(const n of neighborhoods){if(text.includes(n)){scope='neighborhood';score=.68;reason='The online source names the matched subdivision or neighborhood.';matchIndex=text.indexOf(n);matchedTerms=[n];break;}}
  }
  if(!water_relevant&&scope!=='system-context'){
    reason+=' The snippet does not itself contain a drinking-water term, so it remains a lead until the source is reviewed.';
    score=Math.min(score,.55);
  }
  const fragment=matchIndex>=0?nearby(text,matchIndex):text.slice(0,700);
  return {...item,scope,match_score:score,match_reason:reason,matched_terms:matchedTerms,water_relevant,notice_status:noticeStatus(fragment),excerpt:item.excerpt||evidenceExcerpt(raw,[parts.canonical,parts.street,...neighborhoods,'boil water','water quality']),address_specific:['exact-address','affected-address-range'].includes(scope),neighborhood_specific:['street','neighborhood'].includes(scope)};
}
function extractNeighborhoodCandidates(parcel={},input={}){
  const values=[];
  if(input.subdivision)values.push(input.subdivision);
  const keyRe=/(SUBDIV|SUBD|PLAT_NAME|PLATNAME|COMMUNITY|NEIGHBOR|NBHD|DEVELOPMENT|MOBILE.*HOME|PARK_NAME|PROJECT_NAME)/i;
  for(const [k,v] of Object.entries(parcel||{})){
    if(!keyRe.test(k)||v===null||v===undefined)continue;
    const s=String(v).trim();
    if(s.length<4||s.length>90||/^\d+(?:\.\d+)?$/.test(s)||/^(N\/A|NA|NONE|UNKNOWN|NULL)$/i.test(s))continue;
    values.push(s.replace(/\s+(PHASE|PH)\s*\d+[A-Z]?$/i,'').trim());
  }
  const seen=new Set();return values.filter(v=>{const n=canonical(v);if(!n||seen.has(n))return false;seen.add(n);return true;}).slice(0,6);
}
function summarizeAddressEvidence(items=[]){
  const matches=items.filter(x=>x.water_relevant&&x.scope!=='system-context').sort((a,b)=>(b.match_score||0)-(a.match_score||0));
  const counts={exact_address:0,affected_address_range:0,street:0,neighborhood:0,system_context:0};
  for(const x of items.filter(x=>x.water_relevant)){const key=String(x.scope||'system-context').replaceAll('-','_');if(key in counts)counts[key]++;else counts.system_context++;}
  const best=matches[0]||null;
  return {searched:true,raw_items_checked:items.length,counts,best_scope:best?.scope||'none',best_match:best,matches,system_context:items.filter(x=>x.scope==='system-context'),disclaimer:'Online address, street, and neighborhood matches are contextual public evidence. They do not become a household contaminant measurement unless the source explicitly reports a sample from that home.'};
}

module.exports={canonical,parseAddress,addressRangeMatch,classifyAddressEvidence,extractNeighborhoodCandidates,summarizeAddressEvidence,evidenceExcerpt,htmlDecode};
