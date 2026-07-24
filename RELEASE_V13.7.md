# Seminole Water God-Mode v13.7.0 — Causal-Conformal Evidence Assurance

Version 13.7 adds eight deterministic accuracy and scientific-safety layers to the v13.6 negotiated evidence engine.

## New runtime layers

1. **Set-Valued Provider Uncertainty Agent**
   - Returns a prediction set of plausible PWS IDs instead of forcing a singleton when provider evidence is close.
   - Supports split-conformal calibration when independently adjudicated nonconformity scores are supplied.
   - Explicitly refuses to claim conformal coverage when calibration data are absent.

2. **Monotone Evidence Applicability Lattice**
   - Scores every record across spatial, temporal, hydraulic, provenance, laboratory, regulatory, and evidence-scope dimensions.
   - Prevents evidence from being promoted to a finer geographic scope than it actually supports.

3. **Leave-One-Origin-Out Negotiation Influence Audit**
   - Removes each originating sample/source unit and reruns the full agent negotiation.
   - Detects conclusions that depend disproportionately on one evidence origin, even when that origin was republished by several agencies.

4. **Minimum Contradiction Cut-Set Agent**
   - Searches for the smallest origin-level evidence sets whose removal eliminates explicit support/opposition conflicts.
   - Identifies the evidence units driving disagreement without automatically discarding them.

5. **Negative-Evidence Coverage Tensor**
   - Constructs a scope × time × analyte × source-family monitoring tensor.
   - Enforces that missing data and non-detects are never interpreted as zero or absence.

6. **Causal Water-Pathway Proof Graph**
   - Represents source water, treatment, distribution, service area, premise, and tap as an auditable evidence graph.
   - Blocks household-causality claims unless a fully observed path reaches an address-linked tap sample.

7. **Multi-Agent Evidence Acquisition Auction**
   - Allocates a bounded evidence-gathering budget using expected confidence gain, verdict-flip probability, health severity, effort, latency, and privacy.
   - Produces a Pareto frontier and selects only actions that fit the configured budget.

8. **Adversarial Verdict Envelope**
   - Stress-tests the system confidence under plausible adverse evidence conditions, including alternate providers, dominant-origin removal, coverage gaps, incomplete causal paths, and undecided negotiation claims.
   - Reports pessimistic, base, and optimistic confidence values without mislabeling the output as a statistical confidence interval.

## Interface changes

A new **Causal-conformal evidence assurance** panel displays:

- the provider prediction set;
- system-versus-household applicability fractions;
- dominant evidence origins;
- contradiction cut sets;
- missing contaminant groups;
- source-to-tap pathway evidence;
- auction-selected next evidence actions;
- the adversarial confidence envelope.

## Validation

- 142 JavaScript tests pass.
- 4 Python synchronization tests pass.
- Existing address, crosswalk, EPA, WQP, CCR, negotiation, and uncertainty tests remain green.

## Patent-language limitation

These mechanisms are documented as **patent candidates**, not as guaranteed patentable inventions. Patentability depends on jurisdiction-specific novelty, non-obviousness, eligibility, inventorship, disclosure timing, and prior art. A qualified patent attorney or patent agent should perform a formal search before public disclosure or filing.
