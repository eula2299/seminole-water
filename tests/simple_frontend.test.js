'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','public');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const actions=fs.readFileSync(path.join(root,'resident-actions.js'),'utf8');

test('main page leads with health meaning and address lookup',()=>{
  assert.match(index,/What does your water mean for your health\?/);
  assert.match(index,/Check water/);
  assert.match(index,/health level from 1 to 4/);
  assert.match(app,/Detected substances/);
});

test('main page does not render internal agent or evidence-debug panels',()=>{
  const combined=index+'\n'+app+'\n'+actions;
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
});

test('resident report has four plain-language health levels',()=>{
  assert.match(actions,/Low concern/);
  assert.match(actions,/Monitor/);
  assert.match(actions,/Health concern/);
  assert.match(actions,/Official advisory/);
  assert.match(actions,/What Level \$\{level.number\} means for your health/);
  assert.match(actions,/What every level means/);
});

test('resident-facing page removes limitation-heavy UI',()=>{
  assert.doesNotMatch(index,/What it cannot prove/);
  assert.doesNotMatch(index,/This is not a test of your home's water/);
  assert.doesNotMatch(index,/Disclaimers &amp; Terms of Use/);
  assert.match(actions,/removeLimitationMessaging/);
  assert.match(actions,/\.plain-language-note, \.dioxane-note/);
});

test('resident report adds health meaning to contaminant cards',()=>{
  assert.match(actions,/result-health-meaning/);
  assert.match(actions,/Lead can harm brain development/);
  assert.match(actions,/High nitrate can reduce the blood/);
  assert.match(actions,/Higher PFAS exposure/);
});

test('resident report includes official local resources and impact analytics',()=>{
  assert.match(actions,/Boil-water advisories/);
  assert.match(actions,/State-approved water labs/);
  assert.match(actions,/1,4-dioxane information/);
  assert.match(actions,/resident_health_level_viewed/);
  assert.match(actions,/official_resource_clicked/);
});

test('resident action report guards against repeated observer rendering',()=>{
  assert.match(actions,/lastRenderedKey/);
  assert.match(actions,/existing && lastRenderedKey === latestLookupKey/);
});
