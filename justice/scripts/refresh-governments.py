"""Keep only public organization/domain/location data from CISA's .gov registry."""
import csv,io,json,urllib.request,re
from pathlib import Path
from datetime import datetime,timezone
url='https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv'
rows=list(csv.DictReader(io.StringIO(urllib.request.urlopen(url,timeout=30).read().decode('utf-8-sig'))))
result=[]
for r in rows:
 domain=r['Domain name'].lower().strip();kind=r['Domain type'];state=r['State'].strip().upper();city=r['City'].strip()
 if kind not in ['City','County','Tribal','Special district'] or not re.fullmatch(r'[a-z0-9-]+\.gov',domain) or not re.fullmatch('[A-Z]{2}',state) or not city:continue
 result.append([domain,kind,r['Organization name'].strip(),city,state])
assert len(result)>5000
out={'source':'https://get.gov/about/data/','registry':url,'checked_at':datetime.now(timezone.utc).date().isoformat(),'fields':['domain','type','organization','city','state'],'records':result}
Path(__file__).resolve().parents[1].joinpath('governments.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps({'organizations':len(result),'cities':len(set((r[3].lower(),r[4])for r in result))}))
