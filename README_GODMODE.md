# v9 God-Mode Accuracy Layer

This release fixes the major ways an address-level water report could become confidently wrong.

## Critical rules

1. **Originating-sample independence:** DEP, SDWIS/ECHO and a CCR may republish one laboratory sample. They count as one origin. Confirmation requires a distinct sample event/accession, not a second publisher.
2. **Household vs system:** System records never become household concentrations. Lead risk uses service-line inventory and parcel plumbing era only as a testing-priority indicator.
3. **Expanded scope:** The agent fleet now covers metals, PFAS, nitrate/nitrite, DBPs, radionuclides, microbial indicators, corrosion chemistry and selected VOC/SVOCs.
4. **Community quarantine:** HOA/social/community content can trigger follow-up but can never corroborate a laboratory result.
5. **Reproducibility:** Reports carry a data/config/code/model snapshot manifest. LLM use is disabled by default and must be version-pinned.
6. **Adversarial and human review:** A separate reviewer challenges synthesis. High-severity or heavily contradicted reports enter a human-review queue.
7. **Statistics:** Non-detects remain censored; half-DL substitution is prohibited. Mann-Kendall and Benjamini-Hochberg/FDR scaffolding is included.
8. **Private wells:** No-PWS addresses branch into a private-well pathway rather than dead-ending. Context indicators are never called measurements.
9. **Canaries and golden cases:** Source-format canaries and a regression-case harness are installed.
10. **Actionability:** Treatment guidance is mapped only to contaminant-specific NSF/ANSI certification categories and explicitly avoids medical claims.

## Important data reality

The code and data models are implemented. Some new datasets (service-line inventories, PFAS/radionuclide/microbial imports, private-well permits, reviewed golden cases and current regulatory benchmark rows) start empty and must be populated by their official-source importers before the UI may claim those data are available. Empty sources are surfaced as missing coverage, not fabricated.

## v10 compliance and accuracy frontier

This release replaces single-sample threshold comparisons with rule-specific evaluators: Lead/Copper 90th percentile action-level logic, Stage 2 DBP location-specific running annual averages, radionuclide entry-point running annual averages, nitrate confirmation-sample logic, and RTCR occurrence/assessment semantics. Compliance claims are blocked when the required location, window, confirmation, protocol, or sample count is missing.

The bundled FDEP workbook is now imported as an all-contaminant bank rather than a metals-only extract: 4,338 Seminole County records spanning DBPs, water-quality parameters, inorganics, secondary contaminants, VOCs, radionuclides, and synthetic organics. Records retain laboratory, method, location, sample design, detection limits and sample IDs.

Coverage confidence is schedule-aware and capped by received/expected monitoring, waivers, source freshness and hydraulic/spatial applicability. The statistical layer implements regression-on-order-statistics for left-censored values, seasonal Kendall trend analysis, and Benjamini-Hochberg FDR control. It never treats non-detects as zero or automatically substitutes half the detection limit.

The method-aware analyte registry keys special analytes by CAS/sum definition and approved method families. Hydraulic graph, service-line, private-well, USGS NWIS, ambient-groundwater and SDWIS importers are prioritized in `data/importer_catalog.json`. Live imports must be snapshot-pinned before use.

Robustness controls include physical plausibility quarantine, OCR decimal-shift detection, mutation testing, golden/temporal case support, deterministic report replay, confidence calibration bins, adversarial disagreement/overturn metrics and scraper canaries.

## v13.6 negotiated accuracy and counterfactual validation

The final synthesis is now produced through an auditable dialectical council. Each agent submits a structured claim with provenance, scope, confidence, and originating-sample keys. Supporting and opposing arguments are weighted by a transparent reliability ledger; repeated republications of one sample receive one origin vote. Hard scope guards veto unsupported household-concentration claims. The council may return `undecided` rather than invent certainty.

The provider assignment is stress-tested by coordinate perturbation at 5, 15, and 30 meters. A separate uncertainty budget reports system-evidence confidence and household-exposure confidence, and a robustness certificate records exactly which checks passed.
