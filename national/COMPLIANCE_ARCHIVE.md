# SDWIS compliance archive

`compliance_archive.py` acquires the official EPA ECHO SDWA ZIP and retains its
violation/enforcement table as text-preserving Parquet in the existing object
store. `WAREHOUSE_COMPLIANCE_ENABLED=true` enables a refresh after each EPA
occurrence archive cycle. The PostgreSQL capacity guard is unchanged.

The input host and file are fixed. Transfers, decoded table size, temporary disk,
DuckDB memory, shard size, cache size and response rows are bounded. The original
ZIP is retained with its checksum and retrieval time. All source rows remain in
Parquet; invalid system/event identities are counted and excluded from serving.
Blank values, leading zeros and original date strings remain intact. Official
code descriptions come from the reference table in the same acquired ZIP.

Enforcement can have no linked violation ID. Such rows remain available and have
a separate count. Distinct violation IDs exclude blank IDs; multiple enforcement
actions never become extra violations. Row counts are not contaminant samples,
independent observations, affected households or current advisories.

Parquet is partitioned by the first hexadecimal SHA-256 character of the complete
PWSID. Requests fetch at most one bounded shard, filter by the exact system ID,
and return at most 100 rows ordered by reported noncompliance start date. Source
fields and code descriptions are returned separately. A single query lock bounds
memory use; overload is explicitly unavailable. There is no nearest-provider
inference or household exposure calculation in this path.

Source artifacts and an immutable receipt are uploaded before switching the
active receipt under the warehouse publication lease. Failed publication leaves
the previous active snapshot readable. Restarts restore that active receipt.
The public status response reports this inventory as `compliance_archive`,
separate from occurrence and WQP counts. The per-system archive response includes
`compliance`; private-well routing does not use these public-system records.

The source is a quarterly federal snapshot with reporting limitations. Neither
an absent row nor a reported resolved violation proves current tap safety. Local
advisories still require the utility or responsible public-health authority.

Source and field definitions:
[EPA ECHO SDWA download dictionary](https://echo.epa.gov/tools/data-downloads/sdwa-download-summary).
