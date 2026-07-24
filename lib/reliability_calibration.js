'use strict';
function clamp(x,min=0,max=1){return Math.max(min,Math.min(max,Number(x)||0));}
function posteriorMean(alpha,beta){alpha=Number(alpha)||1;beta=Number(beta)||1;return alpha/(alpha+beta);}
function calibrateProfile(profile={agents:{}},adjudications=[]){
  const agents={};
  for(const [name,entry] of Object.entries(profile.agents||{}))agents[name]={...entry,alpha:Number(entry.alpha)||1,beta:Number(entry.beta)||1,observations:0};
  for(const row of adjudications||[]){
    if(!row||!row.agent||typeof row.correct!=='boolean')continue;
    const weight=clamp(row.weight===undefined?1:row.weight);
    const entry=agents[row.agent]||(agents[row.agent]={alpha:1,beta:1,basis:'uninformative prior',observations:0});
    if(row.correct)entry.alpha+=weight;else entry.beta+=weight;
    entry.observations+=1;
  }
  const reliability={};
  for(const [name,entry] of Object.entries(agents)){
    entry.posterior_mean=Number(posteriorMean(entry.alpha,entry.beta).toFixed(6));
    reliability[name]=entry.posterior_mean;
  }
  return {version:profile.version||'1.0.0',policy:profile.policy||'',agents,reliability,adjudication_count:(adjudications||[]).filter(x=>x&&typeof x.correct==='boolean').length,generated_at:new Date().toISOString()};
}
module.exports={posteriorMean,calibrateProfile};
