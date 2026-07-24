'use strict';

const SCOPE_RANK={
  'nearby-environmental-station':0,
  'regional-context':1,
  'public-water-system-record':2,
  'source-well-record':3,
  'treatment-entry-record':4,
  'distribution-point-record':5,
  'tap-sampling-record':6,
  'exact-household-sample':7
};

function clamp(x,min=0,max=1){return Math.max(min,Math.min(max,Number(x)||0));}
function norm(s){return String(s||'').trim().toUpperCase();}
function ageDays(date,now=new Date()){
  const t=Date.parse(date||'');
  return Number.isFinite(t)?Math.max(0,(now.getTime()-t)/86400000):null;
}
function geometricMean(values){
  const xs=values.filter(x=>Number.isFinite(x)&&x>0);
  return xs.length?Math.exp(xs.reduce((a,b)=>a+Math.log(b),0)/xs.length):0;
}
function scopeRank(scope){return SCOPE_RANK[scope]??SCOPE_RANK['public-water-system-record'];}
function canSupportScope(evidenceScope,claimScope){return scopeRank(evidenceScope)>=scopeRank(claimScope);}
function inferRecordScope(record={}){
  const explicit=record.granularity||record.evidence_level||record.scope;
  if(explicit&&Object.hasOwn(SCOPE_RANK,explicit))return explicit;
  const t=norm(record.sample_type);
  if(/EXACT|HOUSEHOLD|HOME/.test(t))return 'exact-household-sample';
  if(/TAP|RESIDENT/.test(t))return 'tap-sampling-record';
  if(/DISTRIBUT|DS|LOCATION/.test(t))return 'distribution-point-record';
  if(/ENTRY|POE|PLANT/.test(t))return 'treatment-entry-record';
  if(/WELL|SOURCE/.test(t))return 'source-well-record';
  return 'public-water-system-record';
}
function temporalScore(record,{now=new Date(),halfLifeDays=365}={}){
  const age=ageDays(record.sample_date||record.analysis_date,now);
  if(age===null)return .35;
  return clamp(Math.pow(.5,age/Math.max(1,halfLifeDays)),.05,1);
}
function labScore(record={}){
  const status=norm(record.lab_accreditation?.status||record.lab_status||'');
  if(/ACCREDITED|VERIFIED/.test(status))return 1;
  if(/UNACCREDITED|EXPIRED|REVOKED/.test(status))return .35;
  return record.lab_id?.trim?.()? .72:.55;
}
function provenanceScore(record={}){
  let x=.45;
  if(record.record_fingerprint)x+=.2;
  if(record.originating_sample_key||record.sample_id)x+=.18;
  if(record.source_id)x+=.08;
  if(record.publisher)x+=.05;
  return clamp(x);
}
function hydraulicScore(record,hydraulic={}){
  if(hydraulic.admissible===true)return clamp(hydraulic.path_certainty||hydraulic.certainty||1,.5,1);
  if(hydraulic.admissible===false)return .05;
  if(record.entry_point||record.facility_id||record.location_code)return .68;
  return .55;
}
function spatialScore(record,{pwsid,addressHash=null}={}){
  if(addressHash&&record.address_hash===addressHash)return 1;
  if(pwsid&&String(record.pwsid)===String(pwsid))return .88;
  return .2;
}
function regulatoryScore(record={}){
  if(record.factual_status==='quarantined')return .1;
  if(record.is_current===false)return .45;
  if(record.superseded_by)return .35;
  return record.pwsid?.trim?.()? .9:.5;
}
function applicabilityForRecord(record,{pwsid,addressHash=null,claimScope='public-water-system-record',hydraulic={},now=new Date(),halfLifeDays=365}={}){
  const evidenceScope=inferRecordScope(record);
  const scopeCompatible=canSupportScope(evidenceScope,claimScope);
  const dimensions={
    spatial:spatialScore(record,{pwsid,addressHash}),
    temporal:temporalScore(record,{now,halfLifeDays}),
    hydraulic:hydraulicScore(record,hydraulic),
    provenance:provenanceScore(record),
    laboratory:labScore(record),
    regulatory:regulatoryScore(record),
    scope_compatibility:scopeCompatible?1:.01
  };
  let score=geometricMean(Object.values(dimensions));
  if(!scopeCompatible)score=Math.min(score,.15);
  if(String(record.pwsid||'')!==String(pwsid||''))score=Math.min(score,.2);
  const vetoes=[];
  if(!scopeCompatible)vetoes.push(`evidence scope ${evidenceScope} cannot support finer claim scope ${claimScope}`);
  if(record.factual_status==='quarantined')vetoes.push('record is quarantined');
  if(String(record.pwsid||'')!==String(pwsid||''))vetoes.push('record PWS does not match resolved PWS');
  return {
    record_fingerprint:record.record_fingerprint||null,
    analyte:record.analyte||record.metal||null,
    evidence_scope:evidenceScope,
    claim_scope:claimScope,
    dimensions:Object.fromEntries(Object.entries(dimensions).map(([k,v])=>[k,Number(v.toFixed(4))])),
    applicability_score:Number(score.toFixed(4)),
    eligible:score>=.5&&!vetoes.length,
    vetoes
  };
}
function buildApplicabilityLattice({records=[],pwsid,addressHash=null,hydraulicChecks=[],claimScopes=['public-water-system-record','exact-household-sample'],now=new Date()}={}){
  const hydraulicByFingerprint=new Map(hydraulicChecks.map(x=>[x.record_fingerprint,x]));
  const evaluated=[];
  for(const record of records){
    for(const claimScope of claimScopes)evaluated.push(applicabilityForRecord(record,{pwsid,addressHash,claimScope,hydraulic:hydraulicByFingerprint.get(record.record_fingerprint)||{},now}));
  }
  const byScope={};
  for(const scope of claimScopes){
    const rows=evaluated.filter(x=>x.claim_scope===scope);
    byScope[scope]={
      eligible:rows.filter(x=>x.eligible).length,
      total:rows.length,
      mean_applicability:rows.length?Number((rows.reduce((a,b)=>a+b.applicability_score,0)/rows.length).toFixed(4)):0,
      vetoed:rows.filter(x=>x.vetoes.length).length,
      top:rows.slice().sort((a,b)=>b.applicability_score-a.applicability_score).slice(0,12)
    };
  }
  const household=byScope['exact-household-sample'];
  const system=byScope['public-water-system-record'];
  return {
    method:'Monotone Evidence Applicability Lattice v1.0',
    scope_order:Object.entries(SCOPE_RANK).sort((a,b)=>a[1]-b[1]).map(([scope,rank])=>({scope,rank})),
    by_claim_scope:byScope,
    system_applicable_fraction:system?.total?Number((system.eligible/system.total).toFixed(4)):0,
    household_applicable_fraction:household?.total?Number((household.eligible/household.total).toFixed(4)):0,
    household_scope_blocked:!!household&&household.eligible===0,
    evaluated_count:evaluated.length,
    interpretation:'Evidence may move to an equal or coarser claim scope, never to a finer scope. Spatial, temporal, hydraulic, provenance, laboratory, and regulatory dimensions are jointly required.'
  };
}
module.exports={SCOPE_RANK,scopeRank,canSupportScope,inferRecordScope,applicabilityForRecord,buildApplicabilityLattice};
