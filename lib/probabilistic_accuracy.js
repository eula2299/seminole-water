'use strict';

function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null}
function variance(xs,m=mean(xs)){return xs.length>1?xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1):0}
function quantile(xs,p){if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),i=(a.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return l===h?a[l]:a[l]+(a[h]-a[l])*(i-l)}
function clamp(x,a=0,b=1){return Math.max(a,Math.min(b,x))}
function normalCdf(x){const t=1/(1+.2316419*Math.abs(x));const d=.3989423*Math.exp(-x*x/2);let p=1-d*t*(.3193815+t*(-.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>=0?p:1-p}

// Empirical-Bayes normal-normal partial pooling. Honest about being an approximation.
function hierarchicalPartialPool(groups,{priorMean=null,betweenVariance=null,minVariance=1e-9}={}){
  const prepared=groups.map(g=>{const values=(g.values||[]).filter(Number.isFinite);return {...g,n:values.length,sample_mean:mean(values),sample_variance:Math.max(variance(values),minVariance)}}).filter(g=>g.n);
  const grand=priorMean??mean(prepared.map(g=>g.sample_mean));
  const tau2=betweenVariance??Math.max(variance(prepared.map(g=>g.sample_mean))-mean(prepared.map(g=>g.sample_variance/g.n)),minVariance);
  return prepared.map(g=>{
    const se2=g.sample_variance/g.n, weight=tau2/(tau2+se2), posteriorMean=weight*g.sample_mean+(1-weight)*grand;
    const posteriorVar=1/(1/tau2+1/se2), sd=Math.sqrt(posteriorVar);
    return {...g,prior_mean:grand,between_group_variance:tau2,shrinkage_weight:weight,posterior_mean:posteriorMean,credible_interval_95:[posteriorMean-1.96*sd,posteriorMean+1.96*sd],method:'empirical-Bayes normal-normal partial pooling',warning:'Borrowed-strength estimate; not a measured concentration and not a compliance determination.'};
  });
}

// Converts CCR range/average summaries into bounded latent-series constraints.
function intervalCcrLikelihood({min,max,average,n=null}){
  if(![min,max,average].every(Number.isFinite)||min>average||average>max) return {status:'invalid-summary'};
  const width=max-min, impliedSd=width/3.92; // approximate 95% span, deliberately conservative
  const effectiveN=Number.isInteger(n)&&n>1?n:null;
  const meanSe=effectiveN?impliedSd/Math.sqrt(effectiveN):null;
  return {status:'usable-interval-evidence',constraints:{sample_min:[min,min],sample_max:[max,max],latent_mean:[Math.max(min,average-(meanSe??width/2)),Math.min(max,average+(meanSe??width/2))]},approximate_sd:impliedSd,effective_n:effectiveN,likelihood_family:'bounded summary/order-statistic constraint',compliance_use:'context only unless sampling count, locations, and rule-specific aggregation are known'};
}

function corrosionIndices({chlorideMgL,sulfateMgL,pH,alkalinityMgLCaCO3,calciumMgL,temperatureC=25,tdsMgL=0}){
  const csmr=Number.isFinite(chlorideMgL)&&Number.isFinite(sulfateMgL)&&sulfateMgL>0?chlorideMgL/sulfateMgL:null;
  let langelier=null;
  if([pH,alkalinityMgLCaCO3,calciumMgL,temperatureC,tdsMgL].every(Number.isFinite)&&alkalinityMgLCaCO3>0&&calciumMgL>0){
    const A=(Math.log10(Math.max(tdsMgL,1))-1)/10;
    const B=-13.12*Math.log10(temperatureC+273)+34.55;
    const C=Math.log10(calciumMgL*.4);
    const D=Math.log10(alkalinityMgLCaCO3);
    const pHs=(9.3+A+B)-(C+D); langelier=pH-pHs;
  }
  const ccppProxy=langelier===null?null:langelier*(alkalinityMgLCaCO3||0)*0.5;
  const csmrTier=csmr===null?'unknown':csmr>.5?'elevated':csmr>.2?'moderate':'lower';
  return {csmr,langelier_saturation_index:langelier,ccpp_proxy_mgL_as_CaCO3:ccppProxy,csmr_risk_tier:csmrTier,interpretation:'Corrosion-potential inference only; not a predicted tap concentration.',inputs_complete:{csmr:csmr!==null,langelier:langelier!==null}};
}

function ionChargeBalance({calcium=0,magnesium=0,sodium=0,potassium=0,bicarbonate=0,carbonate=0,chloride=0,sulfate=0,nitrate=0}={}){
  const cations=calcium/20.039+magnesium/12.152+sodium/22.99+potassium/39.098;
  const anions=bicarbonate/61.016+carbonate/30.004+chloride/35.453+sulfate/48.03+nitrate/62.005;
  const denom=cations+anions, error=denom?100*(cations-anions)/denom:null;
  return {cation_meqL:cations,anion_meqL:anions,charge_balance_error_percent:error,status:error===null?'insufficient-data':Math.abs(error)<=10?'pass':Math.abs(error)<=20?'review':'quarantine',rule:'absolute charge-balance error <=10% preferred; >20% quarantined'};
}

// Binary segmentation with BIC-like penalty; deterministic and dependency-free.
function detectChangePoints(values,{minSegment=4,penalty=null}={}){
  const xs=values.filter(Number.isFinite), n=xs.length;if(n<minSegment*2)return {method:'penalized binary segmentation',change_points:[],status:'insufficient-data'};
  const sse=a=>{const m=mean(a);return a.reduce((s,x)=>s+(x-m)**2,0)}; const base=sse(xs); const pen=penalty??Math.log(n)*Math.max(variance(xs),1e-9);
  const cps=[];function split(lo,hi){if(hi-lo<minSegment*2)return;const seg=xs.slice(lo,hi),whole=sse(seg);let best=null;for(let k=lo+minSegment;k<=hi-minSegment;k++){const gain=whole-sse(xs.slice(lo,k))-sse(xs.slice(k,hi));if(!best||gain>best.gain)best={k,gain}}if(best&&best.gain>pen){cps.push(best.k);split(lo,best.k);split(best.k,hi)}}split(0,n);
  return {method:'penalized binary segmentation',change_points:cps.sort((a,b)=>a-b),penalty:pen,total_sse:base,status:'ok'};
}

function extremeTail(values,threshold){const xs=values.filter(Number.isFinite), exc=xs.filter(x=>x>threshold).map(x=>x-threshold);if(exc.length<8)return {status:'insufficient-tail-data',exceedances:exc.length};const m=mean(exc),v=variance(exc,m);const shape=clamp(.5*(1-m*m/v),-.49,.49),scale=Math.max(m*(1-shape),1e-9);return {status:'ok',method:'method-of-moments generalized Pareto approximation',threshold,shape,scale,exceedances:exc.length,tail_fraction:exc.length/xs.length,warning:'Screening probability model, not a regulatory compliance statistic.'}}

function rainfallLagAdjust(samples,rainfall,{lags=[1,3,7,14,30]}={}){
  const rainMap=new Map(rainfall.map(r=>[String(r.date).slice(0,10),Number(r.value)])); const day=86400000;
  const rows=samples.filter(x=>Number.isFinite(x.value)).map(s=>{const d=new Date(s.date);const predictors=lags.map(l=>{let sum=0;for(let i=1;i<=l;i++){const k=new Date(d-i*day).toISOString().slice(0,10);sum+=rainMap.get(k)||0}return sum});return {...s,predictors}});
  if(rows.length<lags.length+3)return {status:'insufficient-data',rows:rows.length};
  // sequential residualization via simple ridge gradient descent
  const X=rows.map(r=>[1,...r.predictors]), y=rows.map(r=>r.value), beta=Array(X[0].length).fill(0), lr=1e-7;
  for(let it=0;it<20000;it++){const g=beta.map(()=>0);for(let i=0;i<X.length;i++){const e=X[i].reduce((s,x,j)=>s+x*beta[j],0)-y[i];for(let j=0;j<g.length;j++)g[j]+=2*e*X[i][j]}for(let j=0;j<beta.length;j++)beta[j]-=lr*(g[j]/X.length+1e-6*beta[j])}
  const adjusted=rows.map((r,i)=>({...r,adjusted_value:y[i]-X[i].slice(1).reduce((s,x,j)=>s+x*beta[j+1],0)}));
  return {status:'ok',method:'ridge rainfall-lag residualization',lags_days:lags,coefficients:beta,adjusted};
}

function inferHydraulicTopology(seriesByPoint,{minOverlap=6,correlationThreshold=.75}={}){
  const points=Object.keys(seriesByPoint),edges=[];const corr=(a,b)=>{const keys=[...a.keys()].filter(k=>b.has(k));if(keys.length<minOverlap)return null;const x=keys.map(k=>a.get(k)),y=keys.map(k=>b.get(k)),mx=mean(x),my=mean(y);const num=x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0),den=Math.sqrt(x.reduce((s,v)=>s+(v-mx)**2,0)*y.reduce((s,v,i)=>s+(y[i]-my)**2,0));return den?num/den:null};
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){const r=corr(new Map(seriesByPoint[points[i]].map(x=>[x.date,x.value])),new Map(seriesByPoint[points[j]].map(x=>[x.date,x.value])));if(r!==null&&r>=correlationThreshold)edges.push({from:points[i],to:points[j],correlation:r,certainty:clamp((r-correlationThreshold)/(1-correlationThreshold)*.5+.5)});}
  return {method:'covariance-fingerprint topology inference',inferred_edges:edges,review_required:true,warning:'Inferred topology cannot replace utility-confirmed hydraulic maps.'};
}

function digitForensics(values){const xs=values.filter(Number.isFinite).map(Math.abs).filter(x=>x>0),first=Array(9).fill(0),last=Array(10).fill(0);for(const x of xs){first[Number(String(x).replace(/^0\./,'').replace(/^0+/,'')[0])-1]++;last[Math.round(x*1000)%10]++}const n=xs.length||1;const benfordChi=first.reduce((s,c,i)=>{const e=n*Math.log10(1+1/(i+1));return s+(c-e)**2/Math.max(e,1e-9)},0);const terminalMax=Math.max(...last)/n;return {n:xs.length,benford_chi_square:benfordChi,terminal_digit_max_share:terminalMax,flag:xs.length>=30&&(benfordChi>20.09||terminalMax>.25),interpretation:'Screening signal only; rounding, reporting limits, and laboratory methods can create benign digit patterns.'}}

function serviceLinePosterior({yearBuilt,inventoryNeighborhood={lead:0,galvanized:0,nonLead:0,unknown:0},corrosion={csmr:null,langelier_saturation_index:null}}={}){
  let prior=yearBuilt<1940?.65:yearBuilt<1950?.5:yearBuilt<1986?.25:yearBuilt<1991?.12:.03;
  const total=Object.values(inventoryNeighborhood).reduce((a,b)=>a+(Number(b)||0),0);if(total){const observed=((inventoryNeighborhood.lead||0)+.5*(inventoryNeighborhood.galvanized||0))/total;const strength=Math.min(total,100);prior=(prior*20+observed*strength)/(20+strength)}
  let corrosivityMultiplier=1;if(corrosion.csmr>.5)corrosivityMultiplier*=1.25;if(corrosion.langelier_saturation_index<-.5)corrosivityMultiplier*=1.2;
  const materialProbability=clamp(prior), releaseRisk=clamp(materialProbability*corrosivityMultiplier);
  return {posterior_probability_lead_or_galvanized:materialProbability,posterior_corrosion_interaction_risk:releaseRisk,credible_band_heuristic:[clamp(materialProbability-.15),clamp(materialProbability+.15)],status:total?'neighborhood-informed':'parcel-era-prior-only',disclaimer:'Material/risk posterior only; not proof of service-line material and not a predicted lead concentration.'};
}

function coKrigingScreen(points,target,{aquifer=null,depth=null,power=2}={}){const usable=points.filter(p=>Number.isFinite(p.value)&&Number.isFinite(p.lat)&&Number.isFinite(p.lon));if(usable.length<3)return {status:'insufficient-data'};let sw=0,sv=0,vals=[];for(const p of usable){const dx=(p.lon-target.lon)*Math.cos(target.lat*Math.PI/180),dy=p.lat-target.lat,dist=Math.sqrt(dx*dx+dy*dy)*111+1e-3;let w=1/(dist**power);if(aquifer&&p.aquifer===aquifer)w*=2;if(Number.isFinite(depth)&&Number.isFinite(p.depth))w*=1/(1+Math.abs(depth-p.depth)/100);sw+=w;sv+=w*p.value;vals.push({w,value:p.value})}const estimate=sv/sw,varianceEstimate=vals.reduce((s,p)=>s+p.w*(p.value-estimate)**2,0)/sw;return {status:'ok',method:'covariate-weighted inverse-distance screening surface',estimate,standard_error_proxy:Math.sqrt(varianceEstimate),n:usable.length,warning:'Not regulatory-grade kriging; use only as a private-well screening prior until a fitted variogram is available.'}}

module.exports={hierarchicalPartialPool,intervalCcrLikelihood,corrosionIndices,ionChargeBalance,detectChangePoints,extremeTail,rainfallLagAdjust,inferHydraulicTopology,digitForensics,serviceLinePosterior,coKrigingScreen,normalCdf};
