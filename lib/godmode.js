'use strict';
const crypto=require('crypto');
function norm(v){return String(v??'').trim().toUpperCase().replace(/\s+/g,' ')}
function sha(v){return crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex')}
function originSampleKey(r){
  // Publisher/portal is deliberately excluded. The key identifies the originating sample event.
  const explicit=r.origin_sample_id||r.lab_accession||r.sample_id||r.analysis_id;
  if(explicit)return `EXPLICIT:${norm(explicit)}`;
  return `DERIVED:${sha([r.pwsid,r.facility_id,r.sample_point,r.sample_date,r.sample_time,r.analyte_code||r.metal,r.sample_type,r.lab_id,r.method_id].map(norm).join('|'))}`;
}
function quarantineLiveEvidence(items=[]){
  const leads=[],official=[];
  for(const item of items){
    const u=String(item.url||''),t=String(item.publisher||item.title||'');
    if(/nextdoor|facebook|reddit|forum|hoa|community|social/i.test(u+' '+t))leads.push({...item,evidence_role:'lead-only',may_corroborate:false,quarantined:true});
    else official.push({...item,evidence_role:/\.gov\b|epa\.gov|floridadep\.gov|seminolecountyfl\.gov/i.test(u)?'official-context':'context-only',may_corroborate:false});
  }
  return {official_context:official,leads_only:leads};
}
function parcelLeadRisk(parcel={},serviceLine={}){
  const y=Number(parcel.year_built||parcel.YR_BLT||parcel.ACT_YR_BLT||parcel.yearBuilt);
  const status=norm(serviceLine.material_status||serviceLine.status||'UNKNOWN');
  let score=0,reasons=[];
  if(/LEAD|GALVANIZED REQUIRING REPLACEMENT/.test(status)){score+=70;reasons.push(`Service-line inventory status: ${status}`)}
  else if(/NON[- ]?LEAD/.test(status)){score-=20;reasons.push('Service-line inventory identifies non-lead material')}
  if(Number.isFinite(y)){if(y<1950){score+=25;reasons.push(`Property built ${y}, an older plumbing era`)}else if(y<1987){score+=15;reasons.push(`Property built ${y}, before the federal lead plumbing ban era`)}else reasons.push(`Property built ${y}`)}
  const tier=score>=70?'high-priority-for-tap-testing':score>=25?'elevated-plumbing-era-risk':score<=0?'lower-indicator-risk':'unknown-or-moderate';
  return {tier,score:Math.max(0,Math.min(100,score)),year_built:Number.isFinite(y)?y:null,service_line_status:status,reasons,disclaimer:'This is a plumbing/service-line risk indicator, not a predicted lead concentration.'};
}
function privateWellPathway({noPws,coordinates,wellPermits=[],sites=[],septicDensity=null,aquiferVulnerability=null}){
  if(!noPws)return {activated:false};
  return {activated:true,coordinates,well_permits:wellPermits,nearby_contamination_sites:sites,septic_density:septicDensity,aquifer_vulnerability:aquiferVulnerability,recommendation:'Obtain a certified private-well laboratory test; modeled proximity and vulnerability indicators are not measurements.'};
}
function snapshotManifest({records=[],sources=[],codeVersion,modelManifest={},config={}}){
  const dataHash=sha(records.map(r=>r.record_fingerprint||originSampleKey(r)).sort());
  const sourceHash=sha(sources.map(s=>[s.id,s.url,s.retrieved_at,s.content_hash]).sort());
  const configHash=sha(config);
  const snapshotId=sha({dataHash,sourceHash,codeVersion,modelManifest,configHash}).slice(0,24);
  return {snapshot_id:snapshotId,data_hash:dataHash,source_hash:sourceHash,config_hash:configHash,code_version:codeVersion,model_manifest:modelManifest,created_at:new Date().toISOString(),deterministic_inputs_pinned:true};
}
function adversarialReview(report){
  const challenges=[];
  if(report.statuses?.result_level!=='exact-household-sample')challenges.push('No direct household measurement supports a household concentration claim.');
  if(report.contradictions?.length)challenges.push(...report.contradictions.map(x=>`Unresolved contradiction: ${x}`));
  const single=(report.analyte_reports||report.metal_reports||[]).filter(x=>x.verification_summary?.presentation_status==='single-source').length;
  if(single)challenges.push(`${single} analyte conclusion(s) rely only on one originating sample/source chain.`);
  const severe=(report.analyte_reports||report.metal_reports||[]).some(x=>x.latest?.parsed?.value>x.latest?.record?.mcl);
  return {status:challenges.length?'challenged':'passed',challenges,severity:severe?'high':'normal',human_review_required:severe||challenges.length>3,decision:'The synthesis cannot be promoted above the reviewer findings.'};
}
function actionability(analyte){
  const a=norm(analyte);
  const map={LEAD:['NSF/ANSI 53','NSF/ANSI 58'],PFAS:['NSF/ANSI 53','NSF/ANSI 58'],ARSENIC:['NSF/ANSI 58'],NITRATE:['NSF/ANSI 58'],RADIUM:['NSF/ANSI 58'],COPPER:['NSF/ANSI 53']};
  return {standards:map[a]||[],message:map[a]?.length?'Verify the exact certified contaminant-reduction claim in the NSF listing; certification is model-specific.':'No generic treatment recommendation is assigned without a contaminant-specific certified claim.',medical_advice:false};
}
module.exports={originSampleKey,quarantineLiveEvidence,parcelLeadRisk,privateWellPathway,snapshotManifest,adversarialReview,actionability,sha};
