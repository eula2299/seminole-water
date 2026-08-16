'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const priority = fs.readFileSync(path.join(root, 'public', 'result-priority.js'), 'utf8');

test('address results are structurally above explainer and roadmap content', () => {
  const search = index.indexOf('class="search-card resident-search"');
  const out = index.indexOf('id="out"');
  const explainer = index.indexOf('class="how-it-helps"');
  assert.ok(search >= 0 && out > search, 'results should follow the address search');
  assert.ok(explainer > out, 'results should appear before educational content');
  assert.match(index, /class="result-priority-zone"/);
});

test('roadmap content is moved below the result area', () => {
  assert.match(priority, /getElementById\('roadmap-home'\)/);
  assert.match(priority, /explainer\.after\(roadmap\)/);
  assert.doesNotMatch(priority, /roadmap\.before\(out\)/);
});

test('completed lookups reveal the result instead of scrolling on loading state', () => {
  assert.match(priority, /pendingLookup/);
  assert.match(priority, /hasFinishedResult/);
  assert.match(priority, /\.report-header/);
  assert.match(priority, /scrollIntoView/);
  assert.match(priority, /prefers-reduced-motion/);
});

test('result priority browser script compiles and is loaded after app.js', () => {
  assert.doesNotThrow(() => new Function(priority));
  assert.ok(index.indexOf('/result-priority.js') > index.indexOf('/app.js'));
});
