#!/usr/bin/env python3
"""Synchronize Seminole County real-time telemetry & environmental water health.

Sources
-------
* Seminole County Water Atlas (County + USF), via the documented USF Water
  Institute API at https://api.wateratlas.usf.edu: continuous-monitoring station
  inventory, water-quality trend stations, and real-time rainfall telemetry.
* Seminole County Surface Water Quality Program: watershed monitoring sites and
  the 15 automated meteorological / telemetry weather stations.
* Seminole County GIS Library / Public Works: pipeline, drainage, and capital
  engineering asset counts (metadata inventory).

Files are written atomically to data/telemetry/. These are environmental and
infrastructure monitoring streams, not household tap samples.
"""
from __future__ import annotations

import argparse
import sys

import seminole_sync_lib as lib

OUT = lib.ROOT / "data" / "telemetry"
# Official USF Water Institute Water Atlas API (documented at
# https://api.wateratlas.usf.edu/docs). Verified 2026-07-22.
ATLAS_API = "https://api.wateratlas.usf.edu"
ATLAS_SITE = "seminole"                                 # Seminole County Water Atlas
ATLAS_STATIONS = ATLAS_API + "/DataMapper/Stations/All"           # continuous-monitoring stations
ATLAS_WQ_STATIONS = ATLAS_API + "/WQTrends/Stations?siteID=" + ATLAS_SITE
ATLAS_WQ_PARAMS = ATLAS_API + "/WQTrends/Params?siteID=" + ATLAS_SITE
ATLAS_RAINFALL = ATLAS_API + "/rainfall/latest?s=" + ATLAS_SITE   # real-time rainfall telemetry
ATLAS_PORTAL = "https://seminole.wateratlas.usf.edu"


ATLAS_STATION_CANDIDATES = [
    "/DataMapper/Stations/All",
    "/datamapper/stations/all",
    "/DataMapper/Stations/All/Minimized",
    "/datamapper/stations",
    "/DataMapper/stations/all",
]
ATLAS_WQ_CANDIDATES = [
    "/WQTrends/Datasources?siteID={site}",
    "/WQTrends/Stations",
    "/WQTrends/Stations?siteID={site}",
    "/WQTrends/Stations?siteid={site}",
    "/WQTrends/Stations?site={site}",
    "/WQTrends/Stations?s={site}",
    "/wqtrends/stations",
]
ATLAS_RAIN_CANDIDATES = [
    "/rainfall/latest?s=seminole",
    "/Rainfall/latest",
    "/rainfall",
    "/rainfall/latest",
    "/rainfall/latest?s={site}",
    "/rainfall/latest?siteID={site}",
    "/Rainfall/Latest",
]


def atlas_probe(base: str, candidates: list[str], site: str, errors: list, stage: str) -> tuple[list, str | None]:
    """Try each documented path shape and use the first that responds.

    The Water Atlas API is versioned independently of its docs page, so a single
    hardcoded path is fragile. Every attempt is recorded so a failure reports
    what was actually tried rather than a bare 404.
    """
    attempted = []
    for path in candidates:
        url = base.rstrip("/") + path.format(site=site)
        try:
            payload = lib.request_json(url, timeout=90)
            rows = payload if isinstance(payload, list) else (
                payload.get("features") or payload.get("stations") or payload.get("data") or [])
            if rows:
                print(f"[Telemetry sync] {stage}: using {url}")
                return list(rows), url
            attempted.append({"url": url, "result": "empty"})
        except Exception as exc:  # noqa: BLE001
            attempted.append({"url": url, "result": str(exc)})
    errors.append({"stage": stage, "error": "no candidate endpoint returned data", "attempted": attempted})
    return [], None


def _atlas_rows(url: str, errors: list, stage: str) -> list[dict]:
    try:
        data = lib.request_json(url, timeout=120)
        if isinstance(data, dict):
            data = data.get("stations") or data.get("results") or data.get("features") or []
        rows = []
        for item in data if isinstance(data, list) else []:
            props = item.get("properties", item) if isinstance(item, dict) else {}
            row = {lib.snake(k): v for k, v in props.items()}
            geom = item.get("geometry") if isinstance(item, dict) else None
            if isinstance(geom, dict) and isinstance(geom.get("coordinates"), list):
                row.setdefault("longitude", geom["coordinates"][0])
                row.setdefault("latitude", geom["coordinates"][1])
            rows.append(row)
        return rows
    except Exception as exc:  # noqa: BLE001
        errors.append({"stage": stage, "error": str(exc)})
        return []


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync Seminole County telemetry & environmental water health")
    ap.add_argument("--atlas-stations-url", default=ATLAS_STATIONS)
    ap.add_argument("--atlas-wq-url", default=ATLAS_WQ_STATIONS)
    ap.add_argument("--rainfall-url", default=ATLAS_RAINFALL,
                    help="Water Atlas real-time rainfall telemetry (defaults to the official endpoint)")
    ap.add_argument("--atlas-site", default=ATLAS_SITE)
    ap.add_argument("--surface-sites-url", help="ArcGIS FeatureServer layer URL for county surface-water monitoring sites")
    ap.add_argument("--weather-stations-url", help="ArcGIS FeatureServer layer URL for the 15 automated telemetry weather stations")
    ap.add_argument("--gis-assets-url", help="ArcGIS FeatureServer layer URL for pipeline/drainage assets (counted, not stored in full)")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    errors: list = []

    stations = _atlas_rows(args.atlas_stations_url, errors, "atlas-stations")
    atlas_wq = _atlas_rows(args.atlas_wq_url, errors, "atlas-wq")

    surface = lib.load_json(OUT / "surface_water_sites.json", [])
    if args.surface_sites_url:
        try:
            surface = [{**f, "source": "seminole-surface-water-program", "granularity": "watershed-station"}
                       for f in lib.arcgis_query_all(args.surface_sites_url)]
        except Exception as exc:  # noqa: BLE001
            errors.append({"stage": "surface-sites", "error": str(exc)})

    # Weather / rainfall telemetry: the Water Atlas rainfall endpoint is the
    # documented real-time feed. A county ArcGIS layer can still be supplied.
    weather = []
    if args.weather_stations_url:
        try:
            weather = [{**f, "source": "seminole-surface-water-program", "granularity": "weather-station"}
                       for f in lib.arcgis_query_all(args.weather_stations_url)]
        except Exception as exc:  # noqa: BLE001
            errors.append({"stage": "weather-stations", "error": str(exc)})
    if not weather:
        _rain, _ = atlas_probe(ATLAS_API, ATLAS_RAIN_CANDIDATES, args.atlas_site, errors, "atlas-rainfall")
        weather = [{**r, "source": "seminole-water-atlas", "granularity": "weather-station"} for r in _rain]

    gis_assets = lib.load_json(OUT / "gis_assets.json", [])
    if args.gis_assets_url:
        try:
            feats = lib.arcgis_query_all(args.gis_assets_url)
            gis_assets = [{"asset_type": f.get("asset_type") or f.get("type") or "asset",
                           "layer_url": args.gis_assets_url} for f in feats[:5000]]
        except Exception as exc:  # noqa: BLE001
            errors.append({"stage": "gis-assets", "error": str(exc)})

    lib.atomic_json(OUT / "atlas_stations.json", stations)
    lib.atomic_json(OUT / "atlas_wq.json", atlas_wq)
    lib.atomic_json(OUT / "surface_water_sites.json", surface)
    lib.atomic_json(OUT / "weather_stations.json", weather)
    lib.atomic_json(OUT / "gis_assets.json", gis_assets)

    populated = stations or atlas_wq or surface or weather or gis_assets
    status = "synced" if populated else ("synced-empty" if not errors else "error")
    lib.atomic_json(OUT / "manifest.json", {
        "family": "telemetry-and-environmental-water-health",
        "status": status,
        "downloaded_at": lib.utcnow(),
        "generated_at": lib.utcnow(),
        "county": lib.COUNTY_NAME,
        "sources": ["seminole-water-atlas", "seminole-surface-water-program", "seminole-gis-library"],
        "counts": {"atlas_stations": len(stations), "atlas_wq": len(atlas_wq),
                   "surface_water_sites": len(surface), "weather_stations": len(weather),
                   "gis_assets": len(gis_assets)},
        "errors": errors,
        "note": "Environmental and infrastructure monitoring context; not a household tap sample.",
    })
    print(f"[Telemetry sync] atlas_stations={len(stations)} atlas_wq={len(atlas_wq)} surface={len(surface)} weather={len(weather)} gis={len(gis_assets)} errors={len(errors)}", file=sys.stderr)
    for e in errors:
        print(f"  ! {e['stage']}: {e['error']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
