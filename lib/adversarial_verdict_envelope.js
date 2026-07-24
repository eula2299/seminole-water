'use strict';
function confidenceLabel(x){return x>=.9?'very-high':x>=.75?'high':x>=.55?'moderate':x>=.35?'low':'insufficient';}
function buildAdversarialVerdictEnvelope({uncertaintyBudget={},providerPredictionSet={},influenceAudit={},coverageTensor={},applicabilityLattice={},causalPathway={},negotiation={}}={}){
  const base=Number(uncertaintyBudget.system_evidence_confidence||0);
  const penalties=[];
  if((providerPredictionSet.prediction_set||[]).length>1)penalties.push({scenario:'alternate-provider-remains-plausible',penalty:.25});
  if(influenceAudit.single_origin_fragility)penalties.push({scenario:'remove-most-influential-origin',penalty:Math.min(.3,.08+Number(influenceAudit.max_confidence_delta||0))});
  if((coverageTensor.coverage_fraction||0)<.75)penalties.push({scenario:'missing-contaminant-groups',penalty:.15});
  if(applicabilityLattice.household_scope_blocked)penalties.push({scenario:'household-scope-unobserved',penalty:.35,household_only:true});
  if(!causalPathway.system_path_complete)penalties.push({scenario:'causal-system-path-incomplete',penalty:.2});
  if((negotiation.undecided_claims||[]).length)penalties.push({scenario:'negotiation-undecided-claims',penalty:Math.min(.2,.04*(negotiation.undecided_claims||[]).length)});
  const systemPenalties=penalties.filter(x=>!x.household_only);
  const worst=Math.max(0,base-systemPenalties.reduce((a,b)=>a+b.penalty,0));
  const optimistic=Math.min(1,base+.05);
  const width=optimistic-worst;
  return {
    method:'Adversarial Verdict Envelope v1.0',
    base_system_confidence:Number(base.toFixed(4)),
    pessimistic_system_confidence:Number(worst.toFixed(4)),
    optimistic_system_confidence:Number(optimistic.toFixed(4)),
    envelope_width:Number(width.toFixed(4)),
    base_label:confidenceLabel(base),pessimistic_label:confidenceLabel(worst),optimistic_label:confidenceLabel(optimistic),
    stress_scenarios:penalties,
    stable_under_stress:confidenceLabel(base)===confidenceLabel(worst)&&width<=.2,
    interpretation:'The platform computes a bounded confidence envelope after simultaneously applying plausible adverse evidence conditions. This is not a probabilistic confidence interval; it is a structured robustness stress test.'
  };
}
module.exports={buildAdversarialVerdictEnvelope};
