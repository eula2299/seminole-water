# Current drinking-water notices

The production address report retrieves the following reviewed sources alongside
historical monitoring. This is selected-source coverage, not nationwide clearance.

| Publisher | Matching | Active-status evidence | Limits |
| --- | --- | --- | --- |
| [Oregon Drinking Water Services](https://yourwater.oregon.gov/advisories.php) | Exact candidate PWSID, `OR41` plus the state's five-digit water-system number | State's active-advisory map and begin date | Map omits some partial advisories; a mapped provider does not verify a household connection |
| [Cleveland Water / Cleveland GIS](https://clevelandgis.maps.arcgis.com/apps/webappviewer/index.html?id=21d27b6876944aa1b6ac5d060d699fb8) | Publisher advisory polygon intersects a 30 m envelope around the estimated address | Start has passed; end is null or in the future | Envelope is an uncertainty screen, not a calibrated address error bound or verified household connection |

Oregon's official page links Experience Builder item
`93d74eeed43d47b9810383c0b0cf2226`, whose map item
`e60516ad3c5d4117b3c499daec8d8fc7` references advisory service item
`1047b2c8a8334b5a98d0ae02f99300d3` (OHA publisher). Cleveland's public
application references service item `50c244e387804e53b678ec51ce3d4400`,
published in the Cleveland GIS organization `dty2kHktVXHrqO8i`.

The Oregon connector preserves the affected population (including advisories
limited to vulnerable groups), affected area, reason, dates and original notice
link. Non-federal small-system records can appear in the source but are not
attached to an unrelated federal provider. Names and proximity are never used
to substitute a utility ID. Private-well reports do not inherit utility notices.

The UI puts notices before historical measurements, preserves boil-water,
do-not-drink and do-not-use distinctions, and links to the original instructions.
General action wording follows [CDC advisory guidance](https://www.cdc.gov/water-emergency/about/drinking-water-advisories-an-overview.html).
It never infers a current advisory from an SDWIS violation or a historical result.

## Freshness and failure behavior

Reads allow only fixed HTTPS source paths; redirects are rejected. Each request
has a seven-second timeout and 1.5 MB response cap, within the existing lookup
deadline. Explicit schema checks reject invalid IDs, dates, intervals, unknown
notice types, truncated results and upstream error payloads. Staff/contact
fields are not requested. Oregon's statewide response can be reused for one
minute, retaining the actual read time. Failed refreshes do not republish an old
cache entry as current. No household address is stored.

Publisher edit time and retrieval time are distinct. If the source edit time is
older than 48 hours, returned notices are labeled earlier publications whose
current status needs confirmation. The 48-hour threshold is an application
freshness policy, not a promise about the publisher's update schedule. Recent
publication also cannot eliminate reporting delay. No matching notice, failed
retrieval, absent coverage, and stale publication remain separate statuses.

`current_advisories_checked` means at least one configured source was read with
recent publication metadata. `advisories_comprehensive` and
`household_applies_verified` remain false. Never interpret these sources as
covering every US utility, all local notices, private wells, or premise plumbing.

## Verification

`node --test tests/national_advisories.test.js` checks chemical-notice guidance,
expired/future notices, private-well isolation, exact system identity, geographic
screening, stale metadata, refresh failure, transport restrictions and resident
report integration. The release source contract uses only public civic locations
and public utility identifiers; it exercises live source schemas without
requiring a particular advisory to exist.
