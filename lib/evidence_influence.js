'use strict';
const {negotiateClaims}=require('./agent_negotiation');
function statusMap(result){
  const m=new Map();
  for(const x of result.accepted_claims||[])m.set(x.key,{status:'accepted',confidence:x.confidence});
  for(const x of result.rejected_claims||[])m.set(x.key,{status:'rejected',confidence:x.confidence});
  for(const x of result.undecided_claims||[])m.set(x.key,{status:'undecided',confidence:x.confidence});
  return m;
}
function originsOf(claims=[]){return [...new Set(claims.flatMap(c=>(c.origin_keys&&c.origin_keys.length?c.origin_keys:[c.id])).filter(Boolean))];}
function leaveOneOriginOutInfluence(claims=[],options={}){
  const baseline=negotiateClaims(claims,options),baseMap=statusMap(baseline),influences=[];
  for(const origin of originsOf(claims)){
    const filtered=claims.filter(c=>!(c.origin_keys||[]).includes(origin));
    const rerun=negotiateClaims(filtered,options),map=statusMap(rerun);
    const flips=[];let totalDelta=0;
    const keys=new Set([...baseMap.keys(),...map.keys()]);
    for(const key of keys){
      const a=baseMap.get(key)||{status:'absent',confidence:0},b=map.get(key)||{status:'absent',confidence:0};
      const delta=Math.abs((a.confidence||0)-(b.confidence||0));totalDelta+=delta;
      if(a.status!==b.status)flips.push({claim_key:key,from:a.status,to:b.status,confidence_delta:Number(delta.toFixed(4))});
    }
    influences.push({origin,claim_status_flips:flips.length,total_confidence_delta:Number(totalDelta.toFixed(4)),flips,remaining_claims:filtered.length});
  }
  influences.sort((a,b)=>b.claim_status_flips-a.claim_status_flips||b.total_confidence_delta-a.total_confidence_delta);
  const dominant=influences.filter(x=>x.claim_status_flips||x.total_confidence_delta>=.2);
  return {
    method:'Leave-One-Origin-Out Negotiation Influence Audit v1.0',
    baseline,
    origin_count:influences.length,
    influences,
    dominant_origins:dominant.slice(0,10),
    single_origin_fragility:influences.some(x=>x.claim_status_flips>0),
    max_confidence_delta:influences.length?influences[0].total_confidence_delta:0,
    interpretation:'Each originating evidence unit is removed and the full negotiation is rerun. Publisher replicas sharing an origin are removed together, exposing conclusions dominated by one sample or source.'
  };
}
module.exports={leaveOneOriginOutInfluence,statusMap,originsOf};
