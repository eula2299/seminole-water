# v13.5.3 — Final named service-area mappings

This patch resolves the last two named provider labels in the official Seminole County service-area layer:

- `SER` → Seminole County Southeast, PWS `3590571`
- `LAKE HARRIET` → Seminole County Southwest, PWS `3590785`

`SER` is the county's Southeast Regional water treatment/service area. County capital-program records identify the Southeast Regional plant as the SER facility. Lake Harriet's former standalone service area was connected to and incorporated into the Southwest system, with the former treatment plant slated for decommissioning.

The patch adds exact authoritative aliases only. It does not use broad fuzzy matching and does not change blank/unassigned polygon handling.
