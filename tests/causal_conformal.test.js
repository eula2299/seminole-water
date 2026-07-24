'use strict';
const test=require('node:test');
const assert=require('node:assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const {canSupportScope,applicabilityForRecord,buildApplicabilityLattice}=require('../lib/evidence_applicability_lattice');
const {buildProviderPredictionSet}=require('../lib/conformal_provider_set');
const {claim}=require('../lib/agent_negotiation');
const {leaveOneOriginOutInfluence}=require('../lib/evidence_influence');
const {findMinimumContradictionCutsets}=require('../lib/contradiction_cutset');
const {buildCoverageTensor}=require('../lib/coverage_tensor');
const {buildCausalPathwayGraph}=require('../lib/causal_pathway_graph');
const {allocateEvidenceBudget}=require('../lib/evidence_auction');
const {buildAdversarialVerdictEnvelope}=require('../lib/adversarial_verdict_envelope');
const {buildInvestigation}=require('../lib/investigator');
const {adaptAll,deriveSystems,deriveProviderAliases}=require('../lib/record_adapter');
const load=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const records=adaptAll(load('data/all_contaminant_records.json'));
const systems=deriveSystems([...load('data/systems.json'),...load('data/fdep_system_registry.json')],records);
const aliases=deriveProviderAliases(load('data/provider_aliases.json'),load('data/fdep_system_registry.json'),systems);
const registry=load('data/source_registry.json');

test('evidence applicability lattice enforces monotone scope ordering',()=>{
  assert.equal(canSupportScope('public-water-system-record','exact-household-sample'),false);
  assert.equal(canSupportScope('exact-household-sample','public-water-system-record'),true);
});

test('system record is vetoed for an exact household concentration claim',()=>{
  const out=applicabilityForRecord({pwsid:'A',sample_type:'N',sample_date:new Date().toISOString(),record_fingerprint:'x',lab_id:'L'},{pwsid:'A',claimScope:'exact-household-sample'});
  assert.equal(out.eligible,false);
  assert.ok(out.vetoes.some(x=>/scope/i.test(x)));
});

test('applicability lattice separately scores system and household claim scopes',()=>{
  const now=new Date().toISOString();
  const out=buildApplicabilityLattice({records:[{pwsid:'A',sample_type:'N',sample_date:now,record_fingerprint:'x',lab_id:'L'}],pwsid:'A'});
  assert.ok(out.by_claim_scope['public-water-system-record'].mean_applicability>out.by_claim_scope['exact-household-sample'].mean_applicability);
  assert.equal(out.household_scope_blocked,true);
});

test('calibrated provider prediction set returns all candidates inside threshold',()=>{
  const out=buildProviderPredictionSet({candidates:[{pwsid:'A',score:.97},{pwsid:'B',score:.9},{pwsid:'C',score:.5}],alpha:.1,calibrationNonconformity:[.03,.05,.08,.1,.12,.15,.04,.06,.07,.09]});
  assert.equal(out.status,'calibrated');
  assert.ok(out.prediction_set.some(x=>x.pwsid==='A'));
  assert.ok(out.prediction_set.some(x=>x.pwsid==='B'));
  assert.ok(!out.prediction_set.some(x=>x.pwsid==='C'));
});

test('uncalibrated provider output is honestly set-valued without a coverage claim',()=>{
  const out=buildProviderPredictionSet({candidates:[{pwsid:'A',score:.96},{pwsid:'B',score:.93}]});
  assert.equal(out.empirical_coverage_guarantee,false);
  assert.equal(out.prediction_set.length,2);
  assert.match(out.interpretation,/must not be described as having conformal coverage/i);
});

test('leave-one-origin-out influence audit detects a conclusion dominated by one origin',()=>{
  const claims=[
    claim({id:'a',topic:'t',proposition:'P',agent:'Provider Identity Agent',confidence:.99,origin_keys:['only-origin']}),
    claim({id:'b',topic:'t',proposition:'P',stance:'oppose',agent:'Contradiction Agent',confidence:.3,origin_keys:['oppose']})
  ];
  const out=leaveOneOriginOutInfluence(claims,{acceptThreshold:.62,margin:.12});
  assert.equal(out.single_origin_fragility,true);
  assert.ok(out.dominant_origins.some(x=>x.origin==='only-origin'));
});

test('minimum contradiction cut set identifies the smallest evidence origin removal',()=>{
  const claims=[
    claim({id:'a',topic:'t',proposition:'P',agent:'A',confidence:.8,origin_keys:['support-origin']}),
    claim({id:'b',topic:'t',proposition:'P',stance:'oppose',agent:'B',confidence:.8,origin_keys:['oppose-origin']})
  ];
  const out=findMinimumContradictionCutsets(claims);
  assert.equal(out.minimum_cut_size,1);
  assert.equal(out.cutsets.length,2);
});

test('coverage tensor never equates missing or censored evidence with zero',()=>{
  const out=buildCoverageTensor({records:[{pwsid:'A',analyte:'BENZENE',contaminant_group:'VOC',result:'<0.5',sample_date:'2024-01-01',source_id:'fdep'}],expectedGroups:['VOC','PFAS'],currentYear:2024});
  assert.deepEqual(out.missing_groups,['PFAS']);
  assert.equal(out.negative_evidence_guard.missing_is_zero,false);
  assert.equal(out.negative_evidence_guard.non_detect_is_zero,false);
  assert.equal(out.cells[0].non_detects,1);
});

test('causal pathway graph blocks household causality without a tap sample',()=>{
  const out=buildCausalPathwayGraph({providerSystem:{pwsid:'A',name:'System'},serviceMatches:[{name:'Area'}],sdwis:{system:{primary_source:'GW'}},records:[{entry_point:'EP1'}],hydraulicGraph:{edges:[]},exactHouseholdCount:0,addressLabel:'1 Test St'});
  assert.equal(out.household_path_observed,false);
  assert.equal(out.strongest_supported_scope,'public-water-system-record');
  assert.match(out.prohibited_inference,/household tap/i);
});

test('causal pathway graph can certify a fully observed source-to-tap path',()=>{
  const out=buildCausalPathwayGraph({providerSystem:{pwsid:'A',name:'System'},serviceMatches:[{name:'Area'}],sdwis:{system:{primary_source:'GW'}},records:[{entry_point:'EP1'}],hydraulicGraph:{edges:[{from:'EP1',to:'Z1'}]},exactHouseholdCount:1,addressLabel:'1 Test St'});
  assert.equal(out.household_path_observed,true);
  assert.equal(out.strongest_supported_scope,'exact-household-sample');
});

test('evidence auction allocates bounded actions on value per cost and privacy',()=>{
  const out=allocateEvidenceBudget([
    {id:'a',title:'A',expected_confidence_gain:.4,expected_verdict_flip_probability:.6,severity:.9,effort:.2,privacy_risk:.1},
    {id:'b',title:'B',expected_confidence_gain:.6,expected_verdict_flip_probability:.8,severity:1,effort:.9,privacy_risk:.9},
    {id:'c',title:'C',expected_confidence_gain:.2,expected_verdict_flip_probability:.3,severity:.5,effort:.1,privacy_risk:.05}
  ],{budget:.8,maxActions:2,privacyCeiling:.8});
  assert.ok(out.selected.some(x=>x.id==='a'));
  assert.ok(!out.bids.some(x=>x.id==='b'));
  assert.ok(out.spent<=.8);
});

test('adversarial verdict envelope lowers confidence when multiple fragilities coincide',()=>{
  const out=buildAdversarialVerdictEnvelope({uncertaintyBudget:{system_evidence_confidence:.8},providerPredictionSet:{prediction_set:[{pwsid:'A'},{pwsid:'B'}]},influenceAudit:{single_origin_fragility:true,max_confidence_delta:.2},coverageTensor:{coverage_fraction:.5},applicabilityLattice:{household_scope_blocked:true},causalPathway:{system_path_complete:false},negotiation:{undecided_claims:[{}]}});
  assert.ok(out.pessimistic_system_confidence<out.base_system_confidence);
  assert.equal(out.stable_under_stress,false);
});

test('end-to-end investigation emits all v13.7 causal-conformal layers',()=>{
  const inv=buildInvestigation({address:'1 Test St',city:'Sanford'}, {
    geocode:{lon:-81.3,lat:28.7,matchedAddress:'1 TEST ST'},secondaryGeocode:null,
    geocodeConsensus:{primary_available:true,secondary_available:false,disagreement_meters:null,low_confidence:false,selected:'census'},
    serviceMatches:[{pwsid:'3590205',name:'SANFORD',matchMethod:'test',properties:{ZONE_ID:'Z1'}}],
    spatialAssessment:{gap:false,overlap:false,near_boundary:false},serviceAreaVersion:{version:'test'},systems,records,aliases,registry,
    directRows:[],liveErrors:[],utilityLineage:[],sourceInterconnections:[],labRegistry:[],liveWeb:{items:[],errors:[]},publicRecordsTracker:{requests:[]},hydraulicGraph:{edges:[]},
    federalContext:{sdwis:{synced:true,system:{primary_source:'GW'},violations:{active:[]}},wqp:{synced:true,stations:[]},ccr:{synced:true,latest:null},summary:{}},
    counterfactualStability:{status:'stable',reference_pwsid:'3590205',stability_score:1,stable_fraction:1,max_unanimous_radius_m:30,samples:[],rings:[],alternate_pwsids:[],interpretation:'stable'}
  });
  for(const k of ['provider_prediction_set','evidence_applicability_lattice','origin_influence_audit','contradiction_cutsets','coverage_tensor','causal_pathway_graph','evidence_acquisition_auction','adversarial_verdict_envelope'])assert.ok(inv[k],k);
  assert.ok(inv.agents.some(x=>x.name==='Causal Water-Pathway Proof Agent'));
  assert.ok(inv.agents.some(x=>x.name==='Evidence Acquisition Auction Council'));
});
