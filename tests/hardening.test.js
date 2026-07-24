'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const H = require('../lib/runtime_hardening');

function tmpFile(seed) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'imp-')), 'impact.json');
  fs.writeFileSync(file, JSON.stringify(seed));
  return file;
}

test('rate limiter allows up to the cap then rejects with a retry hint', () => {
  const rl = new H.RateLimiter({ windowMs: 10_000, max: 3 });
  assert.deepEqual([1, 2, 3].map(() => rl.check('a').allowed), [true, true, true]);
  const blocked = rl.check('a');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
  assert.equal(rl.check('b').allowed, true, 'a different client is unaffected');
});

test('rate limiter window resets and memory is bounded', () => {
  const rl = new H.RateLimiter({ windowMs: 1, max: 1 });
  rl.check('x');
  const later = Date.now() + 5;
  while (Date.now() < later) { /* wait out the window */ }
  assert.equal(rl.check('x').allowed, true, 'a new window must reset the count');

  const capped = new H.RateLimiter({ windowMs: 1, max: 100, maxClients: 50 });
  for (let i = 0; i < 500; i += 1) capped.check(`client-${i}`);
  capped.prune(Date.now() + 10_000);
  assert.ok(capped.hits.size <= 50, `client map must stay bounded, got ${capped.hits.size}`);
});

test('forwarded headers are only trusted when explicitly enabled', () => {
  const req = { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(H.clientKey(req), '127.0.0.1', 'spoofable header must be ignored by default');
  assert.equal(H.clientKey(req, { trustProxy: true }), '9.9.9.9');
});

test('impact counter is O(1) per record rather than a linear array scan', () => {
  const file = tmpFile({ completed: 0, unique: [], residents: 0 });
  const counter = new H.ImpactCounter(file, { flushMs: 10_000 });
  const started = Date.now();
  for (let i = 0; i < 100_000; i += 1) counter.record({ token: `t${i}`, householdSize: 2 });
  const elapsed = Date.now() - started;
  assert.equal(counter.uniqueCount, 100_000);
  assert.equal(counter.residents, 200_000);
  assert.ok(elapsed < 5_000, `100k records took ${elapsed}ms; this should be near-instant`);
});

test('repeat visitors increment lookups but not unique residents', () => {
  const file = tmpFile({ completed: 0, unique: [], residents: 0 });
  const counter = new H.ImpactCounter(file, { flushMs: 10_000 });
  for (let i = 0; i < 5; i += 1) counter.record({ token: 'same-token', householdSize: 3 });
  assert.equal(counter.completed, 5);
  assert.equal(counter.uniqueCount, 1);
  assert.equal(counter.residents, 3);
});

test('persisted token list is capped so the file cannot grow without bound', () => {
  const file = tmpFile({ completed: 0, unique: [], residents: 0 });
  const counter = new H.ImpactCounter(file, { flushMs: 10_000, maxTokens: 10 });
  for (let i = 0; i < 50; i += 1) counter.record({ token: `t${i}` });
  const snap = counter.snapshot();
  assert.equal(snap.unique_count, 50, 'the count stays accurate');
  assert.equal(snap.unique.length, 0, 'raw tokens stop being persisted past the cap');
  assert.equal(snap.unique_tokens_truncated, true);
});

test('existing impact files are migrated without losing their counts', () => {
  const file = tmpFile({ completed: 7, unique: ['a', 'b'], residents: 4, exactMatches: 2 });
  const counter = new H.ImpactCounter(file, { flushMs: 10_000 });
  assert.equal(counter.completed, 7);
  assert.equal(counter.uniqueCount, 2);
  assert.equal(counter.exactMatches, 2);
  counter.record({ token: 'a' });
  assert.equal(counter.uniqueCount, 2, 'a known token must not double-count');
});

test('address-bearing investigation files are not retained by default', () => {
  assert.equal(H.retentionPolicy({}).enabled, false);
  assert.equal(H.retentionPolicy({ RETAIN_INVESTIGATIONS: 'on' }).enabled, true);
  assert.equal(H.retentionPolicy({ RETAIN_INVESTIGATIONS: 'on', INVESTIGATION_RETENTION_DAYS: '3' }).days, 3);
});

test('retention pruning removes files past the window and keeps recent ones', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
  const dir = path.join(root, 'data', 'investigations');
  fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, 'aaaaaaaa-0000-0000-0000-000000000000.json');
  const fresh = path.join(dir, 'bbbbbbbb-0000-0000-0000-000000000000.json');
  fs.writeFileSync(old, '{}');
  fs.writeFileSync(fresh, '{}');
  const longAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  fs.utimesSync(old, longAgo / 1000, longAgo / 1000);
  const result = H.pruneInvestigations(root, { days: 7 });
  assert.equal(result.removed, 1);
  assert.equal(result.kept, 1);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
});

test('the server rate-limits lookups and gates investigation downloads', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /lookupLimiter\.check/, 'lookup endpoint must be rate limited');
  assert.match(server, /429/, 'must return HTTP 429 when the limit is exceeded');
  assert.match(server, /if\(retention\.enabled\)saveInvestigation/, 'address files must be opt-in');
  assert.match(server, /impactCounter\.snapshot\(\)/, 'impact must be served from memory');
  assert.ok(!/JSON\.parse\(fs\.readFileSync\(impacts/.test(server),
    'the synchronous read-modify-write impact path must be gone');
});

test('user-facing output escapes HTML so submitted text cannot inject markup', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const escLine = app.split('\n').find(l => /const esc\s*=/.test(l));
  assert.ok(escLine, 'an escaping helper must exist');
  for (const ch of ['&', '<', '>', '"', "'"]) {
    assert.ok(escLine.includes(ch), `escaper must handle ${ch}`);
  }
});

test('geocode cache returns hits, expires entries, and bounds memory', () => {
  const c = new H.GeocodeCache({ ttlMs: 10_000, max: 3 });
  assert.equal(c.get('1 Main St', 'Sanford'), undefined, 'cold lookup is a miss');
  c.set('1 Main St', 'Sanford', { lat: 28.8, lon: -81.27 });
  assert.deepEqual(c.get('1 Main St', 'Sanford'), { lat: 28.8, lon: -81.27 });
  assert.deepEqual(c.get('  1   MAIN st ', 'sanford'), { lat: 28.8, lon: -81.27 },
    'keys must normalise case and whitespace');
  for (let i = 0; i < 10; i += 1) c.set(`addr${i}`, 'Sanford', { lat: i, lon: i });
  assert.ok(c.map.size <= 3, `cache must evict, got ${c.map.size}`);
  assert.ok(c.stats().hit_rate > 0);
});

test('failed geocodes are cached only briefly so bad input cannot hammer upstream', () => {
  const c = new H.GeocodeCache({ ttlMs: 100_000, negativeTtlMs: 1 });
  c.set('nowhere', 'Sanford', null);
  assert.equal(c.get('nowhere', 'Sanford'), null, 'negative result is cached');
  const until = Date.now() + 5;
  while (Date.now() < until) { /* let the short TTL lapse */ }
  assert.equal(c.get('nowhere', 'Sanford'), undefined, 'negative cache must expire quickly');
});

test('the health endpoint exposes what monitoring needs', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /\/api\/health/);
  for (const field of ['uptime_seconds', 'memory_mb', 'geocode_cache', 'local_synced']) {
    assert.ok(server.includes(field), `health endpoint must report ${field}`);
  }
});
