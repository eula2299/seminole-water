'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','public');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const index=read('index.html');
const app=read('app.js');
const actions=read('resident-actions.js');
const roadmap=read('roadmap.js');
const roadmapData=read('roadmap-data.js');
const pages=read('pages.js');
const css=read('roadmap.css');

test('main page leads with health meaning and simple address lookup',()=>{
  assert.match(index,/What could your water mean for your health\?/);
  assert.match(index,/Check water/);
  assert.match(index,/possible long-term effects/i);
  assert.doesNotMatch(index,/More options/);
  assert.doesNotMatch(index,/People in household/);
  assert.doesNotMatch(index,/Water system<\/span>/);
});

test('resident-facing page does not expose old engineering UI',()=>{
  const combined=index+'\n'+roadmap+'\n'+pages;
  assert.doesNotMatch(combined,/Agent audit trail/);
  assert.doesNotMatch(combined,/Provider crosswalk diagnostics/);
  assert.doesNotMatch(combined,/Causal-conformal evidence assurance/);
  assert.doesNotMatch(combined,/Evidence used/);
  assert.doesNotMatch(combined,/Service-area diagnostics/);
  assert.doesNotMatch(index,/PWSID/i);
  assert.equal(fs.existsSync(path.join(root,'explorer.html')),false);
  assert.match(actions,/simplifyBaseReport/);
});

test('resident report keeps long-term disease explanations',()=>{
  assert.match(actions,/permanently lower IQ/);
  assert.match(actions,/cardiovascular disease and type 2 diabetes/);
  assert.match(actions,/skin, lung, and bladder cancers/);
  assert.match(actions,/kidney and testicular cancer/);
  assert.match(actions,/kidney disease and make bones more fragile/);
});

test('technical units are translated for residents',()=>{
  assert.match(actions,/parts per trillion/);
  assert.match(actions,/parts per billion/);
  assert.match(actions,/parts per million/);
});

test('full roadmap includes resident problem selector and anonymous reporting',()=>{
  assert.match(roadmap,/What is happening with your water\?/);
  assert.match(roadmap,/resident_water_problem_reported/);
  assert.match(roadmapData,/Brown, yellow, or rusty water/);
  assert.match(roadmapData,/Rotten-egg or sulfur smell/);
  assert.match(roadmapData,/Older home or lead concern/);
  assert.match(roadmapData,/I use a private well/);
});

test('full roadmap includes exact-area alerts and private-well flow',()=>{
  assert.match(roadmap,/LOCAL WATER ALERTS/);
  assert.match(roadmap,/address_evidence/);
  assert.match(roadmap,/PRIVATE WELL PATH/);
  assert.match(roadmap,/nearby_dioxane_well_samples/);
  assert.match(roadmap,/nearby_dioxane_detections/);
});

test('full roadmap includes approved labs and correct local routing',()=>{
  assert.match(roadmap,/STATE-APPROVED WATER LABS/);
  assert.match(roadmapData,/Flowers Labs/);
  assert.match(roadmapData,/PC&B/);
  assert.match(roadmapData,/HBEL/);
  assert.match(roadmapData,/AEL/);
  for(const place of ['Sanford','Lake Mary','Oviedo','Winter Springs','Altamonte Springs','Casselberry','Longwood','Unincorporated Seminole County']) assert.match(roadmapData,new RegExp(place));
});

test('full roadmap includes local 1,4-dioxane experience',()=>{
  assert.match(roadmap,/Local 1,4-dioxane information for this area/);
  assert.match(roadmap,/liver toxicity and cancer risk/);
  assert.match(roadmapData,/Seminole County.*1,4-dioxane/s);
});

test('full roadmap includes public impact tracking and outcome feedback',()=>{
  assert.match(index,/impact\.html/);
  assert.match(roadmap,/impact_understanding_feedback/);
  assert.match(roadmap,/official_resource_clicked/);
  assert.match(pages,/fetch\('\/api\/impact'\)/);
  assert.match(pages,/water checks/);
  assert.match(pages,/unique households/);
  assert.equal(fs.existsSync(path.join(root,'impact.html')),true);
});

test('dedicated city and health-guide pages exist',()=>{
  assert.equal(fs.existsSync(path.join(root,'city.html')),true);
  assert.equal(fs.existsSync(path.join(root,'issue.html')),true);
  assert.match(pages,/renderCity/);
  assert.match(pages,/renderIssue/);
  assert.match(roadmapData,/lead:/);
  assert.match(roadmapData,/pfas:/);
  assert.match(roadmapData,/dioxane:/);
  assert.match(roadmapData,/bacteria:/);
});

test('Spanish and accessibility/mobile support are built in',()=>{
  assert.match(roadmap,/Español/);
  assert.match(roadmap,/¿Qué está pasando con su agua\?/);
  assert.match(roadmapData,/nameEs/);
  assert.match(css,/skip-link/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/@media\(max-width:620px\)/);
  assert.match(css,/:focus-visible/);
});

test('new browser scripts compile',()=>{
  assert.doesNotThrow(()=>new Function(roadmapData));
  assert.doesNotThrow(()=>new Function(roadmap));
  assert.doesNotThrow(()=>new Function(pages));
});

test('underlying detection handling remains intact',()=>{
  assert.match(app,/recordStatus/);
  assert.match(app,/not-detected/);
  assert.match(actions,/isDetected/);
});
