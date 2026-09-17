# National expansion: implementation and release status

## Status — September 17, 2026

This branch is **not the finished USA-wide product requested**. It contains working, isolated components for national evidence retrieval and raw-data ingestion. It does not replace the existing Seminole application, modify the production start command, or provision new infrastructure. Do not deploy it as a completed national replacement.

The distinction is explicit in the API and interface: national address-format support is not proof of national measurement coverage. An unavailable or unmapped result is not evidence of safe water. There are **zero national observations ingested into this new serving layer**; this count excludes the existing county dataset and external publishers' catalogs.

## Implemented

`evidence.js` preserves complete federal PWSIDs and leading zeros; validates input, sample dates, units, chemical basis, medium and QA; keeps nondetects and reporting limits separate from measured concentrations; retains boundary provenance and multiple provider candidates; refuses to treat unrecognized source schemas as empty-success responses.

`service.js` connects the Census geocoder, the EPA national service-area feature layer, and ECHO drinking-water-system endpoints through bounded, allowlisted HTTPS requests. It supports a user-selected full PWSID even if address geocoding fails. System information remains system-level. Private wells never inherit a nearby utility's findings. Every executed retrieval stage has status, retrieval time and an error code when unavailable. The service neither creates household chemistry nor runs a predictive model.

`server.js` exposes an isolated browser interface and JSON API. It uses safe text rendering, no-store responses, same-origin checks, request/response limits, per-process rate/concurrency limits and source deadlines. It does not persist addresses or call an LLM. Addresses are necessarily transmitted to Census and coordinates to EPA when those lookups are requested. Infrastructure-level logging and privacy must also be reviewed before deployment.

`ingest.py` streams already-downloaded official CSV/TSV/TXT/ZIP inputs into immutable Parquet/Zstandard partitions or JSONL for troubleshooting. Both row and raw-payload-byte limits bound a batch. It records original strings, provenance, source-file/partition hashes and atomic run manifests. It never extracts ZIP member paths onto the filesystem or publishes a partially failed run as successful. It stages raw rows only; it does not download a national archive, resolve canonical sample identities, populate the serving API or certify source completeness.

## Verification actually performed locally

- `node --test tests/national_*.test.js`: **70 passed, 0 failed**.
- `python -m unittest discover -s tests -p 'test_national_ingest.py' -v`: **12 passed, 1 skipped**.
- The skipped test is the Parquet round-trip because PyArrow is not installed in the local execution environment. JSONL/ZIP behavior was tested.
- These tests use clearly synthetic fixtures and prove implementation behavior, not empirical national accuracy.
- Full existing-application regression tests have not been run locally. Existing source files and startup configuration are unchanged.
- Live-source interoperability, a real national bulk import, load/availability benchmarks, model training and production rollout have **not been verified or completed**.

## Running the isolated service

Requires Node 22 or a compatible newer release. No new Node package dependency is required.

```sh
node --test tests/national_*.test.js
node national/server.js
```

The default port is 3001; `NATIONAL_PORT` overrides it. Routes are `/national`, `POST /api/national/lookup`, `GET /api/national/status`, and `/healthz`. The health endpoint describes process liveness, not evidence readiness. Run this separately from production; it is not wired into the existing `platform.js` route table.

Example request body using a public-system ID rather than a household address:

```json
{"state":"NY","pwsid":"NY7003493","supply_type":"public"}
```

For an address request use `street`, `city` or `zip`, `state`, and optionally `pwsid` and `supply_type`. All 50 state codes, DC and AS/GU/MP/PR/VI are accepted. This does not guarantee Census coverage of every address format, urbanization, rural route or territory. The 30-meter nearby-boundary screen is a limited ambiguity screen, not a calibrated positional-error bound or verified household connection.

## Running the raw importer

Install the Parquet dependency and use a source file obtained through a reviewed ingestion job:

```sh
python -m pip install -r national/requirements.txt
python national/ingest.py --input /data/SDWA_latest_downloads.zip \
  --output /data/national/raw --source-id epa-sdwis \
  --source-url https://echo.epa.gov/files/echodownloads/SDWA_latest_downloads.zip
```

Use `--format jsonl` only for testing/troubleshooting. `--required-column` may be repeated for source-specific schema checks. WQP source profiles and UCMR member/column formats must be separately verified before canonical publication. The importer infers tab separators for TXT/TSV; a source with another delimiter needs an explicit adapter, not a silent guess.

The per-job byte/row budgets protect workers; they are not a cap on total collection size. A real national backfill needs partition manifests, scheduling, retries, checkpoints, persistent storage, licenses/access checks, source freshness validation and actual cost controls. No recurring or paid backfill is created by this branch.

## Production design and acceptance gates — not yet implemented

The requested hundreds-of-millions-to-billions data target is **unmet**, not reduced. Keep counts of source records, canonical observations, independent sampling events, image pixels, and households separate. Duplicating observations, counting document tokens or reclassifying predictions as measurements must not be used to reach a volume target.

The intended architecture is the existing Node web stack with typed evidence contracts; Python ingestion and geospatial/ML workers; S3-compatible immutable objects with Parquet/Iceberg tables; PostgreSQL/PostGIS for dated system boundaries, property connections and provenance; an analytical store such as ClickHouse for observation histories; and versioned materialized evidence bundles for request-time serving. These services and schemas are not provisioned by this branch. Keep ingestion and remote-source discovery outside the ordinary address request. A durable batch orchestrator comes before Kafka/Flink unless measured source throughput actually requires streaming infrastructure. Population is not simultaneous traffic; actual traffic and dataset benchmarks determine sizing.

Before a national release, complete and verify:

1. **Canonical national evidence.** Federal occurrence/compliance data, state laboratory records, reviewed CCR extraction, utility advisories, local lead-line inventories and well records. Preserve sample identity, collection time, source publication/retrieval time, location/medium, sample fraction, units and chemical basis, detection limits, QA, revision history and origin lineage. Deduplicate republished samples rather than giving each agency copy a separate vote.
2. **Address-to-service applicability.** Versioned authoritative and modeled service areas, private wells inside utility polygons, boundary ambiguity, wholesalers/consecutive systems, seasonal supplies, cross-state and tribal systems, and user-confirmed utility IDs. A parcel, city, ZIP or building footprint alone does not establish the actual pipe connection. Add a consent-protected household-laboratory workflow for true household evidence.
3. **Rules and current notices.** Reviewed federal/state/local rule versions with effective dates, sample scope and statistical requirements. Do not infer a legal violation from a single numerical comparison or treat a missing advisory feed as no advisory.
4. **Model validation.** No national models are trained here. Proposed lead-line models are calibrated gradient-boosted classifiers trained on verified material labels; proposed private-well models are contaminant/aquifer/depth-specific susceptibility models compared against simpler geostatistical baselines. Require held-out regions, utilities and times, calibration, subgroup checks, drift monitoring and abstention. A GNN needs defensible hydraulic connectivity and independent validation; it cannot manufacture a household test.
5. **Bounded evidence agents.** Deterministic address/provider, retrieval, units/provenance, rules/advisories and well-context stages. An optional language model may explain a verified claim bundle, but cannot set provider assignments, chemistry, safety thresholds, compliance or exposure-risk percentages. Exact identifier/date/unit joins belong in structured queries, not vector similarity. Untrusted source documents cannot change tool permissions.
6. **Measured operations.** Actual national records acquired and reconciled, coverage by geography/supply/analyte/date, capacity/load tests at the intended row tiers, worker restart/replay tests, backups and restore, authenticated access controls, privacy review, source-failure monitoring, whole-application regressions, production integration and rollback. Do not interpret a passing fixture suite as a nationwide accuracy certificate.

Satellite and ambient telemetry may add useful source-water context, but remain separate from finished drinking-water samples. Historical sensor catalog size is not the number of currently active chemistry sensors, and satellite pixel counts are not independent household measurements.

## Primary source references

- EPA national service areas and limitations: https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas
- Census geocoding: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
- SDWIS table identities and quarterly data: https://echo.epa.gov/tools/data-downloads/sdwa-download-summary
- ECHO drinking-water web services: https://echo.epa.gov/tools/web-services/facility-search-drinking-water
- UCMR occurrence: https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule
- WQP: https://www.epa.gov/waterdata/water-quality-data-download
- WQP current-profile documentation: https://www.waterqualitydata.us/beta/webservices_documentation/
- USGS API v1 announcement: https://waterdata.usgs.gov/blog/api-v1-release/
- Private-well evidence limits: https://www.cdc.gov/drinking-water/safety/guidelines-for-testing-well-water.html

EPA's page currently describes more than 430 million WQP result records. That is the publisher's inventory, not this project's imported count, and it is not a count of tested household taps. The final product must make those distinctions visible.
