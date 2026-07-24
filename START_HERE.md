# Seminole Water God-Mode v13.5 — Start Here

## First-time setup

```bash
cd ~/Downloads/"seminole-water-godmode-v13.5-federal-data"
npm install
npm run test:all
```

## Download the complete Seminole County federal data

```bash
npm run sync:epa
```

This performs three jobs:

1. downloads and filters EPA's quarterly SDWIS/SDWA tables for Seminole County;
2. downloads EPA/USGS Water Quality Portal stations and results for county FIPS `US:12:117`;
3. indexes and downloads available official Consumer Confidence Reports.

The EPA SDWA archive is large. For a quicker first run that gets only SDWIS system summaries, use:

```bash
npm run sync:epa:sdwis:fast
npm run sync:epa:wqp
npm run sync:epa:ccr
```

## Start the app

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Diagnostics

```text
http://localhost:3000/api/diagnostics/service-areas
http://localhost:3000/api/crosswalk-coverage
http://localhost:3000/api/epa/status
```

A healthy service-area cache should report 107 polygons. The EPA status page reports SDWIS systems/violations, WQP stations/results, and CCR entries.

## Reload data without restarting

After running a sync while the app is open:

```bash
curl -X POST http://localhost:3000/api/epa/reload
```

## Important interpretation

- Florida DEP and SDWIS/CCR records are public-water-system or facility records unless explicitly identified otherwise.
- WQP records are nearby environmental monitoring context, not the household faucet and not automatically the utility's compliance sample.
- An exact household concentration requires an address-specific laboratory sample.

## v13.5.1 SDWIS sync repair

EPA's SDWA summary page may no longer expose a static ZIP link. This build discovers the archive from EPA's official download directory and falls back to the official stable path `SDWA_latest_downloads.zip`. The bulk download is roughly 500 MB and now prints progress every 25 MiB. If bulk download still fails, the synchronizer automatically fills SDWIS system summaries through ECHO rather than leaving the federal cache empty.

Run only the repaired federal stages after replacing the project folder:

```bash
npm run sync:epa:sdwis
npm run sync:epa:ccr
npm start
```

Your existing WQP cache does not need to be downloaded again.
