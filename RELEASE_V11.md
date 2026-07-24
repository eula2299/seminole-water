# v11 Verification Frontier

Adds regulator-oracle reconciliation, final-report mutation testing, unit-typed concentrations, and small-system address resolution.

## SDWIS reconciliation
`lib/sdwis_reconciliation.js` diffs the engine's historical determinations against EPA SDWIS violation records by PWS, rule, contaminant, compliance period, and location. Every mismatch enters review; SDWIS-only disagreements are critical because the engine missed a regulator-recorded violation.

## End-to-end mutation testing
`lib/end_to_end_mutation.js` considers a mutation killed only when the final report is explicitly flagged/reviewed or remains exactly unchanged. Component routing does not count.

## Unit-typed core
`lib/typed_units.js` requires an analyte key and supported concentration unit. Conversions are explicit; different analytes cannot be compared or added.

## Small-system resolution
`lib/small_system_resolution.js` resolves mobile-home parks, master-metered complexes, and non-community systems using exact facility addresses, parcel IDs, property names, system types, and master-meter registries. It refuses near ties.
