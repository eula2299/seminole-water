# EPA Six-Year Review 2 historical records

The occurrence warehouse includes the six official EPA SYR2 archives for
1998–2005. The nitrate source is the corrected file identified by EPA. The
source catalogue and its inventory/chemistry dictionary are at:

https://www.epa.gov/dwsixyearreview/six-year-review-2-contaminant-occurrence-data-1998-2005

The six published ZIPs contain 69 Access databases. Each has one chemical table
whose name supplies the chemical name and four-digit SDWIS code. Discovery
accepts only these six reviewed filenames. Ingestion retains the original ZIP,
records its SHA-256, and converts table values using the open-source MDB Tools
reader. Stored Access queries and macros are not executed. Child output bytes,
stderr, execution time and memory are bounded; the production image installs
MDB Tools before dropping to its unprivileged application user.

For every table, `mdb-count` must equal the parsed export count before any
publication. Chemical code, PWSID, calendar date, unit, detection qualifier and
numeric value are checked. A mismatch or missing measurement remains in retained
raw records and is excluded from numerical summaries. `DETECT=0` means a less-than
result at the reported value; it is not a measured zero. `DETECT=1` identifies a
detected value. Original table field values remain in Parquet alongside the
normalized fields. Exact duplicate rows within each table are counted once.

The system's groundwater/surface-water source type does not establish whether a
particular sample was collected before or after treatment. These records retain
`system-sampling-context-unspecified` and are not used as household samples or
automated legal-compliance determinations. Collection dates remain prominent in
resident reports; a historical result cannot establish current tap chemistry.

Publication uses the existing immutable object keys, storage budget, conditional
publication lease and atomic receipt pointer. Counts are actual retained source
rows, with eligible rows reported separately. Cross-program records are not
asserted to be independent samples.

The release contract test downloads the corrected nitrate database and verifies
its full export and parser counts. Deterministic tests cover quoted table fields,
zero versus nondetect, invalid codes/dates/units, count mismatch, subprocess budgets
and failure cleanup. The same importer handles all six reviewed source files.
