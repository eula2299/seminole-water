# Utility sampling prediction evaluation

Run `python -m pip install -r national/benchmark-requirements.txt` and `python -m national.prediction_benchmark` from the repository root. This downloads only the official whole-cycle UCMR5 archive, hashes it, verifies sampling identity, and saves a machine-readable evaluation and fitted parameters. The existing production application does not import this module or use its predictions.

The endpoint is reported PFOA/PFOS detection in the next observed sampling round at a previously sampled utility location. Within a sampling point/analyte/method/unit, same-day results are one round and a round is positive when any reported sample was detected. Nondetects are binary detection labels, not imputed zero concentrations. The first observed round cannot generate a forecast example. Dates and outcomes from the target round never enter its feature vector.

Before examining holdout scores, the design fixes training targets before January 1, 2025 in non-holdout states and test targets from that date onward in AK, AR, CA, CT, FL, IL, ME, MO, NV, NY, OR, TX, WI. No utility crosses the training/test boundary. Earlier observed rounds at held-out sites are permitted as lagged features for later one-step predictions. Parameters and standardization are fitted only to training data. No holdout tuning is performed. The archive contains retrospectively corrected records, not an as-of historical information set.

The logistic model is compared with training prevalence, the previous observed round, and the prior-round average. The report includes Brier error, ROC area, average precision, threshold-specific precision/recall, calibration bins, and 200 utility-cluster bootstrap replicates for improvement over last-observation prediction. Repeated records are not treated as independent households in the uncertainty calculation. Source counts, exclusions, dates, library versions, and feature digest are retained.

This benchmark cannot validate household concentrations, current drinking-water safety, private-well chemistry, or nationwide predictions for untested homes. Passing executable tests means the stated evaluation ran; it does not certify scientific or clinical suitability. Production household inference remains disabled. A prospective external validation and a source/target population that matches the intended application are still required for that separate use.

Source: https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule
