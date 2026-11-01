'use strict';
// Public Census estimates republished by Esri's verified demographics publisher.
// Reviewed 2026-11-01; exact tract identity and dataset vintage are checked at runtime.
const ROOT='https://P3ePLMYs2RVChkJx.svcs.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/';
const specs=[
 ['poverty','abec2f1c32774dadab427eb36ebdbfcf','ACS_Poverty_Status_View_Boundaries',{B17020_001E:'B17001_001E',B17020_002E:'B17001_002E'}],
 ['income','c9faa265b82848498bc0a8390c0afa65','ACS_Median_Household_Income_View_Boundaries',{B19049_001E:'B19013_001E'}],
 ['tenure','a6fdf94877254d7ca9e5ff9ba6504297','ACS_Housing_Tenure_by_Race_View_Boundaries',{B25003_001E:'B25003_001E',B25003_003E:'B25003_003E'}],
 ['housing','204f0ea4315640fca8c2e0fbefe11a96','ACS_Housing_Units_by_Year_Built_View_Boundaries',Object.fromEntries(['001','007','008','009','010','011'].map(n=>['B25034_'+n+'E','B25034_'+n+'E']))]
].map(([id,item,service,fields])=>({id,fields,meta:'https://www.arcgis.com/sharing/rest/content/items/'+item,url:ROOT+service+'/FeatureServer/2/query'}));
const ENDPOINTS=Object.fromEntries(specs.flatMap(s=>[['acs_'+s.id,s.url],['acs_'+s.id+'_metadata',s.meta]]));
function createNeighborhood(){
 const verified=new Map();
 return async function neighborhood(address,get){
  const geoid=String(address.geography?.tract?.geoid||'');if(!/^\d{11}$/.test(geoid))throw Error('TRACT_REQUIRED');
  const rows=await Promise.allSettled(specs.map(async s=>{
   if(!verified.get(s.id)||Date.now()-verified.get(s.id)>86400000){const meta=await get(s.meta+'?f=json');if(meta.owner!=='esri_demographics'||!String(meta.description).includes('2020-2024'))throw Error('NEIGHBORHOOD_VINTAGE');verified.set(s.id,Date.now());}
   const u=new URL(s.url);u.search=new URLSearchParams({f:'json',where:"GEOID='"+geoid+"'",outFields:['GEOID','NAME',...Object.keys(s.fields)].join(','),returnGeometry:'false',resultRecordCount:'2'});
   const response=await get(u.href),matches=response.features?.filter(f=>f.attributes?.GEOID===geoid);if(response.exceededTransferLimit||matches?.length!==1)throw Error('TRACT_IDENTITY');
   return {spec:s,attributes:matches[0].attributes};
  }));
  const good=rows.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw Error('NEIGHBORHOOD_SOURCE');
  const values={NAME:good[0].attributes.NAME};for(const r of good)for(const [from,to]of Object.entries(r.spec.fields))if(r.attributes[from]!=null)values[to]=r.attributes[from];
  const context=require('./access_plan').parseAcsContext([Object.keys(values),Object.values(values)],address);
  return {...context,source:'U.S. Census Bureau 2020–2024 ACS estimates, published by Esri',source_urls:good.map(r=>r.spec.meta.replace('/sharing/rest/content/items/','/home/item.html?id=')),checked_at:new Date().toISOString(),available_topics:good.map(r=>r.spec.id),household_inference:false};
 };
}
module.exports={ENDPOINTS,createNeighborhood};
