# Water help

This adds six help tiles to the existing national lookup and an accessible `/help` flow. It keeps the existing address results, voice service, testing options, live analytics and placement of estimated savings.

## Implemented

- English, Spanish, French, Portuguese, Haitian Creole and Arabic help text, RTL layout, large text and browser read-aloud. Language changes preserve form input. Official source documents and residents' own words retain their original language; optional AI can explain them in the chosen language.
- PDF text extraction and photo/scanned-PDF OCR in the browser. Documents stay on the device. Measurement review preserves units, qualifiers, nondetects, nitrate basis and the original line. No safe-water certificate or medical diagnosis is produced.
- Optional, consent-based AI explanation, fact extraction and result translation. The server uses the existing `GEMINI_API_KEY`, a fixed Google endpoint, structured output, a 45-second deadline, two concurrent calls and a daily process cap. No tool execution, autonomous submission or paid-model fallback.
- Exact property pipe connectors for Denver Water, Pittsburgh Water and Minneapolis, alongside the existing NYC lookup. Other locations get official source routes and an inspection-request builder. A missing record is explicitly unknown.
- Source-dated filter comparison with exact matching cartridges, certified analyte scope, real purchase links, whole-pack replacement costs, first-year and three-year estimates. No subscription pricing or unverified cheapest-market claim. Unknown prices stay unknown. Budget and installation constraints are explicit.
- Bill extraction and editable arithmetic including credits. This does not validate an unconnected utility tariff, assert an illegal overcharge or stop a shutoff.
- Step-by-step inspection, assistance, complaint, unfair-treatment, lab-question and follow-up letters. An address check can pass its temporary contact token to help, allowing reuse of the existing verified-contact finder.
- On-device filling of the verified official USDA RD 3550-35 intake. Unicode font supports the offered languages. No signatures, Social Security numbers, missing facts or eligibility findings are inserted. The resident reviews the original form and submits through USDA's office. Other programs use their official pages; there is no claim that every government's application portal is integrated.
- Denver and Pittsburgh live meeting calendars, agenda links, applicable speaking-registration deadlines and official signup instructions. The nationwide finder additionally searches current official pages and verifies exact quotes before showing a meeting or deadline. It links to the published page for speaking instructions.
- Shared group requests with separate organizer/invitation capabilities. Invitees explicitly consent to their names being given to the organizer for that request. Names are not public and are not represented as verified signatures. Nothing is sent to an official automatically.
- Device-local progress, attachments, receipts and follow-up dates are encrypted at rest with AES-GCM and a password-derived key. The key stays in memory and locks after inactivity. Password-encrypted export/import works on HTTPS. Residents can instead continue without saving; that option keeps records in memory only and loses them on refresh. Assistance received is distinct from potential savings. Clearing browser storage can erase local data; the UI explains this.

## Runtime and configuration

Use the existing Node/Python/PostgreSQL app deployment, with `npm ci` and `npm start`. This is not a static-only site. Runtime dependencies and official form/font assets are part of the repository.

- `GEMINI_API_KEY`: existing AI key; without it the document reader, calculators, letters and local progress still work.
- `WATER_HELP_AI_MODEL`: optional; default `gemini-3.5-flash-lite`, a current model recommended in Google's model/deprecation documentation, checked 2026-10-31. The local-help finder uses Google Search grounding with the same bounded AI quota. Only city, state and topic are sent; street addresses and private documents are excluded. The API project's own billing and quota settings remain authoritative.
- `WATER_HELP_AI_DAILY_LIMIT`: optional; default 200 calls per process per UTC day. Multiple instances need a shared quota if a deployment-wide cap is required.
- `DATABASE_URL`: existing Postgres connection enables shared requests. The new `water_help_groups` and `water_help_promises` tables are isolated from existing community data. `PGSSLMODE=require` uses certificate verification; supply a trusted CA using standard Node settings if the provider requires one.
- Group requests expire after 90 days; expired records are inaccessible and purged at startup/use and hourly. Private organizer keys cannot be recovered. Delete is available to the organizer.
- Existing application and proxy environment settings remain in force. Do not expose the app's internal/core service publicly.

`/api/help/config` reports available AI, group support, public commitment support, languages and form metadata. It contains no secrets. Help pages exclude analytics to avoid collecting document/form information. Private group keys are in URL fragments and request headers, never query strings or referrers. Document text is not logged or cached by these handlers.

## Source maintenance

`filter-catalog.json` and `local-sources.json` include exact official URLs and check dates. Prices become visibly stale after 30 days. Recheck prices, stock, cartridge SKUs and the exact performance sheet together. Certification for one PFAS is not certification for all PFAS; arsenic has additional restrictions. Source categories do not guarantee a household's tap-water quality.

The bundled USDA form's displayed OMB expiration is 2026-11-30. After this date, the UI directs residents to the official current form until a maintainer verifies and updates the bundled form and mapping. The form is an intake, not approval or a complete application.

## Verification

`npm run test:help` covers measurement qualifiers/units, cost calculations, negative bill credits, all translation keys, exact pipe matching, local-date meeting logic, cross-origin and consent checks, official form fields, AI evidence filtering and separate group privileges. Tests execute the group and commitment SQL in the embedded PostgreSQL engine PGlite, in addition to contract tests. The production Postgres smoke test and consented synthetic-document AI request passed on 2026-11-01, as recorded below. Never load test participants, sample promises or fictional agency responses into production.

`npm run test:national` verifies the existing address, reports, action contacts, savings and voice contracts. Use the managed preview for browser checks. The report reader was exercised with a fictional PDF and image, including a less-than result. Do not use real resident records as fixtures.

## Release status

The user has authorized permanent Railway hosting and deployment. The app and archive remain in the existing project; no additional service or subscription is created. App deployment watches include `justice/**`. The archive now uses Railway's documented virtual-host S3 URL style and live bucket variable references. Automatic government submission is excluded by design; residents review and use official submission channels.

## Integrated tools and actual coverage

| Tool | Behavior and current limits |
| --- | --- |
| Report and bill upload | Selecting a file starts local reading. Recognized report results and bill charges are prefilled for one review. Missing or uncertain facts are left blank. Reading still works without the AI key. |
| Address reuse | A short-lived, same-tab context carries the entered address, public findings, testing options and contact token into help. Assistance options are shown automatically; requests start with those facts and fetch published contacts. No repeat address entry is required. |
| Form assistance | Recognized fields in uploaded fillable PDFs can be completed locally; known address fields are prefilled. Signatures, sensitive identifiers and unlabeled fields remain for the original form. The verified USDA intake has its own mapped workflow. |
| Full filter cost | Purchase links and exact replacement cartridges are sourced in the catalog. Comparison includes whole replacement packs over one and three years. Maintenance dates use the earlier volume or time limit; downloadable calendar reminders include alarms. |
| Bill-rate check | Minneapolis residential monthly water-use charges for meter reads in 2026 are supported at the verified CCF rate. A rate comparison requires confirmation of the account scope and units. Other tariffs are not claimed as verified. Meter mismatch, duplicate charges and daily-use changes can be flagged without asserting overbilling. |
| Assistance | Relevant testing options from the existing address results lead to prefilled help requests. The private tracker separates requested funds, approvals and funds actually received. It does not invent awards or automatically access a person's utility account. |
| Meetings | Denver and Pittsburgh live calendars and source-stated speaking deadlines. Downloadable reminders are calendar files, not a background subscription. Other places receive official finding routes. |
| Joint requests | Real PostgreSQL storage, private invite/organizer capabilities, explicit supporter consent, request-text hashes and join receipts. Organizer can prepare the joint submission; no agency receipt is fabricated. |
| Officials' commitments | Public, source-linked, user-contributed statements with owner-authorized updates and withdrawal. Source links and dates are shown. Posts are not represented as verified government statements. Requires Postgres. |
| AI advocate | Module-aware explanation, next steps and editable drafts with allowlisted source links. Existing address facts are prefilled. Explicit consent is required before sending content. Requires the existing Gemini key; unavailable state is honest. |
| Repair progress | Exact Pittsburgh 311 case-and-year read-only connector, plus official NYC and Florida PSC tracking portals. A case marked closed does not prove a repair was completed. No nationwide real-time work-order feed is claimed. |
| Complaints and equity | Structured unequal-treatment notes, EPA civil-rights complaint preparation and Florida PSC mapped questions, source-backed escalation routes, encrypted evidence and receipts. Official submission and any signature/CAPTCHA are completed at the responsible office. Jurisdiction and outcomes are not assumed. |

`research-rates-status.json` and `research-complaints-coverage.json` are runtime source catalogs, not sample records. Their official URLs, scope, verification dates and coverage limits must ship with `extended-sources.js`. No demonstration database or seeded results are used in the app.

### Latest verification

51 focused tests passed, including existing resident results/gateway contracts, source matching, SQL access control, bill math, calendar escaping, Unicode form filling, language parity, encrypted at-rest storage and the no-disk-write temporary mode. Browser checks confirmed automatic reading of the actual blank USDA form. The managed browser preview's server could not reach the Pittsburgh status feed (DNS failure); the direct server connector separately returned a real public case. The later deployed Pittsburgh read, AI requests and hosted database workflow passed on 2026-11-01; see the live checks below.

## Nationwide retrieval and local help update

- A transient geocoder failure retries independent address formats. Published active community-water-system city/ZIP listings are searched separately from the boundary map; exact state and full PWSID are preserved. City directory matches are possible providers, never proof of a home connection. The first four candidates are queried even when more candidates exist, and selection retrieves a provider’s records.
- Fixed the missing Census ACS endpoint in the request allowlist. Cached aggregate coverage status avoids repeating database-wide status work on every lookup. Removed reassuring screened tiles that were produced without completed source checks.
- `agencies.json` includes 56 jurisdictions, 325 direct official routes and separately identified state-directory routes, sourced from EPA and USAGov. The refreshed six-language `/help/local` tool uses the existing address context and shows relevant offices immediately.
- Local discovery uses Google Search grounding. A result must match a grounded URL, an allowed official publisher and an exact quote independently fetched from that page. Deadlines must occur in that quote. Search attribution is isolated in a sandboxed iframe; public-page retrieval checks DNS/IPs on each redirect.
- The existing PostgreSQL database uses about 4.30 GB of its 5 GB disk, and its 3 GB import ceiling has stopped updates. The object archive also reached its 250 GB configured budget. These are operational capacity issues, not evidence that locations lack records. No paid storage expansion or deletion of retained records is part of this release. Existing published snapshots remain readable and dated.

## Live checks on 2026-11-01

Railway deployments for the app and archive reached SUCCESS. The deployed help API returned a quoted lead result, Spanish translation and a useful advocate draft. Shared-request create, invite read, join receipt, owner read and removal passed against production Postgres using an isolated private software-validation record; it was removed. Public commitments support initialized successfully. Denver's real calendar and a Pittsburgh water-main case returned live records. GA4 and voice configuration remained operational.

Six public-address checks returned 174–478 water findings in Seattle, New York, Denver, Miami, Anchorage and Honolulu, with full provider IDs. This is regional verification, not proof of every property. The separate Census API now requires a key; the neighborhood context uses verified-publisher public ACS layers with exact tract identity and a runtime vintage check when no Census key is configured. Google's grounded-search quota rejected requests, so the finder now also reads verified agency directories and their relevant links directly, with independently checked quotes.

The local finder also uses the official CISA .gov registry to match public city/county office websites by exact city and state. Only domain, organization, city, state and organization type are retained; security-contact email addresses are excluded. Relevant linked pages are fetched with the same IP/redirect protections and quotes are verified before display. An office's registered city is not proof of household service or program eligibility.

The finder prioritizes program links over navigation and news, extracts article text without repeated site menus, and can verify additional AI-suggested informational routes on the exact official hostnames already matched to the location. These suggestions are never displayed as results unless the page is retrieved and its quote matches. Query-string, credential-bearing and unrelated-host hints are rejected.


### Continuation: November 1, 2026

The rate registry now exposes Denver Water's 2026 single-family schedule as a tiered adapter, alongside Minneapolis's existing water-use comparison. Denver requires confirmed service class, meter size, winter allowance and usage dates. It compares base water use, temporary drought and fixed charges separately; it does not include credits, other services or old balances in the tariff subtotal. Crossing May 1, missing details and 2027 reads do not produce a guessed comparison. UI labels and results support all six languages without discarding entered values.

Help-AI daily attempts now use an atomic PostgreSQL counter when DATABASE_URL is present. All help-AI instances share the UTC-day limit, including restarts. Database failure prevents a provider request instead of bypassing the cap. Local development without a database retains the process cap. This does not replace Gemini quotas or the separate voice service's limits. The public config reports `ai_budget_scope`; the budget table contains dates and counts only. In-flight concurrency remains bounded per process.

Property pipe inventory reads reject truncated or malformed responses. Multiple exact-address records return `ambiguous`, preserving the records without choosing one pipe material. The resident flow continues to official local help.

See `docs/water-help-acceptance.json` for the maintained feature/source/verification inventory and `docs/storage-investigation-2026-11-01.json` for measured capacity and the approval-dependent plan. These do not assert nationwide completion.
