# Seminole Water God-Mode v13 — Probabilistic Accuracy

This release adds guarded probabilistic and geochemical accuracy layers.

## Integrated into address reports
- Empirical-Bayes hierarchical partial pooling for sparse comparable groups, with shrinkage and 95% credible intervals. Borrowed-strength estimates are never compliance determinations.
- Chloride-to-sulfate mass ratio, Langelier saturation index, and a CCPP proxy, labeled as inferred corrosion potential.
- Address-level service-line material posterior combining parcel era, neighborhood inventory rates, and corrosivity interaction. It never predicts a lead concentration.
- Penalized change-point detection on analyte histories.
- Digit-preference screening as a non-accusatory quality-control signal.

## Available modules for importer/report activation
- Interval-censored CCR summary likelihoods.
- Ion charge-balance quality control.
- Covariance-based hydraulic-topology inference.
- Generalized-Pareto tail screening.
- Rainfall-lag residualization.
- Aquifer/depth-aware private-well screening surfaces with uncertainty.

## Guardrails
Inferred values cannot replace rule-required samples, trigger a regulatory violation by themselves, or be described as measured household concentrations. Sparse or missing covariates return insufficient-data states.

## Verification
52 automated tests pass, including all 44 prior tests and 8 new probabilistic/geochemical tests.
