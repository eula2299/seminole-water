#!/usr/bin/env python3
"""Synchronize Seminole County PFAS & emerging-contaminant occurrence data.

Sources
-------
* EPA UCMR 5 occurrence data (29 PFAS + lithium), filtered to this project's
  Seminole County PWS registry.
* EPA/USGS Water Quality Portal PFAS results for county FIPS US:12:117.
* Florida DEP PFAS program compliance status (systems meeting/failing the EPA
  PFAS MCLs), filtered to Seminole County.
* EWG PFAS interactive-map indicators (non-governmental, cross-reference only).

Only rows tied to a registered Seminole PWS ID (or, for WQP, within the county)
are published. Files are written atomically to data/pfas/.
"""
from __future__ import annotations

import argparse
import io
import re
import sys
import zipfile

import seminole_sync_lib as lib

OUT = lib.ROOT / "data" / "pfas"
# UCMR 5 occurrence files rotate with every quarterly release (the eleventh set
# published February 2026; a twelfth is due fall 2026), so the download URL is
# discovered from EPA's occurrence-data page rather than hardcoded.
UCMR5_PAGE = "https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule"
UCMR5_ZIP = None
# Verified 2026-07-22. Florida DEP manages PFAS records on EPA's behalf under
# the federal NPDWR; EPA conducts formal enforcement.
FDEP_PFAS = "https://floridadep.gov/water/source-drinking-water/content/and-polyfluoroalkyl-substances-pfas"
FDEP_DW_DATABASE = "https://floridadep.gov/water/source-drinking-water/content/information-drinking-water-database"
FDEP_PFOA_PFOS_WELLS = "https://floridadep.gov/waste/waste-cleanup/content/pfoa-and-pfos-sampling-efforts-associated-public-well-systems-florida"
EWG_MAP = "https://www.ewg.org/interactive-maps/pfas_contamination/map/"


def registry_pwsids() -> set[str]:
    ids = set()
    for name in ("systems.json", "fdep_system_registry.json"):
        for row in lib.load_json(lib.ROOT / "data" / name, []):
            pid = lib.normalize_pwsid(row.get("pwsid"))
            if pid:
                ids.add(pid)
    return ids


def discover_ucmr5_zip(errors: list) -> str | None:
    """Find the NEWEST UCMR 5 occurrence zip on EPA's page.

    EPA keeps every quarterly release on the same page (eleven as of February
    2026). Taking the first matching link yields the August 2023 file, which
    predates most systems' sampling. Links are therefore ranked by the YYYY-MM
    stamp EPA puts in the file path, newest first.
    """
    try:
        links = lib.discover_links(UCMR5_PAGE, r"ucmr.?5.*\.zip")
    except Exception as exc:  # noqa: BLE001
        errors.append({"stage": "ucmr5-discovery", "error": str(exc)})
        return None
    if not links:
        errors.append({"stage": "ucmr5-discovery",
                       "error": f"no UCMR 5 zip link found on {UCMR5_PAGE}"})
        return None

    def stamp(url: str) -> str:
        m = re.search(r"/(20\d{2})-(\d{2})/", url)
        return f"{m.group(1)}{m.group(2)}" if m else "000000"

    ranked = sorted(links, key=stamp, reverse=True)
    chosen = ranked[0]
    print(f"[PFAS sync] UCMR 5 releases found: {len(ranked)}; newest: {chosen}")
    return chosen


def sync_ucmr5(pwsids: set[str], errors: list) -> list[dict]:
    try:
        target = UCMR5_ZIP or discover_ucmr5_zip(errors)
        if not target:
            return []
        blob = lib.request(target, timeout=900, max_bytes=900_000_000)
        rows: list[dict] = []
        scanned = 0
        seen_ids: set[str] = set()
        if blob[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(blob)) as zf:
                for member in zf.namelist():
                    if not member.lower().endswith((".txt", ".csv")):
                        continue
                    for row in lib.read_csv_rows(zf.read(member)):
                        scanned += 1
                        pid = lib.normalize_pwsid(row.get("pwsid") or row.get("pws_id") or row.get("pwsid_"))
                        if pid and len(seen_ids) < 500:
                            seen_ids.add(pid)
                        state = str(row.get("state") or "").upper()
                        if pid in pwsids or (state == "FL" and (pid in pwsids)):
                            rows.append({
                                "pwsid": pid,
                                "pws_name": row.get("pws_name"),
                                "characteristic_name": row.get("contaminant"),
                                "result_value": row.get("analytical_result_value") or row.get("result"),
                                "result_unit": row.get("units") or "ng/L",
                                "sample_date": row.get("collection_date") or row.get("sample_collection_date"),
                                "detection_condition": ("non-detect" if str(row.get("analytical_result_sign") or "").strip() == "<" else None),
                                "granularity": "public-water-system",
                                "source": "epa-ucmr5",
                                "source_url": target,
                            })
        if not rows and scanned:
            errors.append({
                "stage": "ucmr5-match",
                "error": f"downloaded and scanned {scanned} rows but none matched a registered Seminole PWS ID",
                "sample_pwsids_in_file": sorted(seen_ids)[:8],
                "registered_pwsids_sought": sorted(pwsids)[:8],
                "source_url": target,
            })
        return rows
    except Exception as exc:  # noqa: BLE001
        errors.append({"stage": "ucmr5", "error": str(exc)})
        return []


def pfas_from_local_wqp_cache() -> list[dict]:
    """Reuse data/epa/wqp_results.json if the federal sync already fetched it.

    Costs nothing and avoids a second multi-hundred-megabyte download.
    """
    cached = lib.load_json(lib.ROOT / "data" / "epa" / "wqp_results.json", [])
    if not cached:
        return []
    wanted = {n.strip().lower() for n in lib.PFAS_CHARACTERISTICS}
    hits = [r for r in cached
            if str(r.get("characteristic_name") or "").strip().lower() in wanted]
    if hits:
        print(f"[PFAS sync] reused {len(hits)} PFAS rows from the existing county WQP cache")
    return hits


def sync_wqp_pfas(errors: list) -> list[dict]:
    local = pfas_from_local_wqp_cache()
    if local:
        for r in local:
            r["source"] = "epa-usgs-wqp-pfas"
            r["granularity"] = "environmental-monitoring-station"
        return local
    try:
        rows, url, chunk_errors = [], None, []
        chars = lib.PFAS_CHARACTERISTICS
        for i in range(0, len(chars), 4):
            batch = chars[i:i + 4]
            try:
                part, url = lib.wqp_results(batch)
                rows.extend(part)
            except Exception as exc:  # noqa: BLE001
                chunk_errors.append({"stage": "wqp-pfas-batch", "analytes": batch, "error": str(exc)})
        errors.extend(chunk_errors)
        for r in rows:
            r["source"] = "epa-usgs-wqp-pfas"
            r["granularity"] = "environmental-monitoring-station"
        return rows
    except Exception as exc:  # noqa: BLE001
        errors.append({"stage": "wqp-pfas", "error": str(exc)})
        return []


def sync_fdep(errors: list) -> list[dict]:
    """Record Florida DEP PFAS program references for the county.

    Florida DEP does not publish a single machine-readable PFAS compliance
    feed. It (a) manages PFAS monitoring records on EPA's behalf under the
    federal NPDWR, and (b) publishes annual drinking-water database reports.
    This stage verifies the official program pages are reachable and records
    them as authoritative references. Actual PFAS results reach the app through
    UCMR 5 and the Water Quality Portal, which are machine-readable.
    """
    refs: list[dict] = []
    for ref_id, url, title in (
        ("fdep-pfas-program", FDEP_PFAS, "Florida DEP PFAS drinking-water program"),
        ("fdep-drinking-water-database", FDEP_DW_DATABASE, "Florida DEP drinking-water database reports"),
        ("fdep-pfoa-pfos-public-wells", FDEP_PFOA_PFOS_WELLS, "Florida DEP PFOA/PFOS public-well sampling efforts"),
    ):
        try:
            lib.request(url, timeout=60, max_bytes=20_000_000)
            refs.append({"id": ref_id, "title": title, "url": url, "reachable": True,
                         "checked_at": lib.utcnow(), "granularity": "official-program-reference",
                         "source": "fdep-pfas-program"})
        except Exception as exc:  # noqa: BLE001
            errors.append({"stage": ref_id, "error": str(exc)})
    return refs


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync Seminole County PFAS data")
    ap.add_argument("--fdep-layer", help="ArcGIS FeatureServer layer URL for the FDEP PFAS compliance status, if known")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    pwsids = registry_pwsids()
    errors: list = []

    ucmr5 = sync_ucmr5(pwsids, errors)
    wqp = sync_wqp_pfas(errors)
    fdep = sync_fdep(errors)
    if args.fdep_layer:
        try:
            feats = lib.arcgis_query_all(args.fdep_layer, where="COUNTY='SEMINOLE' OR County='Seminole'")
            fdep = [{**f, "source": "fdep-pfas-program", "granularity": "public-water-system"} for f in feats]
        except Exception as exc:  # noqa: BLE001
            errors.append({"stage": "fdep-pfas-layer", "error": str(exc)})

    lib.atomic_json(OUT / "ucmr5_results.json", ucmr5)
    lib.atomic_json(OUT / "wqp_pfas_results.json", wqp)
    lib.atomic_json(OUT / "fdep_pfas_status.json", fdep)
    # EWG indicators are recorded as a reference pointer only (leads/context).
    lib.atomic_json(OUT / "ewg_indicators.json", lib.load_json(OUT / "ewg_indicators.json", []))

    status = "synced" if (ucmr5 or wqp or fdep) else ("synced-empty" if not errors else "error")
    lib.atomic_json(OUT / "manifest.json", {
        "family": "pfas-and-emerging-contaminants",
        "status": status,
        "downloaded_at": lib.utcnow(),
        "generated_at": lib.utcnow(),
        "county_fips": lib.COUNTY_FIPS,
        "sources": ["epa-ucmr5", "epa-usgs-wqp-pfas", "fdep-pfas-program", "ewg-pfas-map"],
        "counts": {"ucmr5_results": len(ucmr5), "wqp_pfas_results": len(wqp),
                   "fdep_pfas_status": len(fdep), "ewg_indicators": len(lib.load_json(OUT / "ewg_indicators.json", []))},
        "errors": errors,
        "note": "PFAS occurrence/compliance context. UCMR 5 is occurrence monitoring, not a compliance finding.",
    })
    print(f"[PFAS sync] ucmr5={len(ucmr5)} wqp={len(wqp)} fdep={len(fdep)} errors={len(errors)}", file=sys.stderr)
    for e in errors:
        print(f"  ! {e['stage']}: {e['error']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
