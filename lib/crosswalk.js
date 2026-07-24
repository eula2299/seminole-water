'use strict';
/*
 * Self-discovering polygon -> provider -> PWS crosswalk.
 *
 * Fixes the "polygon found / provider unresolved" blocker by:
 *  1. Inspecting EVERY property on a polygon (not a fixed regex whitelist) to
 *     discover which field carries the provider name and which carries a PWS id.
 *  2. Canonicalizing provider names so "City of Sanford", "SANFORD, CITY OF (2 WPS)"
 *     and "Sanford Utilities" all collapse to the same key.
 *  3. Matching with a strategy ladder (embedded PWS id -> exact canonical ->
 *     alias -> token overlap) and returning ALL candidates with reasons.
 *  4. Treating "one provider that operates several PWS sub-systems"
 *     (e.g. unincorporated Seminole County -> 4 PWS ids) as RESOLVED at the
 *     provider level instead of an unresolvable tie.
 *  5. Emitting a rich per-polygon diagnostic and a county-wide coverage report.
 *
 * Node core only, no dependencies.
 */

function normalize(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

// Organizational / utility noise that is safe to drop before comparing names.
// Distinctive place tokens (MANOR, OAKS, RIDGE, SHORES, VALLEY, WEKIVA, ...) are
// deliberately NOT in this list so subdivision systems stay distinguishable.
const NOISE = new Set([
  'CITY', 'TOWN', 'OF', 'THE', 'A',
  'DEPT', 'DEPARTMENT', 'DIV', 'DIVISION', 'DBA',
  'UTILITIES', 'UTILITY', 'UTIL', 'WATERWORKS', 'WORKS',
  'PUBLIC', 'WATER', 'SYSTEM', 'SYSTEMS', 'SYS', 'PWS',
  'SERVICE', 'SERVICES', 'SVC', 'AREA', 'DISTRICT', 'DIST',
  'WPS', 'WTP', 'WWTP', 'WSP', 'AND', 'CO', 'CORP', 'INC', 'LLC', 'LP', 'LTD',
  // Keep facility/subdivision words such as MHP, MOBILE, HOME, PARK, RV,
  // RESORT and ASSOCIATION because they distinguish real systems in this county.
  'IMPROVEMENT'
]);

const TOKEN_EQUIV = new Map([
  ['ASSOC','ASSOCIATION'], ['ASSN','ASSOCIATION'],
  ['GOVT','GOVERNMENTAL'], ['AUTH','AUTHORITY'],
  ['MULLETT','MULLET'], ['CAMPGROUND','CAMPGROUND']
]);
function canonicalTokens(name) {
  return normalize(name)
    .replace(/\bM\.?H\.?P\.?\b/g, ' MOBILE HOME PARK ')
    .replace(/\bR\.?V\.?\b/g, ' RV ')
    .replace(/\bS\s*\/\s*D\b/g, ' SUBDIVISION ')
    .replace(/\([^)]*\)/g, ' ')          // drop parentheticals e.g. "(2 WPS)"
    .replace(/[^A-Z0-9 ]/g, ' ')          // punctuation -> space
    .replace(/\b\d{5,}\b/g, ' ')          // drop long id numbers e.g. "3590473"
    .split(' ')
    .map(t => TOKEN_EQUIV.get(t) || t)
    .filter(t => t && !NOISE.has(t));
}
function canonicalName(name) { return canonicalTokens(name).join(' '); }

function jaccard(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens), b = new Set(bTokens);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ---- provider-field discovery over ALL polygon properties -------------------

const PWSID_RE = /^\s*(FL)?\s*0*([0-9]{6,7})\s*$/i;   // 6-7 digit FDEP ids, optional FL prefix
const NAME_KEY_RE = /name|util|prov|owner|agenc|operat|system|servic|water|dept|dist|dba|label|desc|title|company|entity/i;
const PWS_KEY_RE = /pws|wsid|water.?sys|sys.?(id|no|num|code)|system.?(id|no|num|code)|facility.?id/i;

function looksLikePwsid(v) {
  const m = String(v == null ? '' : v).match(PWSID_RE);
  return m ? m[2] : null;
}

/**
 * Inspect every property and return the most likely provider name + PWS id,
 * plus a full field inventory for diagnostics.
 * systemTokenVocab is a Set of tokens seen across official systems + aliases;
 * a value that contains one of those tokens is very likely the provider name,
 * regardless of what the field is called.
 */
function discoverProviderFields(properties = {}, systemTokenVocab = new Set()) {
  const inventory = [];
  let bestName = { field: null, value: '', score: -1 };
  let bestPws = { field: null, value: '', pwsid: null, score: -1 };

  for (const [key, raw] of Object.entries(properties || {})) {
    if (raw == null || raw === '') continue;
    const value = String(raw).trim();
    inventory.push({ field: key, value: value.length > 80 ? value.slice(0, 80) + '…' : value });

    // ---- PWS id candidate ----
    const pid = looksLikePwsid(value);
    if (pid) {
      let s = 0.5;
      if (PWS_KEY_RE.test(key)) s += 0.5;
      if (/^\d{7}$/.test(value.trim())) s += 0.1;
      if (s > bestPws.score) bestPws = { field: key, value, pwsid: pid, score: s };
    }

    // ---- provider name candidate ----
    // Skip metadata/URL/geometry fields; otherwise an official layer URL can
    // outscore the actual provider label merely because it contains WATER/SERVICE.
    const metadataField = key.startsWith('_') || /url|source|item.?id|objectid|globalid|shape|geometry|created|edited|date|length|area/i.test(key) || /^https?:\/\//i.test(value) || /^[0-9a-f]{24,}$/i.test(value) || /^[0-9a-f-]{32,36}$/i.test(value);
    if (!metadataField && /[A-Za-z]/.test(value) && value.length >= 3 && value.length <= 120) {
      const toks = canonicalTokens(value);
      let s = 0.2;                                   // base: plausible label
      if (NAME_KEY_RE.test(key)) s += 0.5;           // field name hints provider
      if (/(CITY|TOWN|COUNTY|UTILIT|WATER)/i.test(value)) s += 0.3; // value hints provider
      if (toks.some(t => systemTokenVocab.has(t))) s += 0.6;        // value overlaps a real system/alias token
      if (looksLikePwsid(value)) s -= 1;             // pure ids are not names
      if (s > bestName.score) bestName = { field: key, value, score: s };
    }
  }
  return {
    name: bestName.value || '',
    name_field: bestName.field,
    pwsid: bestPws.pwsid || '',
    pwsid_field: bestPws.field,
    field_inventory: inventory
  };
}

// ---- system index -----------------------------------------------------------

function buildCrosswalkIndex(systems = [], aliases = {}, records = []) {
  const sys = systems.map(s => ({
    pwsid: String(s.pwsid),
    name: s.name,
    city: s.city || s.mailing_city || '',
    state: s.state || '',
    canonical: canonicalName(s.name),
    tokens: canonicalTokens(s.name),
    alt_names: (Array.isArray(s.aliases) ? s.aliases : []).map(name => ({name, canonical: canonicalName(name), tokens: canonicalTokens(name)})).filter(x => x.tokens.length)
  }));
  const byPwsid = new Map(sys.map(s => [s.pwsid, s]));

  // Harvest per-PWS system_name variants from the record bank. These often carry
  // the distinguishing detail the registry omits — e.g. "SEMINOLE COUNTY NORTHEAST"
  // for PWS 3590473 where systems.json only says "...PUBLIC WATER SYSTEM 3590473".
  const seen = new Map();  // pwsid -> Set(normalized names)
  for (const r of records || []) {
    const pid = String(r && r.pwsid || '');
    const nm = r && r.system_name;
    if (!byPwsid.has(pid) || !nm) continue;
    const key = normalize(nm);
    const set = seen.get(pid) || new Set();
    if (!set.has(key)) {
      set.add(key);
      const toks = canonicalTokens(nm);
      // only keep names that add discriminating tokens beyond the registry name
      if (toks.length && toks.join(' ') !== byPwsid.get(pid).canonical) {
        byPwsid.get(pid).alt_names.push({ name: nm, canonical: toks.join(' '), tokens: toks });
      }
    }
    seen.set(pid, set);
  }

  // alias label -> { pwsids:[...], tokens:[...] }
  const aliasEntries = Object.entries(aliases || {}).map(([label, ids]) => ({
    label: normalize(label),
    tokens: canonicalTokens(label),
    pwsids: (Array.isArray(ids) ? ids : [ids]).map(String).filter(id => byPwsid.has(id))
  })).filter(a => a.pwsids.length);

  // vocabulary of tokens that identify a real provider (drives field discovery)
  const vocab = new Set();
  for (const s of sys) {
    for (const t of s.tokens) vocab.add(t);
    for (const alt of s.alt_names) for (const t of alt.tokens) vocab.add(t);
  }
  for (const a of aliasEntries) for (const t of a.tokens) vocab.add(t);

  // Count in how many distinct systems each identifying token appears. This
  // lets a one-word official label such as JANSEN resolve when that token is
  // unique, while rejecting generic one-word labels shared by several systems.
  const tokenSystems = new Map();
  for (const s of sys) {
    const own = new Set([...s.tokens, ...(s.alt_names || []).flatMap(a => a.tokens)]);
    for (const t of own) { const set = tokenSystems.get(t) || new Set(); set.add(s.pwsid); tokenSystems.set(t, set); }
  }
  return { systems: sys, byPwsid, aliases: aliasEntries, vocab, tokenSystems };
}

// ---- matching ladder --------------------------------------------------------

/**
 * Produce scored candidates for a discovered {name, pwsid}.
 * Each candidate carries a providerKey identifying the *provider entity* so that
 * several PWS ids belonging to one entity are not mistaken for a contradiction.
 */
function matchCandidates(discovered, index) {
  const out = [];
  // provider_key groups candidates into one provider ENTITY. Only an alias may
  // group several PWS ids together; each individual system is keyed by its own
  // id so two systems that merely collide on a canonical name never merge.
  const push = (pwsid, score, method, providerKey, providerLabel, reason, isAlias = false) => {
    if (!index.byPwsid.has(String(pwsid))) return;
    out.push({ pwsid: String(pwsid), score, method, provider_key: providerKey, provider_label: providerLabel, is_alias: isAlias, reason });
  };

  // Strategy 1: PWS id physically present on the polygon.
  if (discovered.pwsid && index.byPwsid.has(discovered.pwsid)) {
    const s = index.byPwsid.get(discovered.pwsid);
    push(discovered.pwsid, 1.0, 'pwsid-in-polygon', 'SYS:' + s.pwsid, s.name,
      `Polygon field "${discovered.pwsid_field}" carried PWS id ${discovered.pwsid}`);
  }

  const label = normalize(discovered.name);
  const labelTokens = canonicalTokens(discovered.name);
  const labelCanon = labelTokens.join(' ');

  if (labelTokens.length) {
    // Strategy 1b: distinctive per-PWS name harvested from the record bank
    // (e.g. the county quadrant names). Scored ABOVE the generic provider alias
    // so a specific sub-system resolves rather than collapsing to the umbrella.
    for (const s of index.systems) {
      for (const alt of s.alt_names || []) {
        if (alt.canonical === labelCanon) {
          push(s.pwsid, 0.995, 'subsystem-name-exact', 'SYS:' + s.pwsid, alt.name,
            `Polygon provider "${discovered.name}" matched sub-system name "${alt.name}"`);
        } else {
          const lSet = new Set(labelTokens), aSet = new Set(alt.tokens);
          const altInL = alt.tokens.every(t => lSet.has(t));
          const lInAlt = labelTokens.every(t => aSet.has(t));
          if ((altInL && alt.tokens.length >= 2) || (lInAlt && labelTokens.length >= 2)) {
            push(s.pwsid, 0.97, 'subsystem-name-subset', 'SYS:' + s.pwsid, alt.name,
              `Polygon provider "${discovered.name}" is a token-subset match to sub-system "${alt.name}"`);
          }
        }
      }
    }
    // Strategy 2: alias table is the authoritative provider registry. A matched
    // alias defines the provider entity AND its PWS-id membership, and outranks
    // coincidental canonical/token collisions from differently-named systems.
    for (const a of index.aliases) {
      const aSet = new Set(a.tokens), lSet = new Set(labelTokens);
      const aInL = a.tokens.every(t => lSet.has(t));
      const lInA = labelTokens.every(t => aSet.has(t));
      if (a.tokens.length && (aInL || lInA)) {
        const aliasExact = a.tokens.join(' ') === labelCanon;
        const aliasScore = aliasExact ? 0.985 : 0.92;
        for (const pid of a.pwsids) {
          // Canonically equivalent aliases that point at the same PWS set are
          // the same provider entity, even when punctuation/abbreviations differ
          // (e.g. "PALM VALLEY ASSOC." vs "PALM VALLEY ASSOCIATION").
          const aliasEntityKey = 'ALIAS:' + a.tokens.join(' ') + ':' + [...a.pwsids].sort().join(',');
          push(pid, aliasScore, aliasExact ? 'alias-exact' : 'alias-subset', aliasEntityKey, a.label,
            `Provider "${discovered.name}" matched alias "${a.label}"${aliasExact ? ' exactly' : ' by token subset'}`, true);
        }
      }
    }
    // Strategy 3: exact canonical-name equality against a specific system.
    for (const s of index.systems) {
      if (s.canonical && s.canonical === labelCanon) {
        push(s.pwsid, 0.99, 'canonical-name-exact', 'SYS:' + s.pwsid, s.name,
          `Polygon provider "${discovered.name}" canonicalized to "${s.canonical}"`);
      }
    }
    // Strategy 3b: token-subset containment (one name fully inside the other),
    // e.g. polygon "Bear Lake Manor MHP" ⊇ system "Bear Lake Manor".
    for (const s of index.systems) {
      if (!s.tokens.length) continue;
      const lSet = new Set(labelTokens), sSet = new Set(s.tokens);
      const sInL = s.tokens.every(t => lSet.has(t));
      const lInS = labelTokens.every(t => sSet.has(t));
      if ((sInL && s.tokens.length >= 2) || (lInS && labelTokens.length >= 2)) {
        push(s.pwsid, 0.96, 'token-subset', 'SYS:' + s.pwsid, s.name,
          `Polygon provider "${discovered.name}" is a token-subset match to system "${s.name}"`);
      }
    }
    // Strategy 3c: a single token may resolve only when it identifies exactly
    // one registered PWS. This handles official labels such as "JANSEN"
    // without allowing generic labels such as "LAKE" or "PARK".
    if (labelTokens.length === 1) {
      const ids = index.tokenSystems?.get(labelTokens[0]) || new Set();
      if (ids.size === 1) {
        const pid = [...ids][0], s = index.byPwsid.get(pid);
        push(pid, 0.955, 'unique-token', 'SYS:' + pid, s.name,
          `Provider token "${labelTokens[0]}" uniquely identifies system "${s.name}"`);
      }
    }
    // Strategy 4: token overlap (Jaccard) against system names.
    for (const s of index.systems) {
      const j = jaccard(labelTokens, s.tokens);
      if (j >= 0.5) {
        push(s.pwsid, 0.80 + 0.10 * j, 'token-overlap', 'SYS:' + s.pwsid, s.name,
          `Provider "${discovered.name}" overlaps system "${s.name}" (token similarity ${(j * 100).toFixed(0)}%)`);
      }
    }
  }

  // Return the full candidate list (sorted). Grouping in resolveConsensus needs
  // complete provider-entity membership, so we do NOT collapse per-pwsid here.
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Collapse candidates into a provider-level decision.
 * Accept when the top provider entity clears threshold and no *different*
 * provider entity is within epsilon. Multiple PWS ids from the SAME entity are
 * returned together and flagged sub_system_ambiguous rather than rejected.
 */
function resolveConsensus(candidates, { threshold = 0.90, epsilon = 0.02 } = {}) {
  if (!candidates.length) {
    return { accepted: false, confidence: 'unresolved', reason: 'no-provider-candidate',
      pwsid: null, pwsid_candidates: [], provider_key: null, score: 0, method: null, candidates: [] };
  }
  // group by provider entity
  const groups = new Map();
  for (const c of candidates) {
    const g = groups.get(c.provider_key) || {
      provider_key: c.provider_key, provider_label: c.provider_label,
      is_alias: c.is_alias, pwsids: new Set(), top: c
    };
    g.pwsids.add(c.pwsid);
    if (c.score > g.top.score) { g.top = c; g.provider_label = c.provider_label; }
    groups.set(c.provider_key, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.top.score - a.top.score);
  const winner = ranked[0];
  const winnerIds = new Set(winner.pwsids);
  // Eligibility to contest the winner:
  //  - an alias winner may only be contested by another alias (a real two-provider
  //    overlap), not by a coincidental system-name collision; and
  //  - a specific sub-system winner is NOT contested by the umbrella provider alias
  //    that contains it (that alias is its parent, not a competitor).
  const samePwsMembership = g => {
    if (g.pwsids.size !== winnerIds.size) return false;
    return [...winnerIds].every(id => g.pwsids.has(id));
  };
  const isParentOfWinner = g =>
    g.is_alias && !winner.is_alias && [...winnerIds].every(id => g.pwsids.has(id));
  const contestPool = ranked.slice(1).filter(g =>
    // Different labels/strategies that resolve to the exact same PWS set are
    // corroborating evidence for one provider, not a provider conflict.
    !samePwsMembership(g) &&
    !isParentOfWinner(g) &&
    (winner.is_alias ? g.is_alias : true));
  const runner = contestPool[0];

  const clears = winner.top.score >= threshold;
  const contested = runner && (winner.top.score - runner.top.score) < epsilon;
  const pwsids = [...winner.pwsids];
  const representative = winner.top.pwsid;   // highest-scoring member of the winning entity

  if (clears && !contested) {
    return {
      accepted: true,
      confidence: winner.top.score >= 0.98 ? 'very-high' : winner.top.score >= 0.95 ? 'high' : 'moderate',
      pwsid: representative,
      pwsid_candidates: pwsids,
      sub_system_ambiguous: pwsids.length > 1,
      provider_key: winner.provider_key,
      provider_label: winner.provider_label,
      score: winner.top.score,
      method: winner.top.method,
      reason: pwsids.length > 1
        ? `Resolved to provider "${winner.provider_label}" which operates ${pwsids.length} PWS sub-systems (${pwsids.join(', ')}); point-level disambiguation pending`
        : winner.top.reason,
      candidates
    };
  }
  return {
    accepted: false,
    confidence: 'unresolved',
    reason: contested
      ? `Two distinct providers tie: "${winner.provider_label}" vs "${runner.provider_label}"`
      : `Best provider "${winner.provider_label}" scored ${winner.top.score.toFixed(2)} (< ${threshold})`,
    pwsid: null,
    pwsid_candidates: pwsids,
    provider_key: winner.provider_key,
    provider_label: winner.provider_label,
    score: winner.top.score,
    method: winner.top.method,
    candidates
  };
}

// ---- public API -------------------------------------------------------------

/**
 * Full resolve for one polygon feature (or a plain properties object).
 * Returns the decision PLUS a human-readable diagnostic (item 10 in the report).
 */
function resolveProviderForFeature(feature, index, opts = {}) {
  const properties = feature && feature.properties ? feature.properties : (feature || {});
  const discovered = discoverProviderFields(properties, index.vocab);
  const candidates = matchCandidates(discovered, index);
  const decision = resolveConsensus(candidates, opts);

  // Some owner/operator labels legitimately cover more than one PWS polygon.
  // When a real address is being resolved, use the geocoded/user locality only
  // if it identifies exactly one member of that already-resolved provider.
  // This is intentionally a second-stage narrowing rule: locality can never
  // introduce a new provider candidate or override a polygon/PWS-id match.
  const locationCity = String(opts.location_city || opts.city || '').trim();
  if (decision.accepted && decision.sub_system_ambiguous && locationCity) {
    const loc = canonicalName(locationCity);
    const localityMatches = decision.pwsid_candidates.filter(pid => {
      const s = index.byPwsid.get(String(pid));
      const systemCity = canonicalName(s && s.city);
      return loc && systemCity && (loc === systemCity || loc.includes(systemCity) || systemCity.includes(loc));
    });
    if (localityMatches.length === 1) {
      const pid = localityMatches[0], system = index.byPwsid.get(pid);
      decision.pwsid = pid;
      decision.pwsid_candidates = [pid];
      decision.sub_system_ambiguous = false;
      decision.provider_key = 'SYS:' + pid;
      decision.provider_label = system.name;
      decision.method = `${decision.method || 'provider-alias'}+locality`;
      decision.confidence = decision.score >= 0.98 ? 'very-high' : 'high';
      decision.reason = `Provider-level match narrowed to PWS ${pid} because its registered locality "${system.city}" uniquely matches address city "${locationCity}"`;
    }
  }
  const unassigned = !discovered.name && !discovered.pwsid;
  if (unassigned) {
    decision.reason = 'Polygon contains no public-water provider label or PWS id; treat as an unassigned/service-gap polygon rather than inventing a provider.';
    decision.classification = 'unassigned-no-provider-label';
  } else if (!decision.accepted) decision.classification = 'named-provider-unresolved';
  else decision.classification = decision.sub_system_ambiguous ? 'provider-only-multi-pws' : 'single-pws-resolved';
  return {
    ...decision,
    discovered,
    diagnostic: {
      provider_field: discovered.name_field || '(none found)',
      provider_value: discovered.name || '(none)',
      pwsid_field: discovered.pwsid_field || '(none found)',
      pwsid_value: discovered.pwsid || '(none)',
      matched: decision.accepted,
      matched_pwsid: decision.pwsid,
      match_method: decision.method || '(none)',
      reason: decision.reason,
      inspected_fields: discovered.field_inventory
    }
  };
}

/** Startup coverage validation over every polygon in the service-area layer. */
function validateCrosswalk(features = [], index, opts = {}) {
  const total = features.length;
  const resolved = [], unresolvedNamed = [], unassigned = [];
  let singlePws = 0, multiPws = 0;
  for (const f of features) {
    const r = resolveProviderForFeature(f, index, opts);
    if (r.accepted) {
      resolved.push(r);
      if (r.sub_system_ambiguous) multiPws++; else singlePws++;
    } else if (r.classification === 'unassigned-no-provider-label') unassigned.push(r);
    else unresolvedNamed.push(r);
  }
  const pct = (n,d=total) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const named = resolved.length + unresolvedNamed.length;
  return {
    loaded_polygons: total,
    named_provider_polygons: named,
    blank_or_unassigned_polygons: unassigned.length,
    matched_provider: resolved.length,
    matched_single_pws: singlePws,
    provider_only_multi_pws: multiPws,
    unmatched_named_provider: unresolvedNamed.length,
    unmatched: unresolvedNamed.length,
    all_polygon_coverage_pct: pct(resolved.length),
    named_provider_coverage_pct: pct(resolved.length,named),
    coverage_pct: pct(resolved.length,named),
    single_pws_pct: pct(singlePws,named),
    multi_pws_samples: resolved.filter(r => r.sub_system_ambiguous).slice(0, 25).map(r => ({
      provider: r.provider_label, pwsid_candidates: r.pwsid_candidates,
      provider_field: r.diagnostic.provider_field, provider_value: r.diagnostic.provider_value
    })),
    unresolved_samples: unresolvedNamed.slice(0, 100).map(r => ({
      provider_field: r.diagnostic.provider_field,
      provider_value: r.diagnostic.provider_value,
      reason: r.reason,
      fields: r.discovered.field_inventory
    })),
    unassigned_samples: unassigned.slice(0, 25).map(r => ({
      reason:r.reason,
      fields:r.discovered.field_inventory
    }))
  };
}

function printCoverage(report) {
  const lines = [];
  lines.push(`Loaded polygons: ${report.loaded_polygons}`);
  lines.push(`Polygons with a named provider/PWS label: ${report.named_provider_polygons}`);
  lines.push(`Blank or unassigned polygons: ${report.blank_or_unassigned_polygons}`);
  lines.push(`Matched named-provider polygons: ${report.matched_provider}/${report.named_provider_polygons} (${report.named_provider_coverage_pct}%)`);
  lines.push(`Matched to a single PWS id: ${report.matched_single_pws} (${report.single_pws_pct}% of named polygons)`);
  if (report.provider_only_multi_pws) {
    lines.push(`Provider resolved, sub-system pending (multi-PWS): ${report.provider_only_multi_pws}`);
    for (const m of report.multi_pws_samples) {
      lines.push(`  ~ ${m.provider_value} -> provider "${m.provider}" [${m.pwsid_candidates.join(', ')}] (point-level disambiguation)`);
    }
  }
  lines.push(`Named providers still unresolved: ${report.unmatched_named_provider}`);
  for (const u of report.unresolved_samples) {
    lines.push(`  - provider_field=${u.provider_field} value="${u.provider_value}" :: ${u.reason}`);
  }
  return lines.join('\n');
}

module.exports = {
  normalize, canonicalName, canonicalTokens, jaccard,
  discoverProviderFields, buildCrosswalkIndex, matchCandidates, resolveConsensus,
  resolveProviderForFeature, validateCrosswalk, printCoverage
};
