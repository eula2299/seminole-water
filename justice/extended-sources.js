'use strict';
const evidence=require('./research-rates-status.json');
const advocacyEvidence=require('./research-complaints-coverage.json');
const rates=evidence.water_rates.map(r=>({
 id:r.id,name:r.provider+' · 2026',unit:r.base_tier_rates_usd_per_1000_gallons?'gallons':'CCF',
 from:r.effective_from,through:'2026-12-31',source:r.source_url,date_source:r.effective_date_source,
 scope:r.supported_scope,checked_at:evidence.checked_at,
 ...(r.base_tier_rates_usd_per_1000_gallons?{
   model:'denver-single-family',tiers:r.base_tier_rates_usd_per_1000_gallons,
   fixed:r.monthly_fixed_water_usd_by_meter_inches,drought:r.drought,drought_source:r.drought_source_url
 }:{model:'flat-use',perUnit:r.volume_rate_usd_per_unit})
}));
const routes={
 provider:{titleKey:'routeProvider',descriptionKey:'routeProviderHelp',url:'https://www.epa.gov/ground-water-and-drinking-water/local-drinking-water-information'},
 drinkingWater:{titleKey:'routeDrinkingWater',descriptionKey:'routeDrinkingWaterHelp',url:advocacyEvidence.sources.epa_primacy.url},
 commission:{titleKey:'routeCommission',descriptionKey:'routeCommissionHelp',url:advocacyEvidence.sources.naruc_directory.url},
 municipal:{titleKey:'routeMunicipal',descriptionKey:'routeMunicipalHelp',url:'https://www.usa.gov/local-governments'},
 housing:{titleKey:'routeHousing',descriptionKey:'routeHousingHelp',url:'https://www.usa.gov/tenant-rights'},
 civilRights:{titleKey:'routeCivilRights',descriptionKey:'routeCivilRightsHelp',url:advocacyEvidence.sources.doj_portal.url},
 legalAid:{titleKey:'routeLegalAid',descriptionKey:'routeLegalAidHelp',url:'https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help'},
 followup:{titleKey:'routeFollowup',descriptionKey:'routeFollowupHelp'}
};
async function readJson(url,fetcher=fetch){
 const r=await fetcher(url,{signal:AbortSignal.timeout(25000),redirect:'error',headers:{Accept:'application/json'}});
 if(!r.ok){await r.body?.cancel();throw Error('SOURCE_UNAVAILABLE');}
 let bytes=0,parts=[];for await(const chunk of r.body){bytes+=chunk.length;if(bytes>2e6)throw Error('SOURCE_TOO_LARGE');parts.push(chunk);}
 return JSON.parse(Buffer.concat(parts).toString());
}
async function requestStatus(input,fetcher=fetch){
 const number=String(input.number||'').trim(),year=String(input.year||'');
 if(!/^\d{2}-\d{5,12}$/.test(number)||!/^20\d{2}$/.test(year))throw Object.assign(Error('INVALID_REQUEST'),{status:400});
 const spec=evidence.request_status.recommended,u=new URL(spec.endpoint);
 u.search=new URLSearchParams({resource_id:spec.resource_id,filters:JSON.stringify({case_number:number}),fields:spec.query_parameters.fields,limit:'5',include_total:'false'});
 const data=await readJson(u,fetcher);if(data.success!==true||!Array.isArray(data.result?.records))throw Error('SOURCE_UNAVAILABLE');
 const records=data.result.records.filter(r=>r.case_number===number&&String(r.created_date_utc||'').startsWith(year+'-')).map(r=>({id:r.unique_id,number:r.case_number,status:r.status,office:r.case_owner,subject:r.subject,created:r.created_date_utc?String(r.created_date_utc).replace(/Z$/,'')+'Z':null,updated:r.last_modified_date_utc?String(r.last_modified_date_utc).replace(/Z$/,'')+'Z':null,closed:r.closed_date_utc?String(r.closed_date_utc).replace(/Z$/,'')+'Z':null}));
 return {records,checked_at:new Date().toISOString(),source:spec.source_url,frequency:spec.published_refresh,official:spec.official_fallback};
}
const statusProviders=[{name:'Pittsburgh 311',url:evidence.request_status.recommended.official_fallback,connector:'pittsburgh'},{name:'New York City 311',url:evidence.request_status.nyc_receipt_lookup_not_supported.official_receipt_lookup},{name:'Florida Public Service Commission',url:advocacyEvidence.sources.fl_tracking.url}];
module.exports={rates,routes,statusProviders,requestStatus,complaints:advocacyEvidence.complaint_routes||advocacyEvidence.supported_complaint_routes||[],evidence:advocacyEvidence};
