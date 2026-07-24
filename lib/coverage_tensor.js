'use strict';
function norm(s){return String(s||'').trim().toUpperCase();}
function quarter(date){const t=Date.parse(date||'');if(!Number.isFinite(t))return 'UNKNOWN';const d=new Date(t);return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth()/3)+1}`;}
function sourceFamily(r={}){
  const s=norm(r.source_id||r.publisher);
  if(/SDWIS|EPA/.test(s))return 'EPA-SDWIS';
  if(/WQP|STORET|NWIS|USGS/.test(s))return 'WQP';
  if(/CCR/.test(s))return 'CCR';
  if(/FDEP|DEP|CHEMICAL/.test(s))return 'FDEP';
  return 'OTHER';
}
function isCensored(r={}){return r.normalized_measurement?.censored===true||/^[<]/.test(String(r.result||'').trim())||/NON.?DETECT|ND/i.test(String(r.result||''));}
function numeric(r={}){const n=Number(r.normalized_measurement?.canonical_value??r.result);return Number.isFinite(n)?n:null;}
function buildCoverageTensor({records=[],expectedGroups=['INOR','DBP','VOC','SOC','RAD','PFAS','MICRO','WQP'],currentYear=new Date().getUTCFullYear()}={}){
  const cells=new Map();
  for(const r of records){
    const group=norm(r.contaminant_group||'UNKNOWN'),analyte=norm(r.analyte||r.metal||'UNKNOWN'),q=quarter(r.sample_date),source=sourceFamily(r),scope=r.granularity||r.evidence_level||'public-water-system-record';
    const key=[group,analyte,q,source,scope].join('|');
    const cell=cells.get(key)||{group,analyte,quarter:q,source_family:source,scope,records:0,detects:0,non_detects:0,numeric_values:0};
    cell.records++;
    if(isCensored(r)||r.detected===false)cell.non_detects++;else if(r.detected===true||(numeric(r)!==null&&numeric(r)>0))cell.detects++;
    if(numeric(r)!==null)cell.numeric_values++;
    cells.set(key,cell);
  }
  const groups={};
  for(const g of expectedGroups){
    const rows=[...cells.values()].filter(x=>x.group===g);
    const analytes=[...new Set(rows.map(x=>x.analyte))];
    const recent=rows.filter(x=>x.quarter.startsWith(String(currentYear))||x.quarter.startsWith(String(currentYear-1)));
    groups[g]={measured:rows.length>0,analyte_count:analytes.length,cell_count:rows.length,recent_cell_count:recent.length,source_families:[...new Set(rows.map(x=>x.source_family))],latest_quarter:rows.map(x=>x.quarter).filter(x=>x!=='UNKNOWN').sort().reverse()[0]||null};
  }
  const missing=expectedGroups.filter(g=>!groups[g].measured);
  const stale=expectedGroups.filter(g=>groups[g].measured&&!groups[g].recent_cell_count);
  const measured=expectedGroups.length-missing.length;
  return {
    method:'Scope × Time × Analyte × Source Coverage Tensor v1.0',
    cell_count:cells.size,
    cells:[...cells.values()],
    group_summary:groups,
    expected_groups:expectedGroups,
    measured_group_count:measured,
    missing_groups:missing,
    stale_groups:stale,
    coverage_fraction:expectedGroups.length?Number((measured/expectedGroups.length).toFixed(4)):0,
    negative_evidence_guard:{enabled:true,rule:'A missing cell means not observed in the loaded evidence, never zero and never not present.',missing_is_zero:false,non_detect_is_zero:false},
    interpretation:missing.length?`${missing.length} expected contaminant group(s) have no loaded system records; absence claims are prohibited for those groups.`:'Every expected contaminant group has at least one loaded record, but date, scope, and source-family gaps may remain.'
  };
}
module.exports={buildCoverageTensor,quarter,sourceFamily};
