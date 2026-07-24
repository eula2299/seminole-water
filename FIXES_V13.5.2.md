# v13.5.2 — Service-area crosswalk coverage repair

This patch repairs the misleading `47/107` startup coverage report and the named-provider failures visible in the official 107-polygon layer.

## Fixed

- ArcGIS metadata fields such as `_official_item_id` are no longer treated as provider names.
- Polygons with no `WaterDistrict`/PWS label are reported separately as **blank or unassigned**, not as failed provider matches.
- Added a current Seminole County FDEP system registry and merged it with the bundled chemistry and synchronized SDWIS registries.
- Added aliases and normalization for abbreviated official layer labels:
  - Florida Governmental Utility Authority
  - Lake Harney Water Association
  - Mullet Lake Water Association
  - Palm Valley Association
  - Twelve Oaks Campground
  - Jansen
  - Phillips
  - Crystal Lake
  - Black Hammock
- Prevented contact-person/organization fields from becoming provider aliases. This fixes the false Winter Springs vs. Dovera conflict.
- Canonically equivalent aliases are treated as corroborating evidence rather than competing providers.
- FGUA is correctly represented as a multi-system provider in Seminole County:
  - Chuluota Water System — PWS 3590186
  - Harmony Homes — PWS 3590497
- During an address lookup, an FGUA provider-level match is narrowed only when the address city uniquely matches one registered system locality. Startup auditing remains honest and leaves the generic FGUA polygon provider-level.
- Added explicit tests for every named failure shown by the real-layer audit.

## Expected startup report

The 107 polygons include polygons that carry no public-water provider label. Those are now excluded from the named-provider failure denominator. The server reports:

- total polygons
- named-provider polygons
- blank/unassigned polygons
- named providers resolved
- unique-PWS matches
- provider-level multi-PWS matches
- genuinely unresolved named providers

Use `http://localhost:3000/api/crosswalk-coverage` for the full JSON audit.

## Validation

`npm run test:all` passes 116/116 tests.
