"""Bounded, durable national occurrence ingestion and read-only serving.

The archive retains source records, NOT independently sampled households. Neither
record counts nor statistical summaries are a certification of current safety.
"""
from __future__ import annotations
import datetime as dt, hashlib, io, json, os, pathlib, re, shutil, socket, sqlite3, tempfile, threading, time, urllib.parse, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
try:
 from .catalog import discover, download
except ImportError:
 from catalog import discover, download

VERSION='occurrence-warehouse/1'
PARSER_VERSION=2
ROOT=pathlib.Path(os.environ.get('WAREHOUSE_DIR','/tmp/water-warehouse'))
MAX_ARCHIVE=int(os.environ.get('WAREHOUSE_MAX_ARCHIVE_BYTES','2000000000'))
MAX_TOTAL=int(os.environ.get('WAREHOUSE_MAX_TOTAL_BYTES','20000000000'))
MAX_EXPANDED=20_000_000_000
LOCK=threading.RLock()
STATE={'schema':VERSION,'sources':{},'errors':{},'ingestion_status':'starting','current_archive':None,'target_minimum_records':200000000,'trained_prediction_models':0}

def utc(): return dt.datetime.now(dt.timezone.utc).isoformat()
def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  while b:=f.read(1024*1024):h.update(b)
 return h.hexdigest()
def log(event,**fields):print(json.dumps({'event':event,'time':utc(),**fields},default=str),flush=True)
def quote(name):return '"'+str(name).replace('"','""')+'"'
def lit(value):return "'"+str(value).replace("'","''")+"'"
def names(columns):return {re.sub('[^a-z0-9]','',str(x).lower()):str(x) for x in columns}
def column(columns,*options,required=False):
 index=names(columns)
 for option in options:
  if option in index:return 'NULLIF(TRIM('+quote(index[option])+"), '')"
 if required:raise ValueError('Missing required source column: '+','.join(options))
 return 'NULL::VARCHAR'
def mapping(columns,family):
 c=lambda *o,**kw:column(columns,*o,**kw)
 if family=='ucmr':
  return dict(pwsid=c('pwsid',required=True),name=c('pwsname'),analyte=c('contaminant',required=True),date=c('collectiondate',required=True),value=c('analyticalresultvalue',required=True),unit=c('units',required=True),qualifier=c('analyticalresultssign',required=True),limit=c('mrl'),limit_unit=c('units'),sample=c('sampleid'),point=c('samplepointid'),point_type=c('samplepointtype'),facility=c('facilityid'),source_type=c('ucmr1sampletype'),origin=c('sampleid'),presence='NULL::VARCHAR')
 return dict(pwsid=c('pwsid',required=True),name=c('systemname','pwsname'),analyte=c('analytename','contaminant',required=True),date=c('samplecollectiondate','collectiondate',required=True),value=c('value','analyticalresultvalue',required=True),unit=c('unit','units',required=True),qualifier=c('detect',required=True),limit=c('detectionlimitvalue'),limit_unit=c('detectionlimitunit'),sample=c('sampleid'),point=c('samplingpointid','samplepointid'),point_type=c('samplingpointtype','samplepointtype'),facility=c('waterfacilityid','facilityid'),source_type=c('sourcetypecode'),origin=c('sixyearid','sixyearreviewid','sampleid'),presence=c('presenceindicatorcode'))
def canonical_sql(columns,family):
 m=mapping(columns,family)
 q=m['qualifier']
 qualifier=(f"CASE {q} WHEN '<' THEN '<' WHEN '=' THEN '=' ELSE {q} END" if family=='ucmr' else f"CASE {q} WHEN '0' THEN '<' WHEN '1' THEN '=' ELSE {q} END")
 date=f"COALESCE(TRY_STRPTIME({m['date']}, ['%m/%d/%Y','%m/%d/%Y %H:%M:%S','%Y-%m-%d %H:%M:%S.%f','%Y-%m-%d %H:%M:%S','%Y-%m-%d'])::DATE, TRY_CAST(SUBSTR({m['date']},1,10) AS DATE))"
 value=f"TRY_CAST({m['value']} AS DOUBLE)"
 valid=f"regexp_full_match(UPPER({m['pwsid']}),'[A-Z0-9]{{9}}') AND {date} IS NOT NULL AND {date}<=CURRENT_DATE AND {m['analyte']} IS NOT NULL"
 return f"""SELECT UPPER({m['pwsid']}) AS pwsid,{m['name']} AS system_name,{m['analyte']} AS analyte,
 {date} AS sample_date,{m['date']} AS original_date,{m['value']} AS original_value,{m['unit']} AS original_unit,
 {qualifier} AS qualifier,{m['limit']} AS reporting_limit,{m['limit_unit']} AS reporting_limit_unit,
 CASE WHEN {valid} AND {m['unit']} IS NOT NULL AND {qualifier}='=' AND isfinite({value}) AND {value}>=0 THEN {value} ELSE NULL END AS detected_value,
 {m['sample']} AS sample_id,{m['point']} AS point_id,{m['facility']} AS facility_id,
 {m['point_type']} AS point_type,{m['source_type']} AS source_type,{m['origin']} AS origin_id,{m['presence']} AS presence,
 CASE WHEN {m['point_type']} IN ('RW','SR') OR {m['source_type']}='RW' THEN 'source-water' WHEN {m['point_type']} IN ('EP','DS') THEN 'system-monitoring' ELSE 'system-sampling-context-unspecified' END AS evidence_scope,
 {valid} AS identity_date_valid,sha256(to_json(r)) AS source_record_sha256,to_json(r) AS original_record
 FROM raw_input r"""

def process_member(source_file,parquet_path,summary_db,family,member):
 import duckdb
 con=duckdb.connect()
 con.execute("SET memory_limit='1800MB'; SET threads=2; SET preserve_insertion_order=false")
 con.execute('SET temp_directory='+lit(str(parquet_path.parent/'spill')))
 try:
  con.execute("CREATE VIEW raw_input AS SELECT * FROM read_csv("+lit(source_file)+", delim='\t', header=true, all_varchar=true, quote='\"', escape='\"', strict_mode=true, null_padding=true, max_line_size=1048576)")
  columns=[x[0] for x in con.execute('SELECT * FROM raw_input LIMIT 0').description]
  sql=canonical_sql(columns,family)
  con.execute('CREATE TABLE normalized AS '+sql)
  raw_count=con.execute('SELECT COUNT(*) FROM normalized').fetchone()[0]
  if not raw_count:raise ValueError('Empty sample member')
  con.execute('CREATE TABLE distinct_rows AS SELECT * FROM normalized QUALIFY ROW_NUMBER() OVER (PARTITION BY source_record_sha256)=1')
  count,invalid=con.execute('SELECT COUNT(*),COUNT(*) FILTER (WHERE NOT COALESCE(identity_date_valid,false)) FROM distinct_rows').fetchone()
  if invalid==count:raise ValueError('No rows have valid system identity and sample date; source schema review required')
  con.execute("COPY (SELECT * FROM distinct_rows ORDER BY pwsid,sample_date DESC) TO "+lit(parquet_path)+" (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 65536)")
  cursor=con.execute("""SELECT pwsid,analyte,COALESCE(original_unit,reporting_limit_unit,''),evidence_scope,COUNT(*),COUNT(detected_value),COUNT(*) FILTER(WHERE qualifier='<'),MIN(sample_date)::VARCHAR,MAX(sample_date)::VARCHAR,MIN(detected_value),MAX(detected_value),arg_max(original_record,sample_date),COUNT(*) FILTER(WHERE NOT COALESCE(identity_date_valid,false)) FROM distinct_rows WHERE COALESCE(identity_date_valid,false) GROUP BY 1,2,3,4""")
  db=sqlite3.connect(summary_db)
  try:
   db.execute('CREATE TABLE IF NOT EXISTS summaries (pwsid TEXT,analyte TEXT,unit TEXT,scope TEXT,n INTEGER,detects INTEGER,nondetects INTEGER,first_date TEXT,last_date TEXT,min_detect REAL,max_detect REAL,latest_record TEXT,invalid_identity_date INTEGER,member TEXT)')
   while rows:=cursor.fetchmany(2000):db.executemany('INSERT INTO summaries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[tuple(r)+(member,) for r in rows])
   db.commit()
  finally:db.close()
  return {'member':member,'raw_rows':raw_count,'distinct_source_rows':count,'invalid_identity_date_rows':invalid,'identity_date_valid_rows':count-invalid,'sha256':digest(parquet_path),'bytes':parquet_path.stat().st_size}
 finally:con.close()

class Store:
 def __init__(self):
  import boto3
  from botocore.config import Config
  self.bucket=os.environ['AWS_S3_BUCKET_NAME']
  self.client=boto3.client('s3',endpoint_url=os.environ['AWS_ENDPOINT_URL'],region_name=os.environ.get('AWS_DEFAULT_REGION','auto'),config=Config(signature_version='s3v4',connect_timeout=10,read_timeout=90,retries={'max_attempts':3},s3={'addressing_style':'path'}))
 def json(self,key):
  from botocore.exceptions import ClientError
  try:return json.loads(self.client.get_object(Bucket=self.bucket,Key=key)['Body'].read(10_000_000))
  except ClientError as e:
   if e.response.get('Error',{}).get('Code') in ('NoSuchKey','404'):return None
   raise
 def put_json(self,key,value):self.client.put_object(Bucket=self.bucket,Key=key,Body=json.dumps(value,allow_nan=False).encode(),ContentType='application/json')
 def put(self,key,path):self.client.upload_file(str(path),self.bucket,key)
 def total_bytes(self):
  return sum(obj['Size'] for page in self.client.get_paginator('list_objects_v2').paginate(Bucket=self.bucket) for obj in page.get('Contents',[]))
 def get(self,key,path,sha):
  if path.exists() and digest(path)==sha:return
  path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_suffix('.part')
  self.client.download_file(self.bucket,key,str(temporary))
  if digest(temporary)!=sha:temporary.unlink(missing_ok=True);raise ValueError('Object checksum mismatch')
  temporary.replace(path)

def summary_path(ident,sha,parser_version=1):return ROOT/'summaries'/f'{ident}-{sha}-parser{parser_version}.sqlite'
def activate(store,receipt):
 p=summary_path(receipt['id'],receipt['sha256'],receipt.get('parser_version',1))
 store.get(receipt['summary_key'],p,receipt['summary_sha256'])
 with LOCK:STATE['sources'][receipt['id']]=receipt;STATE['errors'].pop(receipt['id'],None)
def status():
 with LOCK:s=json.loads(json.dumps(STATE))
 receipts=list(s['sources'].values());count=sum(x['distinct_source_rows'] for x in receipts)
 s.update(retained_source_records=count,raw_rows=sum(x['raw_rows'] for x in receipts),published_archives=len(receipts),parser_version=PARSER_VERSION,identity_date_valid_records=sum(x.get('identity_date_valid_rows',0) for x in receipts),legacy_parser_archives=sum(x.get('parser_version',1)!=PARSER_VERSION for x in receipts),stored_bytes=sum(x['stored_bytes'] for x in receipts),target_met=count>=s['target_minimum_records'],count_definition='distinct source-field rows within each published archive member; not independently sampled households; cross-source independence not certified',household_safety_certified=False,coverage_complete=False)
 return s

def ingest(store,item):
 existing=store.json('v1/latest/'+item['id']+'.json')
 if existing:activate(store,existing)
 with LOCK:STATE['current_archive']=item['id']
 with tempfile.TemporaryDirectory(prefix='ingest-',dir=ROOT) as td:
  work=pathlib.Path(td);archive=work/'source.zip'
  receipt={**item,**download(item['url'],archive,MAX_ARCHIVE),'retrieved_at':utc(),'schema':VERSION,'parser_version':PARSER_VERSION}
  if existing and existing['sha256']==receipt['sha256'] and existing.get('parser_version')==PARSER_VERSION:
   log('unchanged',source=item['id']);return
  base='v1/data/'+receipt['sha256']+'/parser-'+str(PARSER_VERSION);summary=work/'summary.sqlite';parts=[];skipped=[];expanded=0
  with zipfile.ZipFile(archive) as z:
   members=[m for m in z.infolist() if not m.is_dir() and m.filename.lower().endswith(('.txt','.tsv','.csv'))]
   for member in members:
    name=pathlib.PurePosixPath(member.filename).name;low=name.lower()
    if item['family']=='ucmr' and not re.fullmatch(r'ucmr[1-5]_all\.txt',low):skipped.append({'member':name,'reason':'ancillary-not-observation-table'});continue
    if any(x in low for x in ('paired','hybrid','readme','dictionary','treatment')):skipped.append({'member':name,'reason':'derived-or-documentation-table'});continue
    expanded+=member.file_size
    if expanded>MAX_EXPANDED:raise ValueError('Expanded archive budget exceeded')
    raw=work/'member.raw';text=work/'member.tsv'
    with z.open(member) as src,open(raw,'wb') as dst:shutil.copyfileobj(src,dst,1024*1024)
    encoding='utf-8-sig'
    try:
     with open(raw,'r',encoding=encoding) as src,open(text,'w',encoding='utf-8',newline='') as dst:
      while chunk:=src.read(1024*1024):dst.write(chunk)
    except UnicodeDecodeError:
     encoding='cp1252'
     with open(raw,'r',encoding=encoding) as src,open(text,'w',encoding='utf-8',newline='') as dst:
      while chunk:=src.read(1024*1024):dst.write(chunk)
    raw.unlink();partpath=work/(hashlib.sha256(name.encode()).hexdigest()[:16]+'.parquet')
    part=process_member(str(text),partpath,summary,item['family'],name);part['encoding']=encoding;part['key']=base+'/'+partpath.name
    parts.append(part);text.unlink();log('member-processed',source=item['id'],member=name,rows=part['distinct_source_rows'])
  if not parts:raise ValueError('No sample tables matched the validated schema')
  db=sqlite3.connect(summary);db.execute('CREATE INDEX IF NOT EXISTS summaries_pws ON summaries(pwsid)');db.commit();db.close()
  receipt.update(parts=parts,skipped_members=skipped,raw_rows=sum(x['raw_rows'] for x in parts),distinct_source_rows=sum(x['distinct_source_rows'] for x in parts),identity_date_valid_rows=sum(x['identity_date_valid_rows'] for x in parts),summary_key=base+'/summary.sqlite',summary_sha256=digest(summary))
  receipt['stored_bytes']=receipt['archive_bytes']+summary.stat().st_size+sum(x['bytes'] for x in parts)
  if store.total_bytes()+receipt['stored_bytes']>MAX_TOTAL:raise ValueError('Persistent storage budget exceeded; no publication performed')
  store.put(base+'/original.zip',archive)
  for part in parts:store.put(part['key'],work/pathlib.PurePosixPath(part['key']).name)
  store.put(receipt['summary_key'],summary)
  store.put_json(base+'/receipt.json',receipt)
  store.put_json('v1/latest/'+item['id']+'.json',receipt)
  activate(store,receipt);log('archive-published',source=item['id'],records=receipt['distinct_source_rows'],total_records=status()['retained_source_records'])

def pws_report(pwsid):
 if not re.fullmatch('[A-Z0-9]{9}',pwsid):raise ValueError('Invalid complete PWSID')
 with LOCK:receipts=list(STATE['sources'].values())
 summaries=[];sources=[];truncated=[]
 for receipt in receipts:
  db=sqlite3.connect(f'file:{summary_path(receipt["id"],receipt["sha256"],receipt.get("parser_version",1))}?mode=ro',uri=True)
  db.row_factory=sqlite3.Row
  try:
   rows=db.execute('SELECT * FROM summaries WHERE pwsid=? ORDER BY last_date DESC LIMIT 501',(pwsid,)).fetchall()
   if len(rows)>500:truncated.append(receipt['id'])
   if rows:sources.append({k:receipt[k] for k in ('id','url','catalogue_url','retrieved_at','sha256')})
   for row in rows[:500]:
    item=dict(row);item['latest_record']=json.loads(item['latest_record']) if item['latest_record'] else None;item['source_id']=receipt['id'];summaries.append(item)
  finally:db.close()
 return {'pwsid':pwsid,'status':'records-returned' if summaries else 'no-records-in-loaded-archives','summaries':summaries,'sources':sources,'archives_checked':len(receipts),'truncated_archives':truncated,'scope':'public-system-samples-not-household','current_safety':'not-determined','cross_source_sample_independence_certified':False,'historical_data':True,'coverage_complete':False}

def loop():
 ROOT.mkdir(parents=True,exist_ok=True)
 try:store=Store()
 except Exception as e:
  with LOCK:STATE['ingestion_status']='storage-unavailable';STATE['errors']['storage']=type(e).__name__
  log('storage-unavailable',error=type(e).__name__);return
 while True:
  try:
   items=discover()
   with LOCK:STATE['catalogue_archives']=len(items);STATE['ingestion_status']='ingesting'
   for item in items:
    try:
     receipt=store.json('v1/latest/'+item['id']+'.json')
     if receipt:activate(store,receipt)
    except Exception as e:log('restore-error',source=item['id'],error=type(e).__name__)
   for item in items:
    try:ingest(store,item)
    except Exception as e:
     with LOCK:STATE['errors'][item['id']]=str(e)[:250]
     log('ingest-error',source=item['id'],error=str(e)[:250])
   with LOCK:STATE['ingestion_status']='cycle-complete-with-gaps' if STATE['errors'] else 'cycle-complete';STATE['current_archive']=None;STATE['last_cycle_at']=utc()
  except Exception as e:
   with LOCK:STATE['ingestion_status']='catalogue-unavailable';STATE['errors']['catalogue']=type(e).__name__
   log('catalogue-unavailable',error=type(e).__name__)
  time.sleep(max(1,int(os.environ.get('WAREHOUSE_REFRESH_HOURS','168')))*3600)

class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  target=urllib.parse.urlsplit(self.path)
  try:
   if target.path=='/healthz':data={'process':'up','published_archives':status()['published_archives']}
   elif target.path=='/status':data=status()
   elif re.fullmatch(r'/pws/[A-Z0-9]{9}',target.path):data=pws_report(target.path.rsplit('/',1)[-1])
   else:self.send_error(404);return
   payload=json.dumps(data,allow_nan=False,default=str).encode()
   self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
  except Exception as e:
   log('query-error',error=type(e).__name__);self.send_error(503,'Evidence temporarily unavailable')
class Server(ThreadingHTTPServer):
 address_family=socket.AF_INET6
 daemon_threads=True
if __name__=='__main__':
 threading.Thread(target=loop,daemon=True).start()
 log('warehouse-started',schema=VERSION)
 Server(('::',int(os.environ.get('PORT','8080'))),Handler).serve_forever()
