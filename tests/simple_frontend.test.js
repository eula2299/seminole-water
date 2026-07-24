'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','public');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');

test('main page uses plain-language water-check interface',()=>{
  assert.match(index,/What is in your water system\?/);
  assert.match(index,/Check water/);
  assert.match(app,/Detected substances/);
  assert.match(app,/Only a sample collected from the home/);
});

test('main page does not render internal agent or evidence-debug panels',()=>{
  const combined=index+'\n'+app;
  assert.doesNotMatch(combined,/Agent audit trail/);
  assert.doesNotMatch(combined,/Provider crosswalk diagnostics/);
  assert.doesNotMatch(combined,/Causal-conformal evidence assurance/);
  assert.doesNotMatch(combined,/Evidence used/);
  assert.doesNotMatch(combined,/View agent configuration/);
  assert.doesNotMatch(combined,/Service-area diagnostics/);
});

test('simple interface still keeps non-detects separate from detections',()=>{
  assert.match(app,/recordStatus/);
  assert.match(app,/not-detected/);
  assert.match(app,/A detection does not automatically mean/);
});
