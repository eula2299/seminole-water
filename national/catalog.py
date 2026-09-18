"""Discover official occurrence archives; catalogue sizes are never ingested counts."""
from __future__ import annotations
import concurrent.futures, hashlib, html.parser, io, json, os, pathlib, re, tempfile, time, urllib.parse, urllib.request, zipfile
PAGES={
 'ucmr':'https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule',
 'syr4':'https://www.epa.gov/dwsixyearreview/six-year-review-4-compliance-monitoring-data-2012-2019',
 'syr3':'https://www.epa.gov/dwsixyearreview/six-year-review-3-compliance-monitoring-data-2006-2011',
 'syr2':'https://www.epa.gov/dwsixyearreview/six-year-review-2-contaminant-occurrence-data-1998-2005'}
SYR2_ARCHIVES={
 'sixyearreview_2_dh_part1_1.zip':'syr2_part1',
 'sixyearreview_2_dh_part2_1.zip':'syr2_part2',
 'sixyearreview_2_dh_part3_0.zip':'syr2_part3',
 'nitrate-as-n-_chem1040_update_mdb.zip':'syr2_part4_nitrate_corrected',
 'sixyearreview_2_dh_part5_0.zip':'syr2_part5',
 'sixyearreview_2_dh_part6.zip':'syr2_part6'}
MAX_PAGE_BYTES=3000000
READ_CHUNK_BYTES=1024*1024
class Links(html.parser.HTMLParser):
 def __init__(self): super().__init__(); self.links=[]
 def handle_starttag(self,tag,attrs):
  if tag=='a':
   for key,value in attrs:
    if key=='href' and value: self.links.append(value)
def approved(url):
 u=urllib.parse.urlsplit(url)
 if u.scheme!='https' or u.hostname not in ('www.epa.gov','epa.gov') or u.username is not None or u.password is not None or u.port is not None: raise ValueError('unapproved EPA source')
 return url
class EPARedirectHandler(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  approved(newurl)
  return super().redirect_request(req,fp,code,msg,headers,newurl)
def _open_epa(url,timeout):
 approved(url)
 return urllib.request.build_opener(EPARedirectHandler()).open(urllib.request.Request(url,headers={'User-Agent':'IsMyWaterOK/1.0 public water evidence'}),timeout=timeout)
def _validate_budget(max_bytes):
 if isinstance(max_bytes,bool) or not isinstance(max_bytes,int) or max_bytes<0: raise ValueError('byte budget must be a nonnegative integer')
def _bounded_chunks(response,max_bytes,message):
 _validate_budget(max_bytes)
 if int(response.headers.get('content-length') or 0)>max_bytes: raise ValueError(message)
 size=0
 while chunk:=response.read(min(READ_CHUNK_BYTES,max_bytes-size+1)):
  size+=len(chunk)
  if size>max_bytes: raise ValueError(message)
  yield chunk
def discover():
 out=[]
 for family,page in PAGES.items():
  with _open_epa(page,timeout=30) as r:
   approved(r.url); content=b''.join(_bounded_chunks(r,MAX_PAGE_BYTES,'source catalogue page byte budget exceeded')).decode('utf-8')
  parser=Links();parser.feed(content)
  for href in parser.links:
   url=urllib.parse.urljoin(page,href);name=urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit('/',1)[-1]).lower()
   if not name.endswith('.zip'): continue
   if family=='ucmr':
    m=re.fullmatch(r'ucmr([1-5])-occurrence-data.zip',name)
    if not m: continue
    ident='ucmr'+m[1]
   elif family=='syr2':
    if name not in SYR2_ARCHIVES:continue
    ident=SYR2_ARCHIVES[name]
   else:
    name=name.lstrip('_')
    if not name.startswith(family+'_') or any(x in name for x in ('paired','treatment','corrective','cryptobinning','adwr','microbes_dr','microbes_gw')): continue
    ident=re.sub('[^a-z0-9_-]','_',name[:-4])
   approved(url)
   if not any(x['url']==url for x in out): out.append({'id':ident,'family':'ucmr' if family=='ucmr' else family,'url':url,'catalogue_url':page,'count_state':'not-downloaded'})
 order={'ucmr5':0,'ucmr4':1,'ucmr3':2,'ucmr2':3,'ucmr1':4}
 return sorted(out,key=lambda x:(order.get(x['id'],{'syr4':10,'syr3':20,'syr2':30}.get(x['family'],40)),x['id']))
def download(url,path,max_bytes=2000000000):
 approved(url);_validate_budget(max_bytes);h=hashlib.sha256();size=0;started=time.monotonic()
 with _open_epa(url,timeout=90) as r,open(path,'wb') as f:
  approved(r.url)
  for chunk in _bounded_chunks(r,max_bytes,'source archive byte budget exceeded'):
   size+=len(chunk)
   if time.monotonic()-started>600: raise ValueError('source archive time budget exceeded')
   h.update(chunk);f.write(chunk)
 if not zipfile.is_zipfile(path): raise ValueError('source did not return a ZIP archive')
 return {'sha256':h.hexdigest(),'archive_bytes':size}
def probe():
 from warehouse import process_member, export_mdb
 rows=discover();result={'catalogue':rows,'probes':[]};wanted=[x for x in rows if x['id'] in ('ucmr5','syr4_rads','syr3_rads','syr2_part4_nitrate_corrected')]
 def one(item):
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td);p=root/'source.zip';receipt=download(item['url'],p,200000000)
   with zipfile.ZipFile(p) as z:
    headers=[]
    for name in z.namelist():
     if item['family']=='syr2' and name.lower().endswith('.mdb'):
      mdb=root/'source.mdb';src=root/'source.tsv'
      with z.open(name) as f,mdb.open('wb') as out:
       import shutil
       shutil.copyfileobj(f,out,1024*1024)
      info=export_mdb(mdb,src)
      contract=process_member(str(src),root/'syr2.parquet',root/'summary.sqlite','syr2',name,info)
      if not contract['eligible_source_rows'] or contract['invalid_identity_date_rows']:raise ValueError('SYR2 source contract failed')
      headers.append({'member':name,'bytes':z.getinfo(name).file_size,'source_table':info,'schema_contract':contract})
     if name.lower().endswith(('.txt','.csv','.tsv')):
      with z.open(name) as f:blob=f.read(16000)
      try:sample=blob.decode('utf-8-sig')
      except UnicodeDecodeError:sample=blob.decode('cp1252')
      lines=sample.splitlines()[:4];entry={'member':name,'bytes':z.getinfo(name).file_size,'first_lines':lines}
      if (item['family']!='ucmr' or name.lower()=='ucmr5_all.txt'):
       src=root/'sample.tsv';src.write_text('\n'.join(lines)+'\n',encoding='utf-8')
       dest=root/(hashlib.sha256(name.encode()).hexdigest()+'.parquet')
       entry['schema_contract']=process_member(str(src),dest,root/'summary.sqlite',item['family'],name)
       contract=entry['schema_contract']
       if contract['invalid_identity_date_rows'] or not contract['eligible_source_rows']:
        raise ValueError('Live sample did not produce qualified identity/date/measurement rows: '+name)
      headers.append(entry)
   return {**item,**receipt,'schemas':headers}
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  for future in [pool.submit(one,x) for x in wanted]:
   try:result['probes'].append(future.result())
   except Exception as e:result['probes'].append({'error':str(e)})
 print(json.dumps(result,indent=2));pathlib.Path('national-catalog-probe.json').write_text(json.dumps(result,indent=2))
 if len(result['probes'])!=4 or any('error' in x for x in result['probes']):raise RuntimeError('Source schema contract failed')
if __name__=='__main__':probe()
