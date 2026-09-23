'use strict';
const evaluation=require('./evaluations/utility-next-round-v1-summary.json');

function finite(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
function modelReadiness(){
 const model=evaluation.model||{},last=evaluation.last_observed_round_baseline||{},prior=evaluation.prior_round_average_baseline||{};
 return {
  schema:'model-readiness/1',
  status:evaluation.status||'not-evaluated',
  purpose:evaluation.endpoint||null,
  validation_scope:'held-out-utilities-and-states-retrospective',
  evaluated_at:evaluation.evaluated_at||null,
  holdout:{states:Array.isArray(evaluation.holdout_states)?evaluation.holdout_states:[],utilities:Number(evaluation.holdout_utilities)||0,transitions:Number(evaluation.holdout_transitions)||0,overlapping_utilities:Number(evaluation.overlapping_utilities)||0},
  performance:{brier_score:finite(model.brier_score),roc_auc:finite(model.roc_auc),average_precision:finite(model.average_precision),precision_at_0_5:finite(model.precision_at_0_5),recall_at_0_5:finite(model.recall_at_0_5)},
  baseline_checks:{
   brier_better_than_last_round:finite(model.brier_score)!==null&&finite(last.brier_score)!==null?model.brier_score<last.brier_score:null,
   brier_better_than_prior_round_average:finite(model.brier_score)!==null&&finite(prior.brier_score)!==null?model.brier_score<prior.brier_score:null,
   roc_auc_better_than_last_round:finite(model.roc_auc)!==null&&finite(last.roc_auc)!==null?model.roc_auc>last.roc_auc:null,
   roc_auc_better_than_prior_round_average:finite(model.roc_auc)!==null&&finite(prior.roc_auc)!==null?model.roc_auc>prior.roc_auc:null
  },
  interpretation:evaluation.interpretation||null,
  production_utility_risk_forecast_enabled:false,
  production_household_inference_enabled:false,
  nationally_validated_household_models:0,
  household_prediction_gate:'blocked-until-household-specific-prospective-or-external-validation',
  limitations:Array.isArray(evaluation.limitations)?evaluation.limitations:[]
 };
}
module.exports={modelReadiness};
