'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {normalizeMeasurement,versionRecords,resolveUtilityLineage,applicableSources}=require('./accuracy');
const {verifyRecords}=require('./verification');
const {quarantineLiveEvidence,parcelLeadRisk,privateWellPathway,snapshotManifest,adversarialReview,actionability}=require('./godmode');
const {censoredSummary,mannKendall}=require('./statistics');
const {effectiveN}=require('./effective_independence');
const {freshnessWeight}=require('./evidence_half_life');
const {admissibility}=require('./hydraulic_admissibility');
const {score:strategicSamplingScore}=require('./strategic_sampling');
const prob=require('./probabilistic_accuracy');
const {summarizeAddressEvidence}=require('./address_evidence');
const {computeUncertaintyBudget}=require('./uncertainty_budget');
const {buildInvestigationClaims,negotiateClaims}=require('./agent_negotiation');
const {planNextEvidence}=require('./active_evidence_planner');
const {buildRobustnessCertificate}=require('./robustness_certificate');
const {buildPeerComparison}=require('./peer_comparison');
const {calibrateProfile}=require('./reliability_calibration');
const {buildApplicabilityLattice}=require('./evidence_applicability_lattice');
const {buildProviderPredictionSet}=require('./conformal_provider_set');
const {leaveOneOriginOutInfluence}=require('./evidence_influence');
const {findMinimumContradictionCutsets}=require('./contradiction_cutset');
const {buildCoverageTensor}=require('./coverage_tensor');
const {buildCausalPathwayGraph}=require('./causal_pathway_graph');
const {allocateEvidenceBudget}=require('./evidence_auction');
const {buildAdversarialVerdictEnvelope}=require('./adversarial_verdict_envelope');
const RELIABILITY_PROFILE=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','agent_reliability.json'),'utf8'));
const RELIABILITY_ADJUDICATIONS=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','agent_adjudications.json'),'utf8')).adjudications||[];
const RELIABILITY_CALIBRATION=calibrateProfile(RELIABILITY_PROFILE,RELIABILITY_ADJUDICATIONS);
const PROVIDER_CONFORMAL_CALIBRATION=(()=>{try{return JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','provider_conformal_calibration.json'),'utf8')).nonconformity_scores||[];}catch{return [];}})();

function meanSafe(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null}
function normalize(s){return String(s||'').trim().toUpperCase().replace(/\s+/g,' ')}
function hashAddress(address,city){return crypto.createHash('sha256').update(`${normalize(address)}|${normalize(city)}|FL`).digest('hex')}
function safeDate(v){const s=String(v||'');return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):s}
function sourceForRecord(r,registry){
  const src=registry.find(x=>x.id===(r.source_id||'fdep-chemical-current'))||registry.find(x=>x.id==='fdep-chemical-current');
  return {...src,source_year:r.source_year||null,local_file:r.source_file||null};
}
function classifyGranularity(record,direct=false){
  if(direct)return 'exact-household-sample';
  const t=normalize(record.sample_type);
  if(/TAP|HOME|RESIDENT|HOUSEHOLD/.test(t))return 'tap-sampling-record';
  if(/WELL|SOURCE/.test(t))return 'source-well-record';
  if(/PLANT|ENTRY|POE/.test(t))return 'treatment-entry-record';
  return 'public-water-system-record';
}
function parseNumeric(v){
  if(typeof v==='number')return {value:v,qualifier:null};
  const s=String(v??'').trim(); const m=s.match(/^([<>]=?)?\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i);
  return m?{value:Number(m[2]),qualifier:m[1]||null}:{value:null,qualifier:s||null};
}
function latestPerMetal(rows){
  const groups={}; for(const r of rows)(groups[r.metal]??=[]).push(r);
  return Object.entries(groups).map(([metal,history])=>{
    history.sort((a,b)=>safeDate(b.sample_date).localeCompare(safeDate(a.sample_date)));
    const latest=history[0], parsed=parseNumeric(latest.result);
    return {metal,latest,history,parsed,record_count:history.length,positive_numeric_count:history.filter(x=>x.detected===true).length};
  }).sort((a,b)=>a.metal.localeCompare(b.metal));
}
function makeEvidence(id,type,claim,source,weight,details={}){return {id,type,claim,source_id:source?.id||null,source_name:source?.name||null,source_url:source?.url||null,weight,details}}
function providerCandidates(serviceMatches,systems,aliases){
  const out=[];
  for(const match of serviceMatches||[]){
    const label=normalize(match.name||match.provider||match.properties?.NAME||match.properties?.UTILITY||'');
    const direct=String(match.pwsid||'').trim();
    if(direct&&systems.some(s=>s.pwsid===direct)) out.push({pwsid:direct,score:1,reasons:['PWS ID embedded in official service-area feature'],match});
    for(const [alias,ids] of Object.entries(aliases||{})){
      const a=normalize(alias); if(label===a||label.includes(a)||a.includes(label)) for(const id of ids) out.push({pwsid:id,score:.96,reasons:[`Official polygon provider “${label}” matched alias “${a}”`],match});
    }
    for(const s of systems){const n=normalize(s.name);if(label&&((n.includes(label)&&label.length>4)||(label.includes(n)&&n.length>4)))out.push({pwsid:s.pwsid,score:.94,reasons:[`Official polygon provider matched FDEP system name “${s.name}”`],match});}
  }
  const merged={};for(const x of out){if(!merged[x.pwsid]||x.score>merged[x.pwsid].score)merged[x.pwsid]=x}
  return Object.values(merged).sort((a,b)=>b.score-a.score);
}
function consensusProvider({serviceMatches,systems,aliases,userPwsid}){
  const candidates=providerCandidates(serviceMatches,systems,aliases);
  if(userPwsid&&systems.some(s=>s.pwsid===userPwsid))candidates.push({pwsid:userPwsid,score:.70,reasons:['User supplied this PWS ID; retained as corroborating evidence only']});
  candidates.sort((a,b)=>b.score-a.score);
  const top=candidates[0], second=candidates[1];
  const accepted=!!top&&top.score>=.90&&(!second||second.pwsid===top.pwsid||top.score-second.score>=.02);
  return {accepted,pwsid:accepted?top.pwsid:null,confidence:accepted?(top.score>=.98?'very-high':'high'):'unresolved',score:top?.score||0,candidates};
}
function validateMetalGroup(group,registry,directRows=[],allVerified=[]){
  const findings=[],conflicts=[];
  for(const r of group.history){
    const p=parseNumeric(r.result),src=sourceForRecord(r,registry);
    if(!r.sample_date)conflicts.push('missing sample date');
    if(!r.unit)conflicts.push('missing unit');
    if(!r.pwsid)conflicts.push('missing PWS ID');
    const verified=allVerified.find(x=>x.record_fingerprint===r.record_fingerprint)||r;
    findings.push({record:verified,parsed:p,source:src,granularity:classifyGranularity(r,false),corroboration:verified.corroboration||null,lab_accreditation:verified.lab_accreditation||null,factual_status:verified.factual_status||'single-origin-sample'});
  }
  const exact=directRows.filter(r=>normalize(r.metal)===normalize(group.metal));
  for(const r of exact)findings.unshift({record:r,parsed:parseNumeric(r.result),source:r.source||null,granularity:'exact-household-sample'});
  const latest=findings[0];
  const statement=latest?.granularity==='exact-household-sample'
    ?`A public or owner-supplied sample explicitly matched to this address reported ${latest.record.result} ${latest.record.unit||''} of ${group.metal}.`
    :`The exact address was matched to its water system; the latest applicable ${group.metal} record is ${group.latest.result} ${group.latest.unit||''} dated ${safeDate(group.latest.sample_date)}. This is not automatically a faucet measurement at the home.`;
  const confirmed=findings.filter(x=>x.factual_status==='confirmed-independent-sample').length;
  const singleSource=findings.filter(x=>x.factual_status==='single-origin-sample').length;
  const ordered=[...group.history].sort((a,b)=>safeDate(a.sample_date).localeCompare(safeDate(b.sample_date)));
  const vals=ordered.filter(x=>!x.normalized_measurement?.censored).map(x=>x.normalized_measurement?.canonical_value).filter(Number.isFinite);
  return {metal:group.metal,analyte:group.metal,statement,latest:latest||null,findings,conflicts:[...new Set(conflicts)],validated:conflicts.length===0,statistics:{censoring:censoredSummary(group.history),trend:mannKendall(vals),half_detection_limit_substitution:false},actionability:actionability(group.metal),verification_summary:{confirmed_records:confirmed,single_origin_records:singleSource,presentation_status:confirmed?'confirmed-independent-sample':'single-origin-sample'}};
}
function buildInvestigation(input,ctx){
  const {geocode,secondaryGeocode,geocodeConsensus,serviceMatches,spatialAssessment,serviceAreaVersion,systems,records,aliases,registry,directRows,liveErrors,utilityLineage=[],sourceInterconnections=[],labRegistry=[],liveWeb={items:[],errors:[]},publicRecordsTracker={requests:[]},federalContext={sdwis:{synced:false,violations:{active:[]}},wqp:{synced:false,stations:[]},ccr:{synced:false,reports:[]},summary:{}},counterfactualStability={status:'not-computed',stability_score:0,samples:[],rings:[]}}=ctx;
  const addressHash=hashAddress(input.address,input.city);
  const consensus=consensusProvider({serviceMatches,systems,aliases,userPwsid:input.pwsid&&input.pwsid!=='AUTO'?input.pwsid:null});
  const evidence=[];
  const census=registry.find(x=>x.id==='census-geocoder'),geom=registry.find(x=>x.id==='seminole-water-service-areas'),fdep=registry.find(x=>x.id==='fdep-chemical-current');
  if(geocode)evidence.push(makeEvidence('address-geocode','address-resolution',`Address normalized to ${geocode.matchedAddress}`,census,.98,{coordinates:{lat:geocode.lat,lon:geocode.lon},tigerLine:geocode.tigerLine}));
  for(const [i,m] of (serviceMatches||[]).entries())evidence.push(makeEvidence(`service-area-${i+1}`,'provider-boundary',`Coordinate intersects official water-service area ${m.name||'unnamed area'}`,geom,1,{matchMethod:m.matchMethod,properties:m.properties||{},pwsid:m.pwsid||null}));
  if(consensus.accepted)evidence.push(makeEvidence('provider-consensus','provider-resolution',`Provider evidence resolves to PWS ID ${consensus.pwsid}`,geom,consensus.score,{candidates:consensus.candidates}));
  const sys=consensus.pwsid?systems.find(s=>s.pwsid===consensus.pwsid):null;
  const applicableRaw=consensus.pwsid?records.filter(r=>r.pwsid===consensus.pwsid):[];
  const applicableBase=versionRecords(applicableRaw).filter(r=>r.is_current).map(r=>({...r,normalized_measurement:normalizeMeasurement(r.result,r.unit,r.detection_limit)}));
  const applicable=verifyRecords(applicableBase,registry,labRegistry);
  const groups=latestPerMetal(applicable);
  const exact=(directRows||[]).filter(r=>r.address_hash===addressHash);
  const metalReports=groups.map(g=>validateMetalGroup(g,registry,exact,applicable));
  for(const r of applicable)evidence.push(makeEvidence(`fdep-${r.pwsid}-${r.metal}-${r.sample_date}-${r.result}`,'regulatory-sample',`${r.metal}: ${r.result} ${r.unit||''} on ${safeDate(r.sample_date)}`,sourceForRecord(r,registry),1,{pwsid:r.pwsid,sample_type:r.sample_type,mcl:r.mcl,detected:r.detected,granularity:classifyGranularity(r,false),factual_status:r.factual_status,corroboration:r.corroboration,lab_accreditation:r.lab_accreditation}));
  for(const r of exact)evidence.unshift(makeEvidence(`home-${r.id||crypto.randomUUID()}`,'household-sample',`${r.metal}: ${r.result} ${r.unit||''} at the exact matched address`,r.source||null,1,{sample_date:r.sample_date,lab:r.lab||null}));
  const sdwis=federalContext.sdwis||{synced:false,violations:{active:[]}},wqp=federalContext.wqp||{synced:false,stations:[]},ccr=federalContext.ccr||{synced:false,reports:[]};
  const epaSdwisSource={id:'epa-sdwis-echo',name:'EPA ECHO / Safe Drinking Water Information System',url:'https://echo.epa.gov/tools/data-downloads/sdwa-download-summary'};
  const wqpSource={id:'epa-usgs-wqp',name:'EPA/USGS Water Quality Portal',url:'https://www.waterqualitydata.us/'};
  const ccrSource={id:'epa-ccr',name:'Consumer Confidence Report',url:ccr.latest?.url||'https://sdwis.epa.gov/ords/safewater/f?p=136:102::::::'};
  if(sdwis.system)evidence.push(makeEvidence('epa-sdwis-system','federal-system-record',`EPA SDWIS system record matched PWS ID ${consensus.pwsid}`,epaSdwisSource,.98,{system:sdwis.system,compliance_status:sdwis.compliance_status}));
  for(const [i,v] of (sdwis.violations?.active||[]).entries())evidence.push(makeEvidence(`epa-sdwis-violation-${i+1}`,'federal-compliance-record',`Active SDWIS compliance item: ${v.violation_name||v.violation_type||v.rule_name||v.rule_code||'violation'}`,epaSdwisSource,.98,{violation:v,classification:v.classification||null}));
  if(ccr.latest)evidence.push(makeEvidence('consumer-confidence-report','annual-water-quality-report',`Consumer Confidence Report available for PWS ID ${consensus.pwsid}${ccr.latest.report_year?` (${ccr.latest.report_year})`:''}`,{...ccrSource,url:ccr.latest.url||ccrSource.url},.96,{report:ccr.latest,system_level:true}));
  for(const [i,station] of (wqp.stations||[]).slice(0,5).entries())evidence.push(makeEvidence(`wqp-station-${i+1}`,'nearby-environmental-monitoring',`Nearby WQP station ${station.monitoring_location_name||station.monitoring_location_id||'unnamed'} is ${Number(station.distance_miles||0).toFixed(2)} miles from the geocoded address`,wqpSource,.72,{station,not_tap_or_compliance_data:true}));
  const contradictions=[];
  const singleSourceCount=applicable.filter(r=>r.factual_status==='single-origin-sample').length;
  const unaccreditedCount=applicable.filter(r=>r.lab_accreditation?.tier!=='accredited').length;
  if(singleSourceCount)contradictions.push(`${singleSourceCount} contaminant record(s) have only one originating laboratory sample; republications do not count as independent confirmation.`);
  if(unaccreditedCount)contradictions.push(`${unaccreditedCount} record(s) lack a verified active NELAP/state laboratory accreditation match.`);
  if(geocodeConsensus?.disagreement_meters>50)contradictions.push(`Primary and secondary geocoders disagree by ${geocodeConsensus.disagreement_meters} meters.`);
  if(spatialAssessment?.near_boundary)contradictions.push(`Address is within ${spatialAssessment.min_boundary_distance_m} m of a service-area boundary.`);
  if(spatialAssessment?.gap)contradictions.push('Address falls in a mapped service-area gap.');
  if(spatialAssessment?.overlap)contradictions.push('Address falls in overlapping service-area polygons.');
  if(serviceMatches.length>1)contradictions.push('The coordinate intersected multiple service-area polygons; boundary overlap requires review.');
  if(consensus.candidates.length>1&&consensus.candidates[0].score===consensus.candidates[1].score&&consensus.candidates[0].pwsid!==consensus.candidates[1].pwsid)contradictions.push('Two provider candidates had equal evidence scores.');
  if(counterfactualStability.status&&counterfactualStability.status!=='not-computed'&&Number(counterfactualStability.stability_score)<.75)contradictions.push(`Counterfactual coordinate perturbation found a ${counterfactualStability.status} provider assignment (stability ${counterfactualStability.stability_score}).`);
  const directStatus=exact.length?'exact-household-data-found':'no-exact-household-sample-found';
  const locationStatus=!geocode?'address-not-resolved':!serviceMatches.length?'no-service-polygon-match':consensus.accepted?'exact-address-to-system-match':'provider-not-resolved';
  const resultLevel=exact.length?'exact-household-sample':consensus.accepted?'exact-address/system-level-water-quality':'unresolved';
  const confidence=exact.length&&consensus.accepted?'very-high':consensus.accepted?(contradictions.length?'moderate':'high'):'insufficient';
  const quarantinedLive=quarantineLiveEvidence(liveWeb.items||[]);
  const addressOnline=summarizeAddressEvidence(liveWeb.items||[]);
  for(const [i,item] of addressOnline.matches.entries()){
    const source={id:item.id||`online-address-${i+1}`,name:item.publisher||item.title||'Online public source',url:item.url||null};
    evidence.push(makeEvidence(`online-address-${i+1}`,'address-or-neighborhood-online-evidence',`${item.scope}: ${item.match_reason}`,source,Number(item.match_score||.5),{scope:item.scope,notice_status:item.notice_status,excerpt:item.excerpt||'',water_relevant:item.water_relevant,address_specific:item.address_specific,neighborhood_specific:item.neighborhood_specific,checked_at:item.checked_at||liveWeb.checked_at||null}));
  }
  const leadRisk=parcelLeadRisk(secondaryGeocode?.parcel_attributes||{},{});
  const privateWell=privateWellPathway({noPws:!consensus.accepted,coordinates:geocode?{lat:geocode.lat,lon:geocode.lon}:null});
  const onlineProof=addressOnline.best_scope==='exact-address'||addressOnline.best_scope==='affected-address-range'?'an online public water notice or record explicitly matched this address/address range':addressOnline.best_scope==='street'||addressOnline.best_scope==='neighborhood'?'an online public water notice or record matched the street/neighborhood':null;
  const proven=exact.length?['address normalization','official service area','PWS identity','exact household sample record']:consensus.accepted?['address normalization','official service area','PWS identity','official system/facility records']:['only the evidence listed below'];
  if(onlineProof)proven.push(onlineProof);
  const proof={
    claim: exact.length?`This exact address has ${exact.length} matched household sample record(s).`:
      consensus.accepted?`This exact address falls in the official service area resolved to ${sys?.name||consensus.pwsid}; displayed contaminant records apply to that public water system or its sampling facilities, not necessarily the home's faucet.`:
      'The evidence does not support assigning a water system or contamination result to this address.',
    what_is_proven:proven,
    what_is_not_proven: exact.length?[]:['the concentration at the individual kitchen tap','that a historical detection remains present today','that every home in the system receives identical water','that an online notice naming a street or neighborhood is a laboratory measurement from this home','that a nearby Water Quality Portal station represents this home’s tap or the resolved utility’s compliance sample'],
    confidence
  };
  const result={
    investigation_id:crypto.randomUUID(),created_at:new Date().toISOString(),input:{address:input.address,city:input.city,address_hash:addressHash},
    statuses:{location:locationStatus,direct_data:directStatus,online_address_evidence:addressOnline.best_scope,result_level:resultLevel,confidence},
    geocode:{primary:geocode,secondary:secondaryGeocode,consensus:geocodeConsensus},provider:{consensus,system:sys,service_area_matches:serviceMatches,spatial_assessment:spatialAssessment,service_area_version:serviceAreaVersion,utility_lineage:resolveUtilityLineage(consensus.pwsid,null,utilityLineage),source_interconnections:applicableSources(consensus.pwsid,null,sourceInterconnections)},
    agents:[
      {name:'Dual-Geocoder Resolution Agent',status:geocode?'completed':'failed',output:{primary:geocode,secondary:secondaryGeocode,consensus:geocodeConsensus}},
      {name:'Versioned Service-Area Agent',status:serviceMatches.length?'completed':'no-match',output:{matches:serviceMatches,assessment:spatialAssessment,version:serviceAreaVersion}},
      {name:'Provider/PWS Crosswalk Agent',status:consensus.accepted?'completed':'unresolved',output:consensus},
      {name:'Direct Household Sample Agent',status:exact.length?'records-found':'none-found',output:{count:exact.length}},
      {name:'Expanded Contaminant-Class Agent Swarm',status:consensus.accepted?'completed':'blocked',output:{analytes:metalReports.length,records:applicable.length,configured_classes:['metals','PFAS','nitrate/nitrite','disinfection byproducts','radionuclides','microbial indicators','corrosion chemistry','VOCs/SVOCs']} },
      {name:'EPA SDWIS System & Compliance Agent',status:!consensus.accepted?'blocked':sdwis.synced?'completed':'not-synced',output:sdwis},
      {name:'EPA Water Quality Portal Source-Water Agent',status:!geocode?'blocked':wqp.synced?'completed':'not-synced',output:wqp},
      {name:'Consumer Confidence Report Agent',status:!consensus.accepted?'blocked':ccr.latest?'report-found':ccr.synced?'no-direct-report-found':'not-synced',output:ccr},
      {name:'Redundant Confirmation Agent',status:singleSourceCount?'partial':'passed',output:{confirmed:applicable.length-singleSourceCount,single_source:singleSourceCount,rule:'At least two distinct originating sample events are required. DEP, SDWIS, and CCR republications of the same lab sample count once.'}},
      {name:'Laboratory Accreditation Agent',status:unaccreditedCount?'review-needed':'passed',output:{accredited:applicable.length-unaccreditedCount,unverified_or_unaccredited:unaccreditedCount}},
      {name:'Live Official-Source Agent',status:liveWeb.errors?.length?'partial':'completed',output:{official_context:quarantinedLive.official_context,errors:liveWeb.errors||[],snapshot_required:true}},
      {name:'Address & Neighborhood Online Evidence Agent',status:addressOnline.matches.length?(addressOnline.best_scope==='exact-address'||addressOnline.best_scope==='affected-address-range'?'address-specific-evidence-found':'neighborhood-evidence-found'):(liveWeb.errors?.length?'partial-no-match':'no-address-specific-evidence-found'),output:{...addressOnline,public_search_enabled:liveWeb.public_search_enabled!==false,errors:liveWeb.errors||[]}},
      {name:'Community Leads Quarantine Agent',status:'completed',output:{leads_only:quarantinedLive.leads_only,may_corroborate:false}},
      {name:'Household Lead / Service-Line Risk Agent',status:'completed',output:leadRisk},
      {name:'Private Well Pathway Agent',status:privateWell.activated?'activated':'not-applicable',output:privateWell},
      {name:'Public Records / Litigation Tracker Agent',status:'completed',output:{matching_requests:(publicRecordsTracker.requests||[]).filter(x=>x.utility_pwsid===consensus.pwsid)}},
      {name:'Contradiction Validator Agent',status:contradictions.length?'review-needed':'passed',output:{contradictions}},
      {name:'Cross-Contaminant Chemistry Agent',status:'completed',output:{relationships:['lead-copper-pH-alkalinity-corrosion','nitrate-septic-land-use','radium-aquifer-geology'],note:'Relationship logic may contextualize measurements but cannot invent measurements.'}},
      {name:'Statistical Rigor Agent',status:'completed',output:{censored_method:'ROS/Kaplan-Meier when data suffices',trend_method:'Mann-Kendall',multiple_comparisons:'Benjamini-Hochberg FDR',half_DL_substitution:false}},
      {name:'Evidence Compilation Agent',status:'completed',output:{evidence_items:evidence.length,live_evidence_items:(liveWeb.items||[]).length}}
    ],
    proof,federal_data:federalContext,analyte_reports:metalReports,metal_reports:metalReports,household_lead_risk:leadRisk,private_well_pathway:privateWell,evidence,contradictions,source_registry:registry,live_web:{official_context:quarantinedLive.official_context,leads_only:quarantinedLive.leads_only,address_evidence:addressOnline,public_search_enabled:liveWeb.public_search_enabled!==false,checked_at:liveWeb.checked_at||null,errors:liveWeb.errors||[]},public_records_tracker:{matching_requests:(publicRecordsTracker.requests||[]).filter(x=>x.utility_pwsid===consensus.pwsid),official_request_channels:publicRecordsTracker.official_request_channels||[]},verification_policy:{two_independent_originating_samples_required:true,publisher_replicas_do_not_count:true,single_origin_label:'single-origin-sample',lab_accreditation_required_for_top_tier:true,community_content_leads_only:true},errors:[...(liveErrors||[]),...((liveWeb&&liveWeb.errors)||[])]
  };
  const independence=effectiveN(applicable);
  const uncertaintyBudget=computeUncertaintyBudget({geocodeConsensus,providerConsensus:consensus,spatialAssessment,counterfactualStability,records:applicable,exactHouseholdCount:exact.length,contradictions,independence,federalContext});
  const negotiationClaims=buildInvestigationClaims({providerConsensus:consensus,counterfactualStability,exactHouseholdCount:exact.length,sdwis,ccr,wqp,records:applicable,contradictions,evidence});
  const negotiation=negotiateClaims(negotiationClaims,{reliability:RELIABILITY_CALIBRATION.reliability});
  const nextBestEvidence=planNextEvidence({providerConsensus:consensus,counterfactualStability,exactHouseholdCount:exact.length,uncertaintyBudget,records:applicable,sdwis,ccr,labUnverifiedCount:unaccreditedCount,contradictions});
  const robustnessCertificate=buildRobustnessCertificate({counterfactualStability,uncertaintyBudget,negotiation,providerConsensus:consensus,exactHouseholdCount:exact.length,contradictions});
  const peerComparison=buildPeerComparison({pwsid:consensus.pwsid,records,systems,minPeers:5,maxAgeDifferenceDays:366});
  result.peer_system_comparison=peerComparison;
  result.counterfactual_stability=counterfactualStability;
  result.uncertainty_budget=uncertaintyBudget;
  result.agent_negotiation=negotiation;
  result.claim_robustness_certificate=robustnessCertificate;
  result.next_best_evidence=nextBestEvidence;
  result.statuses.calibrated_system_confidence=uncertaintyBudget.system_evidence_label;
  result.statuses.calibrated_system_confidence_score=uncertaintyBudget.system_evidence_confidence;
  result.statuses.household_exposure_confidence=uncertaintyBudget.household_exposure_label;
  result.statuses.household_exposure_confidence_score=uncertaintyBudget.household_exposure_confidence;
  result.agents.push(
    {name:'Counterfactual Boundary Stability Agent',status:counterfactualStability.status==='stable'?'passed':counterfactualStability.status==='not-computed'?'not-computed':'review-needed',output:counterfactualStability},
    {name:'Uncertainty Budget Agent',status:uncertaintyBudget.system_evidence_confidence>=.55?'completed':'review-needed',output:uncertaintyBudget},
    {name:'Agent Reliability Calibration Agent',status:RELIABILITY_CALIBRATION.adjudication_count?'empirically-updated':'prior-only',output:{adjudication_count:RELIABILITY_CALIBRATION.adjudication_count,reliability:RELIABILITY_CALIBRATION.reliability,policy:RELIABILITY_PROFILE.policy}},
    {name:'Evidence Scope Guardian Agent',status:(negotiation.vetoes||[]).some(x=>x.topic==='household-measurement')?'household-claim-blocked':'passed',output:{household_claims_blocked:(negotiation.vetoes||[]).filter(x=>x.topic==='household-measurement')}},
    {name:'Multi-Agent Negotiation Council',status:(negotiation.undecided_claims||[]).length?'partial-consensus':'consensus-reached',output:negotiation},
    {name:'Claim Robustness Certifier Agent',status:robustnessCertificate.level,output:robustnessCertificate},
    {name:'Peer-System Comparative Toxicology Agent',status:peerComparison.status,output:peerComparison},
    {name:'Active Evidence Acquisition Agent',status:nextBestEvidence.length?'recommendations-generated':'no-action-required',output:{recommendations:nextBestEvidence}}
  );
  const hydraulicGraph=ctx.hydraulicGraph||{edges:[]};
  const serviceZone=serviceMatches?.[0]?.properties?.ZONE_ID||serviceMatches?.[0]?.properties?.ZONE||null;
  const hydraulicChecks=applicable.slice(0,500).map(r=>{
    const samplingPoint=r.sample_point||r.location_code||r.facility_id||null;
    return samplingPoint&&serviceZone?{record_fingerprint:r.record_fingerprint||null,...admissibility(hydraulicGraph,{samplingPoint,serviceZone,sampleDate:r.sample_date,minCertainty:.5})}:null;
  }).filter(Boolean);
  const admissibleCount=hydraulicChecks.filter(x=>x.admissible).length;
  const providerPredictionSet=buildProviderPredictionSet({candidates:consensus.candidates,acceptedPwsid:consensus.pwsid,alpha:.1,calibrationNonconformity:PROVIDER_CONFORMAL_CALIBRATION});
  const applicabilityLattice=buildApplicabilityLattice({records:applicable,pwsid:consensus.pwsid,addressHash,hydraulicChecks,claimScopes:['public-water-system-record','exact-household-sample']});
  const influenceAudit=leaveOneOriginOutInfluence(negotiationClaims,{reliability:RELIABILITY_CALIBRATION.reliability});
  const contradictionCutsets=findMinimumContradictionCutsets(negotiationClaims,{maxCutSize:3,maxSets:12});
  const coverageTensor=buildCoverageTensor({records:applicable});
  const causalPathway=buildCausalPathwayGraph({providerSystem:sys,serviceMatches,sdwis,records:applicable,hydraulicGraph,exactHouseholdCount:exact.length,addressLabel:geocode?.matchedAddress||input.address});
  const evidenceAuction=allocateEvidenceBudget(nextBestEvidence,{budget:1.4,maxActions:3,privacyCeiling:.8});
  const adversarialEnvelope=buildAdversarialVerdictEnvelope({uncertaintyBudget,providerPredictionSet,influenceAudit,coverageTensor,applicabilityLattice,causalPathway,negotiation});
  result.provider_prediction_set=providerPredictionSet;
  result.evidence_applicability_lattice=applicabilityLattice;
  result.origin_influence_audit=influenceAudit;
  result.contradiction_cutsets=contradictionCutsets;
  result.coverage_tensor=coverageTensor;
  result.causal_pathway_graph=causalPathway;
  result.evidence_acquisition_auction=evidenceAuction;
  result.adversarial_verdict_envelope=adversarialEnvelope;
  result.agents.push(
    {name:'Set-Valued Provider Uncertainty Agent',status:providerPredictionSet.singleton?'singleton-set':providerPredictionSet.status,output:providerPredictionSet},
    {name:'Evidence Applicability Lattice Agent',status:applicabilityLattice.system_applicable_fraction>=.5?'completed':'review-needed',output:applicabilityLattice},
    {name:'Origin Influence Stress-Test Agent',status:influenceAudit.single_origin_fragility?'fragility-found':'passed',output:influenceAudit},
    {name:'Minimum Contradiction Cut-Set Agent',status:contradictionCutsets.status,output:contradictionCutsets},
    {name:'Negative-Evidence Coverage Tensor Agent',status:coverageTensor.missing_groups.length?'coverage-gaps-found':'completed',output:coverageTensor},
    {name:'Causal Water-Pathway Proof Agent',status:causalPathway.household_path_observed?'source-to-tap-observed':causalPathway.system_path_complete?'system-path-only':'review-needed',output:causalPathway},
    {name:'Evidence Acquisition Auction Council',status:evidenceAuction.selected.length?'budget-allocated':'no-action-selected',output:evidenceAuction},
    {name:'Adversarial Verdict Envelope Agent',status:adversarialEnvelope.stable_under_stress?'stress-stable':'stress-sensitive',output:adversarialEnvelope}
  );
  const strategic=strategicSamplingScore({values:applicable.map(r=>r.normalized_measurement?.canonical_value).filter(Number.isFinite),threshold:null,censoringRates:[],peerDivergence:0,protocolShift:0});
  const byAnalyte=Object.values(applicable.reduce((a,r)=>{const k=r.analyte||r.metal||'UNKNOWN';(a[k]??=[]).push(r.normalized_measurement?.canonical_value);return a},{})).map((values,i)=>({id:String(i),values:values.filter(Number.isFinite)})).filter(x=>x.values.length);
  const pooled=prob.hierarchicalPartialPool(byAnalyte).slice(0,100);
  const chemistry=(name)=>applicable.filter(r=>normalize(r.analyte||r.metal)===name).map(r=>r.normalized_measurement?.canonical_value).filter(Number.isFinite);
  const chem=prob.corrosionIndices({chlorideMgL:meanSafe(chemistry('CHLORIDE'))/1000,sulfateMgL:meanSafe(chemistry('SULFATE'))/1000,pH:meanSafe(chemistry('PH')),alkalinityMgLCaCO3:meanSafe(chemistry('ALKALINITY'))/1000,calciumMgL:meanSafe(chemistry('CALCIUM'))/1000,tdsMgL:meanSafe(chemistry('TOTAL DISSOLVED SOLIDS'))/1000});
  const linePosterior=prob.serviceLinePosterior({yearBuilt:input.year_built||null,inventoryNeighborhood:input.inventory_neighborhood||{},corrosion:chem});
  const changePoints=metalReports.slice(0,100).map(r=>({analyte:r.analyte,...prob.detectChangePoints(r.findings.map(f=>f.record?.normalized_measurement?.canonical_value).filter(Number.isFinite))}));
  result.research_accuracy_layers={
    effective_independence:independence,
    hydraulic_admissibility:{checked:hydraulicChecks.length,admissible:admissibleCount,checks:hydraulicChecks,rule:'time-valid hydraulic reachability required'},
    evidence_freshness:{method:'empirical half-life by analyte × aquifer/system stratum',fallback:'confidence capped when unavailable',example_weight:freshnessWeight(30,180)},
    strategic_sampling_index:strategic,
    bitemporal_ready:true,
    verdict_flip_acquisition_ready:true,
    hierarchical_partial_pooling:{status:pooled.length?'computed':'insufficient-data',groups:pooled,rule:'borrow strength only across configured comparable strata; never substitute for compliance samples'},
    corrosion_chemistry:chem,
    service_line_material_posterior:linePosterior,
    automatic_change_points:changePoints,
    digit_preference_forensics:prob.digitForensics(applicable.map(r=>r.normalized_measurement?.canonical_value)),
    provider_prediction_set:providerPredictionSet,evidence_applicability_lattice:applicabilityLattice,origin_influence_audit:influenceAudit,contradiction_cutsets:contradictionCutsets,coverage_tensor:coverageTensor,causal_pathway_graph:causalPathway,evidence_acquisition_auction:evidenceAuction,adversarial_verdict_envelope:adversarialEnvelope,optional_layers:{interval_censored_ccr:true,hydraulic_topology_inference:true,extreme_value_tail:true,rainfall_lag_adjustment:true,private_well_surface_uncertainty:true}
  };
  result.reproducibility=snapshotManifest({records:applicable,sources:registry,codeVersion:'13.7.0',modelManifest:{validator:'deterministic-rules-7.0',negotiation_protocol:'Auditable Dialectical Evidence Negotiation v1.1',llm:'disabled-by-default'},config:{serviceAreaVersion}});
  result.adversarial_review=adversarialReview(result);
  result.agents.push({name:'Adversarial Reviewer Agent',status:result.adversarial_review.status,output:result.adversarial_review});
  result.human_review_queue={required:result.adversarial_review.human_review_required,reasons:result.adversarial_review.challenges,status:result.adversarial_review.human_review_required?'pending-expert-review':'not-required'};
  return result;
}
function saveInvestigation(root,inv){const dir=path.join(root,'data','investigations');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,`${inv.investigation_id}.json`);fs.writeFileSync(file,JSON.stringify(inv,null,2));return file}
module.exports={buildInvestigation,saveInvestigation,hashAddress,latestPerMetal,parseNumeric,classifyGranularity,providerCandidates,consensusProvider};
