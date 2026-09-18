'use strict';
// Pure national evidence contracts. A numerical conversion is not a safety finding.
const {createHash} = require('node:crypto');
const REGION_CODES = Object.freeze('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' '));
class EvidenceError extends Error { constructor(code,message,status=422){super(message);this.name='EvidenceError';this.code=code;this.status=status;} }
function validateInput(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new EvidenceError('BAD_INPUT','A JSON object is required.');
  const str=(key,max)=>{const value=raw[key]??'';if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw new EvidenceError('BAD_INPUT',`Invalid ${key}.`);return value.normalize('NFKC').trim();};
  const x={address:str('address',300),street:str('street',180),city:str('city',100),state:str('state',2).toUpperCase(),zip:str('zip',10),pwsid:str('pwsid',9).toUpperCase(),supply_type:str('supply_type',12)||'unknown'};
  if((x.state||!x.address)&&!REGION_CODES.includes(x.state))throw new EvidenceError('BAD_REGION','Include a US state or territory with your address.');
  if(!x.address&&!x.pwsid&&(!x.street||(!x.city&&!x.zip)))throw new EvidenceError('ADDRESS_REQUIRED','Enter your street address, city and state or ZIP code.');
  if(x.address&&x.address.length<8)throw new EvidenceError('ADDRESS_REQUIRED','Add the street number, street name and city or ZIP code.');
  if(raw.include_environment!==undefined&&typeof raw.include_environment!=='boolean')throw new EvidenceError('BAD_INPUT','Invalid environmental search choice.');
  if(x.zip&&!/^\d{5}(-\d{4})?$/.test(x.zip))throw new EvidenceError('BAD_ZIP','Use a five-digit ZIP or ZIP+4.');
  if(x.pwsid&&!validPwsid(x.pwsid))throw new EvidenceError('BAD_PWSID','Use the complete nine-character federal PWSID.');
  if(!['unknown','public','private-well'].includes(x.supply_type))throw new EvidenceError('BAD_SUPPLY','Supply must be unknown, public, or private-well.');
  if(x.pwsid&&x.supply_type==='private-well')throw new EvidenceError('CONFLICTING_SUPPLY','A private well cannot simultaneously be assigned a public-water-system ID.');
  return x;
}
function validPwsid(value){return typeof value==='string'&&/^[A-Z0-9]{9}$/.test(value);}
function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
function fingerprint(x){return createHash('sha256').update(canonical(x)).digest('hex');}
function finiteNumber(x){if(typeof x!=='string'&&typeof x!=='number')return null;const s=String(x).trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s))return null;const n=Number(s);return Number.isFinite(n)?n:null;}
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
function normalizeMeasurement(raw,asOf=new Date().toISOString().slice(0,10)){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new EvidenceError('BAD_MEASUREMENT','Measurement must be an object.');
  const issues=[],text=String(raw.value??'').trim(),inline=text.match(/^(<=|>=|<|>|≤|≥)/)?.[0]||null;
  const q=String(raw.qualifier??'').trim(),qsign=['<','<=','>','>=','≤','≥'].includes(q)?q:null;
  const nd=/^(ND|non[- ]?detect|not detected|below detection limit)$/i.test(q)||/^ND$/i.test(text);
  const operator=inline||qsign||(nd?'<':null),censored=!!operator;
  if(inline&&qsign&&inline!==qsign)issues.push('conflicting-censor-qualifiers');
  const number=finiteNumber(inline?text.slice(inline.length):text);
  const unit=String(raw.unit??'').replace(/[µμ]/g,'u').replace(/\s+/g,'').toLowerCase();
  const factors={'mg/l':1000,'ug/l':1,'ng/l':0.001},factor=factors[unit];
  if(factor===undefined)issues.push('unsupported-concentration-unit');
  if(q&&!qsign&&!nd&&!/^(=|detected)$/i.test(q))issues.push('qualifier-requires-review');
  if(!validDate(raw.sample_date))issues.push('missing-or-invalid-sample-date');
  else if(raw.sample_date>asOf)issues.push('future-sample-date');
  if(raw.matrix!=='water')issues.push('matrix-not-established-as-water');
  if(!raw.chemical_basis)issues.push('chemical-basis-not-established');
  if(raw.quality_status!=='accepted')issues.push('quality-not-accepted');
  if(!censored&&number===null)issues.push('missing-or-invalid-value');
  if(number!==null&&number<0)issues.push('negative-concentration');
  const converted=number!==null&&factor!==undefined?number*factor:null;
  if(converted!==null&&!Number.isFinite(converted))issues.push('conversion-overflow');
  const limit=raw.reporting_limit==null?null:finiteNumber(raw.reporting_limit);
  const limitUnit=raw.reporting_limit_unit==null?unit:String(raw.reporting_limit_unit).replace(/[µμ]/g,'u').replace(/\s+/g,'').toLowerCase();
  const convertedLimit=limit!==null&&limit>=0&&factors[limitUnit]!==undefined?limit*factors[limitUnit]:null;
  const reportingLimit=convertedLimit!==null&&Number.isFinite(convertedLimit)?convertedLimit:null;
  // A reported censor bound and a method's reporting limit are different facts.
  // For "<1 mg/L", preserve 1 mg/L even if the reporting limit is separately
  // supplied as 10 mg/L (or uses different units). A bare ND uses its limit.
  const explicitCensor=!!(inline||qsign);
  const explicitBound=number!==null&&number>=0&&converted!==null&&Number.isFinite(converted)?converted:null;
  const bound=censored?(explicitCensor?explicitBound:reportingLimit):null;
  if(censored&&bound===null)issues.push(explicitCensor?'censor-bound-unresolved':'reporting-limit-unresolved');
  const numericOk=!censored&&number!==null&&number>=0&&converted!==null&&Number.isFinite(converted);
  return {original:raw,censored,censor_operator:operator,value_ug_l:numericOk?converted:null,reported_bound_ug_l:bound,reporting_limit_ug_l:reportingLimit,bound_source:bound===null?null:explicitCensor?'reported-value':'reporting-limit',issues,eligible_for_numeric_analysis:numericOk&&issues.length===0,household_safety:'not-determined'};
}
function censusMatch(payload,input){
  const rows=payload?.result?.addressMatches;if(!Array.isArray(rows))throw new EvidenceError('CENSUS_SCHEMA','Census did not return an address-match list.',502);
  const valid=rows.filter(x=>REGION_CODES.includes(x?.addressComponents?.state?.toUpperCase())&&(!input.state||x.addressComponents.state.toUpperCase()===input.state)&&typeof x.coordinates?.x==='number'&&typeof x.coordinates?.y==='number'&&Number.isFinite(x.coordinates.x)&&Number.isFinite(x.coordinates.y)&&Math.abs(x.coordinates.x)<=180&&Math.abs(x.coordinates.y)<=90);
  // Census can return street-name aliases (SAINT/ST) for the same address on
  // the exact same TIGER segment, side and interpolated point. These are not
  // competing locations. Different points or house numbers remain ambiguous.
  const seen=new Set(),hits=valid.filter(x=>{
    const house=String(x.matchedAddress||'').match(/^\s*(\d+[A-Z0-9-]*)\s/i)?.[1]?.toUpperCase(),t=x.tigerLine,c=x.addressComponents;
    const key=house&&t?.tigerLineId&&['L','R'].includes(t.side)&&c.city&&c.zip?fingerprint([house,t.tigerLineId,t.side,x.coordinates.x,x.coordinates.y,c.state.toUpperCase(),c.city.toUpperCase(),c.zip]):null;
    if(!key)return true;
    if(seen.has(key))return false;seen.add(key);return true;
  });
  if(hits.length!==1)return {status:hits.length?'ambiguous':'unresolved',candidate_count:hits.length,candidates:hits.slice(0,5).map(x=>({address:x.matchedAddress,state:x.addressComponents.state}))};
  const hit=hits[0],geography={};
  for(const [key,label]of [['States','state'],['Counties','county'],['Census Tracts','tract'],['Census Blocks','block']]){const list=hit.geographies?.[key];if(Array.isArray(list)&&list.length===1)geography[label]={name:list[0].NAME||null,geoid:list[0].GEOID||null};}
  return {status:'matched',longitude:hit.coordinates.x,latitude:hit.coordinates.y,matched_address:hit.matchedAddress,state:hit.addressComponents.state.toUpperCase(),components:hit.addressComponents,geography,precision:'address-range-interpolation-not-rooftop',household_connection_verified:false};
}
function boundaryCandidates(payload){
  if(!Array.isArray(payload?.features))throw new EvidenceError('BOUNDARY_SCHEMA','Boundary source did not return features.',502);
  if(payload.exceededTransferLimit)throw new EvidenceError('BOUNDARY_TRUNCATED','Boundary source truncated the candidate set.',502);
  const out=[];
  for(const f of payload.features){
    const p=f?.attributes;if(!p||!validPwsid(p.PWSID))throw new EvidenceError('BOUNDARY_SCHEMA','Invalid PWSID in boundary data.',502);
    const provider=String(p.Data_Provider_Type??''),method=String(p.Model_Method??'');
    const modeled=/model/i.test(provider)||(/epa/i.test(provider)&&!/(state|system)/i.test(provider))||!!method&&!/^(none|n\/a|not applicable)$/i.test(method);
    const provenance=modeled?'modeled':/^(state|system|utility)( sourced| provided)?$/i.test(provider)?'state-or-system-sourced':'unclassified';
    const row={pwsid:p.PWSID,name:String(p.PWS_Name||p.PWSID),provenance,household_connection_verified:false,raw_attributes:p};
    if(!out.some(x=>fingerprint(x)===fingerprint(row)))out.push(row);
  }
  return out;
}
function echoRows(payload,pwsid){
  if(!payload||typeof payload!=='object'||payload.error||payload.Error)throw new EvidenceError('ECHO_SCHEMA','ECHO returned an error or invalid envelope.',502);
  const found=[];let recognized=false;
  function walk(x,depth=0){if(depth>16||!x||typeof x!=='object')return;if(Array.isArray(x)){for(const y of x)walk(y,depth+1);return;}
    for(const [k,v]of Object.entries(x)){const key=k.replace(/[^a-z0-9]/gi,'').toLowerCase();if(['pwsid','pwsidnumber','publicwatersystemid'].includes(key)){recognized=true;if(String(v).toUpperCase().trim()===pwsid)found.push(x);return;}}
    for(const v of Object.values(x))walk(v,depth+1);
  }walk(payload);
  const r=payload.Results||{},zero=[r.QueryRows,r.TotalRows,r.TotalCount].some(v=>finiteNumber(v)===0);
  if(!recognized&&!zero)throw new EvidenceError('ECHO_SCHEMA','No recognized system records or explicit zero count; source availability is not established.',502);
  return found.filter((x,i,a)=>a.findIndex(y=>fingerprint(y)===fingerprint(x))===i);
}
function queryId(payload){let id=null;function walk(x,depth=0){if(id||depth>10||!x||typeof x!=='object')return;for(const[k,v]of Object.entries(x)){if(['queryid','qid'].includes(k.replace(/[^a-z0-9]/gi,'').toLowerCase())&&/^[A-Za-z0-9_-]{1,100}$/.test(String(v))){id=String(v);return;}walk(v,depth+1);}}walk(payload);return id;}
module.exports={REGION_CODES,EvidenceError,validateInput,validPwsid,fingerprint,finiteNumber,validDate,normalizeMeasurement,censusMatch,boundaryCandidates,echoRows,queryId};
