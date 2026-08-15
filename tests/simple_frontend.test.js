'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','public');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const actions=fs.readFileSync(path.join(root,'resident-actions.js'),'utf8');

test('main page leads with health meaning and simple address lookup',()=>{
  assert.match(index,/What could your water mean for your health\?/);
  assert.match(index,/Check water/);
  assert.match(index,/possible long-term effects/i);
  assert.doesNotMatch(index,/More options/);
  assert.doesNotMatch(index,/People in household/);
  assert.doesNotMatch(index,/Water system<\/span>/);
});

test('resident-facing page does not expose internal debugging or engineering UI',()=>{
  assert.doesNotMatch(index,/Agent audit trail/);
  assert.doesNotMatch(index,/Provider crosswalk diagnostics/);
  assert.doesNotMatch(index,/Causal-conformal evidence assurance/);
  assert.doesNotMatch(index,/Evidence used/);
  assert.doesNotMatch(index,/Service-area diagnostics/);
  assert.doesNotMatch(index,/PWSID/i);
  assert.match(actions,/simplifyBaseReport/);
  assert.match(actions,/plainUnit/);
  assert.match(actions,/plainName/);
});

test('resident report uses four understandable health levels',()=>{
  assert.match(actions,/Low current concern/);
  assert.match(actions,/Some findings to watch/);
  assert.match(actions,/Higher health concern/);
  assert.match(actions,/Active water alert/);
  assert.match(actions,/What this could mean long term/);
});

test('long-term health explanations include concrete diseases and organ effects',()=>{
  assert.match(actions,/permanently lower IQ/);
  assert.match(actions,/learning and behavior problems/);
  assert.match(actions,/cardiovascular disease and type 2 diabetes/);
  assert.match(actions,/skin, lung, and bladder cancers/);
  assert.match(actions,/kidney and testicular cancer/);
  assert.match(actions,/kidney disease and make bones more fragile/);
  assert.match(actions,/increase cancer risk/);
});

test('common technical units are translated for residents',()=>{
  assert.match(actions,/parts per trillion/);
  assert.match(actions,/parts per billion/);
  assert.match(actions,/parts per million/);
  assert.match(actions,/radioactivity units/);
});

test('technical result sections are replaced or removed from resident view',()=>{
  assert.match(actions,/\.local-panel/);
  assert.match(actions,/\.alerts-section/);
  assert.match(actions,/\.overall-card/);
  assert.match(actions,/Current official concerns/);
  assert.match(actions,/What was found in testing/);
  assert.match(actions,/See other substances that were tested/);
});

test('resident report keeps useful official local resources',()=>{
  assert.match(actions,/Current water alerts/);
  assert.match(actions,/Local approved water labs/);
  assert.match(actions,/1,4-dioxane in Seminole County/);
  assert.match(actions,/resident_health_level_viewed/);
  assert.match(actions,/official_resource_clicked/);
});

test('simple interface keeps underlying detection handling intact',()=>{
  assert.match(app,/recordStatus/);
  assert.match(app,/not-detected/);
  assert.match(actions,/isDetected/);
});
