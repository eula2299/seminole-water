'use strict';
const {runSuite}=require('../lib/end_to_end_mutation');
function report(input){
 const badUnit=!['mg/L','ug/L','µg/L','ppb','ppm','ng/L','ppt'].includes(input.unit);
 const absurd=Number(input.value)>1000000;
 return {status:badUnit?'invalid':'ok',value:input.value,unit:input.unit,quality:{quarantine:badUnit||absurd,mutation_flag:badUnit||absurd},review:{required:badUnit||absurd}};
}
const base={value:10,unit:'ug/L'};
const suite=runSuite([
 {mutationId:'unit-token-corruption',baselineInput:base,mutatedInput:{...base,unit:'ug|L'}},
 {mutationId:'decimal-shift',baselineInput:base,mutatedInput:{...base,value:10000000}},
 {mutationId:'benign-field-order',baselineInput:base,mutatedInput:{unit:'ug/L',value:10}}
],report);
console.log(JSON.stringify(suite,null,2));if(suite.kill_rate<1)process.exit(1);
