'use strict';
// Runtime hardening for public deployment.
//
// The v13.7 request path was written for a single-operator tool and does three
// things that fail at public scale: it keeps every unique-visitor token in a
// JSON array that is linear-scanned and rewritten synchronously on every
// request, it writes a ~139 KB investigation file containing the submitted home
// address for every lookup, and it accepts unlimited requests against an
// endpoint that calls an external geocoder.
//
// This module replaces those with an O(1) in-memory counter flushed off the
// request path, an opt-in retention policy for address-bearing files, and a
// per-client rate limiter.

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------- rate limit

class RateLimiter {
  // Fixed-window counter per client key. Memory is bounded by pruning expired
  // windows; a client cannot grow the map faster than it can be pruned.
  constructor({ windowMs = 60_000, max = 30, maxClients = 50_000 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxClients = maxClients;
    this.hits = new Map();
  }

  check(key) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now >= entry.reset) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      if (this.hits.size > this.maxClients) this.prune(now);
      return { allowed: true, remaining: this.max - 1, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > this.max) {
      return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((entry.reset - now) / 1000) };
    }
    return { allowed: true, remaining: this.max - entry.count, retryAfterSec: 0 };
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.hits) if (now >= entry.reset) this.hits.delete(key);
    // Hard cap: if still oversized after pruning, drop the oldest windows.
    if (this.hits.size > this.maxClients) {
      const excess = this.hits.size - this.maxClients;
      let dropped = 0;
      for (const key of this.hits.keys()) {
        this.hits.delete(key);
        if (++dropped >= excess) break;
      }
    }
  }
}

// Trust a forwarded header only when explicitly enabled, since a client can
// otherwise spoof it and bypass the limiter entirely.
function clientKey(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// ------------------------------------------------------------ impact counter

class ImpactCounter {
  // Replaces the unbounded `unique` array. Membership is a Set (O(1) instead of
  // a linear array scan) and persistence is debounced and asynchronous, so no
  // request ever waits on disk. Only the count is persisted once the token set
  // exceeds `maxTokens`, which also stops the file growing without bound.
  constructor(file, { flushMs = 5_000, maxTokens = 100_000 } = {}) {
    this.file = file;
    this.flushMs = flushMs;
    this.maxTokens = maxTokens;
    this.timer = null;
    this.dirty = false;
    const seed = this.read();
    this.completed = Number(seed.completed || 0);
    this.residents = Number(seed.residents || 0);
    this.exactMatches = Number(seed.exactMatches || 0);
    this.directMatches = Number(seed.directMatches || 0);
    this.uniqueCount = Number(seed.unique_count || (Array.isArray(seed.unique) ? seed.unique.length : 0));
    this.tokens = new Set(Array.isArray(seed.unique) ? seed.unique : []);
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; }
  }

  record({ token, householdSize = 1, exactMatch = false, directMatch = false }) {
    this.completed += 1;
    if (token && !this.tokens.has(token)) {
      if (this.tokens.size < this.maxTokens) this.tokens.add(token);
      this.uniqueCount += 1;
      this.residents += Math.max(1, Number(householdSize) || 1);
    }
    if (exactMatch) this.exactMatches += 1;
    if (directMatch) this.directMatches += 1;
    this.schedule();
  }

  snapshot() {
    return {
      completed: this.completed,
      residents: this.residents,
      exactMatches: this.exactMatches,
      directMatches: this.directMatches,
      unique_count: this.uniqueCount,
      // Tokens stop being persisted past the cap; the count stays authoritative.
      unique: this.tokens.size < this.maxTokens ? [...this.tokens] : [],
      unique_tokens_truncated: this.tokens.size >= this.maxTokens
    };
  }

  schedule() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.flushMs);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const payload = JSON.stringify(this.snapshot(), null, 2);
    const tmp = `${this.file}.tmp`;
    fs.writeFile(tmp, payload, err => {
      if (err) { this.dirty = true; return; }
      fs.rename(tmp, this.file, renameErr => { if (renameErr) this.dirty = true; });
    });
  }
}

// -------------------------------------------------- investigation retention

// Each investigation file is roughly 139 KB and embeds the submitted street
// address. Writing one per lookup is 70 GB and a standing pile of personal data
// at 500,000 lookups, so persistence is opt-in and time-limited.
//
//   RETAIN_INVESTIGATIONS=off        (default) nothing written
//   RETAIN_INVESTIGATIONS=on         written, pruned after RETENTION_DAYS
//   INVESTIGATION_RETENTION_DAYS=7   default retention window
function retentionPolicy(env = process.env) {
  const mode = String(env.RETAIN_INVESTIGATIONS || 'off').toLowerCase();
  return {
    enabled: mode === 'on' || mode === 'true' || mode === '1',
    days: Math.max(1, Number(env.INVESTIGATION_RETENTION_DAYS || 7))
  };
}

function pruneInvestigations(root, { days = 7, now = Date.now() } = {}) {
  const dir = path.join(root, 'data', 'investigations');
  let removed = 0;
  let kept = 0;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return { removed, kept, dir }; }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) { fs.unlinkSync(file); removed += 1; }
      else kept += 1;
    } catch { /* concurrent removal is fine */ }
  }
  return { removed, kept, dir };
}

// ------------------------------------------------------------ geocode cache

// Load testing showed p50 latency of 61 ms but p95 of 15.5 s: the tail is
// entirely outbound geocoder calls. Addresses repeat heavily within a single
// county, so caching resolved coordinates removes most of that I/O. Negative
// results are cached briefly too, so a bad address cannot be used to hammer
// the upstream service.
class GeocodeCache {
  constructor({ ttlMs = 30 * 24 * 60 * 60 * 1000, negativeTtlMs = 10 * 60 * 1000, max = 100_000 } = {}) {
    this.ttlMs = ttlMs;
    this.negativeTtlMs = negativeTtlMs;
    this.max = max;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  static key(address, city) {
    return `${String(address || '').trim().toLowerCase().replace(/\s+/g, ' ')}|${String(city || '').trim().toLowerCase()}`;
  }

  get(address, city) {
    const key = GeocodeCache.key(address, city);
    const hit = this.map.get(key);
    if (!hit) { this.misses += 1; return undefined; }
    if (Date.now() > hit.expires) { this.map.delete(key); this.misses += 1; return undefined; }
    // Refresh recency for the LRU eviction order.
    this.map.delete(key);
    this.map.set(key, hit);
    this.hits += 1;
    return hit.value;
  }

  set(address, city, value) {
    const key = GeocodeCache.key(address, city);
    const ttl = value ? this.ttlMs : this.negativeTtlMs;
    this.map.set(key, { value, expires: Date.now() + ttl });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return value;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hit_rate: total ? Number((this.hits / total).toFixed(4)) : 0
    };
  }
}

module.exports = {
  RateLimiter, clientKey, ImpactCounter, retentionPolicy, pruneInvestigations, GeocodeCache
};
