# v13.4 Exact-Address and Neighborhood Online Evidence

This release adds a real address-level online evidence layer without pretending that public web pages are household laboratory samples.

## What now happens during every lookup

1. The address is geocoded and matched to the official service-area polygon and PWS as before.
2. Parcel attributes are inspected for subdivision/neighborhood names under many possible field schemas.
3. Relevant official city or county water-alert pages are downloaded based on the resolved utility.
4. Same-origin links labeled as boil-water, drinking-water, lead-service-line, PFAS, bacteriological, or water-quality notices are followed one level deep.
5. A public exact-address search runs through Bing or Brave when an API key exists, otherwise through the keyless DuckDuckGo HTML fallback.
6. Results are classified as:
   - exact address
   - affected address range
   - street
   - neighborhood/subdivision
   - system context only
7. Lifted/rescinded notices are separated from active-or-unspecified notices.
8. Non-water real-estate and directory results do not appear as water evidence.
9. Community and nonofficial results remain leads only and never corroborate a contaminant measurement.

## Important evidence rule

An address, street, or neighborhood web match is contextual evidence. It becomes an exact household concentration only when the source explicitly reports a laboratory sample from that home with an analyte, result, unit, date, and source. The software does not manufacture or infer a household concentration.

## Privacy control

The form includes a checked-by-default option to search public online sources for the exact address. Unchecking it prevents the exact address from being sent to a third-party search provider. Official utility pages are still checked and matched locally.

## Tests

The release adds tests for exact addresses, numeric address ranges, street matches, neighborhood matches, lifted notices, non-water false positives, unpredictable parcel field names, source routing, safe same-origin notice traversal, and search-result parsing.

Run:

```bash
npm install
npm run test:all
npm start
```
