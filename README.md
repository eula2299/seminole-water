# Seminole Water God-Mode v13.6 — Negotiated Accuracy Engine

This version converts an address lookup into a reproducible investigation rather than a single unsupported contamination claim.

## Agent pipeline

1. **Address Resolution Agent** normalizes the submitted address using the U.S. Census geocoder.
2. **Official Service-Area Agent** intersects the coordinate with Seminole County's public Water Service Areas ArcGIS item `41f6f18ec9cd48a5b89b94e946cf2143`.
3. **Provider/PWS Crosswalk Agent** maps official provider attributes to Florida public-water-system IDs. Ambiguous provider-wide polygons are not forced into one sub-system.
4. **Direct Household Sample Agent** checks privacy-safe exact-address hashes for publicly released or owner-supplied laboratory records.
5. **Expanded Contaminant-Class Agents** retrieve all applicable contaminant records from the local verified evidence bank.
6. **Contradiction Validator Agent** flags overlapping polygons, tied provider candidates, missing units, missing dates, unknown sources, and duplicate records.
7. **Evidence Compilation Agent** creates a downloadable JSON evidence package containing every claim, record, source URL, granularity label, confidence decision, and limitation.

## Accuracy rule

The application never estimates a household metal concentration. It reports:

- `exact-household-sample` only when a record is explicitly matched to that address;
- `exact-address/system-level-water-quality` when the address is exactly matched to an official utility service area but the sample is system/facility level;
- `unresolved` when provider evidence is insufficient.

## Start

```bash
npm test
python3 scripts/sync_service_areas.py
python3 scripts/run_metal_agents.py
npm start
```

Open `http://localhost:3000`.

## Automatic updates

Schedule these commands in production:

```bash
python3 scripts/sync_service_areas.py
python3 scripts/sync_fdep.py
python3 scripts/run_metal_agents.py
```

New regulatory records remain pending until schema validation and approval. This prevents a changed spreadsheet layout or an unverified web result from being published as a contaminant measurement.

## Current bundled evidence

The included evidence bank contains the existing FDEP 2024 extract from the prior build. The update scripts are designed to add current and historical official files. A production deployment should run all sync jobs and review the pending import before launch.


## v7 accuracy additions
- Dual geocoding: Census address match plus Florida statewide cadastral parcel intersection cross-check.
- Versioned service-area registry with valid-from/valid-to dates for historical sample attribution.
- Explicit boundary-edge, overlap, and gap flags; no silent polygon selection.
- Utility lineage model for mergers, acquisitions, predecessor and successor PWS identities.
- Interconnection/blended-source model with effective dates and blend fractions.
- Immutable record fingerprints, revision chains, and superseded-record flags.
- Canonical concentration normalization to ug/L while retaining original values and units.
- Left-censored non-detect representation; non-detects are never converted to zero.

## Version 8 verification layer

Every displayed contaminant record now receives two independent checks:

1. **Independent-source corroboration.** A reading is `confirmed` only when a second source family reports the same PWS, metal, sampling context, date and materially equivalent value. Repeated copies from the same agency or database do not count. Records without independent corroboration remain visible but are labeled `single-source`.
2. **Laboratory accreditation.** The record is cross-referenced against the configured NELAP/state laboratory registry. Results are tiered as `accredited`, `expired-accreditation`, `unaccredited-or-unverified`, or `unknown-accreditation`.

At lookup time, the server also performs live checks against configured EPA ECHO/SDWIS, Florida DEP, CCR, utility and public-records sources. An exact-address/street/subdivision search is enabled when a supported search API key is configured, such as `BING_SEARCH_KEY`. Community-board or HOA evidence is retained as unverified context and can never independently confirm a contaminant reading.

The public-records tracker stores utility-specific request status, tracking numbers, returned files, litigation references and consent decrees. Live-source failures are returned in the investigation audit trail rather than silently ignored.

## v12 research accuracy layer

See `RELEASE_V12.md`. Reports now expose `research_accuracy_layers`, including effective originating-sample N, hydraulic admissibility checks, empirical half-life policy, and strategic-sampling screening. The server also exposes `/api/research-layers`.

## v13.4 address and neighborhood lookup

Each lookup now scans utility-specific official alert pages, follows relevant official notice links, derives subdivision names from parcel data, and searches the public web for the submitted address when the form option is enabled. Matches are shown in a dedicated **Exact-address and neighborhood online evidence** panel and are kept separate from household laboratory measurements. See `FIXES_V13.4.md`.


## v13.5 federal drinking-water data

Version 13.5 adds a full Seminole County federal-data pipeline for EPA SDWIS/ECHO, EPA/USGS Water Quality Portal, and Consumer Confidence Reports. Run `npm run sync:epa` to populate the federal cache, then restart or POST `/api/epa/reload`. The UI keeps federal system compliance, annual CCR data, and nearby environmental monitoring separated by evidence type. See `FIXES_V13.5.md`.

## v13.5.1 SDWIS sync repair

EPA's SDWA summary page may no longer expose a static ZIP link. This build discovers the archive from EPA's official download directory and falls back to the official stable path `SDWA_latest_downloads.zip`. The bulk download is roughly 500 MB and now prints progress every 25 MiB. If bulk download still fails, the synchronizer automatically fills SDWIS system summaries through ECHO rather than leaving the federal cache empty.

Run only the repaired federal stages after replacing the project folder:

```bash
npm run sync:epa:sdwis
npm run sync:epa:ccr
npm start
```

Your existing WQP cache does not need to be downloaded again.

## v13.6 negotiated-accuracy layer

Version 13.6 adds deterministic, auditable accuracy controls rather than cosmetic “agent” labels:

- **Counterfactual boundary stability:** every lookup is re-resolved at 24 nearby coordinate perturbations (5 m, 15 m, and 30 m rings) to detect service-boundary sensitivity.
- **Auditable agent negotiation:** structured claims, objections, hard epistemic vetoes, origin-deduplicated voting, explicit dissent, and an allowed `undecided` state.
- **Dimension-separated uncertainty budget:** geolocation, provider identity, spatial robustness, scope, freshness, coverage, independence, conflict, and federal-source availability are scored separately. Household-exposure confidence is capped when no household sample exists.
- **Claim robustness certificate:** the report must pass provider, perturbation, scope, negotiation, confidence, and contradiction checks.
- **Active evidence acquisition:** the engine ranks the next evidence most likely to change the conclusion or improve confidence.
- **Peer-system concentration profile:** only comparable, uncensored, similarly dated system-level measurements are ranked; non-detects and missing analytes are never treated as zero.
- **Bayesian agent reliability ledger:** reliability weights can be updated only from human-adjudicated outcomes using `npm run calibrate:agents`; hard evidence-scope rules cannot be learned away.

Run the complete validation suite with:

```bash
npm run test:all
```

The expected release result is **129 passing tests**.

## v13.8.0 Seminole County local data layer

Version 13.8.0 adds three county-specific data families alongside the federal
pipeline. See `RELEASE_V13.8.0.md` for detail and `DEPLOYMENT.md` for the
required pre-launch data-population steps.

1. **PFAS & emerging contaminants** — EPA UCMR 5 (29 PFAS + lithium), Florida
   DEP PFAS program status, Water Quality Portal PFAS results, and EWG map
   indicators as cross-reference leads. EPA 2024 final MCLs and the
   four-compound Hazard Index are bundled in `data/pfas/benchmarks.json`.
2. **Private wells & septic** — the Seminole County 1,4-Dioxane Private Well
   Data Study, FDOH Seminole drinking-water services records, and SJRWMD well
   and Consumptive Use Permit geometry. This covers the private-well population
   that regulated SDWIS data does not reach.
3. **Real-time telemetry & environmental water health** — the Seminole Water
   Atlas (County + USF), the county Surface Water Quality Program including its
   15 automated telemetry weather stations, and the county GIS asset library.

```bash
npm run sync:local     # all three families
npm run sync:all       # federal + local
npm run test:local
```

New endpoints: `/api/local/status`, `/api/pfas/status`,
`/api/private-wells/status`, `/api/telemetry/status`, `/api/local/sources`,
`/api/local/pws/:pwsid`, and `POST /api/local/reload`. Lookup responses gain a
`local_data` block.

**Data-state honesty.** The caches ship empty and are filled by the sync jobs,
exactly as the federal caches always have been. The public page renders an
un-synchronized family as an amber *Not loaded* panel that says explicitly it
is not a finding that the water is clean, and a PFAS result at or above an EPA
MCL escalates the overall verdict ahead of any all-clear branch.
