'use strict';

function clamp(x,min=0,max=1){return Math.max(min,Math.min(max,Number(x)||0));}
function geometricMean(parts){
  const xs=parts.filter(x=>Number.isFinite(x)&&x>0);
  if(!xs.length)return 0;
  return Math.exp(xs.reduce((s,x)=>s+Math.log(x),0)/xs.length);
}
function ageDays(date,now=new Date()){
  const t=Date.parse(date||'');
  return Number.isFinite(t)?Math.max(0,(now.getTime()-t)/86400000):null;
}
function scoreGeocode(g={}){
  if(!g.primary_available&&!g.secondary_available)return 0;
  if(g.primary_available&&g.secondary_available){
    const d=Number(g.disagreement_meters);
    if(!Number.isFinite(d))return .82;
    if(d<=15)return 1;
    if(d<=30)return .93;
    if(d<=50)return .82;
    if(d<=100)return .58;
    return .3;
  }
  return .82;
}
function scoreTemporal(records=[],halfLifeDays=365){
  const dates=records.map(r=>r.sample_date).filter(Boolean).sort().reverse();
  if(!dates.length)return .2;
  const age=ageDays(dates[0]);
  return age===null?.2:clamp(Math.pow(.5,age/halfLifeDays),.15,1);
}
function scoreCoverage(records=[]){
  if(!records.length)return .1;
  const analytes=new Set(records.map(r=>r.analyte||r.metal).filter(Boolean)).size;
  const groups=new Set(records.map(r=>r.contaminant_group).filter(Boolean)).size;
  const analyteScore=clamp(analytes/20);
  const groupScore=clamp(groups/6);
  return .55*analyteScore+.45*groupScore;
}
function scoreIndependence(independence={},recordCount=0){
  if(!recordCount)return .1;
  const effective=Number(independence.effective_sample_size||independence.effective_n||independence.unique_originating_samples||0);
  return clamp(.35+.65*Math.min(1,effective/Math.max(3,Math.min(recordCount,20))));
}
function confidenceLabel(x){return x>=.9?'very-high':x>=.75?'high':x>=.55?'moderate':x>=.35?'low':'insufficient';}

function computeUncertaintyBudget({geocodeConsensus={},providerConsensus={},spatialAssessment={},counterfactualStability={},records=[],exactHouseholdCount=0,contradictions=[],independence={},federalContext={}}={}){
  const geolocation=scoreGeocode(geocodeConsensus);
  const providerBase=providerConsensus.accepted?clamp(providerConsensus.score||.9):0;
  const stability=counterfactualStability?.status&&counterfactualStability.status!=='not-computed'&&Number.isFinite(counterfactualStability.stability_score)?counterfactualStability.stability_score:(spatialAssessment.near_boundary?.65:.9);
  const providerIdentity=clamp(providerBase*stability*(spatialAssessment.gap?.15:1)*(spatialAssessment.overlap?.65:1));
  const spatial=clamp((spatialAssessment.gap?.2:1)*(spatialAssessment.overlap?.55:1)*(spatialAssessment.near_boundary?.72:1)*stability);
  const evidenceScope=exactHouseholdCount>0?1:(providerConsensus.accepted?.62:.2);
  const temporal=scoreTemporal(records);
  const coverage=scoreCoverage(records);
  const sourceIndependence=scoreIndependence(independence,records.length);
  const conflict=clamp(1/(1+.35*(contradictions||[]).length),.25,1);
  const federal=clamp([
    federalContext?.sdwis?.synced?1:.55,
    federalContext?.ccr?.synced?1:.6,
    federalContext?.wqp?.synced?1:.6
  ].reduce((a,b)=>a+b,0)/3);
  const dimensions={
    geolocation:Number(geolocation.toFixed(4)),
    provider_identity:Number(providerIdentity.toFixed(4)),
    spatial_robustness:Number(spatial.toFixed(4)),
    evidence_scope:Number(evidenceScope.toFixed(4)),
    temporal_freshness:Number(temporal.toFixed(4)),
    contaminant_coverage:Number(coverage.toFixed(4)),
    originating_sample_independence:Number(sourceIndependence.toFixed(4)),
    source_conflict:Number(conflict.toFixed(4)),
    federal_context_availability:Number(federal.toFixed(4))
  };
  const systemWeights={geolocation:.12,provider_identity:.22,spatial_robustness:.12,temporal_freshness:.15,contaminant_coverage:.14,originating_sample_independence:.1,source_conflict:.1,federal_context_availability:.05};
  const expanded=[];
  for(const [k,w] of Object.entries(systemWeights))for(let i=0;i<Math.max(1,Math.round(w*20));i++)expanded.push(dimensions[k]);
  let systemScore=geometricMean(expanded);
  if(!providerConsensus.accepted)systemScore=Math.min(systemScore,.25);
  if(spatialAssessment.gap)systemScore=Math.min(systemScore,.3);
  let householdScore=geometricMean([systemScore,dimensions.evidence_scope,exactHouseholdCount?dimensions.temporal_freshness:.4]);
  if(!exactHouseholdCount)householdScore=Math.min(householdScore,.49);
  const uncertainties=Object.entries(dimensions).map(([dimension,confidence])=>({dimension,confidence,uncertainty:Number((1-confidence).toFixed(4))})).sort((a,b)=>b.uncertainty-a.uncertainty);
  return {
    method:'dimension-separated weighted geometric confidence with hard epistemic caps',
    dimensions,
    system_evidence_confidence:Number(systemScore.toFixed(4)),
    system_evidence_label:confidenceLabel(systemScore),
    household_exposure_confidence:Number(householdScore.toFixed(4)),
    household_exposure_label:confidenceLabel(householdScore),
    dominant_uncertainties:uncertainties.slice(0,4),
    hard_caps:{unresolved_provider:.25,service_area_gap:.3,no_exact_household_sample:.49},
    interpretation:exactHouseholdCount
      ?'A direct address-linked sample exists, but provider, recency, coverage, and source-independence uncertainty still apply.'
      :'The system-level evidence may be strong while household-exposure confidence remains capped because no sample from the submitted home exists.'
  };
}

module.exports={computeUncertaintyBudget,confidenceLabel,ageDays,scoreCoverage};
