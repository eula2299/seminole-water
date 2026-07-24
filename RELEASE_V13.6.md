# Release v13.6.0 — Negotiated Accuracy Engine

## New accuracy techniques

1. **Counterfactual provider stability**
   - Repeats PWS resolution around the geocoded point at 5 m, 15 m, and 30 m.
   - Reports same-PWS fraction, alternate PWS IDs, unresolved fraction, and largest unanimous radius.
   - Boundary-sensitive assignments are automatically challenged.

2. **Auditable Dialectical Evidence Negotiation v1.0**
   - Agents submit structured support or opposition claims.
   - Evidence is deduplicated by originating sample rather than publisher.
   - Hard epistemic vetoes prevent system, CCR, WQP, street, or neighborhood evidence from becoming a household concentration.
   - The protocol records proposals, challenges, revisions, dissent, vetoes, and final accepted/rejected/undecided claims.

3. **Dimension-separated uncertainty budget**
   - Separate scores for geolocation, provider identity, spatial robustness, evidence scope, temporal freshness, contaminant coverage, sample independence, source conflict, and federal-data availability.
   - Reports separate system-evidence and household-exposure confidence.

4. **Claim robustness certificate**
   - Certifies whether the result survives provider, coordinate, scope, negotiation, confidence, and contradiction checks.

5. **Active evidence acquisition planner**
   - Ranks next steps by expected verdict-flip probability, confidence gain, severity, and effort.

6. **Peer-system comparative toxicology agent**
   - Compares only compatible, similarly dated, uncensored, system-level values.
   - Never treats non-detects or missing analytes as zero.
   - Produces a relative concentration profile, not a safety or toxicity score.

7. **Bayesian agent reliability calibration**
   - Transparent Beta priors are stored in `data/agent_reliability.json`.
   - Human-adjudicated outcomes can be added to `data/agent_adjudications.json`.
   - Run `npm run calibrate:agents` to produce posterior reliability weights.

## New report fields

- `counterfactual_stability`
- `uncertainty_budget`
- `agent_negotiation`
- `claim_robustness_certificate`
- `next_best_evidence`
- `peer_system_comparison`

## Validation

- 129 Node tests pass.
- 4 Python sync tests pass.
- Existing address resolution, crosswalk, FDEP, SDWIS, WQP, CCR, and scope-firewall tests remain green.
