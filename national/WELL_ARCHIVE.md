# State well-completion archive

`WAREHOUSE_WELLS_ENABLED=true` enables durable acquisition of reviewed USGS
National Water-Well Database state components. Currently published, verified
components in this integration are Louisiana, Michigan and Minnesota. The USGS
collection is not a complete registry of every US private well.

Each acquisition retains the official GeoPackage, data dictionary and catalogue
metadata. It checks publisher byte counts and MD5 checksums, records independent
SHA-256 hashes, verifies the data dictionary's WGS84 coordinate and feet-depth
contracts, and creates a compact indexed serving database. Missing coordinates
and invalid depths remain distinct from zero. Duplicate well identities prevent
publication. Original files remain available for audit even when records cannot
be mapped.

Version 2 stores well attributes in typed SQLite columns instead of repeating
JSON field names and generated display labels for every record. It keeps the
256 MB per-state index limit. Legacy indexes remain readable during migration;
version 2 artifacts use separate object keys so a failed upgrade cannot overwrite
the active index.

The existing object-store publication lease and capacity accounting apply.
Uploads complete before the per-state receipt changes, so a failed refresh
preserves the prior active inventory. One state is acquired per worker step,
alternating with environmental acquisition. Metadata is checked weekly, with
bounded retries after errors. Unchanged publisher checksums skip re-download.

The private `/wells/near` route returns at most 20 acquired well records in a
five-kilometer geographic search. It reports source dates, distance, depth and
aquifer information. Neither point proximity nor a shared aquifer name identifies
the resident's well or measures its chemistry. Counts are well identities,
separate from occurrence and compliance source rows.

Source collection:
https://www.sciencebase.gov/catalog/item/61b897c9d34e9e224ac120de

This integration does not add construction dates where a well table omits them,
infer groundwater flow, generate unvalidated predictions, or claim current
household safety. Original source geometry and ancillary tables are retained in
the GeoPackage for later validated processing.
