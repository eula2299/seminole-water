const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const inv=require('./lib/investigator');
const root=__dirname,load=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
const records=load('data/metal_records.json'),agents=load('data/metal_agents.json'),source=load('data/service_areas/source.json'),registry=load('data/source_registry.json'),systems=load('data/systems.json'),aliases=load('data/provider_aliases.json');
test('authoritative sources and agents are configured',()=>{assert.ok(records.length>200);assert.ok(agents.length>=17);assert.equal(source.arcgis_item_id,'41f6f18ec9cd48a5b89b94e946cf2143');assert.ok(registry.some(x=>x.id==='fdep-chemical-current'));assert.ok(registry.some(x=>x.id==='seminole-water-service-areas'))});
test('official polygon alias resolves a municipal provider',()=>{const c=inv.consensusProvider({serviceMatches:[{name:'City of Sanford Water',properties:{}}],systems,aliases});assert.equal(c.accepted,true);assert.equal(c.pwsid,'3590205')});
test('ambiguous county provider does not invent one subsystem',()=>{const c=inv.consensusProvider({serviceMatches:[{name:'Seminole County',properties:{}}],systems,aliases});assert.equal(c.accepted,false);assert.equal(c.pwsid,null)});
test('investigation labels system evidence instead of household evidence',()=>{const out=inv.buildInvestigation({address:'100 TEST ST',city:'SANFORD'},{geocode:{lat:28.8,lon:-81.2,matchedAddress:'100 TEST ST, SANFORD, FL'},serviceMatches:[{name:'City of Sanford Water',properties:{}}],systems,records,aliases,registry,directRows:[],liveErrors:[]});assert.equal(out.statuses.location,'exact-address-to-system-match');assert.equal(out.statuses.result_level,'exact-address/system-level-water-quality');assert.ok(out.proof.what_is_not_proven.includes('the concentration at the individual kitchen tap'));assert.ok(out.evidence.length>0)});
test('exact household row upgrades result level',()=>{const h=inv.hashAddress('100 TEST ST','SANFORD');const out=inv.buildInvestigation({address:'100 TEST ST',city:'SANFORD'},{geocode:{lat:28.8,lon:-81.2,matchedAddress:'100 TEST ST, SANFORD, FL'},serviceMatches:[{name:'City of Sanford Water',properties:{}}],systems,records,aliases,registry,directRows:[{id:'x',address_hash:h,metal:'LEAD',result:2,unit:'ug/L',sample_date:'2026-01-01',source:{id:'lab',name:'Certified laboratory report',url:'https://example.invalid'}}],liveErrors:[]});assert.equal(out.statuses.result_level,'exact-household-sample');assert.equal(out.statuses.direct_data,'exact-household-data-found')});
test('no concentration prediction code exists',()=>{const text=fs.readFileSync(path.join(root,'lib/investigator.js'),'utf8');assert.ok(!/predict(ed|ion)?[_ -]?concentration/i.test(text));assert.ok(text.includes('No estimated or model-generated concentration')===false)});
const accuracy=require('./lib/accuracy');
test('unit normalization prevents mg/L and ug/L mismatch',()=>{
  assert.equal(accuracy.normalizeMeasurement(0.01,'mg/L').canonical_value,10);
  assert.equal(accuracy.normalizeMeasurement(10,'ug/L').canonical_value,10);
});
test('non-detect remains censored and is never converted to zero',()=>{
  const x=accuracy.normalizeMeasurement('<0.005','mg/L',0.005);
  assert.equal(x.censored,true);assert.equal(x.censoring_type,'left-censored');assert.equal(x.canonical_value,5);assert.notEqual(x.canonical_value,0);
});
test('record revisions retain superseded versions',()=>{
  const rows=[{pwsid:'1',metal:'LEAD',sample_date:'2024-01-01',sample_type:'TAP',result:5,unit:'ug/L',revision_date:'2024-02-01'},{pwsid:'1',metal:'LEAD',sample_date:'2024-01-01',sample_type:'TAP',result:4,unit:'ug/L',revision_date:'2024-03-01'}];
  const out=accuracy.versionRecords(rows);assert.equal(out.length,2);assert.equal(out[0].is_current,false);assert.ok(out[0].superseded_by);assert.equal(out[1].is_current,true);
});
test('service area version is selected for historical sample date',()=>{
 const v=accuracy.selectServiceAreaVersion([{id:'old',valid_from:'2020-01-01',valid_to:'2022-12-31'},{id:'new',valid_from:'2023-01-01',valid_to:null}],'2021-05-01');assert.equal(v.id,'old');
});
test('boundary assessment explicitly flags overlap and gap',()=>{
 assert.equal(accuracy.assessSpatialAmbiguity({lon:0,lat:0,matches:[]}).gap,true);
 assert.equal(accuracy.assessSpatialAmbiguity({lon:0,lat:0,matches:[{geometry:null},{geometry:null}]}).overlap,true);
});
const verification=require('./lib/verification');
test('publisher independence is not sample independence',()=>{
 const registry2=[{id:'dep',name:'Florida DEP',source_family:'FDEP'},{id:'ccr',name:'Utility CCR',source_family:'UTILITY_CCR'}];
 const a={pwsid:'1',metal:'LEAD',sample_date:'2025-01-01',sample_type:'TAP',result:5,unit:'ug/L',source_id:'dep',sample_id:'SAME'};
 const b={...a,source_id:'ccr'};
 assert.equal(verification.corroborateRecord(a,[a],registry2).status,'single-origin-sample');
 assert.equal(verification.corroborateRecord(a,[a,b],registry2).status,'single-origin-sample');
});
test('laboratory accreditation creates separate evidence tiers',()=>{
 const labs=[{lab_id:'LAB1',name:'Example Lab',status:'active',nelap:true,state_certified:true,expires_on:'2027-01-01'}];
 assert.equal(verification.accreditationTier({lab_id:'LAB1',sample_date:'2026-01-01'},labs).tier,'accredited');
 assert.equal(verification.accreditationTier({lab_id:'UNKNOWN',sample_date:'2026-01-01'},labs).tier,'unknown-accreditation');
});
test('verification never upgrades a single-source record to confirmed',()=>{
 const out=verification.verifyRecords([{pwsid:'1',metal:'ARSENIC',sample_date:'2025-01-01',sample_type:'POE',result:1,unit:'ug/L',source_id:'dep'}],[{id:'dep',name:'Florida DEP',source_family:'FDEP'}],[]);
 assert.equal(out[0].factual_status,'single-origin-sample');
});
const god=require('./lib/godmode'),stats=require('./lib/statistics');
test('publisher replicas of the same originating sample do not create independence',()=>{
 const reg=[{id:'dep',source_family:'FDEP'},{id:'sdwis',source_family:'EPA'},{id:'ccr',source_family:'UTILITY_CCR'}];
 const base={pwsid:'1',metal:'LEAD',sample_date:'2025-01-01',sample_type:'TAP',result:5,unit:'ug/L',sample_id:'SAME-123'};
 const out=verification.corroborateRecord({...base,source_id:'dep'},[{...base,source_id:'dep'},{...base,source_id:'sdwis'},{...base,source_id:'ccr'}],reg);
 assert.equal(out.requirement_met,false);assert.equal(out.publisher_replica_count,2);
});
test('distinct originating samples can corroborate a finding',()=>{
 const reg=[{id:'dep',source_family:'FDEP'},{id:'lab2',source_family:'INDEPENDENT_LAB'}];
 const a={pwsid:'1',metal:'LEAD',sample_date:'2025-01-01',sample_type:'TAP',result:5,unit:'ug/L',sample_id:'A',source_id:'dep'};
 const b={...a,sample_id:'B',source_id:'lab2'};
 assert.equal(verification.corroborateRecord(a,[a,b],reg).requirement_met,true);
});
test('community content is quarantined and cannot corroborate',()=>{const q=god.quarantineLiveEvidence([{url:'https://nextdoor.com/x',title:'Water rumor'}]);assert.equal(q.leads_only[0].may_corroborate,false);assert.equal(q.leads_only[0].quarantined,true)});
test('lead risk model never predicts a concentration',()=>{const x=god.parcelLeadRisk({year_built:1960},{status:'unknown'});assert.ok(x.tier);assert.ok(/not a predicted lead concentration/i.test(x.disclaimer));assert.equal(x.concentration,undefined)});
test('non-detect statistics prohibit half detection limit substitution',()=>{const x=stats.censoredSummary([{normalized_measurement:{censored:true,canonical_value:5}}]);assert.equal(x.substitution_used,false)});
test('FDR correction is monotone and bounded',()=>{const q=stats.benjaminiHochberg([.001,.02,.5]);assert.ok(q.every(x=>x>=0&&x<=1));assert.ok(q[0]<=q[1])});
test('snapshot manifest pins data, code, model and config',()=>{const x=god.snapshotManifest({records:[],sources:[],codeVersion:'9',modelManifest:{m:'x'},config:{a:1}});assert.ok(x.snapshot_id);assert.equal(x.deterministic_inputs_pinned,true)});
test('expanded analyte fleet includes non-metals',()=>{const a=load('data/analyte_agents.json');assert.ok(a.some(x=>x.id==='pfas'));assert.ok(a.some(x=>x.id==='microbial'));assert.ok(a.some(x=>x.id==='radionuclides'))});
const compliance=require('./lib/compliance'),coverage=require('./lib/coverage'),advanced=require('./lib/advanced_statistics'),robust=require('./lib/robustness');
test('all-contaminant bank is populated, not an empty schema',()=>{const x=load('data/all_contaminant_records.json'),s=load('data/all_contaminant_summary.json');assert.ok(x.length>4000);assert.ok(s.groups.RAD>0);assert.ok(s.groups.DBP>0);assert.ok(s.groups.VOC>0)});
test('lead compliance uses 90th percentile rather than a single sample',()=>{const rows=[1,2,3,4,5,6,7,8,9,20].map((v,i)=>({analyte:'LEAD',sample_type:'LCR TAP',result:v,sample_date:`2025-01-${String(i+1).padStart(2,'0')}`}));const x=compliance.evaluate('LEAD',rows);assert.equal(x.statistic,'90th percentile');assert.equal(x.value,9);assert.equal(x.status,'below-action-level')});
test('DBP compliance uses location-specific running annual averages',()=>{const rows=['2024-01-01','2024-04-01','2024-07-01','2024-10-01'].map(d=>({analyte:'TOTAL THMS',location_code:'L1',result:90,sample_date:d}));const x=compliance.evaluate('TOTAL THMS',rows);assert.equal(x.locations[0].lraa,90);assert.equal(x.locations[0].status,'mcl-exceedance')});
test('nitrate exceedance is not final without confirmation',()=>{const x=compliance.evaluate('NITRATE',[{result:12000,sample_date:'2025-01-01'}]);assert.equal(x.status,'confirmation-required');assert.equal(x.compliance_claim_allowed,false)});
test('coverage caps final confidence',()=>{const x=coverage.coverage({expected:10,received:5,sourceFreshness:.8,spatialConfidence:1});assert.equal(x.coverage_ratio,.5);assert.equal(x.confidence_cap,.4)});
test('ROS produces censored estimates without half-DL substitution',()=>{const x=advanced.ros([{value:1},{value:2},{value:4},{limit:1,censored:true},{limit:2,censored:true}]);assert.equal(x.status,'ok');assert.equal(x.substitution_used,false);assert.equal(x.imputed_censored.length,2)});
test('seasonal Kendall preserves seasonal strata',()=>{const x=advanced.seasonalKendall([{date:'2020-01-01',value:1},{date:'2021-01-01',value:2},{date:'2020-07-01',value:1},{date:'2021-07-01',value:3}]);assert.equal(x.method,'seasonal-Kendall');assert.ok(x.S>0)});
test('plausibility layer quarantines catastrophic OCR decimal shifts',()=>{const x=robust.plausibility({analyte:'TOTAL THMS',result:15000,normalized_measurement:{canonical_value:15000}},load('data/analyte_registry.json'));assert.equal(x.quarantine,true)});
test('report replay is deterministic for pinned input',()=>{const r={snapshot_id:'x',value:1};assert.equal(robust.diffReplay(r,JSON.parse(JSON.stringify(r))).identical,true)});
const typed=require('./lib/typed_units'),sdwisRec=require('./lib/sdwis_reconciliation'),e2e=require('./lib/end_to_end_mutation'),small=require('./lib/small_system_resolution');
test('unit-typed core blocks incompatible analyte comparisons and converts explicitly',()=>{const a=typed.concentration(1,'mg/L','CAS:7439-92-1');const b=typed.concentration(1000,'ug/L','CAS:7439-92-1');assert.equal(a.compare(b),0);assert.throws(()=>a.compare(typed.concentration(1,'mg/L','CAS:7440-50-8')))});
test('SDWIS reconciliation exposes both engine-only and regulator-only disagreements',()=>{const x=sdwisRec.reconcile([{pwsid:'3590001',rule_code:'LCR',contaminant_code:'PB',compliance_period:'2024'}],[{pwsid:'3590001',rule_code:'TCR',contaminant_code:'COLI',compliance_period:'2024'}]);assert.equal(x.disagreement_count,2);assert.ok(x.diffs.some(d=>d.type==='sdwis-only'));assert.ok(x.review_required)});
test('end-to-end mutation test asserts on final report behavior',()=>{const run=i=>({status:i.unit==='bad'?'invalid':'ok',quality:{quarantine:i.unit==='bad'}});const x=e2e.runSuite([{mutationId:'u',baselineInput:{unit:'ug/L'},mutatedInput:{unit:'bad'}}],run);assert.equal(x.kill_rate,1);assert.equal(x.results[0].flagged,true)});
test('small-system resolver prioritizes exact facility and master-meter evidence',()=>{const x=small.resolveSmallSystem({address:'10 PARK RD',parcel:{parcel_id:'P1',property_name:'SUNSET MOBILE HOME PARK'},pwsFacilities:[{pwsid:'3599999',parcel_id:'P1',name:'Sunset Mobile Home Park',system_type:'COMMUNITY'}],masterMeters:[]});assert.equal(x.accepted,true);assert.equal(x.pwsid,'3599999');assert.equal(x.confidence,'high')});
test('small-system resolver refuses near-tied systems',()=>{const x=small.resolveSmallSystem({address:'1 MAIN ST',parcel:{property_name:'PARK'},pwsFacilities:[{pwsid:'1',name:'PARK A',system_type:'TRANSIENT'},{pwsid:'2',name:'PARK B',system_type:'TRANSIENT'}],masterMeters:[]});assert.equal(x.accepted,false);assert.equal(x.confidence,'ambiguous')});
const bitemporal=require('./lib/bitemporal'),half=require('./lib/evidence_half_life'),eff=require('./lib/effective_independence'),acq=require('./lib/acquisition_scheduler'),hyd=require('./lib/hydraulic_admissibility'),strategic=require('./lib/strategic_sampling'),oracle=require('./lib/enforcement_oracle');
test('bitemporal engine separates data as-of and regulation as-of',()=>{const rules=load('data/regulatory_rule_versions.json');const out=bitemporal.evaluateBitemporal({rows:[{id:'r1',sample_date:'2023-01-01',recorded_from:'2023-01-02'}],rules,dataAsOf:'2023-12-31',regulationAsOf:'2023-06-01',transactionAsOf:'2026-01-01',evaluator:(rows,rs)=>({status:'ok',rows:rows.length,rules:rs.map(x=>x.id)})});assert.equal(out.rows,1);assert.ok(out.bitemporal);assert.ok(out.replay_hash)});
test('regulatory version diff reports verdict flips',()=>{const rules=[{id:'old',valid_from:'2020-01-01',valid_to:'2024-01-01',recorded_from:'2020-01-01'},{id:'new',valid_from:'2024-01-01',valid_to:null,recorded_from:'2024-01-01'}];const x=bitemporal.diffRegulatoryVersions({rows:[],rules,dataAsOf:'2025-01-01',transactionAsOf:'2026-01-01',evaluator:(r,rs)=>({status:rs[0]?.id||'none'})},[{label:'old',asOf:'2023-01-01'},{label:'new',asOf:'2025-01-01'}]);assert.equal(x.verdict_flip_count,1)});
test('evidence half-life derives decay from autocorrelation',()=>{const rows=[1,2,3,4,5].map((v,i)=>({analyte:'A',stratum:'S',date:`202${i}-01-01`,value:v}));const x=half.fitHalfLife(rows);assert.equal(x.length,1);assert.ok('half_life_days' in x[0]);assert.equal(half.freshnessWeight(180,180),.5)});
test('effective independence counts originating samples not publishers',()=>{const x=eff.effectiveN([{origin_sample_key:'A',source_family:'DEP'},{origin_sample_key:'A',source_family:'CCR'},{origin_sample_key:'B',source_family:'LAB'}]);assert.equal(x.raw_record_count,3);assert.equal(x.effective_n,2);assert.equal(x.publisher_replica_count,1)});
test('verdict-flip scheduler ranks by value of information',()=>{const x=acq.rankSources([{id:'a',verdict_flip_probability:.8,severity_impact:1,acquisition_cost:.2,freshness_gain:1,coverage_gain:1},{id:'b',verdict_flip_probability:.2,severity_impact:1,acquisition_cost:1,freshness_gain:1,coverage_gain:1}],{status:'uncertain'});assert.equal(x[0].id,'a');assert.equal(x[0].rank,1)});
test('hydraulic admissibility requires a time-valid path',()=>{const graph={edges:[{from:'WELL1',to:'PLANT1',certainty:.9,valid_from:'2020-01-01'},{from:'PLANT1',to:'ZONE1',certainty:.8,valid_from:'2020-01-01'}]};const x=hyd.admissibility(graph,{samplingPoint:'WELL1',serviceZone:'ZONE1',sampleDate:'2025-01-01'});assert.equal(x.admissible,true);assert.ok(Math.abs(x.path_certainty-.72)<1e-9);const y=hyd.admissibility(graph,{samplingPoint:'WELL1',serviceZone:'ZONE2',sampleDate:'2025-01-01'});assert.equal(y.admissible,false)});
test('strategic sampling index is composite and non-accusatory',()=>{const x=strategic.score({values:[9.8,9.9,5,4],threshold:10,censoringRates:[.1,.5],peerDivergence:.8,protocolShift:.7,mdlBunchingValues:[1,1,0]});assert.ok(x.composite_score>0);assert.ok(/does not establish intentional/i.test(x.interpretation))});
test('enforcement oracle assigns discrepancy taxonomy',()=>{const rec={diffs:[{type:'sdwis-only',key:'x'}],disagreement_count:1};const x=oracle.formalize(rec,{x:{engineCoverage:.5,ruleImplemented:true}});assert.equal(x.discrepancies[0].taxonomy,'data-gap');assert.equal(x.human_adjudication_required,true)});
const prob=require('./lib/probabilistic_accuracy');
test('hierarchical partial pooling shrinks sparse groups toward peer mean',()=>{const x=prob.hierarchicalPartialPool([{id:'small',values:[20]},{id:'large',values:[1,1,1,1,1]}]);const small=x.find(g=>g.id==='small');assert.ok(small.posterior_mean<20);assert.ok(small.credible_interval_95.length===2)});
test('CCR interval summaries become bounded evidence not invented samples',()=>{const x=prob.intervalCcrLikelihood({min:.012,max:.045,average:.028,n:8});assert.equal(x.status,'usable-interval-evidence');assert.ok(x.constraints.latent_mean[0]>=.012&&x.constraints.latent_mean[1]<=.045)});
test('corrosion indices compute CSMR and preserve inference disclaimer',()=>{const x=prob.corrosionIndices({chlorideMgL:60,sulfateMgL:40,pH:7.2,alkalinityMgLCaCO3:100,calciumMgL:40,tdsMgL:250});assert.equal(x.csmr,1.5);assert.ok(/not a predicted/i.test(x.interpretation))});
test('ion charge balance quarantines grossly unbalanced chemistry',()=>{const x=prob.ionChargeBalance({calcium:100,chloride:1});assert.equal(x.status,'quarantine')});
test('change point detector finds a strong step',()=>{const x=prob.detectChangePoints([1,1,1,1,10,10,10,10],{minSegment:2,penalty:.1});assert.ok(x.change_points.includes(4))});
test('hydraulic topology inference requires strong covariance',()=>{const x=prob.inferHydraulicTopology({A:[1,2,3,4,5,6].map((v,i)=>({date:String(i),value:v})),B:[1,2,3,4,5,6].map((v,i)=>({date:String(i),value:v*2}))});assert.equal(x.inferred_edges.length,1);assert.equal(x.review_required,true)});
test('service line posterior is probabilistic and never a concentration',()=>{const x=prob.serviceLinePosterior({yearBuilt:1940,inventoryNeighborhood:{lead:8,nonLead:2},corrosion:{csmr:.8,langelier_saturation_index:-1}});assert.ok(x.posterior_probability_lead_or_galvanized>.5);assert.equal(x.concentration,undefined)});
test('private well surface returns estimate with uncertainty',()=>{const x=prob.coKrigingScreen([{lat:28,lon:-81,value:1,aquifer:'F'},{lat:28.1,lon:-81,value:2,aquifer:'F'},{lat:28,lon:-81.1,value:3,aquifer:'S'}],{lat:28.05,lon:-81.05},{aquifer:'F'});assert.equal(x.status,'ok');assert.ok(Number.isFinite(x.standard_error_proxy))});
