#!/usr/bin/env python3
"""Synchronize Seminole County federal drinking-water and source-water context.

Sources
-------
* EPA ECHO/SDWIS system and compliance data. A lightweight REST system summary
  is the default. Use --bulk-sdwis for the complete quarterly SDWA tables.
* EPA/USGS Water Quality Portal (WQP) stations and results for county FIPS
  US:12:117.
* Official Consumer Confidence Report (CCR) links from utilities plus EPA's
  local CCR finder.

The script only publishes rows whose PWS ID is present in this project's
Seminole County registry. Files are written atomically to data/epa/.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import html
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from typing import Any, Iterable

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "epa"
OUT.mkdir(parents=True, exist_ok=True)
USER_AGENT = "SeminoleWaterGodMode/13.5 (public-data synchronizer; contact local operator)"
COUNTY_FIPS = "US:12:117"
EPA_CCR_FINDER = "https://sdwis.epa.gov/ords/safewater/f?p=136:102::::::"
ECHO_SYSTEMS = "https://echodata.epa.gov/echo/sdw_rest_services.get_systems"
ECHO_QID = "https://echodata.epa.gov/echo/sdw_rest_services.get_qid"
ECHO_DOWNLOAD_SUMMARY = "https://echo.epa.gov/tools/data-downloads/sdwa-download-summary"
ECHO_DOWNLOAD_INDEX = "https://echo.epa.gov/files/echodownloads/"
ECHO_SDWA_LATEST_ZIP = urllib.parse.urljoin(ECHO_DOWNLOAD_INDEX, "SDWA_latest_downloads.zip")
WQP_STATION = "https://www.waterqualitydata.us/data/Station/search"
WQP_RESULT = "https://www.waterqualitydata.us/data/Result/search"


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def atomic_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def load_json(path: pathlib.Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def normalize_pwsid(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or "").upper().replace("US", "").replace("FL", ""))
    return digits[-7:] if len(digits) >= 7 else digits


def snake(value: str) -> str:
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(value or ""))
    return re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()


def normalize_record(row: dict[str, Any]) -> dict[str, Any]:
    out = {snake(k): v for k, v in row.items()}
    candidate = next((out.get(k) for k in (
        "pwsid", "pws_id", "public_water_system_id", "submissionyearquarter_pwsid",
        "submission_year_quarter_pwsid", "water_system_id"
    ) if out.get(k) not in (None, "")), "")
    out["pwsid"] = normalize_pwsid(candidate)
    return out


def local_systems() -> list[dict[str, Any]]:
    base = load_json(ROOT / "data" / "systems.json", [])
    records = load_json(ROOT / "data" / "all_contaminant_records.json", [])
    merged: dict[str, dict[str, Any]] = {}
    for row in base:
        pid = normalize_pwsid(row.get("pwsid"))
        if pid:
            merged[pid] = {**row, "pwsid": pid}
    for row in records:
        pid = normalize_pwsid(row.get("pwsid"))
        if not pid:
            continue
        current = merged.get(pid, {})
        merged[pid] = {
            "pwsid": pid,
            "name": current.get("name") or row.get("system_name") or pid,
            "system_type": current.get("system_type") or row.get("system_type"),
            "population": current.get("population") if current.get("population") is not None else row.get("population")
        }
    return sorted(merged.values(), key=lambda x: x["pwsid"])


def request(url: str, *, timeout: int = 120, max_bytes: int = 600_000_000,
            retries: int = 4, backoff: float = 3.0) -> bytes:
    """GET with retries. The Water Quality Portal frequently truncates large
    result downloads (IncompleteRead); retrying recovers them instead of
    discarding the stage."""
    import http.client, time, urllib.error as _ue
    last = None
    for attempt in range(retries):
        try:
            return _request_once(url, timeout=timeout, max_bytes=max_bytes)
        except (http.client.IncompleteRead, TimeoutError, ConnectionError) as exc:
            last = exc
        except _ue.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504):
                raise
            last = exc
        except _ue.URLError as exc:
            last = exc
        except Exception as exc:
            if "IncompleteRead" in type(exc).__name__ or "timed out" in str(exc).lower():
                last = exc
            else:
                raise
        if attempt < retries - 1:
            time.sleep(backoff * (2 ** attempt))
    raise last if last else RuntimeError(f"request failed: {url}")


def _request_once(url: str, *, timeout: int = 120, max_bytes: int = 600_000_000) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        length = response.headers.get("Content-Length")
        if length and int(length) > max_bytes:
            raise RuntimeError(f"download is {length} bytes, above the {max_bytes}-byte safety limit")
        chunks, total = [], 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError(f"download exceeded the {max_bytes}-byte safety limit")
            chunks.append(chunk)
        return b"".join(chunks)


def request_json(url: str, timeout: int = 90) -> Any:
    return json.loads(request(url, timeout=timeout, max_bytes=50_000_000).decode("utf-8-sig", errors="replace"))


def recursively_find_qid(value: Any) -> str | None:
    if isinstance(value, dict):
        for k, v in value.items():
            if snake(k) in {"query_id", "queryid", "qid"} and str(v).strip():
                return str(v).strip()
            found = recursively_find_qid(v)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = recursively_find_qid(item)
            if found:
                return found
    return None


def recursively_find_pws_rows(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        keys = {snake(k) for k in value}
        if keys & {"pwsid", "pws_id", "pwsid_number", "public_water_system_id"}:
            found.append(normalize_record(value))
        else:
            for child in value.values():
                found.extend(recursively_find_pws_rows(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(recursively_find_pws_rows(child))
    return found


def dedupe(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out, seen = [], set()
    for row in rows:
        key = hashlib.sha256(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def sync_sdwis_rest(systems: list[dict[str, Any]]) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, str]]]:
    rows, errors = [], []
    for system in systems:
        pid = system["pwsid"]
        query = urllib.parse.urlencode({"output": "JSON", "p_pwsid": "FL" + pid})
        try:
            payload = request_json(ECHO_SYSTEMS + "?" + query)
            qid = recursively_find_qid(payload)
            result_payload = payload
            if qid:
                result_payload = request_json(ECHO_QID + "?" + urllib.parse.urlencode({"output": "JSON", "qid": qid, "pageno": 1}))
            extracted = [r for r in recursively_find_pws_rows(result_payload) if r.get("pwsid") == pid]
            if not extracted:
                # Preserve a registry row even when ECHO returns no parseable result.
                extracted = [{
                    "pwsid": pid, "pws_name": system.get("name"),
                    "system_type": system.get("system_type"), "population_served": system.get("population"),
                    "echo_lookup_status": "no-parseable-row", "source_url": ECHO_SYSTEMS + "?" + query
                }]
            for row in extracted:
                row.setdefault("pws_name", system.get("name"))
                row.setdefault("source_url", ECHO_SYSTEMS + "?" + query)
                row["retrieved_at"] = utcnow()
            rows.extend(extracted)
        except Exception as exc:
            errors.append({"pwsid": pid, "stage": "echo-sdwis-system", "error": str(exc)})
            rows.append({
                "pwsid": pid, "pws_name": system.get("name"), "system_type": system.get("system_type"),
                "population_served": system.get("population"), "echo_lookup_status": "request-failed",
                "error": str(exc), "source_url": ECHO_SYSTEMS + "?" + query, "retrieved_at": utcnow()
            })
    return {"systems": dedupe(rows), "facilities": [], "geographic_areas": [], "service_areas": [], "violations": [], "lcr_samples": [], "site_visits": [], "events": [], "public_notices": []}, errors


def _zip_links(page: str, base_url: str) -> list[str]:
    links = re.findall(r'href=["\']([^"\']+)["\']', page, flags=re.I)
    resolved = []
    for value in links:
        url = urllib.parse.urljoin(base_url, html.unescape(value).strip())
        if ".zip" in urllib.parse.urlsplit(url).path.lower():
            resolved.append(url)
    return resolved


def discover_sdwa_zip() -> str:
    """Return EPA's current national SDWA ZIP URL.

    EPA's summary page no longer always exposes the ZIP as a static anchor, so
    the synchronizer also checks EPA's official download directory. The stable
    ``SDWA_latest_downloads.zip`` path is the final official fallback.
    """
    configured = os.environ.get("SDWA_DOWNLOAD_URL", "").strip()
    if configured:
        return configured

    candidates: list[str] = []
    for page_url in (ECHO_DOWNLOAD_SUMMARY, ECHO_DOWNLOAD_INDEX):
        try:
            page = request(page_url, timeout=60, max_bytes=8_000_000).decode("utf-8", errors="replace")
            candidates.extend(_zip_links(page, page_url))
        except Exception as exc:
            print(f"[EPA sync] Could not inspect {page_url}: {exc}", file=sys.stderr, flush=True)

    candidates = list(dict.fromkeys(
        url for url in candidates
        if "sdwa" in url.lower() or "sdwis" in url.lower()
    ))
    candidates.sort(key=lambda url: (
        "sdwa_latest_downloads.zip" not in url.lower(),
        "latest" not in url.lower(),
        url.lower(),
    ))
    return candidates[0] if candidates else ECHO_SDWA_LATEST_ZIP


def download_to_file(url: str, destination: pathlib.Path, *, timeout: int = 900,
                     max_bytes: int = 1_500_000_000) -> dict[str, Any]:
    """Stream a large download to disk with visible progress and a SHA-256."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/zip,*/*"})
    digest = hashlib.sha256()
    total = 0
    next_report = 25 * 1024 * 1024
    with urllib.request.urlopen(req, timeout=timeout) as response, destination.open("wb") as handle:
        declared = response.headers.get("Content-Length")
        if declared and int(declared) > max_bytes:
            raise RuntimeError(f"download is {declared} bytes, above the {max_bytes}-byte safety limit")
        declared_int = int(declared) if declared and declared.isdigit() else None
        print(f"[EPA sync] Downloading {url}", file=sys.stderr, flush=True)
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError(f"download exceeded the {max_bytes}-byte safety limit")
            handle.write(chunk)
            digest.update(chunk)
            if total >= next_report:
                if declared_int:
                    pct = total * 100 / declared_int
                    print(f"[EPA sync] SDWA download: {total / 1048576:.0f} MiB / {declared_int / 1048576:.0f} MiB ({pct:.1f}%)", file=sys.stderr, flush=True)
                else:
                    print(f"[EPA sync] SDWA download: {total / 1048576:.0f} MiB", file=sys.stderr, flush=True)
                next_report += 25 * 1024 * 1024
    if total < 4 or destination.read_bytes()[:2] != b"PK":
        raise RuntimeError("EPA SDWA response was not a ZIP archive")
    print(f"[EPA sync] SDWA download complete: {total / 1048576:.1f} MiB", file=sys.stderr, flush=True)
    return {"sha256": digest.hexdigest(), "size_bytes": total}


def csv_rows(blob: bytes) -> Iterable[dict[str, str]]:
    text = blob.decode("utf-8-sig", errors="replace")
    yield from csv.DictReader(io.StringIO(text))


def table_kind(filename: str, headers: set[str]) -> str | None:
    label = snake(filename)
    joined = " ".join(headers)
    if "violation" in label or "violation" in joined:
        return "violations"
    if "lcr" in label and ("sample" in label or "sample" in joined):
        return "lcr_samples"
    if "public_notice" in label or ("public" in label and "notice" in label):
        return "public_notices"
    if "site_visit" in label or "sanitary_survey" in label:
        return "site_visits"
    if "event" in label or "milestone" in label:
        return "events"
    if "facility" in label:
        return "facilities"
    if "geographic" in label or "county_served" in label:
        return "geographic_areas"
    if "service_area" in label:
        return "service_areas"
    if "water_system" in label or "public_water_system" in label or "pws" in label:
        return "systems"
    return None


def is_seminole_geography(row: dict[str, Any]) -> bool:
    """Return True only for fields that explicitly identify Seminole County, FL."""
    values = {k: str(v or "").strip().upper() for k, v in row.items()}
    state = " ".join(values.get(k, "") for k in (
        "state_code", "state", "state_served", "primacy_agency_code", "state_code_served"
    ))
    county = " ".join(values.get(k, "") for k in (
        "county_served", "county_name", "county", "area_name", "geographic_area_name",
        "geographic_area_description", "counties_served"
    ))
    county_code = " ".join(values.get(k, "") for k in (
        "county_code", "county_fips", "fips_county_code", "geographic_area_code"
    ))
    florida = ("FL" in state.split()) or ("FLORIDA" in state) or values.get("primacy_agency_code") == "FL"
    seminole = "SEMINOLE" in county or county_code in {"117", "12117", "12-117", "US:12:117"}
    # Geographic-area tables often omit a separate state field, but PWS IDs are state-prefixed.
    raw_pid = str(values.get("pwsid", "") or values.get("pws_id", ""))
    return seminole and (florida or raw_pid.startswith("FL"))


def sync_sdwis_bulk(local_ids: set[str]) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, str]], dict[str, Any]]:
    url = discover_sdwa_zip()
    raw_dir = OUT / "raw"
    raw_dir.mkdir(exist_ok=True)
    # Reuse a recent archive rather than re-downloading ~400 MB. The bulk SDWA
    # export is refreshed quarterly, so a local copy from the last 30 days is
    # current. --force-download overrides.
    if not os.environ.get("SDWA_FORCE_DOWNLOAD"):
        existing = sorted(raw_dir.glob("sdwa_*.zip"), key=lambda f: f.stat().st_mtime, reverse=True)
        for candidate in existing:
            age_days = (dt.datetime.now().timestamp() - candidate.stat().st_mtime) / 86400
            if age_days <= 30 and zipfile.is_zipfile(candidate):
                print(f"[EPA sync] Reusing archive downloaded {age_days:.1f} days ago: {candidate.name}")
                print("[EPA sync] Set SDWA_FORCE_DOWNLOAD=1 to fetch a fresh copy.")
                return candidate, {"sha256": "reused-local-archive",
                                   "size_bytes": candidate.stat().st_size,
                                   "reused": True}

    with tempfile.NamedTemporaryFile(prefix="sdwa_", suffix=".zip.part", dir=raw_dir, delete=False) as temp:
        temp_path = pathlib.Path(temp.name)
    try:
        download_meta = download_to_file(url, temp_path, timeout=900, max_bytes=1_500_000_000)
        digest = download_meta["sha256"]
        raw_path = raw_dir / f"sdwa_{dt.datetime.now().strftime('%Y%m%d')}_{digest[:12]}.zip"
        if raw_path.exists():
            temp_path.unlink(missing_ok=True)
        else:
            temp_path.replace(raw_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    if not zipfile.is_zipfile(raw_path):
        raise RuntimeError(f"Downloaded EPA file is not a valid ZIP archive: {raw_path}")
    tables = {k: [] for k in ("systems", "facilities", "geographic_areas", "service_areas", "violations", "lcr_samples", "site_visits", "events", "public_notices")}
    errors: list[dict[str, str]] = []
    county_ids = set(local_ids)
    print("[EPA sync] Parsing and filtering the national SDWA archive for Seminole County...", file=sys.stderr, flush=True)
    with zipfile.ZipFile(raw_path) as archive:
        csv_names = [n for n in archive.namelist() if n.lower().endswith((".csv", ".txt"))]
        # First pass: discover every SDWIS PWS explicitly associated with Seminole County.
        for name in csv_names:
            label = snake(name)
            if not any(token in label for token in ("geographic", "service_area", "pub_water_system", "public_water_system")):
                continue
            try:
                reader = csv.DictReader(io.StringIO(archive.read(name).decode("utf-8-sig", errors="replace")))
                for raw_row in reader:
                    normalized = normalize_record(raw_row)
                    if normalized.get("pwsid") and is_seminole_geography(normalized):
                        county_ids.add(normalized["pwsid"])
            except Exception as exc:
                errors.append({"stage": "discover-seminole-pwsids", "file": name, "error": str(exc)})
        # Second pass: retain all tables for the complete discovered county registry.
        for name in csv_names:
            try:
                blob = archive.read(name)
                reader = csv.DictReader(io.StringIO(blob.decode("utf-8-sig", errors="replace")))
                headers = {snake(x) for x in (reader.fieldnames or [])}
                kind = table_kind(name, headers)
                if not kind:
                    continue
                for raw_row in reader:
                    row = normalize_record(raw_row)
                    if row.get("pwsid") in county_ids:
                        row["source_file"] = name
                        row["retrieved_at"] = utcnow()
                        tables[kind].append(row)
            except Exception as exc:
                errors.append({"stage": "parse-sdwa-bulk", "file": name, "error": str(exc)})
    for key in tables:
        tables[key] = dedupe(tables[key])
    meta = {
        "url": url, "sha256": digest, "size_bytes": download_meta["size_bytes"],
        "raw_file": str(raw_path.relative_to(ROOT)), "mode": "quarterly-bulk",
        "local_registry_pwsids": len(local_ids),
        "seminole_pwsids_discovered": len(county_ids), "pwsids": sorted(county_ids)
    }
    return tables, errors, meta


def first_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def extract_csv_payload(blob: bytes) -> tuple[str, bytes]:
    if blob[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith((".csv", ".txt"))]
            if not names:
                raise RuntimeError("WQP ZIP contained no CSV file")
            name = max(names, key=lambda n: archive.getinfo(n).file_size)
            return name, archive.read(name)
    return "response.csv", blob


def sync_wqp(start_date: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, str]], dict[str, Any]]:
    common: list[tuple[str, str]] = [
        ("countrycode", "US"), ("statecode", "US:12"), ("countycode", COUNTY_FIPS),
        ("mimeType", "csv"), ("zip", "yes"), ("providers", "NWIS"),
        ("providers", "STEWARDS"), ("providers", "STORET")
    ]
    station_url = WQP_STATION + "?" + urllib.parse.urlencode(common)
    result_params = common + [("startDateLo", start_date)] if start_date else common
    result_url = WQP_RESULT + "?" + urllib.parse.urlencode(result_params)
    errors: list[dict[str, str]] = []
    stations: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    try:
        _, station_csv = extract_csv_payload(request(station_url, timeout=600, max_bytes=500_000_000))
        for raw_row in csv.DictReader(io.StringIO(station_csv.decode("utf-8-sig", errors="replace"))):
            row = {snake(k): v for k, v in raw_row.items()}
            stations.append({
                "monitoring_location_id": first_value(row, "monitoring_location_identifier"),
                "monitoring_location_name": first_value(row, "monitoring_location_name"),
                "monitoring_location_type": first_value(row, "monitoring_location_type_name"),
                "latitude": first_value(row, "latitude_measure"),
                "longitude": first_value(row, "longitude_measure"),
                "organization_id": first_value(row, "organization_identifier"),
                "organization_name": first_value(row, "organization_formal_name"),
                "huc8": first_value(row, "huc_eight_digit_code", "huceight_digit_code"),
                "county_code": first_value(row, "county_code"),
                "source_url": station_url
            })
    except Exception as exc:
        errors.append({"stage": "wqp-stations", "error": str(exc)})
    try:
        _, result_csv = extract_csv_payload(request(result_url, timeout=900, max_bytes=1_200_000_000))
        for raw_row in csv.DictReader(io.StringIO(result_csv.decode("utf-8-sig", errors="replace"))):
            row = {snake(k): v for k, v in raw_row.items()}
            results.append({
                "result_id": first_value(row, "result_identifier"),
                "monitoring_location_id": first_value(row, "monitoring_location_identifier"),
                "activity_start_date": first_value(row, "activity_start_date"),
                "characteristic_name": first_value(row, "characteristic_name"),
                "result_value": first_value(row, "result_measure_result_measure_value", "result_measure_value"),
                "result_unit": first_value(row, "result_measure_measure_unit_code", "measure_unit_code"),
                "detection_condition": first_value(row, "result_detection_condition_text"),
                "activity_media": first_value(row, "activity_media_name"),
                "organization_id": first_value(row, "organization_identifier"),
                "sample_fraction": first_value(row, "result_sample_fraction_text"),
                "analytical_method": first_value(row, "analytical_method_method_identifier"),
                "source_url": result_url
            })
    except Exception as exc:
        errors.append({"stage": "wqp-results", "error": str(exc)})
    stations = dedupe([x for x in stations if x.get("monitoring_location_id")])
    results = dedupe([x for x in results if x.get("monitoring_location_id") and x.get("characteristic_name")])
    return stations, results, errors, {"station_url": station_url, "result_url": result_url, "start_date": start_date, "county_fips": COUNTY_FIPS}


def visible_text(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def pdf_text(pdf: bytes) -> str:
    command = shutil.which("pdftotext")
    if not command:
        return ""
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = pathlib.Path(tmp) / "report.pdf", pathlib.Path(tmp) / "report.txt"
        src.write_bytes(pdf)
        subprocess.run([command, "-layout", str(src), str(dst)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        return dst.read_text(encoding="utf-8", errors="replace") if dst.exists() else ""


def infer_year(text: str, url: str) -> int | None:
    years = [int(x) for x in re.findall(r"\b20(?:1\d|2\d)\b", text + " " + url)]
    valid = [x for x in years if 2010 <= x <= dt.datetime.now().year + 1]
    return max(valid) if valid else None


def extract_ccr_summary(text: str) -> dict[str, Any]:
    compact = re.sub(r"\s+", " ", text).strip()
    source_matches = re.findall(r".{0,120}\b(?:source water|water source|groundwater|aquifer|surface water)\b.{0,240}", compact, flags=re.I)
    compliance_matches = re.findall(r".{0,120}\b(?:in compliance|complied|violation|maximum contaminant level|MCL)\b.{0,240}", compact, flags=re.I)
    detected = []
    # Only extract rows that explicitly carry a concentration unit. This is
    # intentionally conservative: unlabeled table numbers are never guessed.
    unit_row = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 ()/.,+&'-]{2,90}?)\s+([<>≤≥]?\s*\d+(?:\.\d+)?)\s*(mg/L|ug/L|µg/L|ppm|ppb|pCi/L|NTU)\b", re.I)
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        match = unit_row.search(line)
        if not match:
            continue
        name = match.group(1).strip(" .:-")
        if any(x in name.upper() for x in ("MCLG", "DEFINITION", "ABBREVIATION", "UNIT OF MEASURE")):
            continue
        detected.append({"contaminant": name, "reported_value": match.group(2).replace(" ", ""), "unit": match.group(3), "source_line": line[:500]})
        if len(detected) >= 100:
            break
    return {
        "source_water": source_matches[0][:500].strip() if source_matches else None,
        "compliance_summary": compliance_matches[0][:500].strip() if compliance_matches else None,
        "detected_contaminants": detected,
        "text_extracted": bool(compact)
    }


def discover_report_links(base_url: str, raw: bytes) -> list[tuple[str, str]]:
    page = raw.decode("utf-8", errors="replace")
    found = []
    for href, label in re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', page, flags=re.I | re.S):
        title = re.sub(r"<[^>]+>", " ", label)
        title = re.sub(r"\s+", " ", html.unescape(title)).strip()
        url = urllib.parse.urljoin(base_url, html.unescape(href))
        test = (title + " " + url).lower()
        if (".pdf" in test or "documentcenter" in test) and any(k in test for k in ("water quality", "drinking water", "consumer confidence", "ccr", "annual report")):
            found.append((title or "Consumer Confidence Report", url))
    unique, seen = [], set()
    for item in found:
        if item[1] not in seen:
            seen.add(item[1]); unique.append(item)
    return unique


def sync_ccr(systems: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    configured = load_json(OUT / "ccr_sources.json", [])
    reports: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    file_dir = OUT / "ccr_files"
    file_dir.mkdir(exist_ok=True)
    for source in configured:
        pids = [normalize_pwsid(x) for x in source.get("pwsids", []) if normalize_pwsid(x)]
        if not pids:
            continue
        base = {k: v for k, v in source.items() if k != "pwsids"}
        raw = b""
        try:
            raw = request(source["url"], timeout=90, max_bytes=80_000_000)
            is_pdf = raw.startswith(b"%PDF") or ".pdf" in source["url"].lower() or "documentcenter/view" in source["url"].lower()
            if is_pdf:
                digest = hashlib.sha256(raw).hexdigest()
                local = file_dir / f"{source['id']}_{digest[:12]}.pdf"
                local.write_bytes(raw)
                text = pdf_text(raw)
                summary = extract_ccr_summary(text)
                for pid in pids:
                    reports.append({**base, "pwsid": pid, "report_year": source.get("report_year") or infer_year(text, source["url"]), "availability": "downloaded", "local_file": str(local.relative_to(ROOT)), "sha256": digest, "checked_at": utcnow(), **summary})
            else:
                links = discover_report_links(source["url"], raw)
                if links:
                    for title, report_url in links[:12]:
                        for pid in pids:
                            reports.append({**base, "pwsid": pid, "title": title, "url": report_url, "report_year": infer_year(title, report_url), "availability": "discovered-on-official-page", "checked_at": utcnow()})
                else:
                    text = visible_text(raw)
                    summary = extract_ccr_summary(text)
                    for pid in pids:
                        reports.append({**base, "pwsid": pid, "availability": "official-landing-page", "checked_at": utcnow(), **summary})
        except Exception as exc:
            errors.append({"stage": "ccr", "source": source.get("id", source.get("url", "unknown")), "error": str(exc)})
            for pid in pids:
                reports.append({**base, "pwsid": pid, "availability": "configured-official-source-not-downloaded", "checked_at": utcnow(), "sync_error": str(exc)})
    covered = {r.get("pwsid") for r in reports}
    for system in systems:
        pid = system["pwsid"]
        if str(system.get("system_type") or "").upper() not in {"COMMUNITY", "CWS"}:
            continue
        if pid not in covered:
            reports.append({
                "id": f"epa-ccr-finder-{pid}", "pwsid": pid, "publisher": "U.S. EPA",
                "title": f"Find the Consumer Confidence Report for {system.get('name') or pid}",
                "url": EPA_CCR_FINDER, "report_year": None, "availability": "epa-finder-only",
                "checked_at": utcnow(), "note": "No direct official report URL is bundled for this system; use the EPA finder or contact the supplier."
            })
    return dedupe(reports), errors


def write_sdwis(tables: dict[str, list[dict[str, Any]]]) -> None:
    mapping = {
        "systems": "sdwis_systems.json", "facilities": "sdwis_facilities.json",
        "geographic_areas": "sdwis_geographic_areas.json", "service_areas": "sdwis_service_areas.json",
        "violations": "sdwis_violations.json", "lcr_samples": "sdwis_lcr_samples.json",
        "site_visits": "sdwis_site_visits.json", "events": "sdwis_events.json",
        "public_notices": "sdwis_public_notices.json"
    }
    for key, filename in mapping.items():
        atomic_json(OUT / filename, tables.get(key, []))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("all", "sdwis", "wqp", "ccr"), default="all")
    parser.add_argument("--bulk-sdwis", action="store_true", help="Download and filter EPA's large quarterly SDWA ZIP instead of REST summaries")
    default_start = f"01-01-{max(2010, dt.datetime.now().year - 10)}"
    parser.add_argument("--wqp-start-date", default=os.environ.get("WQP_START_DATE", default_start), help="WQP lower date bound in MM-DD-YYYY format")
    args = parser.parse_args()

    systems = local_systems()
    local_ids = {x["pwsid"] for x in systems}
    old = load_json(OUT / "manifest.json", {})
    manifest: dict[str, Any] = {
        "status": "syncing", "generated_at": utcnow(), "seminole_system_count": len(systems),
        "sdwis": old.get("sdwis", {"status": "not-synced"}),
        "wqp": old.get("wqp", {"status": "not-synced"}),
        "ccr": old.get("ccr", {"status": "not-synced"}), "errors": []
    }
    atomic_json(OUT / "manifest.json", manifest)

    if args.source in {"all", "sdwis"}:
        try:
            if args.bulk_sdwis:
                try:
                    tables, errors, meta = sync_sdwis_bulk(local_ids)
                    status = "synced-quarterly-bulk" if not errors else "partial-quarterly-bulk"
                except Exception as bulk_exc:
                    print(f"[EPA sync] Bulk SDWA sync failed: {bulk_exc}", file=sys.stderr, flush=True)
                    print("[EPA sync] Falling back to EPA ECHO system summaries so SDWIS is not left empty.", file=sys.stderr, flush=True)
                    tables, rest_errors = sync_sdwis_rest(systems)
                    errors = [{"stage": "sdwis-bulk", "error": str(bulk_exc)}] + rest_errors
                    meta = {
                        "mode": "echo-rest-fallback",
                        "bulk_error": str(bulk_exc),
                        "bulk_url_attempted": discover_sdwa_zip(),
                        "note": "System summaries are available, but full violation/facility tables require a successful bulk sync."
                    }
                    status = "partial-rest-fallback"
            else:
                tables, errors = sync_sdwis_rest(systems)
                meta = {"mode": "echo-rest-system-summary", "note": "Run with --bulk-sdwis for full historical violation/facility tables."}
                status = "synced-rest-summary" if not errors else "partial-rest-summary"
            write_sdwis(tables)
            counts = {k: len(v) for k, v in tables.items()}
            manifest["sdwis"] = {"status": status, "downloaded_at": utcnow(), "counts": counts, **meta}
            manifest["errors"].extend(errors)
        except Exception as exc:
            manifest["sdwis"] = {"status": "failed", "downloaded_at": utcnow(), "error": str(exc)}
            manifest["errors"].append({"stage": "sdwis", "error": str(exc)})

    if args.source in {"all", "wqp"}:
        stations, results, errors, meta = sync_wqp(args.wqp_start_date)
        atomic_json(OUT / "wqp_stations.json", stations)
        atomic_json(OUT / "wqp_results.json", results)
        manifest["wqp"] = {
            "status": "synced" if stations and not errors else ("partial" if stations or results else "failed"),
            "downloaded_at": utcnow(), "station_count": len(stations), "result_count": len(results), **meta
        }
        manifest["errors"].extend(errors)

    if args.source in {"all", "ccr"}:
        reports, errors = sync_ccr(systems)
        atomic_json(OUT / "ccr_index.json", reports)
        manifest["ccr"] = {
            "status": "synced" if reports and not errors else ("partial" if reports else "failed"),
            "downloaded_at": utcnow(), "report_count": len(reports), "direct_or_landing_page_count": sum(1 for x in reports if x.get("availability") != "epa-finder-only"),
            "epa_finder": EPA_CCR_FINDER
        }
        manifest["errors"].extend(errors)

    statuses = [manifest[k].get("status", "not-synced") for k in ("sdwis", "wqp", "ccr")]
    manifest["status"] = "synced" if all(x.startswith("synced") for x in statuses) else ("partial" if any(x not in {"not-synced", "failed"} for x in statuses) else "failed")
    manifest["generated_at"] = utcnow()
    atomic_json(OUT / "manifest.json", manifest)
    print(json.dumps(manifest, indent=2))
    return 0 if manifest["status"] in {"synced", "partial"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
