# v13.8.0 — Seminole County Local Data Layer

This release adds three new Seminole-County data families on top of the v13.7
causal-conformal backend and the v13.7.1 simplified public interface.

## New data families

**1. PFAS & emerging contaminants**
- EPA UCMR 5 occurrence data (29 PFAS compounds + lithium), filtered to the
  registered Seminole County PWS IDs.
- Florida DEP PFAS program compliance status.
- EPA/USGS Water Quality Portal PFAS results for county FIPS `US:12:117`.
- EWG PFAS interactive map indicators, retained as cross-reference leads only.
- EPA 2024 final NPDWR limits bundled in `data/pfas/benchmarks.json`
  (PFOA 4 ng/L, PFOS 4 ng/L, PFHxS/PFNA/HFPO-DA 10 ng/L, plus the four-compound
  Hazard Index).

**2. Private wells & septic**
- Seminole County 1,4-Dioxane Private Well Data Study (measured private wells).
- FDOH in Seminole County drinking-water services records.
- SJRWMD well-construction and well-completion point locations, plus
  Consumptive Use Permit areas, from the district ArcGIS Open Data services.

**3. Real-time telemetry & environmental water health**
- Seminole County Water Atlas (County + USF) stations and chemistry.
- Seminole County Surface Water Quality Program watershed sites and the 15
  automated meteorological/telemetry weather stations.
- Seminole County GIS Library pipeline, drainage, and capital asset inventory.

## New code

- `lib/local_data.js` — loader, PFAS unit normalization (ug/L and mg/L to
  ng/L), MCL and Hazard Index classification, and distance-based matching for
  environmental and private-well context.
- `scripts/seminole_sync_lib.py` — shared HTTP, CSV, and paginated ArcGIS
  FeatureServer helpers.
- `scripts/sync_pfas.py`, `scripts/sync_private_wells.py`,
  `scripts/sync_telemetry.py` — the three synchronizers.
- `tests/local_data.test.js` — 10 tests covering units, MCL classification,
  non-detect handling, Hazard Index, granularity labelling, and the
  missing-data safety property.

## New endpoints

```text
GET  /api/local/status
GET  /api/pfas/status
GET  /api/private-wells/status
GET  /api/telemetry/status
GET  /api/local/sources
GET  /api/local/pws/:pwsid?lat=&lon=
POST /api/local/reload
```

`/api/lookup` responses now carry a `local_data` block with
`emerging_contaminants`, `private_well_context`, and `local_telemetry`.

## Accuracy rules preserved

- Non-detects are never converted to zero. A non-detect yields
  `value_ng_L: null`, never `0`, and can never register as an exceedance.
- UCMR 5 and FDEP rows are labelled `public-water-system`. Water Quality Portal
  PFAS rows are labelled `environmental-monitoring-station`. County
  1,4-dioxane rows are labelled `private-well-sample`.
- A neighbouring private well is never presented as the submitted household's
  water. Only an address-specific laboratory sample can characterize a home.

## Interface safety change

The public page now distinguishes **"data not loaded"** from **"nothing
found."** An un-synchronized cache renders an amber *Not loaded* panel that
states explicitly that it is not a finding that the water is clean. A PFAS
result at or above an EPA MCL escalates the overall verdict ahead of any
all-clear branch, so the page cannot show "no violations found" while a PFAS
limit is exceeded.

## Test result

```text
155 Node tests passing, 4 Python tests passing
```
