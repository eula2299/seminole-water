# v13.3 Resolver and Runtime Repair

This build fixes the address-resolution blocker in the actual application.

## Fixed

- Added a schema-discovering polygon → provider → PWS crosswalk.
- Added safe exact matching for Seminole County Northeast, Southeast, Southwest and Northwest.
- Prevented an undifferentiated county provider from being falsely assigned to one quadrant.
- Kept small-system names distinct, including Lake Mary MHP versus the City of Lake Mary.
- Expanded the runtime registry from 25 to all 59 PWS IDs present in the official record bank.
- Wired the 4,338-row all-contaminant dataset into the report engine instead of the 246-row metals extract.
- Normalized FDEP dates before sorting and report generation.
- Added automatic official service-area caching and a direct official-layer fallback URL.
- Added live service-area fallback when the local GeoJSON is absent.
- Added crosswalk coverage, service-area diagnostics and a manual sync endpoint.
- Bounded optional live-web calls so they cannot hold the lookup open indefinitely.
- Fixed the frontend matched-address path and changed metals-only labels to all contaminants.
- Fixed polygon-hole handling in point-in-polygon checks.

## Validation

```text
81 tests passed
52 original tests
29 crosswalk/integration tests
```

The real 107-feature ArcGIS layer is downloaded on the user's machine because this build environment cannot reach the public ArcGIS host. The app reports the exact real-data coverage after that sync.
