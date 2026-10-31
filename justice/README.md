# Water help

This adds four help tiles to the existing national lookup and an accessible `/help` flow. It keeps the existing address results, voice service, testing options, live analytics and placement of estimated savings.

## Implemented

- English, Spanish, French, Portuguese, Haitian Creole and Arabic help text, RTL layout, large text and browser read-aloud. Language changes preserve form input. Official source documents and residents' own words retain their original language; optional AI can explain them in the chosen language.
- PDF text extraction and photo/scanned-PDF OCR in the browser. Documents stay on the device. Measurement review preserves units, qualifiers, nondetects, nitrate basis and the original line. No safe-water certificate or medical diagnosis is produced.
- Optional, consent-based AI explanation, fact extraction and result translation. The server uses the existing `GEMINI_API_KEY`, a fixed Google endpoint, structured output, a 45-second deadline, two concurrent calls and a daily process cap. No tool execution, autonomous submission or paid-model fallback.
- Exact property pipe connectors for Denver Water, Pittsburgh Water and Minneapolis, alongside the existing NYC lookup. Other locations get official source routes and an inspection-request builder. A missing record is explicitly unknown.
- Source-dated filter comparison with exact matching cartridges, certified analyte scope, real purchase links, whole-pack replacement costs, first-year and three-year estimates. No subscription pricing or unverified cheapest-market claim. Unknown prices stay unknown. Budget and installation constraints are explicit.
- Bill extraction and editable arithmetic including credits. This does not validate an unconnected utility tariff, assert an illegal overcharge or stop a shutoff.
- Step-by-step inspection, assistance, complaint, unfair-treatment, lab-question and follow-up letters. An address check can pass its temporary contact token to help, allowing reuse of the existing verified-contact finder.
- On-device filling of the verified official USDA RD 3550-35 intake. Unicode font supports the offered languages. No signatures, Social Security numbers, missing facts or eligibility findings are inserted. The resident reviews the original form and submits through USDA's office. Other programs use their official pages; there is no claim that every government's application portal is integrated.
- Denver and Pittsburgh live meeting calendars, agenda links, applicable speaking-registration deadlines and official signup instructions. Unsupported places get a government directory, not invented meetings.
- Shared group requests with separate organizer/invitation capabilities. Invitees explicitly consent to their names being given to the organizer for that request. Names are not public and are not represented as verified signatures. Nothing is sent to an official automatically.
- Device-local progress, attachments, receipts, officials' promises and follow-up dates. Assistance received is entered separately from potential savings. Password-encrypted export/import works on HTTPS. Clearing browser storage can erase local data; the UI explains this.

## Runtime and configuration

Use the existing Node/Python/PostgreSQL app deployment, with `npm ci` and `npm start`. This is not a static-only site. Runtime dependencies and official form/font assets are part of the repository.

- `GEMINI_API_KEY`: existing AI key; without it the document reader, calculators, letters and local progress still work.
- `WATER_HELP_AI_MODEL`: optional; default `gemini-3.5-flash-lite`, a current model recommended in Google's model/deprecation documentation, checked 2026-10-31. No grounding/search billing is enabled. The API project's own billing and quota settings remain authoritative.
- `WATER_HELP_AI_DAILY_LIMIT`: optional; default 200 calls per process per UTC day. Multiple instances need a shared quota if a deployment-wide cap is required.
- `DATABASE_URL`: existing Postgres connection enables shared requests. The new `water_help_groups` table is isolated from existing community data. `PGSSLMODE=require` uses certificate verification; supply a trusted CA using standard Node settings if the provider requires one.
- Group requests expire after 90 days; expired records are inaccessible and purged at startup/use and hourly. Private organizer keys cannot be recovered. Delete is available to the organizer.
- Existing application and proxy environment settings remain in force. Do not expose the app's internal/core service publicly.

`/api/help/config` reports available AI, group support, languages and form metadata. It contains no secrets. Help pages exclude analytics to avoid collecting document/form information. Private group keys are in URL fragments and request headers, never query strings or referrers. Document text is not logged or cached by these handlers.

## Source maintenance

`filter-catalog.json` and `local-sources.json` include exact official URLs and check dates. Prices become visibly stale after 30 days. Recheck prices, stock, cartridge SKUs and the exact performance sheet together. Certification for one PFAS is not certification for all PFAS; arsenic has additional restrictions. Source categories do not guarantee a household's tap-water quality.

The bundled USDA form's displayed OMB expiration is 2026-11-30. After this date, the UI directs residents to the official current form until a maintainer verifies and updates the bundled form and mapping. The form is an intake, not approval or a complete application.

## Verification

`npm run test:help` covers measurement qualifiers/units, cost calculations, negative bill credits, all translation keys, exact pipe matching, local-date meeting logic, cross-origin and consent checks, official form fields, AI evidence filtering and separate group privileges. Group tests use a query adapter; a real Postgres smoke test and a consented fictional-document AI request remain deployment gates.

`npm run test:national` verifies the existing address, reports, action contacts, savings and voice contracts. Use the managed preview for browser checks. The report reader was exercised with a fictional PDF and image, including a less-than result. Do not use real resident records as fixtures.

## Release status

The public domain was observed on the existing Railway deployment at base commit `0f71b393396b7e44fe51ada284c38d4bad4e0020`. The user has rejected Railway. This feature branch therefore must not be merged into its automatic deployment before the replacement hosting path is selected and connected. No Railway service or subscription is created by this change.
