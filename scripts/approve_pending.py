from pathlib import Path
import shutil,json,datetime
R=Path(__file__).resolve().parents[1]; p=R/'data'/'pending_records.json'
if not p.exists(): raise SystemExit('No pending data')
shutil.copy2(R/'data'/'metal_records.json',R/'data'/f"metal_records.backup.{datetime.date.today()}.json")
shutil.copy2(p,R/'data'/'metal_records.json'); print('Approved pending records. Restart server.')
