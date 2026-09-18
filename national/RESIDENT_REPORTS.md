# Resident address reports

The production home page accepts one complete address. Census resolves its state
and geographic hierarchy; residents no longer need source IDs, source-selection
controls, or an ingestion dashboard. The old structured API fields remain
supported for existing clients. A private-well choice stays optional and never
inherits public-utility results.

`resident.js` derives plain-language findings from the existing verified evidence
package. It preserves source, sample period, sampling setting, laboratory
non-detects, and provider identity. Educational comparisons use only explicitly
identified analytes, units, and system-monitoring samples. They are not legal
compliance calculations. Lead action levels and PFAS implementation dates are
not simplified into a blanket safe/unsafe score. Violation IDs are deduplicated
within each system, and historical enforcement is not converted to a current
advisory. Health explanations are reviewed source summaries, not invented
individual exposure probabilities.

`property.js` adds three bounded public-source checks:

- USGS monitoring-well locations, construction depth and recorded aquifer codes.
  These are nearby monitoring wells, not a complete domestic-well registry.
- EPA Superfund site locations within a five-kilometer search radius. No water
  flow or exposure pathway is inferred from proximity.
- NYC DEP service-line records. A normalized street-address match and a local
  geographic screen are both required; multiple tax lots remain ambiguous. The
  last recorded material and verification method do not certify current pipes.

Coordinates use explicitly requested WGS84 source output. All external endpoints
are fixed and redirects disabled. Each source has response and time limits;
failure in one source does not hide the other findings. Residential input is
neither persisted nor included in logs. The public API retains detailed evidence
for auditability; the resident page renders readable findings and source links.

Official contracts checked for this release:

- https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
- https://api.waterdata.usgs.gov/ogcapi/v1/collections/monitoring-locations
- https://geopub.epa.gov/arcgis/rest/services/EMEF/efpoints/MapServer/0
- https://data.cityofnewyork.us/Environment/Lead-Service-Line-Location-Coordinates/jqfp-uff7
- https://dev.socrata.com/docs/functions/intersects.html
- https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations
- https://www.cdc.gov/drinking-water/safety/guidelines-for-testing-well-water.html

The source-contract workflow uses public civic buildings only. This verifies
interoperability, not universal coverage or scientific accuracy at every home.
