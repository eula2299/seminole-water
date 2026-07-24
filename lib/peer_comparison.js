'use strict';
const {normalizeMeasurement,versionRecords}=require('./accuracy');

const COMPARABLE_GROUPS=new Set(['INOR','DBP','VOC','SOC','RAD','PFAS','MICRO','METAL']);
function norm(s){return String(s||'').trim().toUpperCase();}
function safeDate(v){const s=String(v||'');return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):s;}
function latestByAnalyte(rows){
  const groups=new Map();
  for(const r of versionRecords(rows).filter(x=>x.is_current)){
    const analyte=norm(r.analyte||r.metal);
    if(!analyte)continue;
    const cur=groups.get(analyte);
    if(!cur||safeDate(r.sample_date)>safeDate(cur.sample_date))groups.set(analyte,r);
  }
  return groups;
}
function percentileRank(value,values){
  const xs=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!xs.length||!Number.isFinite(value))return null;
  const below=xs.filter(x=>x<value).length,equal=xs.filter(x=>x===value).length;
  return (below+.5*equal)/xs.length;
}
function median(xs){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}

function buildPeerComparison({pwsid,records=[],systems=[],minPeers=5,maxAgeDifferenceDays=366}={}){
  if(!pwsid)return {status:'unresolved-provider',comparisons:[],disclaimer:'A peer comparison requires an exact PWS.'};
  const rowsByPws=new Map();
  for(const row of records){if(!row.pwsid)continue;const bucket=rowsByPws.get(row.pwsid)||[];bucket.push(row);rowsByPws.set(row.pwsid,bucket);}
  const current=latestByAnalyte(rowsByPws.get(pwsid)||[]);
  const peerMaps=new Map();
  for(const s of systems){if(!s.pwsid||s.pwsid===pwsid)continue;peerMaps.set(s.pwsid,latestByAnalyte(rowsByPws.get(s.pwsid)||[]));}
  const comparisons=[];
  for(const [analyte,row] of current){
    const group=norm(row.contaminant_group);
    if(group&&!COMPARABLE_GROUPS.has(group))continue;
    const nm=row.normalized_measurement||normalizeMeasurement(row.result,row.unit,row.detection_limit);
    if(nm.censored){comparisons.push({analyte,group,status:'current-result-censored',current:{result:row.result,unit:row.unit,date:row.sample_date},peer_count:0,percentile:null});continue;}
    if(!Number.isFinite(nm.canonical_value))continue;
    const t=Date.parse(row.sample_date||'');
    const peers=[];
    for(const [peerPws,map] of peerMaps){
      const pr=map.get(analyte);if(!pr)continue;
      const pm=pr.normalized_measurement||normalizeMeasurement(pr.result,pr.unit,pr.detection_limit);
      if(pm.censored||!Number.isFinite(pm.canonical_value))continue;
      const pt=Date.parse(pr.sample_date||'');
      if(Number.isFinite(t)&&Number.isFinite(pt)&&Math.abs(t-pt)/86400000>maxAgeDifferenceDays)continue;
      peers.push({pwsid:peerPws,value:pm.canonical_value,date:pr.sample_date});
    }
    if(peers.length<minPeers){comparisons.push({analyte,group,status:'insufficient-peer-coverage',current:{result:row.result,unit:row.unit,date:row.sample_date,canonical_value:nm.canonical_value},peer_count:peers.length,percentile:null});continue;}
    const pct=percentileRank(nm.canonical_value,peers.map(x=>x.value));
    const mcl=Number(row.mcl);
    const mclNm=Number.isFinite(mcl)?normalizeMeasurement(mcl,row.unit).canonical_value:null;
    comparisons.push({
      analyte,group,status:'comparable',current:{result:row.result,unit:row.unit,date:row.sample_date,canonical_value:nm.canonical_value},peer_count:peers.length,
      higher_concentration_percentile:Number(pct.toFixed(4)),relative_band:pct>=.9?'upper-decile':pct>=.75?'upper-quartile':pct<=.1?'lower-decile':pct<=.25?'lower-quartile':'middle-half',
      mcl_fraction:Number.isFinite(mclNm)&&mclNm>0?Number((nm.canonical_value/mclNm).toFixed(4)):null,
      peer_median:median(peers.map(x=>x.value)),peer_min:Math.min(...peers.map(x=>x.value)),peer_max:Math.max(...peers.map(x=>x.value))
    });
  }
  const comparable=comparisons.filter(x=>x.status==='comparable');
  const profile=median(comparable.map(x=>x.higher_concentration_percentile));
  const high=comparable.filter(x=>x.higher_concentration_percentile>=.75).sort((a,b)=>b.higher_concentration_percentile-a.higher_concentration_percentile).slice(0,8);
  const low=comparable.filter(x=>x.higher_concentration_percentile<=.25).sort((a,b)=>a.higher_concentration_percentile-b.higher_concentration_percentile).slice(0,8);
  return {
    status:comparable.length?'computed':'insufficient-comparable-data',pwsid,comparisons,
    comparable_analytes:comparable.length,total_current_analytes:current.size,coverage_fraction:current.size?Number((comparable.length/current.size).toFixed(4)):0,
    median_higher_concentration_percentile:profile===null?null:Number(profile.toFixed(4)),upper_relative_analytes:high,lower_relative_analytes:low,
    disclaimer:'This is a peer concentration profile, not a toxicity or safety score. It compares only analytes with compatible, similarly dated, uncensored system-level records. Missing analytes and non-detects are not treated as zero, and different monitoring coverage can prevent ranking.'
  };
}
module.exports={buildPeerComparison,latestByAnalyte,percentileRank};
