# Water-results voice guide

The voice panel appears after the initial results and full-records control, before next steps. A visitor approves the Google audio disclosure, presses Start voice call, and grants microphone permission. Audio stays within the page UI; a server-side WebSocket connects to Gemini Live.

The prototype was built in Google AI Studio (Water Results Voice Guide, app f04b5627-01bc-4b23-8901-7dcec390a626). Its exported Node proxy/audio pattern was reviewed and adapted to this CommonJS application. Generated demo findings and assistance-program claims were not imported.

## Configuration

- GEMINI_API_KEY: server-only credential; never include in browser assets or logs.
- GEMINI_VOICE_ENABLED=true: explicit activation switch.
- GEMINI_VOICE_MODEL=gemini-3.1-flash-live-preview: tested audio model.

Google project gen-lang-client-0789484776 showed Free tier on 2026-10-17. Billing was not enabled. Free quota is not unlimited; the code never falls back to a paid provider. Changing the Cloud project's billing later can change charges independently of this application. Railway hosting costs are separate.

## Limits and data

Each call ends after three minutes on both server and client. Per process: two concurrent connections, 200 calls per UTC day, six connection attempts per IP/hour, three calls per report, and a 30-minute report token lifetime. These are in-memory controls for the current single-replica deployment; restarts reset counters and invalidate report tokens. Multiple replicas require shared rate limits and report storage or sticky routing.

Only an allowlist of contaminant findings and notice guidance is sent to Google. Street addresses, coordinates, household identity and demographics are excluded. The client cannot substitute report evidence, change the model, or add tools. The site does not save recordings or conversation captions. Google unpaid-service data handling is disclosed before every call. The feature is for adults using it in the United States. It explains results, does not diagnose, and cannot send messages, make applications or book appointments.

## Validation

Run npm run test:national. Voice tests cover evidence minimization, consent, report expiry, same-origin connections, input handling, audio forwarding, server time limits and quota shutdown. A real Google connection was also tested with synthetic spoken audio: a question about arsenic produced spoken output and correctly distinguished a system-monitoring sample from a household test. This does not replace testing with real microphones across supported browsers.

Disable with GEMINI_VOICE_ENABLED=false and redeploy. Without the flag and credential, lookups return no voice token and the panel is hidden.
