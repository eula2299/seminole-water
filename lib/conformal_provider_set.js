'use strict';
function clamp(x,min=0,max=1){return Math.max(min,Math.min(max,Number(x)||0));}
function quantile(xs,q){
  const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const i=Math.min(a.length-1,Math.max(0,Math.ceil((a.length+1)*q)-1));
  return a[i];
}
function normalizeCandidates(candidates=[]){
  const best=new Map();
  for(const c of candidates){
    if(!c?.pwsid)continue;
    const score=clamp(c.score);
    if(!best.has(c.pwsid)||score>best.get(c.pwsid).score)best.set(c.pwsid,{...c,score});
  }
  return [...best.values()].sort((a,b)=>b.score-a.score);
}
function buildProviderPredictionSet({candidates=[],acceptedPwsid=null,alpha=.1,calibrationNonconformity=[]}={}){
  const rows=normalizeCandidates(candidates);
  if(!rows.length)return {status:'no-candidates',prediction_set:[],coverage_target:1-alpha,calibration_count:calibrationNonconformity.length};
  const threshold=quantile(calibrationNonconformity,1-alpha);
  let selected;
  let method;
  if(threshold!==null){
    selected=rows.filter(x=>(1-x.score)<=threshold);
    method='split-conformal provider set using held-out nonconformity scores';
  }else{
    const top=rows[0].score;
    const adaptiveGap=Math.max(.03,Math.min(.12,(1-top)*.5+.03));
    selected=rows.filter(x=>top-x.score<=adaptiveGap&&x.score>=.5);
    method='conservative uncalibrated set-valued fallback; no empirical coverage guarantee';
  }
  if(acceptedPwsid&&!selected.some(x=>x.pwsid===acceptedPwsid)){
    const accepted=rows.find(x=>x.pwsid===acceptedPwsid);
    if(accepted)selected.push(accepted);
  }
  const unique=[...new Map(selected.map(x=>[x.pwsid,x])).values()].sort((a,b)=>b.score-a.score);
  const singleton=unique.length===1;
  const margin=rows.length>1?rows[0].score-rows[1].score:rows[0].score;
  return {
    status:threshold===null?'uncalibrated-conservative':'calibrated',
    method,
    alpha,
    coverage_target:1-alpha,
    empirical_coverage_guarantee:threshold!==null,
    calibration_count:calibrationNonconformity.length,
    nonconformity_threshold:threshold,
    prediction_set:unique.map(x=>({pwsid:x.pwsid,score:Number(x.score.toFixed(4)),reasons:x.reasons||[]})),
    singleton,
    top_margin:Number(margin.toFixed(4)),
    ambiguity:unique.length>1?'multiple PWS identities remain plausible under the set-valued rule':singleton?'one PWS remains in the prediction set':'no defensible provider remains',
    interpretation:threshold===null
      ?'The output is deliberately set-valued and conservative because no independent calibration cases were available. It must not be described as having conformal coverage until held-out adjudicated addresses are populated.'
      :'The set is calibrated to contain the correct PWS with the configured marginal coverage target under exchangeability assumptions.'
  };
}
module.exports={buildProviderPredictionSet,normalizeCandidates,quantile};
