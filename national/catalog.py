"""Discover official occurrence archives; catalogue sizes are not ingested counts."""
from __future__ import annotations
import concurrent.futures,hashlib,html.parser,json,pathlib,re,tempfile,time,urllib.parse,urllib.request,zipfile
PAGES={
 'ucmr':'https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule',
 'syr4':'https://www.epa.gov/dwsixyearreview/six-year-review-4-compliance-monitoring-data-2012-2019',
 'syr3':'https://www.epa.gov/dwsixyearreview/six-year-review-3-compliance-monitoring-data-2006-2011'}
class Links(html.parser.HTMLParser):
 def __init__(self):super().__init__();self.links=[]
 def handle_starttag(self,tag,attrs):
  if tag=='a':
   for key,value in attrs:
    if key=='href':self.links.append(value)
def approved(url):
 u=urllib.parse.urlsplit(url)
 if u.scheme!='https' or u.hostname not in ('www.epa.gov','epa.gov') or u.username or u.password or u.port:raise ValueError('unapproved EPA source')
 return url
def discover():
 out=[]
 for family,page in PAGES.items():
  with urllib.request.urlopen(urllib.request.Request(page,headers={'User-Agent':'IsMyWaterOK/1.0 public water evidence'}),timeout=30) as r:
   approved(r.url);content=r.read(3000000).decode('utf-8')
  parser=Links();parser.feed(content)
  for href in parser.links:
   url=urllib.parse.urljoin(page,href);name=urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit('/',1)[-1]).lower().lstrip('_')
   if not name.endswith('.zip'):continue
   if family=='ucmr':
    m=re.fullmatch(r'ucmr([1-5])-occurrence-data.zip',name)
    if not m:continue
    ident='ucmr'+m[1]
   else:
    if not name.startswith(family+'_') or any(x in name for x in ('paired','treatment','corrective','cryptobinning','adwr','microbes_dr','microbes_gw')):continue
    ident=re.sub('[^a-z0-9_-]','_',name[:-4])
   approved(url)
   if not any(x['url']==url for x in out):out.append({'id':ident,'family':'ucmr' if family=='ucmr' else family,'url':url,'catalogue_url':page,'count_state':'not-downloaded'})
 order={'ucmr5':0,'ucmr4':1,'ucmr3':2,'ucmr2':3,'ucmr1':4}
 return sorted(out,key=lambda x:(order.get(x['id'],10 if x['family']=='syr4' else 20),x['id']))
def download(url,path,max_bytes=2000000000):
 approved(url);h=hashlib.sha256();size=0;started=time.monotonic()
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'IsMyWaterOK/1.0 public water evidence'}),timeout=90) as r,open(path,'wb') as f:
  approved(r.url)
  if int(r.headers.get('content-length') or 0)>max_bytes:raise ValueError('source archive byte budget exceeded')
  while chunk:=r.read(1024*1024):
   size+=len(chunk)
   if size>max_bytes or time.monotonic()-started>600:raise ValueError('source archive byte or time budget exceeded')
   h.update(chunk);f.write(chunk)
 if not zipfile.is_zipfile(path):raise ValueError('source did not return a ZIP archive')
 return {'sha256':h.hexdigest(),'archive_bytes':size}
def probe():
 from warehouse import process_member
 rows=discover();result={'catalogue':rows,'probes':[]};wanted=[x for x in rows if x['id'] in ('ucmr5','syr4_rads','syr3_rads')]
 def one(item):
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td);p=root/'source.zip';receipt=download(item['url'],p,200000000)
   with zipfile.ZipFile(p) as z:
    headers=[]
    for name in z.namelist():
     if name.lower().endswith(('.txt','.csv','.tsv')):
      with z.open(name) as f:blob=f.read(16000)
      try:sample=blob.decode('utf-8-sig')
      except UnicodeDecodeError:sample=blob.decode('cp1252')
      lines=sample.splitlines()[:4];entry={'member':name,'bytes':z.getinfo(name).file_size,'first_lines':lines}
      if (item['family']!='ucmr' or name.lower()=='ucmr5_all.txt'):
       src=root/'sample.tsv';src.write_text('\n'.join(lines)+'\n',encoding='utf-8')
       dest=root/(hashlib.sha256(name.encode()).hexdigest()+'.parquet')
       entry['schema_contract']=process_member(str(src),dest,root/'summary.sqlite',item['family'],name)
      headers.append(entry)
   return {**item,**receipt,'schemas':headers}
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  for future in [pool.submit(one,x) for x in wanted]:
   try:result['probes'].append(future.result())
   except Exception as e:result['probes'].append({'error':str(e)})
 print(json.dumps(result,indent=2));pathlib.Path('national-catalog-probe.json').write_text(json.dumps(result,indent=2))
 if len(result['probes'])!=3 or any('error' in x for x in result['probes']):raise RuntimeError('Source schema contract failed')
if __name__=='__main__':probe()
