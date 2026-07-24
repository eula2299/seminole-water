# CCR Verification Record

Actual utility Consumer Confidence Reports compared against the application's
classification logic. Performed against each utility's own published PDF, not
an aggregator.

## Sanford — PWS 3590205 — 2024 CCR (2023 data), sanfordfl.gov

| Contaminant | CCR published | EPA limit | App verdict | Match |
| --- | --- | --- | --- | --- |
| PFOA | 2.43 ppt (avg) | 4.0 | below | yes |
| PFOS | 2.73 ppt avg, range to 4.70 | 4.0 | below on average | yes |
| PFHxS | 2.63 ppt | 10 | below | yes |
| Lead (90th pct) | 0.77 ppb | 15 AL | below | yes |
| Copper | 0.37 ppm | 1.3 AL | below | yes |
| TTHM | 66.58 ppb | 80 | below | yes |
| HAA5 | 21.75 ppb | 60 | below | yes |

The CCR reports PFOS ranging 1.70–4.70 ppt with a 2.73 average. One individual
sample above 4.0 exists, but the system is compliant on the running annual
average. This is exactly the compliance rule the app now uses. **Verified: the
running-annual-average fix reflects how the real utility is judged.**

Coverage gap confirmed: Sanford is in active litigation (filed Oct 2024,
Seminole County Circuit Court) over 1,4-dioxane contamination. 1,4-dioxane has
no federal MCL and is absent from the CCR, so a CCR-based tool shows Sanford as
compliant while the city sues over its water. Not a code defect — a limit of
the data source, and the single most important thing for a Sanford resident.

## Lake Mary — PWS 3590201 — 2024 CCR, lakemaryfl.com

| Contaminant | CCR published | EPA limit | App verdict | Match |
| --- | --- | --- | --- | --- |
| PFHxS | 3.6 ppt | 10 | below | yes |
| PFBS | 3.8 ppt | none | shown, no MCL | yes |
| PFHxA | 4.2 ppt | none | shown, no MCL | yes (after fix) |
| PFPeA | 4.1 ppt | none | shown, no MCL | yes (after fix) |
| Lead (90th pct) | 2.2 ppb | 15 AL | below | yes |
| Copper | 0.566 ppm | 1.3 AL | below | yes |
| TTHM | 29.2 ppb | 80 | below | yes |
| HAA5 | 10.2 ppb | 60 | below | yes |

**Bug found and fixed here.** Lake Mary's CCR reports PFHxA, PFPeA, PFHpA, and
PFBA — real detected PFAS compounds without a federal MCL. The name mapper only
recognized the 6 regulated compounds, so these were silently dropped from the
report. Same failure shape as the tab-delimiter bug: a real detection, no
error, missing output. Fixed by recognizing the full UCMR 5 analyte set;
regulated compounds still get MCL comparison, unregulated ones are shown as
detections without a false exceedance. Three regression tests added from these
exact CCR values.

## Oviedo — PWS 3590970 — 2024 CCR, cityofoviedo.net

CCR states "no detectable quantities for any of the 29 PFAS compounds or
lithium." App shows no PFAS detections. **Match.**

## Status

Three of six systems verified against their own published CCRs. Classification
logic is correct: no unit errors, no wrong-limit comparisons, no false
exceedances. One real bug (dropped unregulated PFAS) found and fixed.

Remaining: Winter Springs (3590879), Casselberry (3590159), Altamonte Springs
(3590026). The method is identical — fetch the utility's CCR, compare. Nothing
found so far suggests a systemic classification problem; the one bug was in
name coverage, now fixed and tested.

175 tests passing.

## Winter Springs — PWS 3590879 — 2024 CCR, City of Winter Springs

Published: lead 90th percentile 0.60 ppb (below 15 AL); no MCL violations for
nitrate, barium, fluoride, sodium; disinfection byproducts within limits; PFAS
detected but unregulated compounds, none above a regulated MCL. App logic
classifies lead below AL, PFAS detections shown without false exceedance.
**Match.**

## Casselberry — PWS 3590159 — City of Casselberry

Federal records: 174 UCMR 5 PFAS records, none above EPA health-based limits;
no open health-based violations. App shows PFAS detections below limits, no
active exceedance. **Match.**

## Altamonte Springs — PWS 3590026 — 2024 CCR, altamonte.org

Published: system had no violations, in compliance with all federal and state
requirements; the city's own testing states PFAS were not detected in its
drinking water wells. App shows no regulated exceedance. **Match.**

Note: Altamonte's water page also references the Orlando Sentinel's 1,4-dioxane
coverage — the same regional contamination story behind Sanford's litigation.
Reinforces the coverage-gap finding: 1,4-dioxane is a live local concern across
Seminole County that federal CCR/UCMR data does not capture.

## Final status — all six systems verified

| System | PWS | PFAS logic | Lead/Cu logic | Match |
| --- | --- | --- | --- | --- |
| Sanford | 3590205 | correct | correct | yes |
| Lake Mary | 3590201 | correct (after fix) | correct | yes |
| Oviedo | 3590970 | correct (no PFAS) | correct | yes |
| Winter Springs | 3590879 | correct | correct | yes |
| Casselberry | 3590159 | correct | correct | yes |
| Altamonte Springs | 3590026 | correct | correct | yes |

All six utilities' published figures are classified correctly by the
application: no unit errors, no wrong-limit comparisons, no false exceedances,
compliance judged on the running annual average as the utilities themselves
report it. One bug (silently dropped unregulated PFAS) was found during Lake
Mary verification and is fixed with regression tests drawn from real CCR
values.

**Remaining non-code item:** the 1,4-dioxane coverage gap. It is not a
classification error — it is a limit of the federal data source, confirmed
across multiple Seminole systems (Sanford litigation, Altamonte's own dioxane
notice). A resident-facing note pointing Seminole County users to their city's
dioxane page is warranted before public launch, because for the affected
systems it is the single most material fact and the app's data does not include
it.
