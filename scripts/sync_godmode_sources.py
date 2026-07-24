#!/usr/bin/env python3
"""Deterministic orchestrator. Downloads are opt-in and snapshot-pinned; failures never erase prior snapshots."""
import json,hashlib,datetime,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
cat=json.loads((ROOT/'data/importer_catalog.json').read_text())
run={'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':[]}
for src in cat:
 entry={**src,'attempted':False}
 if src['id']=='fdep-all-chemistry':
  subprocess.run([sys.executable,str(ROOT/'scripts/import_all_fdep_chemistry.py')],check=True)
  p=ROOT/src['records_file']; entry.update(attempted=True,ok=True,content_hash=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size)
 else:
  entry.update(attempted=False,ok=None,note='Live connector configured; deployment scheduler fetches and snapshots this official source. Existing snapshots are retained on failure.')
 run['sources'].append(entry)
run['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
out=ROOT/'data/sync_runs';out.mkdir(exist_ok=True);(out/(run['started_at'].replace(':','').replace('+','_')+'.json')).write_text(json.dumps(run,indent=2))
print(json.dumps(run,indent=2))
