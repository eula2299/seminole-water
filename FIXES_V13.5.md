# Seminole Water God-Mode v13.5 — Federal Drinking-Water Data

Version 13.5 adds three distinct official data families without confusing them with household tap samples.

## 1. EPA SDWIS / ECHO

The synchronizer imports and filters the quarterly EPA Safe Drinking Water Act archive for every public water system identified as serving Seminole County, Florida. It does not rely only on the original local registry; it discovers additional county PWS IDs from the EPA geographic tables.

Imported tables:

- public water systems
- facilities
- geographic areas
- service areas
- violations and enforcement
- lead and copper samples
- site visits and sanitary surveys
- events and milestones
- public-notice violations

The lookup report shows system metadata, population/source fields when present, active compliance items, and a clear status separating health/treatment issues from monitoring/reporting issues.

## 2. EPA/USGS Water Quality Portal

The WQP synchronizer downloads stations and results for Seminole County FIPS `US:12:117`. At lookup time it computes distance from the geocoded address and displays the nearest stations plus the latest result per characteristic.

These records are deliberately labeled **nearby environmental/source-water context**. A lake, stream, groundwater, or other WQP station is never presented as a household tap sample or as the resolved utility's compliance sample.

## 3. Consumer Confidence Reports

The release bundles official CCR/report links for the major municipal and county utilities and an EPA CCR-finder fallback for other community systems. The synchronizer follows official utility pages, discovers annual-report PDFs, saves them locally, and uses `pdftotext` when available to extract:

- source-water descriptions
- compliance statements
- only contaminant rows that explicitly include a value and concentration unit

Unlabeled table numbers are not guessed.

## New API endpoints

- `GET /api/epa/status`
- `GET /api/epa/pws/:pwsid?lat=...&lon=...`
- `POST /api/epa/reload`

## Synchronize all federal data

The full command downloads EPA's large quarterly SDWA archive, so it can take time and disk space:

```bash
npm run sync:epa
```

Individual commands:

```bash
npm run sync:epa:sdwis
npm run sync:epa:wqp
npm run sync:epa:ccr
```

Faster SDWIS system-summary mode, without all historical federal tables:

```bash
npm run sync:epa:sdwis:fast
```

After synchronization, restart the app or run:

```bash
curl -X POST http://localhost:3000/api/epa/reload
```

## Accuracy safeguards

- Only exact Seminole County PWS IDs are retained from the national EPA archive.
- SDWIS reporting lag is stated in the UI.
- WQP ambient records are never promoted to tap-water or compliance records.
- CCRs remain annual system-level reports.
- Federal republications do not create a second independent laboratory sample.
- Existing Florida DEP chemical records remain the primary structured contaminant-result bank.

## Verification

```bash
npm run test:all
```

The release passes 103 tests, including federal compliance classification, WQP distance/result selection, CCR matching, and an end-to-end test proving that WQP context does not upgrade a lookup to a household sample.
