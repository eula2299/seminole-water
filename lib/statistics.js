'use strict';
function benjaminiHochberg(pValues=[]){
 const indexed=pValues.map((p,i)=>({p:Number(p),i})).filter(x=>Number.isFinite(x.p)).sort((a,b)=>a.p-b.p); const m=indexed.length,out=Array(pValues.length).fill(null); let prev=1;
 for(let k=m-1;k>=0;k--){const q=Math.min(prev,indexed[k].p*m/(k+1),1);out[indexed[k].i]=q;prev=q}return out;
}
function mannKendall(values=[]){
 const x=values.filter(v=>Number.isFinite(Number(v))).map(Number);let s=0;for(let i=0;i<x.length;i++)for(let j=i+1;j<x.length;j++)s+=Math.sign(x[j]-x[i]);
 const n=x.length,variance=n<2?0:n*(n-1)*(2*n+5)/18;const z=variance?((s>0?s-1:s<0?s+1:0)/Math.sqrt(variance)):0;return {n,S:s,z,direction:z>0?'increasing':z<0?'decreasing':'no-monotonic-direction',method:'Mann-Kendall; significance requires an externally validated p-value implementation for production decisions'};
}
function censoredSummary(rows=[]){
 const detected=rows.filter(r=>!r.normalized_measurement?.censored&&Number.isFinite(r.normalized_measurement?.canonical_value));
 const censored=rows.filter(r=>r.normalized_measurement?.censored);
 return {n:rows.length,detected_n:detected.length,left_censored_n:censored.length,method:detected.length>=3&&censored.length?'ROS/Kaplan-Meier-required':'descriptive-only',substitution_used:false,note:'Non-detects are retained as censored observations; half-detection-limit substitution is prohibited.'};
}
function analyzeFleet(groups=[]){const raw=groups.map(g=>g.p_value??null);const q=benjaminiHochberg(raw);return groups.map((g,i)=>({...g,fdr_q_value:q[i],multiple_comparison_method:'Benjamini-Hochberg'}));}
module.exports={benjaminiHochberg,mannKendall,censoredSummary,analyzeFleet};
