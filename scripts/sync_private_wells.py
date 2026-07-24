#!/usr/bin/env python3
"""Synchronize Seminole County private-well & septic context.

Sources
-------
* Seminole County 1,4-Dioxane Private Well Data Study (measured private-well
  concentrations). The county publishes this as a report/dataset; supply the
  current dataset URL with --dioxane-url (CSV/GeoJSON) when known.
* FDOH in Seminole County drinking-water services (private/limited-use wells).
* SJRWMD Water Well Construction Permit + well-completion sites (well point
  locations) and Consumptive Use Permit areas, from the SJRWMD ArcGIS Open Data
  FeatureServers, filtered to Seminole County.

Files are written atomically to data/private_wells/. These are contextual
records for neighboring private infrastructure, never the submitted household.
"""
from __future__ import annotations

import argparse
import sys

import seminole_sync_lib as lib

OUT = lib.ROOT / "data" / "private_wells"
SJRWMD_HOST = "https://services.arcgis.com/s8wtJX9suxFen6TA/arcgis/rest/services"
# SJRWMD Open Data feature services (layer 0). Names may be adjusted by the
# operator via flags if the district renames a service.
SJRWMD_WELL_PERMITS = SJRWMD_HOST + "/Well_Completion_Report_Sites_District_Issued_Permits/FeatureServer/0"
SJRWMD_WELL_DELEGATED = SJRWMD_HOST + "/Well_Completion_Report_Sites_Delegated_Counties/FeatureServer/0"
SJRWMD_CUP = SJRWMD_HOST + "/Public_Water_Supply_Area_SJRWMD/FeatureServer/0"
SEMINOLE_WHERE = "COUNTY='SEMINOLE' OR County='Seminole' OR county='SEMINOLE'"
# Verified 2026-07-22. The county publishes 1,4-dioxane results as linked PDFs
# on this page, including "1,4-Dioxane Concentrations: Private Well Data
# Collected During 2023-2024 Seminole County Water Quality Study".
SEMINOLE_DIOXANE_PAGE = "https://www.seminolecountyfl.gov/departments-services/utilities/utilities-engineering/dioxane"
# Match relative and absolute hrefs, any path shape, dioxane anywhere in it.
DIOXANE_PDF_PATTERN = r'href="([^"]*(?:dioxane|1[,\-]?4)[^"]*\.pdf)"'
DIOXANE_ANY_PDF = r'href="([^"]+\.pdf)"'
SEMINOLE_ORIGIN = "https://www.seminolecountyfl.gov"


def discover_dioxane_documents(errors: list) -> list[dict]:
    """Discover the county's published 1,4-dioxane PDFs from its official page."""
    import re as _re
    try:
        html = lib.request(SEMINOLE_DIOXANE_PAGE, timeout=90, max_bytes=30_000_000).decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        errors.append({"stage": "dioxane-page", "error": str(exc)})
        return []
    found = _re.findall(DIOXANE_PDF_PATTERN, html, _re.I)
    if not found:
        # Fall back to every PDF on the page; the page is the dioxane page, so
        # its attachments are the study documents even if names differ.
        found = _re.findall(DIOXANE_ANY_PDF, html, _re.I)
    docs, seen = [], set()
    for match in found:
        url = match if match.startswith("http") else SEMINOLE_ORIGIN + ("" if match.startswith("/") else "/") + match
        if url in seen:
            continue
        seen.add(url)
        docs.append({"url": url, "title": match.rsplit("/", 1)[-1].replace("-", " ").replace(".pdf", ""),
                     "source": "seminole-14-dioxane-study", "discovered_at": lib.utcnow(),
                     "granularity": "official-county-document",
                     "is_private_well_study": bool(_re.search(r"[Pp]rivate|[Ww]ell", match))})
    if not docs:
        errors.append({"stage": "dioxane-page", "error": "no dioxane PDF links found on the county page (layout may have changed)"})
    return docs


def sync_dioxane(url: str | None, errors: list) -> list[dict]:
    if not url:
        # No explicit dataset URL: publish the discovered official documents so
        # the operator has the exact files, rather than inventing measurements.
        return discover_dioxane_documents(errors)
    try:
        if "FeatureServer" in url or "MapServer" in url:
            feats = lib.arcgis_query_all(url)
        else:
            feats = lib.read_csv_rows(lib.request(url, timeout=180, max_bytes=100_000_000))
        rows = []
        for f in feats:
            rows.append({
                "well_id": f.get("well_id") or f.get("id") or f.get("sample_id"),
                "characteristic_name": "1,4-Dioxane",
                "result_value": f.get("result") or f.get("concentration") or f.get("value") or f.get("dioxane_ug_l"),
                "result_unit": f.get("unit") or "ug/L",
                "sample_date": f.get("sample_date") or f.get("date"),
                "latitude": f.get("latitude") or f.get("lat"),
                "longitude": f.get("longitude") or f.get("lon"),
                "granularity": "private-well-sample",
                "source": "seminole-14-dioxane-study",
                "source_url": url,
            })
        return rows
    except Exception as exc:  # noqa: BLE001
        errors.append({"stage": "dioxane-study", "error": str(exc)})
        return []


def sync_sjrwmd_wells(errors: list) -> list[dict]:
    rows: list[dict] = []
    for label, url in (("district-permit", SJRWMD_WELL_PERMITS), ("delegated", SJRWMD_WELL_DELEGATED)):
        try:
            for f in lib.arcgis_query_all(url, where=SEMINOLE_WHERE):
                rows.append({**f, "well_source": label, "granularity": "well-point", "source": "sjrwmd"})
        except Exception as exc:  # noqa: BLE001
            errors.append({"stage": f"sjrwmd-wells-{label}", "error": str(exc)})
    return rows


def sync_cup(errors: list) -> list[dict]:
    try:
        return [{**f, "granularity": "permit-area", "source": "sjrwmd-cup"}
                for f in lib.arcgis_query_all(SJRWMD_CUP, where=SEMINOLE_WHERE)]
    except Exception as exc:  # noqa: BLE001
        errors.append({"stage": "sjrwmd-cup", "error": str(exc)})
        return []


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync Seminole County private-well & septic context")
    ap.add_argument("--dioxane-url", help="Optional tabular CSV/GeoJSON/FeatureServer URL for the county 1,4-dioxane private-well study. If omitted, the official county page is scanned for its published PDFs.")
    ap.add_argument("--fdoh-url", help="CSV/GeoJSON URL for FDOH Seminole private-well testing records")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    errors: list = []

    dioxane = sync_dioxane(args.dioxane_url, errors)
    wells = sync_sjrwmd_wells(errors)
    cup = sync_cup(errors)
    fdoh = lib.load_json(OUT / "fdoh_records.json", [])
    if args.fdoh_url:
        try:
            fdoh = lib.read_csv_rows(lib.request(args.fdoh_url, timeout=120, max_bytes=50_000_000))
        except Exception as exc:  # noqa: BLE001
            errors.append({"stage": "fdoh", "error": str(exc)})

    lib.atomic_json(OUT / "dioxane_study.json", dioxane)
    lib.atomic_json(OUT / "sjrwmd_wells.json", wells)
    lib.atomic_json(OUT / "sjrwmd_cup.json", cup)
    lib.atomic_json(OUT / "fdoh_records.json", fdoh)

    status = "synced" if (dioxane or wells or cup or fdoh) else ("synced-empty" if not errors else "error")
    lib.atomic_json(OUT / "manifest.json", {
        "family": "private-wells-and-septic",
        "status": status,
        "downloaded_at": lib.utcnow(),
        "generated_at": lib.utcnow(),
        "county": lib.COUNTY_NAME,
        "sources": ["seminole-14-dioxane-study", "fdoh-seminole-dws", "sjrwmd-well-permits",
                    "sjrwmd-well-completion-delegated", "sjrwmd-cup"],
        "counts": {"dioxane_study": len(dioxane), "fdoh_records": len(fdoh),
                   "sjrwmd_wells": len(wells), "sjrwmd_cup": len(cup)},
        "errors": errors,
        "note": "Contextual private-infrastructure records for neighboring wells, not the submitted household.",
    })
    print(f"[Private-well sync] dioxane={len(dioxane)} wells={len(wells)} cup={len(cup)} fdoh={len(fdoh)} errors={len(errors)}", file=sys.stderr)
    for e in errors:
        print(f"  ! {e['stage']}: {e['error']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
