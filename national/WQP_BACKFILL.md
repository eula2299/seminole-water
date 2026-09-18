# WQP environmental acquisition

`wqp_backfill.py` acquires actual WQP result rows into a persistent directory.
It uses the current **WQX3** physical/chemical contract, preserves source values
and qualifiers, and records actual imported row counts. It never promotes
ambient observations to household drinking-water samples.

The provider's physical/chemical profiles are not the complete collection of
all WQP biological and supplemental metadata profiles. A state/date plan also
cannot find records with absent or incorrect state/date metadata. A completed
plan is therefore acquisition of its explicit filters, not a nationwide safety
or completeness certification.

## Run on persistent storage

Python 3.10+ and the standard library are sufficient. Run separately from the
Node web service. Choose a persistent volume with enough free space for raw
archives, normalized rows, and temporary files. JSONL is streaming and keeps
memory bounded; at national scale compact the completed files to Parquet or a
columnar store in a separate, measured import job. No object store or production
worker is provisioned by this command.

```sh
python national/wqp_backfill.py plan \
  --output /data/wqp/plan-1900-2026.json \
  --start 1900-01-01 --end 2026-09-17

python national/wqp_backfill.py run \
  --plan /data/wqp/plan-1900-2026.json \
  --output /data/wqp/snapshot-2026-09-17 \
  --max-partitions 20
```

The first command writes an explicit manifest covering all 50 states, DC, and
five inhabited territories. The start/end dates are chosen scope, not a claim
about the first or latest available source record. Earlier historic intervals
may be requested back to 1800. The supplied `wqp_backfill_national.json` is a
reviewable nationwide acquisition specification with an explicit date window;
the `plan` command expands those parameters into the checksummed job manifest.

Repeat the second command from a scheduler until `status.json` reports
`all_planned_partitions_acquired: true`; inspect failures instead of interpreting
them as empty data. Each invocation processes at most `--max-partitions` (default
1). Limits default to 256 MiB downloaded per response, 1 GiB decoded, and one
million result rows per partition. Four transfer attempts are permitted by the
default `--retries 3`. Every transfer is bounded, including failed attempts.
The worker is serial and an exclusive filesystem lock prevents duplicate
workers on one output root. Use disjoint state plans and separate roots for
independent workers; coordinate source request rates outside this script.

Oversized state/year partitions automatically split into contiguous date
intervals. A one-day partition that still exceeds a budget remains failed and
requires a reviewed higher budget or a future county/organization subdivision.
Rows are not truncated to fit a budget. No partial partition is published.

## Output and restart semantics

* `plan.json`: immutable plan identity for the output root.
* `checkpoint.sqlite`: job status, attempts, errors, and completed row counts.
* `raw/<sha256>.bin`: original source CSV/ZIP bytes addressed by content hash.
* `environmental/<partition-id>/`: atomic completed JSONL partitions plus source
  URL, retrieval time, source headers, raw checksum, row counts, and output hashes.
* `status.json`: actual completed row totals and outstanding/split/failed jobs.

Successfully completed jobs are skipped on resume. If the process dies between
publishing a partition and committing its checkpoint, resume verifies checksums
and recovers the existing partition without downloading or counting it twice.
Raw bytes from an unsuccessful parse may remain for investigation. Responses
with warnings, HTML, missing columns, malformed rows, out-of-range dates, or a
declared row count that differs from the parsed count are not published.
WQX3 does not always return a total count header; the manifest records its absence.
Identical result rows are retained and reported as **rows**, not unique samples.
Different snapshots must not be summed as independent observations.

The normalized schema keeps detection conditions, qualifiers, original units,
sample fraction, analytical method, and source coordinate datum. It does not
convert nondetects into zero, assert WGS84 for an unconverted coordinate, assign
a utility PWSID, or infer a kitchen-sink contaminant concentration.

Historic source records can change. Use a new output root for a refreshed
snapshot and publish it only after downstream validation. A current-date plan
does not implement change-data capture; an operator must schedule refreshed
windows. Data ingestion does not by itself connect an address to a utility or
validate a prediction model.

## Verified source contract

The current endpoint and profile names are documented by USGS:

* https://doi-usgs.github.io/dataRetrieval/reference/readWQPdata.html
* https://www.waterqualitydata.us/webservices_documentation/
* https://waterdata.usgs.gov/blog/wqx3/

WQX2.2 `/data/Result/search` excludes USGS records collected/analyzed or modified
after March 11, 2024. This worker deliberately uses `/wqx3/Result/search` with
`fullPhysChem` by default. Column changes cause explicit failures, not silent
fallback to the older schema. Endpoint availability still depends on the provider.

Run the unit tests with:

```sh
python -m unittest discover -s tests -p test_national_wqp.py -v
```

A bounded live contract check can use a single known monitoring location:

```sh
python national/wqp_backfill.py plan \
  --output /data/wqp/site-contract.json --states MN \
  --start 2020-01-01 --end 2020-01-31 --site-id USGS-05288705
python national/wqp_backfill.py run \
  --plan /data/wqp/site-contract.json --output /data/wqp/site-contract \
  --max-response-bytes 10000000 --max-decoded-bytes 40000000 --max-rows 10000
```
