# v12 Research Accuracy Layer

This release adds seven formal research-grade modules:

1. **Bitemporal compliance:** evaluates data-as-of, regulation-as-of, and transaction-as-of separately; supports verdict diffs across rule versions.
2. **Enforcement-oracle method:** classifies SDWIS disagreements as engine bug, regulator lag/miss, temporal mismatch, or data gap, always requiring adjudication.
3. **Empirical evidence half-life:** fits lagged temporal autocorrelation by analyte and hydrogeologic/system stratum and converts it into a measured freshness decay.
4. **Effective independence:** replaces publisher count with unique originating-sample effective N and a confidence multiplier.
5. **Verdict-flip acquisition scheduling:** ranks government source pulls by probability of changing the verdict, severity impact, freshness, coverage, and acquisition cost.
6. **Hydraulic admissibility:** requires a time-valid path from sampling point to service zone and weights evidence by path certainty.
7. **Composite strategic-sampling index:** combines MCL/MDL bunching, censoring drift, peer-lab divergence, and protocol shifts as a review signal, never as proof of intent.

API: `/api/research-layers` exposes the configured rule versions, acquisition candidates, and enabled modules.
