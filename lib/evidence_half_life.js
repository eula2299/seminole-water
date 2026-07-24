'use strict';
function pearson(a,b){if(a.length<3)return null;const ma=a.reduce((s,x)=>s+x,0)/a.length,mb=b.reduce((s,x)=>s+x,0)/b.length;let n=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;n+=x*y;da+=x*x;db+=y*y}return da&&db?n/Math.sqrt(da*db):null}
function fitHalfLife(rows,{valueKey='value',dateKey='date',stratumKeys=['analyte','stratum']}={}){
 const groups=new Map();for(const r of rows){const key=stratumKeys.map(k=>r[k]||'UNKNOWN').join('|');(groups.get(key)||groups.set(key,[]).get(key)).push(r)}
 const out=[];for(const [key,g] of groups){g.sort((a,b)=>new Date(a[dateKey])-new Date(b[dateKey]));const x=[],y=[],lags=[];for(let i=1;i<g.length;i++){const a=Number(g[i-1][valueKey]),b=Number(g[i][valueKey]);if(Number.isFinite(a)&&Number.isFinite(b)){x.push(a);y.push(b);lags.push((new Date(g[i][dateKey])-new Date(g[i-1][dateKey]))/86400000)}}const rho=pearson(x,y);const lag=lags.length?lags.reduce((s,v)=>s+v,0)/lags.length:null;let halfLife=null;if(rho!==null&&rho>0&&rho<1&&lag>0)halfLife=-Math.log(2)*lag/Math.log(rho);else if(rho>=1)halfLife=Infinity;out.push({key,n_pairs:x.length,lag_days:lag,autocorrelation:rho,half_life_days:halfLife,status:halfLife?'estimated':'insufficient-or-nonpersistent'})}return out;
}
function freshnessWeight(ageDays,halfLifeDays){if(!Number.isFinite(ageDays)||ageDays<0)return 0;if(halfLifeDays===Infinity)return 1;if(!Number.isFinite(halfLifeDays)||halfLifeDays<=0)return null;return Math.pow(.5,ageDays/halfLifeDays)}
module.exports={pearson,fitHalfLife,freshnessWeight};
