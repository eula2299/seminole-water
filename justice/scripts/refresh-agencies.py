"""Rebuild official agency routes. Reads public EPA/USAGov directories only."""
import json, re, html, urllib.request, urllib.parse
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
SOURCES={'water':'https://www.epa.gov/DWdata/primacy-agency-drinking-water-data','local':'https://www.usa.gov/local-governments','social':'https://www.usa.gov/state-social-services','health':'https://www.usa.gov/state-health','consumer':'https://www.usa.gov/state-consumer','state':'https://www.usa.gov/state-governments'}
def plain(s):return html.unescape(re.sub('<[^>]+>',' ',s)).strip()
def links(raw,base):
 for url,label in re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>',raw,re.S|re.I):
  url=urllib.parse.urljoin(base,html.unescape(url))
  if urllib.parse.urlparse(url).scheme=='https':yield {'title':re.sub(r'\s+',' ',plain(label)),'url':url}
def read(name):
 cache=Path('/tmp/water-'+('epa' if name=='water' else name)+'.html')
 return cache.read_text() if cache.exists() else urllib.request.urlopen(SOURCES[name],timeout=30).read().decode()
raw={k:read(k) for k in SOURCES}
regions={}
for a in links(raw['state'],SOURCES['state']):
 m=re.fullmatch(r'(.+?)\s*\(([A-Z]{2})\)',a['title'])
 if m and m[2] not in ['FM','PW','MH']:regions[m[2]]={'code':m[2],'name':m[1],'routes':{'state':{**a,'source':SOURCES['state']}}}
by_name={v['name'].lower():v for v in regions.values()};by_name['virgin islands']=regions['VI']
for key in ['local','social','health','consumer']:
 for a in links(raw[key],SOURCES[key]):
  m=re.fullmatch(r'(.+?)\s*\(([A-Z]{2})\)',a['title'])
  if m and m[2] in regions and urllib.parse.urlparse(a['url']).hostname!='childcare.gov':regions[m[2]]['routes'][key]={**a,'source':SOURCES[key]}
heads=list(re.finditer(r'<h3\b[^>]*>(.*?)</h3>',raw['water'],re.S|re.I))
tribes=[]
for i,h in enumerate(heads):
 name=plain(h[1]);end=heads[i+1].start() if i+1<len(heads) else len(raw['water'])
 choices=list(links(raw['water'][h.end():end],SOURCES['water']))
 if not choices:continue
 route={**choices[0],'source':SOURCES['water']}
 if name.lower() in by_name:by_name[name.lower()]['routes']['water']=route
 elif name=='Navajo Nation':tribes.append({'code':'NN','name':name,'routes':{'water':route}})
regions['AS']['routes']['water']={'title':'American Samoa Environmental Protection Agency — Drinking Water','url':'https://www.asepa.gov/drinking-water','source':'https://www.asepa.gov/drinking-water'}
# An EPA-listed program is a contact route, not a claim that every state has enforcement primacy.
assert len(regions)==56
assert all('water' in r['routes'] for r in regions.values())
for r in regions.values():
 for kind in ['local','social','health','consumer']:
  if kind not in r['routes']:r['routes'][kind]={**r['routes']['state'],'directory':True}
result={'checked_at':datetime.now(timezone.utc).date().isoformat(),'sources':SOURCES,'jurisdictions':sorted(regions.values(),key=lambda r:r['name']),'tribes':tribes,'tribal_directory':{'title':'EPA Tribal Drinking Water Programs','url':'https://www.epa.gov/tribaldrinkingwater','source':'https://www.epa.gov/tribaldrinkingwater'}}
(ROOT/'agencies.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'jurisdictions':len(regions),'water_routes':sum('water'in r['routes']for r in regions.values()),'direct_routes':sum(not v.get('directory') for r in regions.values()for v in r['routes'].values())}))
