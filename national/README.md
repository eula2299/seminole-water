# National water evidence

The national interface is integrated with `platform.js` at `/`, `/national`, and
`/api/national/*`. Existing Seminole analysis is available at `/seminole`;
accounts and community endpoints retain their original routes.

## Address and evidence flow

1. Validate a US state/territory and address, or a complete nine-character PWSID.
2. Geocode through Census, retaining address-range interpolation uncertainty.
3. Query the EPA service-area layer and a 30 m ambiguity screen. Preserve
   overlapping candidates and modeled-boundary provenance; do not assert a
   household connection from polygon membership.
4. Retrieve bounded ECHO records and indexed national warehouse records for
   at most four candidates. A selected PWSID is explicitly user-selected.
5. Display historical utility observations with sample dates, units, qualifiers,
   reporting limits, source references and per-contaminant summaries. Household
   samples, current advisories and environmental observations remain distinct.

Private-well requests do not borrow public-system results. They explain the
missing household evidence and provide official testing and laboratory resources.
An upstream failure remains unavailable, never a safe or zero-result finding.

[Current notices](ADVISORIES.md) from Oregon Drinking Water Services and Cleveland
Water are checked when their matching rules apply and appear before historical
measurements. Their coverage and freshness remain explicit; other local
advisory sources still need integration.

## Persistent source ingestion

`national/sync.js` downloads official whole-cycle EPA UCMR5 occurrence data and
the SDWIS national system directory into PostgreSQL. Full violation/enforcement
history is served from the separate object-store compliance archive because it
has different scale, meaning and storage requirements. A duplicate PostgreSQL
violation snapshot is compatibility-only and is disabled by default. Sources are
discovered/allowlisted, downloaded with byte limits, SHA-256 hashed,
and parsed incrementally by `stream_archive.py` with backpressure. Complete
PWSIDs, sample identity, dates, chemistry units and non-detection limits are
retained. Duplicate sample keys do not inflate unique-observation counts.

The existing PostgreSQL connection (`DATABASE_URL`) holds an isolated
`national_water` schema. No household addresses are persisted in this schema.
Imports acquire an advisory lock and stage records invisibly. Publication
atomically switches a source pointer after validation. Failed imports leave the
previous source active. The status endpoint reports counts from active imports
and the latest attempt, with source timestamps and archive hashes.

A persisted database-capacity failure is checked before the next automatic
download. PostgreSQL imports remain paused while allocated database bytes meet the
configured ceiling and resume when capacity is available. Existing published
evidence remains readable; object-store acquisition uses its own budget.

The [SDWIS compliance archive](COMPLIANCE_ARCHIVE.md) is the default national
violation/enforcement store. It supports complete source-file retention and
bounded exact-PWSID reads in object storage. Its counts remain separate from
drinking-water observations. Set `NATIONAL_POSTGRES_VIOLATIONS_ENABLED=true`
only when an additional duplicate PostgreSQL snapshot is intentionally required.

The application checks for source refreshes on startup and hourly; sources
checked within seven days are skipped. `NATIONAL_SYNC_ENABLED=false` disables
background imports. `NATIONAL_MAX_DATABASE_BYTES` defaults to 3,000,000,000 to
reserve space on the current small database volume; a capacity failure must
remain visible and must not be represented as a complete import. This limit is
an operational guard, not a claim of billion-row storage or performance.

```sh
npm ci --ignore-scripts
npm start
npm run sync:national
node national/sync.js --source ucmr5
node national/sync.js --source sdwis
NATIONAL_POSTGRES_VIOLATIONS_ENABLED=true node national/sync.js --source all
# or explicitly, for a compatibility snapshot only:
node national/sync.js --source sdwis-violations
```

The Docker image includes Node 22 and Python 3. Local startup without a database
serves address/ECHO retrieval while explicitly reporting the warehouse as
unconfigured. Production requires a working PostgreSQL connection and enough
storage for the requested import; authentication continues using its separate
existing tables.

## Historical federal archive

`NATIONAL_ARCHIVE_URL` connects the gateway to the private historical EPA
warehouse. UCMR and Six-Year Review archives retain source records and provenance
in object storage with per-system summaries. This count is displayed separately
from PostgreSQL observations because UCMR5 overlaps; totals are never added.
Only corrected schema version 2 summaries are eligible for display. Records with
invalid dates, unidentified units, or unqualified values are excluded from
numerical summaries, while raw source records remain auditable. Source-water
summaries remain distinct from system monitoring and household evidence.

The [SYR2 Access importer](SYR2_ARCHIVE.md) also acquires the six EPA archives
covering 1998–2005, including the publisher's corrected nitrate database. Export
counts must match original table counts before publication.

`national/warehouse.Dockerfile` builds that separate service. It requires
AWS_S3_BUCKET_NAME, AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
and AWS_DEFAULT_REGION supplied as service variables. No credentials belong in
the repository. Stored byte budgets include old and unfinished uploads.

## Environmental archive

`wqp_backfill.py` supports WQP WQX3 state/year acquisition, bounded downloads,
adaptive date splitting, restartable checkpoints and immutable raw checksums.
See `WQP_BACKFILL.md`. Its output is environmental evidence, not drinking-water
or household measurements. The national partition manifest is a work plan,
not an imported-record count. It requires durable storage and downstream serving
before those records can be counted as available to this application.

## Verification

```sh
npm run test:all
npm run test:national
python3 -m unittest discover -s tests -p 'test_national*.py'
```

GitHub Actions runs the national warehouse tests against real PostgreSQL using
`TEST_DATABASE_URL`, in addition to fixture, HTTP gateway, chemistry, streaming,
source-contract and browser-client tests. Tests with synthetic inputs establish
implementation behavior; they are not nationwide scientific validation.

## Outstanding requirements

The requested hundreds-of-millions/billions of observations and universal
household coverage are not achieved merely by this integration. Check
`/api/national/status` for actual stored counts and source outcomes. Nationwide
property/well/service-line inventories, comprehensive current advisory coverage,
household laboratory evidence, validated prediction models and a billion-row
performance test remain outstanding. No fabricated predictions, concentrations,
health percentages or blanket safety guarantees are generated.
