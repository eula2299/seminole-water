#!/usr/bin/env python3
"""Backward-compatible SDWIS sync entry point.

This now delegates to the comprehensive Seminole County EPA synchronizer.
Set SDWA_DOWNLOAD_URL or allow the synchronizer to discover EPA's quarterly
SDWA ZIP. The full bulk mode imports violations plus systems, facilities,
service/geographic areas, LCR samples, site visits, events, and public notices.
"""
import pathlib, subprocess, sys
script=pathlib.Path(__file__).with_name('sync_epa_seminole.py')
raise SystemExit(subprocess.call([sys.executable,str(script),'--source','sdwis','--bulk-sdwis',*sys.argv[1:]]))
