'use strict';
const crypto=require('crypto');
function key(v){return [v.pwsid,v.rule_code||v.rule||'',v.contaminant_code||v.analyte||'',v.compliance_period||v.begin_date||'',v.location_code||'SYSTEM'].join('|').toUpperCase()}
function normalizeViolation(v,source){return {key:key(v),pwsid:v.pwsid,rule_code:v.rule_code||v.rule||null,contaminant_code:v.contaminant_code||v.analyte||null,compliance_period:v.compliance_period||v.begin_date||null,location_code:v.location_code||'SYSTEM',status:v.status||'violation',source,raw:v}}
function reconcile(recomputed,sdwis){
 const a=new Map(recomputed.map(x=>{const n=normalizeViolation(x,'ENGINE');return[n.key,n]}));
 const b=new Map(sdwis.map(x=>{const n=normalizeViolation(x,'SDWIS');return[n.key,n]}));
 const all=new Set([...a.keys(),...b.keys()]),diffs=[];
 for(const k of all){const e=a.get(k),s=b.get(k);if(e&&!s)diffs.push({type:'engine-only',severity:'high',key:k,engine:e,sdwis:null});else if(!e&&s)diffs.push({type:'sdwis-only',severity:'critical',key:k,engine:null,sdwis:s});else if((e.status||'')!==(s.status||''))diffs.push({type:'status-mismatch',severity:'high',key:k,engine:e,sdwis:s});}
 return {recomputed_count:a.size,sdwis_count:b.size,agreement_count:all.size-diffs.length,disagreement_count:diffs.length,diffs,oracle_hash:crypto.createHash('sha256').update(JSON.stringify([...all].sort())).digest('hex'),review_required:diffs.length>0};
}
function historicalBacktest(periods,engineFn,sdwisRows){return periods.map(p=>{const e=engineFn(p);const s=sdwisRows.filter(x=>(x.compliance_period||x.begin_date)===p);return {period:p,...reconcile(e,s)}})}
module.exports={reconcile,historicalBacktest,normalizeViolation};
