'use strict';

function clamp(x,min=0,max=1){return Math.max(min,Math.min(max,Number(x)||0));}
const DEFAULT_RELIABILITY={
  'Provider Identity Agent':.98,
  'Boundary Robustness Agent':.96,
  'Evidence Scope Guardian':.995,
  'SDWIS Compliance Agent':.97,
  'CCR Context Agent':.94,
  'WQP Context Agent':.99,
  'Originating-Sample Independence Agent':.98,
  'Temporal Freshness Agent':.95,
  'Contradiction Agent':.97,
  'Direct Household Sample Agent':.995
};

function claim(input){
  return {
    id:String(input.id),topic:String(input.topic),proposition:String(input.proposition),stance:input.stance==='oppose'?'oppose':'support',
    agent:String(input.agent),confidence:clamp(input.confidence),scope:input.scope||'system',evidence_ids:[...new Set(input.evidence_ids||[])],
    origin_keys:[...new Set(input.origin_keys||input.evidence_ids||[])],hard_veto:!!input.hard_veto,basis:input.basis||'',revision:input.revision||null
  };
}
function weighted(c,reliability){return c.confidence*clamp(reliability[c.agent]??DEFAULT_RELIABILITY[c.agent]??.8);}
function uniqueOriginWeight(claims,reliability){
  const byOrigin=new Map();
  for(const c of claims){
    const origins=c.origin_keys.length?c.origin_keys:[c.id];
    const per=weighted(c,reliability)/Math.max(1,origins.length);
    for(const o of origins)byOrigin.set(o,Math.max(byOrigin.get(o)||0,per));
  }
  return [...byOrigin.values()].reduce((a,b)=>a+b,0);
}

function negotiateClaims(rawClaims,{reliability={},acceptThreshold=.62,margin=.12}={}){
  const claims=rawClaims.map(claim),transcript=[];
  const groups=new Map();
  for(const c of claims){const key=`${c.topic}::${c.proposition}`;(groups.get(key)||groups.set(key,[]).get(key)).push(c);}
  const accepted=[],rejected=[],undecided=[],dissent=[],vetoes=[];
  transcript.push({round:1,name:'proposal',message:`${claims.filter(x=>x.stance==='support').length} supporting and ${claims.filter(x=>x.stance==='oppose').length} opposing claims entered the council.`});
  for(const [key,list] of groups){
    const supports=list.filter(x=>x.stance==='support'),opposes=list.filter(x=>x.stance==='oppose');
    const supportScore=uniqueOriginWeight(supports,reliability),opposeScore=uniqueOriginWeight(opposes,reliability);
    const veto=opposes.find(x=>x.hard_veto);
    const confidence=clamp(supportScore/(supportScore+opposeScore+1e-9));
    const base={key,topic:list[0].topic,proposition:list[0].proposition,scope:list[0].scope,support_score:Number(supportScore.toFixed(4)),opposition_score:Number(opposeScore.toFixed(4)),confidence:Number(confidence.toFixed(4)),supporting_agents:supports.map(x=>x.agent),opposing_agents:opposes.map(x=>x.agent),evidence_ids:[...new Set(list.flatMap(x=>x.evidence_ids))],independent_support_origins:new Set(supports.flatMap(x=>x.origin_keys)).size};
    if(veto){
      const out={...base,status:'rejected',reason:`hard epistemic veto by ${veto.agent}: ${veto.basis}`};rejected.push(out);vetoes.push(out);
    }else if(supportScore>=acceptThreshold&&supportScore-opposeScore>=margin){
      accepted.push({...base,status:'accepted',reason:'independent weighted support exceeded the acceptance threshold and opposition margin'});
    }else if(opposeScore>=acceptThreshold&&opposeScore-supportScore>=margin){
      rejected.push({...base,status:'rejected',reason:'weighted opposition exceeded support'});
    }else{
      undecided.push({...base,status:'undecided',reason:'support and opposition did not separate enough for a defensible conclusion'});
    }
    if(opposes.length)dissent.push({topic:list[0].topic,proposition:list[0].proposition,agents:opposes.map(x=>x.agent),reasons:opposes.map(x=>x.basis)});
  }
  transcript.push({round:2,name:'challenge',message:`${vetoes.length} hard veto(es) and ${dissent.length} dissent set(s) were recorded. Publisher replicas were collapsed by origin key.`});
  transcript.push({round:3,name:'revision',message:'Claims violating household/system/environmental scope rules were rejected rather than softened into unsupported household conclusions.'});
  const score=accepted.length/(accepted.length+rejected.length+undecided.length||1);
  transcript.push({round:4,name:'final',message:`Council finalized ${accepted.length} accepted, ${rejected.length} rejected, and ${undecided.length} undecided claim(s).`});
  return {protocol:'Auditable Dialectical Evidence Negotiation v1.0',accepted_claims:accepted,rejected_claims:rejected,undecided_claims:undecided,dissent,vetoes,transcript,consensus_fraction:Number(score.toFixed(4)),policy:{one_origin_one_vote:true,hard_scope_vetoes:true,agent_reliability_weighted:true,undecided_is_allowed:true}};
}

function buildInvestigationClaims({providerConsensus={},counterfactualStability={},exactHouseholdCount=0,sdwis={},ccr={},wqp={},records=[],contradictions=[],evidence=[]}={}){
  const claims=[];
  const providerEvidence=evidence.filter(x=>['address-resolution','provider-boundary','provider-resolution'].includes(x.type)).map(x=>x.id);
  if(providerConsensus.accepted){
    claims.push(claim({id:'provider-support',topic:'provider-identity',proposition:`PWS ${providerConsensus.pwsid} serves the geocoded point`,agent:'Provider Identity Agent',confidence:providerConsensus.score||.9,evidence_ids:providerEvidence,origin_keys:['official-service-area'],basis:'official polygon and crosswalk evidence'}));
  }else claims.push(claim({id:'provider-oppose',topic:'provider-identity',proposition:'A unique PWS serves the geocoded point',stance:'oppose',agent:'Provider Identity Agent',confidence:.99,hard_veto:true,basis:'the provider crosswalk did not accept a unique PWS'}));
  if(counterfactualStability.status&&counterfactualStability.status!=='not-computed'){
    const stable=counterfactualStability.stability_score>=.75;
    claims.push(claim({id:'boundary-stability',topic:'provider-identity',proposition:`PWS ${providerConsensus.pwsid||'unknown'} serves the geocoded point`,stance:stable?'support':'oppose',agent:'Boundary Robustness Agent',confidence:stable?counterfactualStability.stability_score:1-counterfactualStability.stability_score,hard_veto:counterfactualStability.stability_score<.5,basis:counterfactualStability.interpretation,origin_keys:['coordinate-perturbation-test']}));
  }
  if(exactHouseholdCount>0){
    claims.push(claim({id:'household-data',topic:'household-measurement',proposition:'An address-linked household water sample exists',agent:'Direct Household Sample Agent',confidence:1,origin_keys:['direct-household-sample']}));
  }else{
    claims.push(claim({id:'scope-veto',topic:'household-measurement',proposition:'The report establishes contaminant concentrations at the submitted household tap',stance:'oppose',agent:'Evidence Scope Guardian',confidence:1,hard_veto:true,basis:'no exact-household sample is present; system, CCR, WQP, street, and neighborhood evidence cannot be promoted to a household concentration'}));
  }
  if(sdwis?.synced){
    const active=sdwis.violations?.active||[];
    claims.push(claim({id:'sdwis-compliance',topic:'current-federal-compliance',proposition:active.length?'Active SDWIS compliance items are present':'No active SDWIS violations are present in the synchronized cache',agent:'SDWIS Compliance Agent',confidence:.97,evidence_ids:evidence.filter(x=>x.type==='federal-compliance-record'||x.type==='federal-system-record').map(x=>x.id),origin_keys:['epa-sdwis-cache'],basis:'matched federal SDWIS records'}));
  }
  if(ccr?.latest)claims.push(claim({id:'ccr-context',topic:'annual-system-report',proposition:'An annual Consumer Confidence Report is available for the matched PWS',agent:'CCR Context Agent',confidence:.94,evidence_ids:['consumer-confidence-report'],origin_keys:[`ccr-${ccr.latest.report_year||'unknown'}`]}));
  if((wqp?.stations||[]).length){
    claims.push(claim({id:'wqp-context',topic:'environmental-context',proposition:'Nearby environmental monitoring data are available as contextual evidence',agent:'WQP Context Agent',confidence:.95,evidence_ids:evidence.filter(x=>x.type==='nearby-environmental-monitoring').map(x=>x.id),origin_keys:['wqp-nearby-stations']}));
    claims.push(claim({id:'wqp-tap-veto',topic:'household-measurement',proposition:'Nearby WQP stations establish the submitted household tap concentration',stance:'oppose',agent:'WQP Context Agent',confidence:1,hard_veto:true,basis:'WQP station results are environmental monitoring data and are not household tap or utility compliance samples'}));
  }
  const originCount=new Set(records.map(r=>r.originating_sample_key||r.record_fingerprint).filter(Boolean)).size;
  if(records.length)claims.push(claim({id:'independence',topic:'record-independence',proposition:'The report distinguishes originating samples from republications',agent:'Originating-Sample Independence Agent',confidence:originCount?1:.7,origin_keys:[`origin-count-${originCount}`],basis:`${originCount} distinct originating sample key(s) identified among ${records.length} record(s)`}));
  if(contradictions.length)claims.push(claim({id:'contradiction',topic:'unqualified-high-confidence',proposition:'The report can be presented without unresolved limitations',stance:'oppose',agent:'Contradiction Agent',confidence:clamp(.55+.05*contradictions.length),basis:contradictions.join(' | '),origin_keys:contradictions.map((_,i)=>`contradiction-${i}`)}));
  return claims;
}

module.exports={claim,negotiateClaims,buildInvestigationClaims,DEFAULT_RELIABILITY};
