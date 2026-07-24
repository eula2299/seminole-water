'use strict';
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function date(v){const d=new Date(v);return Number.isNaN(+d)?null:d}
function mean(a){const x=a.map(n).filter(v=>v!==null);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function percentile90(a){const x=a.map(n).filter(v=>v!==null).sort((a,b)=>a-b);if(!x.length)return null;return x[Math.max(0,Math.ceil(.9*x.length)-1)]}
const RULES={
 LEAD:{kind:'action-level-90p',threshold_ug_l:10,location_basis:'targeted household tap sites',minimum_samples:5},
 COPPER:{kind:'action-level-90p',threshold_ug_l:1300,location_basis:'targeted household tap sites',minimum_samples:5},
 'TOTAL THMS':{kind:'lraa',threshold_ug_l:80,quarters:4,location_basis:'individual Stage 2 monitoring location'},
 TTHM:{kind:'lraa',threshold_ug_l:80,quarters:4,location_basis:'individual Stage 2 monitoring location'},
 'TOTAL HALOACETIC ACIDS (HAA5)':{kind:'lraa',threshold_ug_l:60,quarters:4,location_basis:'individual Stage 2 monitoring location'},
 HAA5:{kind:'lraa',threshold_ug_l:60,quarters:4,location_basis:'individual Stage 2 monitoring location'},
 NITRATE:{kind:'single-with-confirmation',threshold_ug_l:10000,location_basis:'entry point',confirmation_required:true},
 NITRITE:{kind:'single-with-confirmation',threshold_ug_l:1000,location_basis:'entry point',confirmation_required:true},
 'COMBINED RADIUM 226/228':{kind:'raa',threshold:5,unit:'pCi/L',quarters:4,location_basis:'entry point'},
 URANIUM:{kind:'raa',threshold_ug_l:30,quarters:4,location_basis:'entry point'},
 'GROSS ALPHA':{kind:'raa',threshold:15,unit:'pCi/L',quarters:4,location_basis:'entry point'},
 'TOTAL COLIFORM':{kind:'rtcr-trigger',location_basis:'routine and repeat distribution samples'},
 'E. COLI':{kind:'rtcr-ecoli-condition',location_basis:'routine and repeat distribution samples'}
};
function key(r){return String(r.analyte||r.contaminant||r.metal||r.CONTAMDESC||'').trim().toUpperCase()}
function value(r){return n(r.normalized_measurement?.canonical_value??r.result??r.RESULTS)}
function byLocation(rows){return Object.groupBy?Object.groupBy(rows,r=>String(r.location_code||r.sample_point||r.LOCATIONCODE||r.entry_point||'UNKNOWN')):rows.reduce((o,r)=>((o[String(r.location_code||r.sample_point||r.LOCATIONCODE||r.entry_point||'UNKNOWN')]??=[]).push(r),o),{})}
function quarter(d){return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth()/3)+1}`}
function evaluate(analyte,rows=[]){const name=String(analyte).toUpperCase(),rule=RULES[name]||{kind:'single-sample-screening',location_basis:'sample-specific'};const usable=rows.filter(r=>value(r)!==null&&date(r.sample_date||r.SAMPLEDATE));
 if(rule.kind==='action-level-90p'){const vals=usable.filter(r=>/TAP|LCR|FIRST/i.test(String(r.sample_type||r.SAMPLETYPE||''))).map(value);const p90=percentile90(vals);return {rule,statistic:'90th percentile',value:p90,n:vals.length,status:p90===null?'insufficient-data':p90>rule.threshold_ug_l?'action-level-exceedance':'below-action-level',compliance_claim_allowed:vals.length>=rule.minimum_samples};}
 if(rule.kind==='lraa'){const results=[];for(const [loc,rs] of Object.entries(byLocation(usable))){const qs={};for(const r of rs){const d=date(r.sample_date||r.SAMPLEDATE);(qs[quarter(d)]??=[]).push(value(r))}const qmeans=Object.entries(qs).sort().slice(-4).map(([q,v])=>({quarter:q,mean:mean(v)}));const lraa=mean(qmeans.map(x=>x.mean));results.push({location:loc,quarter_means:qmeans,lraa,status:qmeans.length<4?'incomplete-window':lraa>rule.threshold_ug_l?'mcl-exceedance':'below-mcl'})}return {rule,statistic:'locational running annual average',locations:results,compliance_claim_allowed:results.some(x=>x.quarter_means.length===4)};}
 if(rule.kind==='raa'){const results=[];for(const [loc,rs] of Object.entries(byLocation(usable))){const vals=rs.sort((a,b)=>date(a.sample_date)-date(b.sample_date)).slice(-4).map(value);const raa=mean(vals);results.push({location:loc,raa,n:vals.length,status:vals.length<4?'incomplete-window':raa>(rule.threshold_ug_l??rule.threshold)?'mcl-exceedance':'below-mcl'})}return {rule,statistic:'running annual average',locations:results,compliance_claim_allowed:results.some(x=>x.n===4)};}
 if(rule.kind==='single-with-confirmation'){const latest=usable.sort((a,b)=>date(b.sample_date)-date(a.sample_date))[0];const v=latest?value(latest):null;const confirm=usable.filter(r=>latest&&String(r.sample_date)!==String(latest.sample_date)&&Math.abs((date(r.sample_date)-date(latest.sample_date))/86400000)<=30).some(r=>value(r)>rule.threshold_ug_l);return {rule,statistic:'sample plus confirmation logic',value:v,status:v===null?'insufficient-data':v<=rule.threshold_ug_l?'below-mcl':confirm?'confirmed-exceedance':'confirmation-required',confirmation_found:confirm,compliance_claim_allowed:v!==null&&(v<=rule.threshold_ug_l||confirm)};}
 if(rule.kind.startsWith('rtcr')){const positives=usable.filter(r=>/POS|PRESENT|DETECT/i.test(String(r.result_text||r.result||r.RESULTS))).length;return {rule,statistic:'RTCR occurrence/condition evaluation',positive_count:positives,status:positives?'assessment-or-condition-review-required':'no-positive-records-in-input',compliance_claim_allowed:false,note:'RTCR determinations require routine/repeat pairing and system schedule metadata.'};}
 const latest=usable.sort((a,b)=>date(b.sample_date)-date(a.sample_date))[0];return {rule,statistic:'screening only',value:latest?value(latest):null,status:latest?'screening-result-only':'insufficient-data',compliance_claim_allowed:false};}
module.exports={RULES,evaluate,percentile90};
