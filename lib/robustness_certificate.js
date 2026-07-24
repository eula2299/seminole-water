'use strict';
function buildRobustnessCertificate({counterfactualStability={},uncertaintyBudget={},negotiation={},providerConsensus={},exactHouseholdCount=0,contradictions=[]}={}){
  const checks=[
    {id:'provider-accepted',passed:!!providerConsensus.accepted,detail:providerConsensus.accepted?`PWS ${providerConsensus.pwsid} accepted`:'No unique PWS accepted'},
    {id:'coordinate-perturbation',passed:(counterfactualStability.stability_score||0)>=.75,detail:counterfactualStability.interpretation||'not computed'},
    {id:'scope-firewall',passed:exactHouseholdCount>0||!(negotiation.accepted_claims||[]).some(x=>x.topic==='household-measurement'&&/concentration/i.test(x.proposition)),detail:exactHouseholdCount?'Direct household evidence exists':'No household concentration claim was accepted'},
    {id:'negotiation-no-hard-veto',passed:(negotiation.vetoes||[]).every(x=>x.topic!=='provider-identity'),detail:`${(negotiation.vetoes||[]).length} total hard veto(es)`},
    {id:'system-confidence',passed:(uncertaintyBudget.system_evidence_confidence||0)>=.55,detail:`system score ${uncertaintyBudget.system_evidence_confidence||0}`},
    {id:'contradiction-load',passed:(contradictions||[]).length<=3,detail:`${(contradictions||[]).length} contradiction/limitation item(s)`}
  ];
  const passed=checks.filter(x=>x.passed).length;
  let level='fragile';
  if(passed===checks.length)level='robust';
  else if(passed>=checks.length-1)level='conditionally-robust';
  else if(passed>=Math.ceil(checks.length/2))level='limited';
  return {level,checks,passed,total:checks.length,scope:exactHouseholdCount?'household-and-system':'system-level-only',certificate_statement:level==='robust'?'The system-level conclusion survived all configured counterfactual, scope, negotiation, and uncertainty checks.':level==='conditionally-robust'?'The system-level conclusion is stable under most configured checks, with one important limitation.':'The conclusion should be treated as provisional because multiple robustness checks did not pass.'};
}
module.exports={buildRobustnessCertificate};
