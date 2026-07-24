'use strict';
function node(id,type,label,observed,confidence,details={}){return {id,type,label,observed:!!observed,confidence:Number((Number(confidence)||0).toFixed(4)),details};}
function edge(from,to,type,observed,confidence,basis){return {from,to,type,observed:!!observed,confidence:Number((Number(confidence)||0).toFixed(4)),basis};}
function buildCausalPathwayGraph({providerSystem=null,serviceMatches=[],sdwis={},records=[],hydraulicGraph={edges:[]},exactHouseholdCount=0,addressLabel='submitted address'}={}){
  const source=sdwis?.system?.primary_source||sdwis?.system?.source_water_type||providerSystem?.primary_source||null;
  const nodes=[
    node('source-water','source-water',source?`${source} source water`:'source water not resolved',!!source,source?.9:.25,{primary_source:source}),
    node('treatment','treatment','treatment/facility stage',records.some(r=>r.entry_point||/ENTRY|PLANT|POE/i.test(String(r.sample_type||''))),records.some(r=>r.entry_point)? .85:.45),
    node('distribution','distribution-system',providerSystem?.name||'resolved public water system',!!providerSystem,providerSystem?.98:.1,{pwsid:providerSystem?.pwsid||null}),
    node('service-area','service-area',serviceMatches[0]?.name||'official service-area polygon',serviceMatches.length>0,serviceMatches.length?1:.1),
    node('premise','premise',addressLabel,true,.98),
    node('tap','household-tap','household tap',exactHouseholdCount>0,exactHouseholdCount?1:.15,{exact_household_samples:exactHouseholdCount})
  ];
  const hydEdges=hydraulicGraph?.edges||[];
  const hasHydraulic=hydEdges.length>0;
  const edges=[
    edge('source-water','treatment','source-to-treatment',!!source&&records.some(r=>r.entry_point),source&&records.some(r=>r.entry_point)?.8:.35,'source type plus treatment-entry evidence'),
    edge('treatment','distribution','treated-water-entry',hasHydraulic,hasHydraulic?.85:.45,hasHydraulic?'utility hydraulic graph':'inferred from PWS membership; hydraulic graph unavailable'),
    edge('distribution','service-area','system-serves-area',serviceMatches.length>0,serviceMatches.length?1:.1,'official service-area polygon and provider crosswalk'),
    edge('service-area','premise','address-inside-service-area',serviceMatches.length>0,serviceMatches.length?1:.1,'point-in-polygon address resolution'),
    edge('premise','tap','premise-to-tap',exactHouseholdCount>0,exactHouseholdCount?1:.2,exactHouseholdCount?'address-linked tap sample':'no address-linked tap sample')
  ];
  const pathObserved=edges.every(e=>e.observed);
  const bottleneck=edges.slice().sort((a,b)=>a.confidence-b.confidence)[0];
  const systemPathComplete=edges.slice(0,4).every(e=>e.confidence>=.45);
  return {
    method:'Causal Water-Pathway Proof Graph v1.0',
    nodes,edges,
    system_path_complete:systemPathComplete,
    household_path_observed:pathObserved,
    bottleneck,
    strongest_supported_scope:pathObserved?'exact-household-sample':systemPathComplete?'public-water-system-record':'regional-context',
    prohibited_inference:pathObserved?null:'The graph does not contain a fully observed path from a measured water sample to the submitted household tap; household concentration causality is therefore blocked.',
    interpretation:pathObserved?'A fully observed source-to-tap evidence path exists for at least one address-linked sample.':'The address-to-system path is supported, but one or more source, hydraulic, premise, or tap links are inferred or absent.'
  };
}
module.exports={buildCausalPathwayGraph};
