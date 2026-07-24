'use strict';
function clamp(x,min=0,max=1){return Math.max(min,Math.min(max,Number(x)||0));}
function defaultBid(rec={}){
  const effort=clamp(rec.effort??.5,.05,1),latency=clamp(rec.latency??effort),privacy=clamp(rec.privacy_risk??(rec.id==='household-sample'?.6:.1));
  const gain=clamp(rec.expected_confidence_gain),flip=clamp(rec.expected_flip_probability??rec.expected_verdict_flip_probability??rec.flip_probability??.3),severity=clamp(rec.health_severity??rec.severity??.6);
  const utility=(.35*gain+.3*flip+.25*severity+.1*(1-privacy));
  const cost=.45*effort+.25*latency+.3*privacy;
  return {...rec,effort,latency,privacy_risk:privacy,expected_confidence_gain:gain,expected_flip_probability:flip,health_severity:severity,utility:Number(utility.toFixed(4)),cost:Number(cost.toFixed(4)),value_per_cost:Number((utility/Math.max(.05,cost)).toFixed(4))};
}
function dominates(a,b){return a.utility>=b.utility&&a.cost<=b.cost&&(a.utility>b.utility||a.cost<b.cost);}
function paretoFront(bids){return bids.filter((x,i)=>!bids.some((y,j)=>j!==i&&dominates(y,x)));}
function allocateEvidenceBudget(recommendations=[],{budget=1.4,maxActions=3,privacyCeiling=.8}={}){
  const bids=recommendations.map(defaultBid).filter(x=>x.privacy_risk<=privacyCeiling).sort((a,b)=>b.value_per_cost-a.value_per_cost||b.utility-a.utility);
  const selected=[];let spent=0;
  for(const bid of bids){
    if(selected.length>=maxActions)break;
    if(spent+bid.cost<=budget){selected.push(bid);spent+=bid.cost;}
  }
  return {
    method:'Multi-Agent Evidence Acquisition Auction v1.0',
    budget:Number(budget.toFixed(4)),spent:Number(spent.toFixed(4)),remaining:Number((budget-spent).toFixed(4)),max_actions:maxActions,privacy_ceiling:privacyCeiling,
    selected,bids,pareto_frontier:paretoFront(bids),
    expected_combined_confidence_gain:Number((1-selected.reduce((remain,x)=>remain*(1-x.expected_confidence_gain),1)).toFixed(4)),
    interpretation:'Evidence requests compete on expected error reduction, verdict-flip probability, health severity, acquisition effort, latency, and privacy. The coordinator allocates a bounded budget rather than requesting every possible dataset.'
  };
}
module.exports={allocateEvidenceBudget,defaultBid,paretoFront,dominates};
