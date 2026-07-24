'use strict';
const test=require('node:test');
const assert=require('node:assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const {assessProviderStability}=require('../lib/counterfactual_stability');
const {computeUncertaintyBudget}=require('../lib/uncertainty_budget');
const {claim,negotiateClaims,buildInvestigationClaims}=require('../lib/agent_negotiation');
const {planNextEvidence}=require('../lib/active_evidence_planner');
const {buildRobustnessCertificate}=require('../lib/robustness_certificate');
const {buildInvestigation}=require('../lib/investigator');
const {adaptAll,deriveSystems,deriveProviderAliases}=require('../lib/record_adapter');

const load=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const records=adaptAll(load('data/all_contaminant_records.json'));
const systems=deriveSystems([...load('data/systems.json'),...load('data/fdep_system_registry.json')],records);
const aliases=deriveProviderAliases(load('data/provider_aliases.json'),load('data/fdep_system_registry.json'),systems);
const registry=load('data/source_registry.json');

test('counterfactual stability certifies a provider that survives coordinate perturbation',()=>{
  const out=assessProviderStability({lat:28.7,lon:-81.3,basePwsid:'3590205',resolveAtPoint:()=>({pwsid:'3590205',provider:'Sanford'}),radiiMeters:[5,15,30],bearings:8});
  assert.equal(out.status,'stable');
  assert.equal(out.stable_fraction,1);
  assert.equal(out.max_unanimous_radius_m,30);
});

test('counterfactual stability exposes boundary sensitivity instead of hiding it',()=>{
  const baseLon=-81.3;
  const out=assessProviderStability({lat:28.7,lon:baseLon,basePwsid:'A',resolveAtPoint:(lon)=>({pwsid:lon>baseLon?'B':'A'}),radiiMeters:[5,15],bearings:8});
  assert.notEqual(out.status,'stable');
  assert.ok(out.alternate_pwsids.includes('B'));
  assert.ok(out.stability_score<.75);
});

test('agent negotiation uses a hard scope veto to block unsupported household concentrations',()=>{
  const claims=[
    claim({id:'bad',topic:'household-measurement',proposition:'The household tap contains 5 ug/L lead',agent:'Provider Identity Agent',confidence:.95,origin_keys:['system-sample']}),
    claim({id:'guard',topic:'household-measurement',proposition:'The household tap contains 5 ug/L lead',stance:'oppose',agent:'Evidence Scope Guardian',confidence:1,hard_veto:true,basis:'no exact household sample'})
  ];
  const result=negotiateClaims(claims);
  assert.equal(result.accepted_claims.length,0);
  assert.equal(result.vetoes.length,1);
  assert.match(result.vetoes[0].reason,/scope|household|sample/i);
});

test('publisher replicas collapse to one origin vote during negotiation',()=>{
  const proposition='No active SDWIS violations are present';
  const claims=[
    claim({id:'a',topic:'compliance',proposition,agent:'SDWIS Compliance Agent',confidence:.9,origin_keys:['same-sample']}),
    claim({id:'b',topic:'compliance',proposition,agent:'CCR Context Agent',confidence:.9,origin_keys:['same-sample']})
  ];
  const result=negotiateClaims(claims,{acceptThreshold:.5});
  assert.equal(result.accepted_claims[0].independent_support_origins,1);
  assert.ok(result.accepted_claims[0].support_score<1.1);
});

test('uncertainty budget separates system confidence from household exposure confidence',()=>{
  const out=computeUncertaintyBudget({
    geocodeConsensus:{primary_available:true,secondary_available:true,disagreement_meters:5},
    providerConsensus:{accepted:true,score:1},spatialAssessment:{gap:false,overlap:false,near_boundary:false},
    counterfactualStability:{status:'stable',stability_score:1},
    records:[{sample_date:new Date().toISOString().slice(0,10),analyte:'NITRATE',contaminant_group:'INOR',record_fingerprint:'a'}],
    exactHouseholdCount:0,contradictions:[],independence:{effective_n:1},federalContext:{sdwis:{synced:true},ccr:{synced:true},wqp:{synced:true}}
  });
  assert.ok(out.system_evidence_confidence>out.household_exposure_confidence);
  assert.ok(out.household_exposure_confidence<=.49);
});

test('active evidence planner ranks household sampling when no household sample exists',()=>{
  const out=planNextEvidence({providerConsensus:{accepted:true},counterfactualStability:{stability_score:1},exactHouseholdCount:0,uncertaintyBudget:{dimensions:{temporal_freshness:.9,contaminant_coverage:.9}},records:[{}],sdwis:{violations:{active:[]}},ccr:{latest:{}},labUnverifiedCount:0,contradictions:[]});
  assert.ok(out.some(x=>x.id==='household-sample'));
  assert.equal(out[0].id,'household-sample');
});

test('robustness certificate refuses robust household scope without household data',()=>{
  const out=buildRobustnessCertificate({counterfactualStability:{stability_score:1,interpretation:'stable'},uncertaintyBudget:{system_evidence_confidence:.8},negotiation:{accepted_claims:[],vetoes:[]},providerConsensus:{accepted:true,pwsid:'3590205'},exactHouseholdCount:0,contradictions:[]});
  assert.equal(out.scope,'system-level-only');
  assert.ok(out.checks.find(x=>x.id==='scope-firewall').passed);
});

test('end-to-end investigation emits negotiation, uncertainty, robustness, and next-evidence layers',()=>{
  const inv=buildInvestigation({address:'1 Test St',city:'Sanford'}, {
    geocode:{lon:-81.3,lat:28.7,matchedAddress:'1 TEST ST'},secondaryGeocode:null,
    geocodeConsensus:{primary_available:true,secondary_available:false,disagreement_meters:null,low_confidence:false,selected:'census'},
    serviceMatches:[{pwsid:'3590205',name:'SANFORD',matchMethod:'test',properties:{ZONE_ID:'Z1'}}],
    spatialAssessment:{gap:false,overlap:false,near_boundary:false},serviceAreaVersion:{version:'test'},systems,records,aliases,registry,
    directRows:[],liveErrors:[],utilityLineage:[],sourceInterconnections:[],labRegistry:[],liveWeb:{items:[],errors:[]},publicRecordsTracker:{requests:[]},hydraulicGraph:{edges:[]},
    federalContext:{sdwis:{synced:true,violations:{active:[]}},wqp:{synced:true,stations:[]},ccr:{synced:true,latest:null},summary:{}},
    counterfactualStability:{status:'stable',reference_pwsid:'3590205',stability_score:1,stable_fraction:1,max_unanimous_radius_m:30,samples:[],rings:[],alternate_pwsids:[],interpretation:'stable'}
  });
  assert.ok(inv.agent_negotiation);
  assert.ok(inv.uncertainty_budget);
  assert.ok(inv.claim_robustness_certificate);
  assert.ok(Array.isArray(inv.next_best_evidence));
  assert.ok(inv.agents.some(x=>x.name==='Multi-Agent Negotiation Council'));
  assert.ok(inv.agent_negotiation.vetoes.some(x=>x.topic==='household-measurement'));
});

test('peer comparison refuses to treat censored non-detects as zero',()=>{
  const {buildPeerComparison}=require('../lib/peer_comparison');
  const rows=[
    {pwsid:'A',metal:'BENZENE',result:'<0.5',unit:'UG/L',sample_date:'2024-01-01',contaminant_group:'VOC'},
    ...Array.from({length:6},(_,i)=>({pwsid:`P${i}`,metal:'BENZENE',result:String(i+1),unit:'UG/L',sample_date:'2024-01-01',contaminant_group:'VOC'}))
  ];
  const out=buildPeerComparison({pwsid:'A',records:rows,systems:[{pwsid:'A'},...Array.from({length:6},(_,i)=>({pwsid:`P${i}`}))],minPeers:5});
  assert.equal(out.comparisons[0].status,'current-result-censored');
  assert.equal(out.comparisons[0].percentile,null);
});

test('peer comparison ranks only compatible common system-level measurements',()=>{
  const {buildPeerComparison}=require('../lib/peer_comparison');
  const rows=[{pwsid:'A',metal:'NITRATE',result:'5',unit:'MG/L',sample_date:'2024-01-01',contaminant_group:'INOR'},
    ...[1,2,3,4,6,7].map((v,i)=>({pwsid:`P${i}`,metal:'NITRATE',result:String(v),unit:'MG/L',sample_date:'2024-01-01',contaminant_group:'INOR'}))];
  const out=buildPeerComparison({pwsid:'A',records:rows,systems:[{pwsid:'A'},...Array.from({length:6},(_,i)=>({pwsid:`P${i}`}))],minPeers:5});
  assert.equal(out.status,'computed');
  assert.equal(out.comparable_analytes,1);
  assert.ok(out.comparisons[0].higher_concentration_percentile>.5);
  assert.match(out.disclaimer,/not a toxicity or safety score/i);
});

test('Bayesian agent reliability calibration updates only from adjudicated outcomes',()=>{
  const {calibrateProfile}=require('../lib/reliability_calibration');
  const out=calibrateProfile({agents:{A:{alpha:1,beta:1}}},[
    {agent:'A',correct:true,weight:1},{agent:'A',correct:false,weight:.5}
  ]);
  assert.equal(out.adjudication_count,2);
  assert.ok(out.reliability.A>.5&&out.reliability.A<.8);
});
