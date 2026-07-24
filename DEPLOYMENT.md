# Deployment Guide — Seminole Water v13.8.0

## Read this first

The application ships with the **analysis code complete and the data caches
empty.** That is deliberate and it is how the existing federal pipeline has
always worked: `data/epa/sdwis_*.json` and `data/epa/wqp_*.json` also ship as
empty arrays and are filled by `npm run sync:epa`.

**Do not publish this to the public until the sync jobs have been run on a
machine with real network access and you have reviewed the output.** With empty
caches the site will correctly report "Not loaded" for every new panel, which
is honest but not useful to a resident.

## 1. Install

```bash
npm install
npm run test:all      # expect 155 Node tests + 4 Python tests passing
```

## 2. Populate the data (required before launch)

This must run on a host that can reach `epa.gov`, `waterqualitydata.us`,
`floridadep.gov`, `services.arcgis.com`, `seminolecountyfl.gov`,
`seminole.floridahealth.gov`, and `seminole.wateratlas.usf.edu`.

```bash
npm run sync:epa      # federal SDWIS / WQP / CCR  (large; ~500 MB archive)
npm run sync:local    # PFAS + private wells + telemetry
```

Or everything at once:

```bash
npm run sync:all
```

Individual stages:

```bash
npm run sync:pfas
npm run sync:private-wells
npm run sync:telemetry
```

### Endpoints used (all verified 2026-07-22)

Every stage now runs against a verified official endpoint with no operator
input required:

| Source | Endpoint |
| --- | --- |
| EPA UCMR 5 occurrence data | `epa.gov` UCMR 5 occurrence ZIP |
| Water Quality Portal (PFAS + 1,4-dioxane) | `waterqualitydata.us/data/Result/search`, county FIPS `US:12:117` |
| Florida DEP PFAS program | `floridadep.gov/water/source-drinking-water/content/and-polyfluoroalkyl-substances-pfas` |
| Seminole County 1,4-dioxane | `seminolecountyfl.gov/departments-services/utilities/utilities-engineering/dioxane` |
| SJRWMD wells and CUP | `services.arcgis.com/s8wtJX9suxFen6TA` FeatureServers |
| Seminole Water Atlas | `api.wateratlas.usf.edu` (`/DataMapper/Stations/All`, `/WQTrends/Stations`, `/rainfall/latest`) |

**Florida DEP PFAS.** DEP does not publish a single machine-readable PFAS
compliance feed. Under the federal NPDWR it manages PFAS monitoring records on
EPA's behalf while **EPA conducts formal enforcement**. The synchronizer
therefore verifies and records DEP's official program pages as references, and
the machine-readable PFAS results reach the application through UCMR 5 and the
Water Quality Portal. If DEP later publishes a compliance layer, pass it with
`--fdep-layer`.

**Seminole County 1,4-dioxane.** The county publishes results as linked PDF
data sheets rather than a dataset. `sync_private_wells.py` scans the official
county page and records every published 1,4-dioxane PDF, including the private
well data collected during the 2023-2024 County Water Quality Study. To load
tabular values, extract them from those PDFs and pass a CSV with
`--dioxane-url`. The script never invents rows.

Optional county ArcGIS layers (surface-water sites, pipeline and drainage
assets) can still be supplied if you want them; the Water Atlas rainfall
telemetry feed is used for weather stations by default.

```bash
python3 scripts/sync_telemetry.py \
  --surface-sites-url "<county surface-water monitoring sites layer>" \
  --gis-assets-url    "<county pipeline/drainage asset layer>"
```

## 3. Verify the caches actually filled

```bash
npm start
curl http://localhost:3000/api/local/status
curl http://localhost:3000/api/epa/status
```

Every `status` should read `synced`, and the counts should be non-zero. A
status of `error` means the fetch failed; read `errors[]` in the matching
`data/*/manifest.json`. A status of `synced-empty` means the source returned no
Seminole rows, which is worth investigating before launch.

Reload caches without restarting:

```bash
curl -X POST http://localhost:3000/api/local/reload
curl -X POST http://localhost:3000/api/epa/reload
```

## 4. Keep it current

Schedule these. UCMR 5 and SDWA are refreshed quarterly; the county telemetry
sources change far more often.

```cron
0 3 * * 1   cd /srv/seminole-water && npm run sync:local
0 4 1 * *   cd /srv/seminole-water && npm run sync:epa
```

## Production environment variables

```bash
RETAIN_INVESTIGATIONS=off        # do not store submitted addresses (default)
INVESTIGATION_RETENTION_DAYS=7   # if retention is on, prune after N days
RATE_MAX_LOOKUPS=20              # per client per minute
TRUST_PROXY=true                 # only behind a proxy that sets X-Forwarded-For
```

Schedule pruning if retention is enabled:

```cron
0 2 * * *  cd /srv/seminole-water && npm run prune:investigations
```

## Before you publish

This is a public-facing tool about drinking water, so a wrong answer has real
consequences for someone's health decisions. Recommended checks:

1. **Spot-check against the source.** Pick three addresses on different
   systems, and confirm the displayed values against the utility's published
   Consumer Confidence Report.
2. **Re-confirm the PFAS rule state.** `data/pfas/benchmarks.json` records the
   rule state as verified on **2026-07-22** and this is actively moving. As of
   that date: the April 2024 NPDWR **remains in force as written**; PFOA and
   PFOS stay at 4 ng/L; EPA's 18 May 2026 proposals would rescind the PFHxS,
   PFNA, HFPO-DA, and Hazard Index limits and extend the PFOA/PFOS compliance
   deadline from 2029 to 2031, and **neither proposal is final** (comment
   period closed 20 July 2026, Docket EPA-HQ-OW-2025-0654). The D.C. Circuit
   denied EPA's summary vacatur on 21 Jan 2026 and its motion to sever and stay
   on 23 Mar 2026. Initial monitoring is still due by **26 April 2027**.
   Re-check `epa.gov/sdwa/proposed-pfas-rescission-rule` before launch and
   update `regulatory_status` if a final rule has issued.
3. **Check a private-well address.** Confirm it does not display a neighbouring
   well's measurement as though it were that home's water.
4. **Confirm the un-synced state is honest.** Temporarily rename a cache file
   and reload; the panel must show the amber "Not loaded" state, never a clean
   result.
5. **Legal and liability review.** Have counsel review the disclaimers before
   launch. This is the item most likely to be underestimated: the application
   makes public-health-adjacent statements about named utilities, and the
   1,4-dioxane contamination in Lake Mary, Sanford, and Seminole County has
   already been the subject of investigative reporting and public dispute.
   Counsel should look specifically at how detections are worded, whether the
   tool could be read as advice not to drink the water, and the disclaimers
   attached to provisional Water Atlas data.
6. **Attribution and terms.** Confirm you are complying with the terms of each
   source, particularly the non-governmental EWG map, whose data is used as a
   cross-reference lead only.

## Interpretation rules built into the product

- System-level records are not a home faucet test.
- Non-detects are never treated as zero.
- Environmental monitoring near an address is context, not the household's water.
- A neighbouring private well describes that well, not the submitted address.
- Missing data is displayed as missing, never as clean.
- A single sample above a maximum contaminant level is reported as *above the
  benchmark*, not as a violation. EPA determines compliance from the running
  annual average at the sampling point, so the application only reports a
  compliance-relevant exceedance when at least four results exist in the
  trailing twelve months.
- 1,4-dioxane has no enforceable federal MCL. The 0.35 ug/L figure is a health
  advisory and cleanup target level, and is labelled as an action level rather
  than a regulatory limit.
- Near-real-time Water Atlas data have not passed the quality-control
  procedures applied to the Atlas's other datasets, and are labelled
  provisional.
