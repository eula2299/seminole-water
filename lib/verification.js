'use strict';
const crypto=require('crypto');
const {originSampleKey}=require('./godmode');

function norm(v){return String(v??'').trim().toUpperCase().replace(/μ/g,'µ').replace(/\s+/g,' ')}
function numeric(v){const m=String(v??'').match(/(?:<|<=|>|>=)?\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);return m?Number(m[1]):null}
function sourceFamily(record,source){
  return norm(record.source_family||source?.source_family||source?.agency||source?.publisher||source?.name||record.source_id||'UNKNOWN');
}
function logicalKey(r){return [r.pwsid,r.metal,r.sample_date,r.sample_type||'',r.facility_id||'',r.sample_point||''].map(norm).join('|')}
function comparable(a,b){
  if(logicalKey(a)!==logicalKey(b))return false;
  const av=numeric(a.result),bv=numeric(b.result);
  if(av===null||bv===null)return norm(a.result)===norm(b.result);
  const scale=Math.max(Math.abs(av),Math.abs(bv),1e-12);
  return Math.abs(av-bv)/scale<=0.02;
}
function corroborateRecord(target,allRecords,registry=[]){
  const targetSource=registry.find(s=>s.id===(target.source_id||'fdep-chemical-current'))||{};
  const targetOrigin=originSampleKey(target);
  const targetFamily=sourceFamily(target,targetSource);
  const publisherReplicas=[],independentSamples=[];
  for(const r of allRecords){
    if(r===target||!comparable(target,r))continue;
    const src=registry.find(s=>s.id===(r.source_id||'fdep-chemical-current'))||{};
    const family=sourceFamily(r,src),origin=originSampleKey(r);
    if(origin===targetOrigin && norm(r.source_id||'fdep-chemical-current')===norm(target.source_id||'fdep-chemical-current'))continue;
    const ref={record_fingerprint:r.record_fingerprint||null,origin_sample_key:origin,source_id:r.source_id||null,source_family:family,source_name:src.name||r.source_name||null,source_url:src.url||r.source_url||null};
    if(origin===targetOrigin)publisherReplicas.push(ref); else independentSamples.push(ref);
  }
  const independentOrigins=[...new Set(independentSamples.map(x=>x.origin_sample_key))];
  return {status:independentOrigins.length>=1?'confirmed-independent-sample':'single-origin-sample',origin_sample_key:targetOrigin,independent_origin_count:1+independentOrigins.length,publisher_replica_count:publisherReplicas.length,publisher_replicas:publisherReplicas,independent_samples:independentSamples,requirement_met:independentOrigins.length>=1,warning:publisherReplicas.length?'Republishing the same originating laboratory sample does not count as independent corroboration.':null};
}
function accreditationTier(record,labRegistry=[]){
  const id=norm(record.lab_id||record.laboratory_id||'');
  const name=norm(record.lab||record.laboratory||'');
  const match=labRegistry.find(x=>(id&&norm(x.lab_id)===id)||(name&&norm(x.name)===name));
  if(!match)return {tier:'unknown-accreditation',verified:false,reason:'No matching laboratory accreditation record was available.',lab:null};
  const active=match.status==='active'&&(!match.expires_on||new Date(match.expires_on)>=new Date(record.sample_date||Date.now()));
  if(active&&(match.nelap||match.state_certified))return {tier:'accredited',verified:true,reason:'Active NELAP or state laboratory certification matched.',lab:match};
  if(match.status==='expired')return {tier:'expired-accreditation',verified:false,reason:'Laboratory certification was expired for the relevant period.',lab:match};
  return {tier:'unaccredited-or-unverified',verified:false,reason:'No active NELAP/state certification was confirmed.',lab:match};
}
function evidenceHash(item){return crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex')}
function verifyRecords(records,registry,labRegistry){
  return records.map(r=>{
    const corroboration=corroborateRecord(r,records,registry);
    const accreditation=accreditationTier(r,labRegistry);
    const factual_status=corroboration.requirement_met?'confirmed-independent-sample':'single-origin-sample';
    return {...r,corroboration,lab_accreditation:accreditation,factual_status,verification_hash:evidenceHash({key:logicalKey(r),corroboration,accreditation})};
  });
}
function classifyLiveEvidence(item){
  const official=/\.gov\b|seminolecountyfl\.gov|epa\.gov|floridadep\.gov/i.test(item.url||'');
  const utility=/(water|utilities|public works)/i.test(item.publisher||item.title||'');
  const community=/(hoa|facebook|nextdoor|reddit|community|forum)/i.test(item.publisher||item.url||'');
  return official?'official-live':utility?'utility-live':community?'community-unverified':'journalism-or-other';
}
module.exports={logicalKey,comparable,corroborateRecord,accreditationTier,verifyRecords,classifyLiveEvidence};
