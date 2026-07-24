'use strict';

function clamp(x,min=0,max=1){return Math.max(min,Math.min(max,Number(x)||0));}
function item(id,title,reason,{flipProbability=.3,confidenceGain=.2,severity=.5,effort=.5,source='official'}={}){
  const score=(flipProbability*confidenceGain*severity)/Math.max(.1,effort);
  return {id,title,reason,expected_verdict_flip_probability:clamp(flipProbability),expected_confidence_gain:clamp(confidenceGain),severity:clamp(severity),effort:clamp(effort),source_type:source,priority_score:Number(score.toFixed(4))};
}
function planNextEvidence({providerConsensus={},counterfactualStability={},exactHouseholdCount=0,uncertaintyBudget={},records=[],sdwis={},ccr={},labUnverifiedCount=0,contradictions=[]}={}){
  const out=[];
  if(!providerConsensus.accepted||counterfactualStability.stability_score<.75)out.push(item('utility-confirmation','Obtain utility service confirmation for the parcel','Provider identity is unresolved or sensitive to coordinate perturbation.',{flipProbability:.75,confidenceGain:.45,severity:.9,effort:.35}));
  if(!exactHouseholdCount)out.push(item('household-sample','Obtain an accredited first-draw and flushed household tap sample','No public record can establish this home’s tap concentration without a sample from the home.',{flipProbability:.65,confidenceGain:.5,severity:1,effort:.8,source:'laboratory'}));
  if(labUnverifiedCount)out.push(item('lab-accreditation','Resolve laboratory identity and accreditation','Some regulatory rows cannot reach the top evidence tier until the laboratory and accreditation period are verified.',{flipProbability:.25,confidenceGain:.25,severity:.55,effort:.25}));
  if(!ccr?.latest)out.push(item('current-ccr','Acquire the newest exact-PWS Consumer Confidence Report','The annual utility report is absent from the synchronized index.',{flipProbability:.25,confidenceGain:.2,severity:.5,effort:.15}));
  const active=sdwis?.violations?.active||[];
  if(active.length)out.push(item('violation-resolution','Retrieve the latest violation resolution and return-to-compliance records',`${active.length} active SDWIS compliance item(s) may change the report’s current status.`,{flipProbability:.7,confidenceGain:.35,severity:.9,effort:.25}));
  if((uncertaintyBudget?.dimensions?.temporal_freshness||0)<.55)out.push(item('fresh-chemistry','Acquire current Florida DEP chemistry or utility sampling results','The most recent bundled chemistry is old enough to dominate the uncertainty budget.',{flipProbability:.45,confidenceGain:.35,severity:.7,effort:.35}));
  if((uncertaintyBudget?.dimensions?.contaminant_coverage||0)<.55)out.push(item('coverage-gap','Acquire missing contaminant classes and monitoring schedules','Sparse analyte or class coverage prevents a broad water-quality conclusion.',{flipProbability:.35,confidenceGain:.3,severity:.65,effort:.5}));
  if(contradictions.length)out.push(item('contradiction-resolution','Resolve the highest-impact contradiction','Conflicting or incomplete evidence currently limits the defensible confidence.',{flipProbability:.5,confidenceGain:.3,severity:.8,effort:.4}));
  return out.sort((a,b)=>b.priority_score-a.priority_score).slice(0,8);
}
module.exports={planNextEvidence};
