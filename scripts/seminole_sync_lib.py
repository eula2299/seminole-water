#!/usr/bin/env python3
"""Shared helpers for the Seminole local-data synchronizers.

Provides atomic JSON writes, HTTP GET (bytes/JSON/CSV), an ArcGIS FeatureServer
paginated query, and a Water Quality Portal CSV fetch. Mirrors the conventions
in scripts/sync_epa_seminole.py so the new PFAS, private-well, and telemetry
syncers stay consistent with the existing federal pipeline.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import pathlib
import re
import urllib.parse
import urllib.request
import zipfile
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 SeminoleWaterGodMode/13.8")
COUNTY_FIPS = "US:12:117"
COUNTY_NAME = "SEMINOLE"


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


def snake(value: str) -> str:
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(value or ""))
    return re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()


def normalize_pwsid(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or "").upper().replace("US", "").replace("FL", ""))
    return digits[-7:] if len(digits) >= 7 else digits


def request(url: str, *, timeout: int = 120, max_bytes: int = 600_000_000,
            retries: int = 4, backoff: float = 3.0) -> bytes:
    """GET with retries. Transient truncation (IncompleteRead) and timeouts are
    retried with exponential backoff rather than discarding the whole stage."""
    import http.client, time, urllib.error
    last = None
    for attempt in range(retries):
        try:
            return _request_once(url, timeout=timeout, max_bytes=max_bytes)
        except (http.client.IncompleteRead, TimeoutError, ConnectionError) as exc:
            last = exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", None)
            if isinstance(exc, urllib.error.HTTPError) and exc.code not in (429, 500, 502, 503, 504):
                raise
            last = exc
        except Exception as exc:
            if "IncompleteRead" in type(exc).__name__ or "timed out" in str(exc).lower():
                last = exc
            else:
                raise
        if attempt < retries - 1:
            time.sleep(backoff * (2 ** attempt))
    raise last if last else RuntimeError(f"request failed: {url}")


def discover_links(page_url: str, pattern: str, *, timeout: int = 90) -> list[str]:
    """Fetch a landing page and return absolute links matching a regex.

    Used instead of hardcoding file URLs that rotate with each data release.
    """
    html = request(page_url, timeout=timeout, max_bytes=40_000_000).decode("utf-8", errors="replace")
    out, seen = [], set()
    for href in re.findall(r'href="([^"]+)"', html):
        if not re.search(pattern, href, re.I):
            continue
        absolute = urllib.parse.urljoin(page_url, href)
        if absolute not in seen:
            seen.add(absolute)
            out.append(absolute)
    return out


def _request_once(url: str, *, timeout: int = 120, max_bytes: int = 600_000_000) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
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
    return json.loads(request(url, timeout=timeout).decode("utf-8", errors="replace"))


def extract_csv_payload(blob: bytes) -> bytes:
    if blob[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith((".csv", ".txt"))]
            if not names:
                raise RuntimeError("ZIP contained no CSV file")
            name = max(names, key=lambda n: archive.getinfo(n).file_size)
            return archive.read(name)
    return blob


def sniff_delimiter(text: str) -> str:
    """Detect the field separator from the header line.

    EPA's UCMR occurrence files are tab-delimited .txt, while the Water Quality
    Portal returns comma-delimited CSV. Assuming a comma silently collapses a
    tab-delimited file into a single column, so every lookup returns None and
    no rows match -- a failure that looks like "no data" rather than an error.
    """
    header = text.split("\n", 1)[0]
    counts = {d: header.count(d) for d in ("\t", ",", "|", ";")}
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else ","


def read_csv_rows(blob: bytes) -> list[dict[str, Any]]:
    text = extract_csv_payload(blob).decode("utf-8-sig", errors="replace")
    delim = sniff_delimiter(text)
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    return [{snake(k): v for k, v in row.items() if k} for row in reader]


def arcgis_query_all(feature_server_layer_url: str, where: str = "1=1", out_fields: str = "*",
                     out_sr: int = 4326, page: int = 1000, timeout: int = 120) -> list[dict[str, Any]]:
    """Page through an ArcGIS FeatureServer/MapServer layer 'query' endpoint as GeoJSON.

    feature_server_layer_url must already include the layer index, e.g.
    https://services.arcgis.com/XXXX/arcgis/rest/services/Layer/FeatureServer/0
    """
    base = feature_server_layer_url.rstrip("/") + "/query"
    offset, features = 0, []
    while True:
        params = urllib.parse.urlencode({
            "where": where, "outFields": out_fields, "outSR": out_sr,
            "f": "geojson", "resultOffset": offset, "resultRecordCount": page,
            "returnGeometry": "true",
        })
        data = request_json(f"{base}?{params}", timeout=timeout)
        batch = data.get("features", []) if isinstance(data, dict) else []
        if not batch:
            break
        for feat in batch:
            props = feat.get("properties", {}) or {}
            geom = feat.get("geometry") or {}
            lat = lon = None
            if geom.get("type") == "Point" and isinstance(geom.get("coordinates"), list):
                lon, lat = geom["coordinates"][0], geom["coordinates"][1]
            row = {snake(k): v for k, v in props.items()}
            if lat is not None:
                row.setdefault("latitude", lat)
                row.setdefault("longitude", lon)
            features.append(row)
        if len(batch) < page or not data.get("properties", {}).get("exceededTransferLimit"):
            # Some servers omit exceededTransferLimit; stop when a short page is returned.
            if len(batch) < page:
                break
        offset += page
        if offset > 200_000:  # safety
            break
    return features


def wqp_results(characteristic_names: list[str], start_date: str = "") -> tuple[list[dict[str, Any]], str]:
    """Fetch Water Quality Portal results for Seminole County (FIPS US:12:117)."""
    common = [("countrycode", "US"), ("statecode", "US:12"), ("countycode", COUNTY_FIPS),
              ("mimeType", "csv"), ("zip", "yes"), ("providers", "NWIS"),
              ("providers", "STEWARDS"), ("providers", "STORET")]
    for name in characteristic_names:
        common.append(("characteristicName", name))
    if start_date:
        common.append(("startDateLo", start_date))
    url = "https://www.waterqualitydata.us/data/Result/search?" + urllib.parse.urlencode(common)
    try:
        rows = read_csv_rows(request(url, timeout=900, max_bytes=1_200_000_000))
    except Exception:
        # The characteristicName filter is rejected by the current WQP API
        # (HTTP 400) while the unfiltered county query succeeds. Fall back to
        # the query that is known to work and filter locally instead.
        base = [kv for kv in common if kv[0] != "characteristicName"]
        url = "https://www.waterqualitydata.us/data/Result/search?" + urllib.parse.urlencode(base)
        allrows = read_csv_rows(request(url, timeout=900, max_bytes=1_500_000_000))
        wanted = {n.strip().lower() for n in characteristic_names}
        rows = [r for r in allrows
                if str(r.get("characteristic_name") or "").strip().lower() in wanted]
    out = []
    for row in rows:
        out.append({
            "result_id": row.get("result_identifier"),
            "monitoring_location_id": row.get("monitoring_location_identifier"),
            "activity_start_date": row.get("activity_start_date"),
            "sample_date": row.get("activity_start_date"),
            "characteristic_name": row.get("characteristic_name"),
            "result_value": row.get("result_measure_result_measure_value") or row.get("result_measure_value"),
            "result_unit": row.get("result_measure_measure_unit_code") or row.get("measure_unit_code"),
            "detection_condition": row.get("result_detection_condition_text"),
            "activity_media": row.get("activity_media_name"),
            "organization_id": row.get("organization_identifier"),
            "latitude": row.get("activity_location_latitude_measure"),
            "longitude": row.get("activity_location_longitude_measure"),
            "analytical_method": row.get("analytical_method_method_identifier"),
            "source_url": url,
        })
    return [r for r in out if r.get("characteristic_name")], url


# The 29 UCMR 5 PFAS analytes plus the canonical short names used by WQP/DEP.
PFAS_CHARACTERISTICS = [
    "Perfluorooctanoic acid", "Perfluorooctanesulfonic acid", "Perfluorohexanesulfonic acid",
    "Perfluorononanoic acid", "Hexafluoropropylene oxide dimer acid", "Perfluorobutanesulfonic acid",
    "Perfluorobutanoic acid", "Perfluoropentanoic acid", "Perfluorohexanoic acid",
    "Perfluoroheptanoic acid", "Perfluorodecanoic acid", "Perfluoroundecanoic acid",
    "Perfluorododecanoic acid", "Perfluorotridecanoic acid", "Perfluorotetradecanoic acid",
    "Perfluoropentanesulfonic acid", "Perfluoroheptanesulfonic acid", "Perfluorononanesulfonic acid",
    "Perfluorodecanesulfonic acid", "Lithium",
]
