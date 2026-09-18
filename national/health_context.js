'use strict';
// Reviewed source summaries, never LLM-generated household risk or compliance decisions.
const REVIEWED_AT='2026-09-18';
const SCOPE='general-contaminant-information-not-household-risk';
const PRIMARY={title:'EPA drinking-water contaminant information',url:'https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations'};
const PFAS={title:'EPA: what is known about PFAS and health',url:'https://www.epa.gov/pfas/our-current-understanding-human-health-and-environmental-risks-pfas'};
const UCMR={title:'EPA UCMR 5: lithium and PFAS monitoring',url:'https://www.epa.gov/dwucmr/fifth-unregulated-contaminant-monitoring-rule'};
const MANGANESE={title:'EPA IRIS manganese assessment',url:'https://iris.epa.gov/static/pdfs/0373_summary.pdf'};
const DIOXANE={title:'EPA final risk evaluation for 1,4-dioxane',url:'https://www.epa.gov/assessing-and-managing-chemicals-under-tsca/final-risk-evaluation-14-dioxane'};
const entries=[
 ['manganese',['manganese','manganese total'],'Manganese','Manganese is an essential nutrient, but excessive exposure can affect the nervous system. Drinking-water exposure needs separate assessment from normal dietary intake; a detected amount alone does not establish harm.',MANGANESE],
 ['dioxane14',['1,4-dioxane'],'1,4-Dioxane','EPA identifies liver toxicity and cancer among concerns from 1,4-dioxane exposure, including contaminated drinking water. Risk depends on exposure amount and duration.',DIOXANE],
 ['antimony',['antimony','antimony total'],'Antimony','Long-term elevated exposure can raise cholesterol and lower blood sugar.',PRIMARY],
 ['beryllium',['beryllium','beryllium total'],'Beryllium','Long-term elevated exposure can damage the intestines.',PRIMARY],
 ['chromium-total',['chromium total','total chromium'],'Total chromium','Elevated exposure can cause allergic skin inflammation. Different chromium forms require distinct assessments.',PRIMARY],
 ['fluoride',['fluoride'],'Fluoride','Excessive long-term fluoride exposure can affect bones and cause tooth discoloration in children.',PRIMARY],
 ['selenium',['selenium','selenium total'],'Selenium','Elevated long-term exposure can affect circulation, hair, nails and sensation in fingers or toes.',PRIMARY],
 ['thallium',['thallium','thallium total'],'Thallium','Elevated exposure can affect hair, blood, kidneys, intestines and liver.',PRIMARY],
 ['mercury-inorganic',['mercury inorganic','inorganic mercury'],'Inorganic mercury','Long-term elevated exposure can harm the kidneys.',PRIMARY],
 ['cyanide-free',['cyanide as free cyanide','free cyanide'],'Free cyanide','Elevated exposure can damage nerves or affect the thyroid.',PRIMARY],
 ['atrazine',['atrazine'],'Atrazine','Long-term elevated exposure can affect cardiovascular and reproductive health.',PRIMARY],
 ['benzene',['benzene'],'Benzene','Long-term elevated exposure can affect blood cells and increase cancer risk.',PRIMARY],
 ['tce',['trichloroethylene','trichloroethene'],'Trichloroethylene','Long-term elevated exposure can harm the liver and increase cancer risk.',PRIMARY],
 ['pce',['tetrachloroethylene','tetrachloroethene'],'Tetrachloroethylene','Long-term elevated exposure can harm the liver and increase cancer risk.',PRIMARY],
 ['chlorite',['chlorite'],'Chlorite','Elevated exposure can cause anemia and affect the nervous system in young children.',PRIMARY],
 ['chlorine',['chlorine','chlorine as cl2'],'Chlorine','Elevated exposure can irritate eyes and the nose and cause stomach discomfort.',PRIMARY],
 ['coliform',['total coliform','total coliforms','coliform (tcr)','coliform, total','coliform'],'Total coliform bacteria','Total coliforms are indicators used to check a water system. Their presence can signal a need to investigate whether harmful germs entered the water; it does not by itself identify those germs.',PRIMARY],
 ['ecoli',['e. coli','escherichia coli','e coli','ecoli'],'E. coli','E. coli can indicate fecal contamination. Certain strains cause gastrointestinal illness. A historical result is not a current advisory; follow current utility or health-department instructions.',PRIMARY],
 ['cadmium',['cadmium','cadmium total'],'Cadmium','Long-term elevated cadmium exposure can damage kidneys.',PRIMARY],
 ['barium',['barium','barium total'],'Barium','Elevated barium exposure can increase blood pressure.',PRIMARY],
 ['copper',['copper','copper total'],'Copper','Elevated copper can cause stomach symptoms and, with long-term exposure, liver or kidney problems.',PRIMARY],
 ['arsenic',['arsenic','arsenic total'],'Arsenic','Long-term exposure to elevated arsenic can affect skin and circulation and increase cancer risk.',PRIMARY],
 ['nitrate',['nitrate','nitrate as n','nitrate (as nitrogen)','nitrate (measured as nitrogen)'],'Nitrate','Elevated nitrate can impair oxygen transport, with infants especially vulnerable.',PRIMARY],
 ['nitrite',['nitrite','nitrite as n','nitrite (as nitrogen)','nitrite (measured as nitrogen)'],'Nitrite','Elevated nitrite can impair oxygen transport, with infants especially vulnerable.',PRIMARY],
 ['lead',['lead','lead total'],'Lead','Lead can affect children’s development and adults’ kidneys and blood pressure. Household plumbing can contribute lead.',PRIMARY],
 ['uranium',['uranium','uranium total'],'Uranium','Elevated uranium exposure can harm kidneys and increase cancer risk.',PRIMARY],
 ['radium',['radium 226','radium 228','radium 226 and 228','combined radium 226 and 228'],'Radium','Long-term exposure to elevated radium can increase cancer risk.',PRIMARY],
 ['haa5',['haa5','haloacetic acids (haa5)','haloacetic acids five'],'Haloacetic acids','HAA5 are disinfection byproducts. Long-term elevated exposure can increase cancer risk.',PRIMARY],
 ['tthm',['tthm','tthms','total trihalomethanes','trihalomethanes total','trihalomethanes (tthms)'],'Total trihalomethanes','These disinfection byproducts can affect organs and increase cancer risk with long-term elevated exposure.',PRIMARY],
 ['bromate',['bromate'],'Bromate','Bromate is a disinfection byproduct associated with increased cancer risk at elevated long-term exposure.',PRIMARY],
 ['lithium',['lithium'],'Lithium','EPA monitors lithium to better understand its occurrence in drinking water. Evidence about risks at typical drinking-water exposures remains limited; a screening reference is not a household safety determination.',UCMR],
 ['pfas',['PFOA','PFOS','PFNA','PFHxS','PFBS','PFBA','PFPeA','PFHxA','PFHpA','PFDA','PFUnA','PFDoA','PFTrDA','PFTeDA','PFPeS','PFHpS','PFNS','PFDS','HFPO-DA','GenX','ADONA','NFDHA','9Cl-PF3ONS','11Cl-PF3OUdS','4:2 FTS','6:2 FTS','8:2 FTS','NMeFOSAA','NEtFOSAA','PFMBA','PFMPA','PFEESA','perfluorooctanoic acid','perfluorooctanesulfonic acid'],'PFAS','Research links exposure to certain PFAS with immune, developmental, liver and other effects, and some cancers. Evidence and toxicity differ among compounds. A finding for one PFAS cannot be applied automatically to another.',PFAS]
];
const normalize=value=>typeof value==='string'?value.normalize('NFKC').trim().toLowerCase().replace(/[\s,_()\-:]+/g,''):'';
const index=new Map();
for(const [id,aliases,label,summary,source] of entries)for(const alias of aliases){const key=normalize(alias);if(index.has(key)&&index.get(key).id!==id)throw new Error('Ambiguous health-context alias');index.set(key,{id,label,summary,source});}
function getHealthContext(analyte){
 const entry=index.get(normalize(analyte));
 if(!entry)return {matched:false,id:null,scope:SCOPE,reviewed_at:REVIEWED_AT,sources:[],summary:'No reviewed explanation is mapped to this exact analyte.'};
 return {matched:true,id:entry.id,label:entry.label,summary:entry.summary,scope:SCOPE,reviewed_at:REVIEWED_AT,
  what_result_means:'A historical system result does not establish the amount in your tap today or your personal exposure. Check the sample date, units, location and reporting limit. A nondetect is not a measured zero.',
  practical_step:entry.id==='lead'?'Ask your utility about the service line and a certified laboratory about a sample from your own tap.':'Ask the utility to explain current results and any applicable notices. A certified laboratory can address questions about your own water.',
  sources:[{...entry.source}]};
}
module.exports={getHealthContext};
