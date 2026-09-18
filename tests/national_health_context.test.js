'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {getHealthContext}=require('../national/health_context');
test('health context matches exact normalized identity without confusing nearby names',()=>{
 assert.equal(getHealthContext(' ARSENIC ').id,'arsenic');
 assert.equal(getHealthContext('arsenic-like compound').matched,false);
 assert.equal(getHealthContext('nitrate + nitrite').matched,false);
 assert.equal(getHealthContext(null).matched,false);
 assert.equal(getHealthContext('PFOA').id,'pfas');
 assert.equal(getHealthContext('PFOA-precursor').matched,false);
});
test('health explanations include provenance and no personal or numeric risk claims',()=>{
 for(const name of ['arsenic','nitrate','nitrite','lead','uranium','radium 226','HAA5','TTHM','bromate','lithium','PFOS']){
  const c=getHealthContext(name);assert.equal(c.matched,true);assert.equal(c.scope,'general-contaminant-information-not-household-risk');
  assert.ok(c.sources.every(s=>new URL(s.url).hostname==='www.epa.gov'));assert.match(c.what_result_means,/nondetect is not a measured zero/i);
  assert.equal(c.household_risk,undefined);assert.equal(c.legal_violation,undefined);
 }
});
