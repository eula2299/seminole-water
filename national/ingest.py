#!/usr/bin/env python3
"""Stream official tabular source files into immutable, checksummed raw partitions.

Raw rows are not verified observations or independent samples. This worker is not
connected to the lookup API. It does not schedule downloads or create cloud resources.
"""
from __future__ import annotations
import argparse, csv, datetime as dt, hashlib, io, json, os, pathlib, shutil
import tempfile, urllib.parse, uuid, zipfile
from typing import Iterator
HOSTS={'echo.epa.gov','www.epa.gov','epa.gov','waterqualitydata.us','www.waterqualitydata.us','api.waterdata.usgs.gov','waterdata.usgs.gov'}
csv.field_size_limit(4*1024*1024)
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def sha(path):
 h=hashlib.sha256()
 with pathlib.Path(path).open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def official_url(value):
 u=urllib.parse.urlsplit(value)
 if u.scheme!='https' or u.hostname not in HOSTS or u.username or u.password or u.port not in (None,443):raise ValueError('Use the actual supported official HTTPS provenance URL.')
 return value

def streams(path,max_bytes):
 if zipfile.is_zipfile(path):
  with zipfile.ZipFile(path) as archive:
   members=[x for x in archive.infolist() if not x.is_dir() and x.filename.lower().endswith(('.csv','.tsv','.txt'))]
   if not members or len(members)>10000:raise ValueError('No supported tables or too many archive members.')
   if sum(x.file_size for x in members)>max_bytes:raise ValueError('Archive exceeds the decoded-byte budget.')
   for member in members:
    # Never extract archive paths onto the filesystem.
    with archive.open(member) as binary,io.TextIOWrapper(binary,encoding='utf-8-sig',errors='strict',newline='') as text:yield member.filename,text
 else:
  if path.stat().st_size>max_bytes:raise ValueError('Input exceeds the byte budget.')
  with path.open(encoding='utf-8-sig',errors='strict',newline='') as text:yield path.name,text

def ingest(path,output,source_id,source_url,fmt='parquet',batch_rows=5000,batch_bytes=16*1024*1024,max_bytes=50_000_000_000,max_rows=None,required_columns=()):
 path,output=pathlib.Path(path),pathlib.Path(output);official_url(source_url)
 if not path.is_file():raise ValueError('Input file does not exist.')
 if not source_id or len(source_id)>100:raise ValueError('A short source identifier is required.')
 if not 1<=batch_rows<=100000 or batch_bytes<1024 or max_bytes<1 or max_rows is not None and max_rows<1:raise ValueError('Invalid resource budgets.')
 if fmt not in ('parquet','jsonl'):raise ValueError('Unknown format.')
 pa=pq=None
 if fmt=='parquet':
  try:import pyarrow as pa;import pyarrow.parquet as pq
  except ImportError as exc:raise RuntimeError('Parquet requires PyArrow; install national/requirements.txt.') from exc
 output.mkdir(parents=True,exist_ok=True)
 staging=pathlib.Path(tempfile.mkdtemp(prefix='.staging-',dir=output));run_id=str(uuid.uuid4());started=now();parts=[];rows=[];count=0;buffer_bytes=0;processed_bytes=0
 def flush():
  nonlocal rows,buffer_bytes
  if not rows:return
  filename=f'part-{len(parts):08d}.{fmt}';target=staging/filename
  if fmt=='parquet':pq.write_table(pa.Table.from_pylist(rows),target,compression='zstd',row_group_size=len(rows))
  else:
   with target.open('w',encoding='utf8',newline='\n') as f:
    for row in rows:f.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
  parts.append({'file':filename,'raw_rows':str(len(rows)),'bytes':str(target.stat().st_size),'sha256':sha(target)});rows=[];buffer_bytes=0
 try:
  tables={}
  for name,text in streams(path,max_bytes):
   delimiter='\t' if name.lower().endswith(('.tsv','.txt')) else ','
   reader=csv.DictReader(text,delimiter=delimiter,strict=True);headers=reader.fieldnames
   if not headers or any(not x for x in headers) or len(set(headers))!=len(headers):raise ValueError('Missing or duplicate column headers.')
   if set(required_columns)-set(headers):raise ValueError('Required source columns are missing.')
   if any('<html' in x.lower() or '<!doctype' in x.lower() for x in headers):raise ValueError('Input is an HTML error page, not a table.')
   tables[name]=0
   for line,raw in enumerate(reader,2):
    if None in raw or any(v is None for v in raw.values()):raise ValueError(f'Malformed row {line} in {name}.')
    serialized=json.dumps(raw,ensure_ascii=False,sort_keys=True,separators=(',',':'));size=len(serialized.encode('utf8'));processed_bytes+=size
    if size>batch_bytes:raise ValueError('One record exceeds the batch-byte budget.')
    if processed_bytes>max_bytes:raise ValueError('Decoded content exceeds the byte budget.')
    if rows and (len(rows)>=batch_rows or buffer_bytes+size>batch_bytes):flush()
    count+=1;tables[name]+=1
    if max_rows is not None and count>max_rows:raise ValueError('Row budget exceeded; no partial run published.')
    rows.append({'source_id':source_id,'source_table':name,'source_row':line,'source_url':source_url,'imported_at':started,'raw_sha256':hashlib.sha256((source_id+'\0'+name+'\0'+serialized).encode()).hexdigest(),'raw_json':serialized});buffer_bytes+=size
  flush()
  if not count:raise ValueError('Zero-row input requires review; not publishing a success.')
  manifest={'schema_version':'national-raw/1','run_id':run_id,'source_id':source_id,'source_url':source_url,'input_sha256':sha(path),'started_at':started,'completed_at':now(),'status':'raw-staged-not-curated','format':fmt,'raw_rows_written':str(count),'unique_observations':None,'independent_samples':None,'household_samples_verified':'0','source_tables':{k:str(v) for k,v in tables.items()},'parts':parts,'limitations':['No source-profile freshness or completeness certification.','Exact row hashes do not establish cross-source sample identity.','Not connected to the serving API; no household or compliance conclusion.']}
  (staging/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8');destination=output/run_id;os.replace(staging,destination)
  return {**manifest,'directory':str(destination)}
 except BaseException:shutil.rmtree(staging,ignore_errors=True);raise

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--source-id',required=True);p.add_argument('--source-url',required=True);p.add_argument('--format',choices=['parquet','jsonl'],default='parquet');p.add_argument('--batch-rows',type=int,default=5000);p.add_argument('--batch-bytes',type=int,default=16*1024*1024);p.add_argument('--max-bytes',type=int,default=50_000_000_000);p.add_argument('--max-rows',type=int);p.add_argument('--required-column',action='append',default=[])
 a=p.parse_args()
 try:result=ingest(a.input,a.output,a.source_id,a.source_url,a.format,a.batch_rows,a.batch_bytes,a.max_bytes,a.max_rows,a.required_column);print(json.dumps(result,indent=2));return 0
 except Exception as exc:print(json.dumps({'status':'failed-not-published','error':str(exc)}));return 1
if __name__=='__main__':raise SystemExit(main())
