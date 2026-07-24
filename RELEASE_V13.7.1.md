# v13.7.1 — Simplified Public Interface

This release keeps the complete v13.7 analytical backend but replaces the main browser page with a plain-language public report.

## Main-page changes

- Shows only the matched water system, a simple overall message, active compliance items, and contaminant results.
- Separates detected substances from zero/non-detect results.
- Hides agent logs, crosswalk internals, evidence provenance, causal-conformal calculations, source lists, and backend diagnostics from the main page.
- Moves optional system confirmation, household size, and public-notice search into a collapsed “More options” section.
- Removes developer and diagnostic links from the public footer.
- Retains a short warning that system-level records are not a home faucet test.

All analytical modules and API response fields remain available to the backend and are not deleted.
