'use strict';
const crypto=require('crypto');
const stable=x=>crypto.createHash('sha256').update(JSON.stringify(x,Object.keys(x).sort())).digest('hex');
function evaluateMutation({baselineInput,mutatedInput,runReport,mutationId}){
 const base=runReport(structuredClone(baselineInput));
 const mutated=runReport(structuredClone(mutatedInput));
 const changed=JSON.stringify(base)!==JSON.stringify(mutated);
 const flagged=Boolean(mutated?.quality?.quarantine||mutated?.quality?.mutation_flag||mutated?.review?.required||mutated?.status==='invalid');
 const harmless=!changed;
 return {mutation_id:mutationId,killed:flagged||harmless,flagged,output_unchanged:harmless,baseline_hash:stable(base),mutated_hash:stable(mutated)};
}
function runSuite(cases,runReport){const results=cases.map(c=>evaluateMutation({...c,runReport}));return {total:results.length,killed:results.filter(x=>x.killed).length,kill_rate:results.length?results.filter(x=>x.killed).length/results.length:0,results};}
module.exports={evaluateMutation,runSuite};
