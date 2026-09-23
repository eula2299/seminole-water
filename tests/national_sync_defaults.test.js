'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {defaultPostgresSources}=require('../national/sync');

test('default national Postgres refresh does not duplicate object-store compliance history',()=>{
 assert.deepEqual(defaultPostgresSources({}),['ucmr5','sdwis']);
});

test('legacy Postgres violation snapshot remains an explicit opt-in',()=>{
 assert.deepEqual(defaultPostgresSources({NATIONAL_POSTGRES_VIOLATIONS_ENABLED:'true'}),['ucmr5','sdwis','sdwis-violations']);
 assert.deepEqual(defaultPostgresSources({NATIONAL_POSTGRES_VIOLATIONS_ENABLED:'TRUE'}),['ucmr5','sdwis','sdwis-violations']);
 assert.deepEqual(defaultPostgresSources({NATIONAL_POSTGRES_VIOLATIONS_ENABLED:'false'}),['ucmr5','sdwis']);
});
