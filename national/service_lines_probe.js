'use strict';
const fs=require('node:fs');
const {ROOT,createServiceLines,sourceReader}=require('./service_lines');
(async()=>{
 const get=createServiceLines({timeoutMs:25000});
 const inventory=await get({pwsids:['TX2270001','NY7003493'],supplyType:'public'});
 const request=sourceReader(),root=await request(ROOT+'?f=json',{signal:AbortSignal.timeout(25000)});
 const table=root.tables.filter(t=>/^CWS_CompleteTable_\d{8}$/.test(t.name));
 if(table.length!==1)throw Error('Ambiguous source table');
 const census=await request(ROOT+'/'+table[0].id+'/query?f=json&where=1%3D1&returnCountOnly=true',{signal:AbortSignal.timeout(25000)});
 const checks={source_contract:inventory.status==='records-returned',both_utilities_found:inventory.records.length===2,no_household_assertion:inventory.household_material_verified===false,source_population_count:Number.isSafeInteger(census.count)&&census.count>0};
 fs.writeFileSync('service-line-live-contract.json',JSON.stringify({checks,inventory,source_table_records:census.count,count_definition:'Public source table records; not locally ingested records, households, or nationally complete inventories.'},null,2));
 console.log(JSON.stringify({checks,source_table_records:census.count,records:inventory.records},null,2));
 if(Object.values(checks).some(v=>!v))process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
