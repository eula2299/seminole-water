'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const priority = fs.readFileSync(path.join(root, 'public', 'result-priority.js'), 'utf8');
const clean = fs.readFileSync(path.join(root, 'public', 'clean-result-flow.js'), 'utf8');
const cleanCss = fs.readFileSync(path.join(root, 'public', 'clean-result-flow.css'), 'utf8');

test('address results sit immediately below the address form', () => {
  const search = index.indexOf('class="search-card resident-search"');
  const out = index.indexOf('id="out"');
  const footer = index.indexOf('class="site-footer"');
  assert.ok(search >= 0 && out > search, 'results should follow the address search');
  assert.ok(footer > out, 'footer should remain below the result area');
  assert.doesNotMatch(index, /class="how-it-helps"/);
  assert.doesNotMatch(index, /class="public-service-note"/);
  assert.match(index, /class="result-priority-zone"/);
});

test('roadmap content is moved below the result area', () => {
  assert.match(priority, /getElementById\('roadmap-home'\)/);
  assert.match(priority, /out\.after\(roadmap\)/);
  assert.doesNotMatch(priority, /roadmap\.before\(out\)/);
});

test('what was found becomes the first visible completed-result section', () => {
  assert.match(clean, /WHAT WAS FOUND/);
  assert.match(clean, /out\.prepend\(resultSection\)/);
  assert.match(clean, /resultSection\.after\(report\)/);
  assert.match(clean, /WHAT THIS MEANS/);
  assert.match(clean, /What to do next/);
  assert.match(cleanCss, /clean-hidden-context/);
  assert.match(cleanCss, /result-priority-zone>\.report-header/);
});

test('duplicate result clutter is removed but roadmap tools remain', () => {
  assert.match(clean, /health-guide-wrap/);
  assert.match(clean, /official-resources-wrap/);
  assert.match(clean, /lookup-feedback/);
  assert.match(clean, /account-cta/);
  assert.match(clean, /MORE WATER TOOLS/);
  assert.match(clean, /Local alerts, private-well help, city information, labs, and issue guides/);
});

test('completed lookups reveal the result instead of scrolling on loading state', () => {
  assert.match(priority, /pendingLookup/);
  assert.match(priority, /hasFinishedResult/);
  assert.match(priority, /\.report-header/);
  assert.match(priority, /scrollIntoView/);
  assert.match(priority, /prefers-reduced-motion/);
});

test('result scripts compile and load after app.js', () => {
  assert.doesNotThrow(() => new Function(priority));
  assert.doesNotThrow(() => new Function(clean));
  assert.ok(index.indexOf('/result-priority.js') > index.indexOf('/app.js'));
  assert.ok(index.indexOf('/clean-result-flow.js') > index.indexOf('/result-priority.js'));
});
