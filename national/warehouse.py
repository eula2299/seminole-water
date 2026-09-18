"""Bounded, durable national occurrence ingestion and read-only serving.

The archive retains source records, NOT independently sampled households. Neither
record counts nor statistical summaries are a certification of current safety.
"""
from __future__ import annotations
import contextlib, datetime as dt, hashlib, io, json, os, pathlib, re, shutil, socket, sqlite3, tempfile, threading, time, urllib.parse, uuid, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
try:
 from .catalog import discover, download
except ImportError:
 from catalog import discover, download

VERSION='occurrence-warehouse/2'
PARSER_PROFILES={'ucmr':'ucmr-tab-bound-v2','syr3':'syr3-date-bound-v2','syr4':'syr4-quoted-microbial-v3'}
ROOT=pathlib.Path(os.environ.get('WAREHOUSE_DIR','/tmp/water-warehouse'))
MAX_ARCHIVE=int(os.environ.get('WAREHOUSE_MAX_ARCHIVE_BYTES','2000000000'))
MAX_TOTAL=int(os.environ.get('WAREHOUSE_MAX_TOTAL_BYTES','20000000000'))
MAX_EXPANDED=20_000_000_000
MAX_RESPONSE=int(os.environ.get('WAREHOUSE_MAX_RESPONSE_BYTES','2000000'))
MAX_SUMMARIES=int(os.environ.get('WAREHOUSE_MAX_SUMMARIES','500'))
MAX_CLIENTS=int(os.environ.get('WAREHOUSE_MAX_CLIENTS','16'))
STORAGE_RETRY_SECONDS=max(5,int(os.environ.get('WAREHOUSE_RETRY_SECONDS','60')))
LEASE_SECONDS=1800
LOCK=threading.RLock()
STATE={'schema':VERSION,'sources':{},'errors':{},'ingestion_status':'starting','current_archive':None,'target_minimum_records':200000000,'trained_prediction_models':0,'persistent_storage_bytes':None,'storage_accounting_checked_at':None}

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
 # Match complete, documented date formats; never turn a malformed timestamp
 # into a valid date by discarding its suffix. SYR4 uses e.g. 31-AUG-16.
 date=f"COALESCE(TRY_STRPTIME({m['date']}, ['%m/%d/%Y','%m/%d/%Y %H:%M:%S','%Y-%m-%d','%Y-%m-%d %H:%M:%S','%Y-%m-%d %H:%M:%S.%f'] )::DATE"
 if family=='syr4':date+=f",TRY_STRPTIME({m['date']}, '%d-%b-%y')::DATE"
 date+=')'
 value=f"TRY_CAST({m['value']} AS DOUBLE)"
 valid=f"regexp_full_match(UPPER({m['pwsid']}),'[A-Z0-9]{{9}}') AND {date} IS NOT NULL AND {date}<=CURRENT_DATE AND {m['analyte']} IS NOT NULL"
 result_unit=f"CASE WHEN {qualifier} IN ('<','<=','>','>=') AND {m['value']} IS NULL THEN {m['limit_unit']} ELSE {m['unit']} END"
 unit=f"LOWER(REPLACE(REPLACE(REPLACE(({result_unit}),'µ','u'),'μ','u'),' ',''))"
 typed=f"{unit} IN ('mg/l','ug/l','ng/l','pci/l','bq/l','mfl','mpn/100ml','cfu/100ml','ntu','su')"
 numeric=f"isfinite({value}) AND {value}>=0"
 bound=f"CASE WHEN {m['value']} IS NULL THEN TRY_CAST({m['limit']} AS DOUBLE) ELSE {value} END"
 eligible=f"COALESCE(({valid}) AND ({typed}) AND (({qualifier}='=' AND {numeric}) OR ({qualifier} IN ('<','<=','>','>=') AND isfinite({bound}) AND {bound}>=0)),false)"
 # EPA's SYR4 dictionary defines P/A only for TC (3100), EC (3014),
 # and FC (3013). These are qualitative results, never concentrations.
 # https://www.epa.gov/system/files/documents/2024-11/user-guide-to-downloading-and-using-syr4-data_0.pdf
 code=column(columns,'analytecode','analyteid')
 qualitative=f"COALESCE(({valid}) AND {code} IN ('3100','3014','3013') AND {m['presence']} IN ('P','A'),false)" if family=='syr4' else 'false'
 return f"""SELECT UPPER({m['pwsid']}) AS pwsid,{m['name']} AS system_name,{m['analyte']} AS analyte,
 {date} AS sample_date,{m['date']} AS original_date,{m['value']} AS original_value,{m['unit']} AS original_unit,
 {qualifier} AS qualifier,{m['limit']} AS reporting_limit,{m['limit_unit']} AS reporting_limit_unit,
 CASE WHEN {qualitative} THEN 'presence/absence' ELSE {result_unit} END AS result_unit,
 CASE WHEN {qualitative} THEN 'presence-absence' ELSE 'numeric' END AS result_kind,
 CASE WHEN ({eligible}) AND NOT ({qualitative}) AND {qualifier}='=' THEN {value} ELSE NULL END AS detected_value,
 {m['sample']} AS sample_id,{m['point']} AS point_id,{m['facility']} AS facility_id,
 {m['point_type']} AS point_type,{m['source_type']} AS source_type,{m['origin']} AS origin_id,{m['presence']} AS presence,
 CASE WHEN {m['point_type']} IN ('RW','SR') OR {m['source_type']}='RW' THEN 'source-water' WHEN {m['point_type']} IN ('EP','DS') THEN 'system-monitoring' ELSE 'system-sampling-context-unspecified' END AS evidence_scope,
 {valid} AS identity_date_valid,({eligible}) OR ({qualitative}) AS summary_eligible,sha256(to_json(r)) AS source_record_sha256,to_json(r) AS original_record
 FROM raw_input r"""

def prepare_member(source_file,family,member):
 # EPA SYR3 alkalinity has two lines with a missing final ancillary chlorine
 # field. Only this exact layout and signature can be padded. Measurements,
 # identities and dates are unchanged; the untouched ZIP remains retained.
 if family!='syr3' or pathlib.PurePosixPath(member).name.lower()!='alkalinity.txt':return source_file,0
 target=pathlib.Path(source_file).with_suffix('.validated.tsv');padded=0
 with open(source_file,encoding='utf-8-sig',newline='') as src,open(target,'w',encoding='utf-8',newline='') as dst:
  header=src.readline().rstrip('\r\n').split('\t')
  expected=['Residual Field Free Chlorine mg/L','Residual Field Total Chlorine mg/L']
  if len(header)!=28 or header[-2:]!=expected:raise ValueError('Unrecognized SYR3 alkalinity trailing metadata layout')
  dst.write('\t'.join(header)+'\n')
  for number,line in enumerate(src,2):
   row=line.rstrip('\r\n').split('\t')
   if len(row)==27 and row[-1]==';':row.append('');padded+=1
   elif len(row)!=28:raise ValueError(f'Unexpected SYR3 alkalinity field count on line {number}')
   dst.write('\t'.join(row)+'\n')
 return str(target),padded

def process_member(source_file,parquet_path,summary_db,family,member):
 import duckdb
 con=duckdb.connect()
 con.execute("SET memory_limit='1800MB'; SET threads=2; SET preserve_insertion_order=false")
 con.execute('SET temp_directory='+lit(str(parquet_path.parent/'spill')))
 try:
  source_file,padded=prepare_member(source_file,family,member)
  quoting=lit('"' if family=='syr4' else '')
  con.execute("CREATE VIEW raw_input AS SELECT * FROM read_csv("+lit(source_file)+", delim='\t', header=true, all_varchar=true, quote="+quoting+", escape="+quoting+", strict_mode=true, max_line_size=1048576)")
  columns=[x[0] for x in con.execute('SELECT * FROM raw_input LIMIT 0').description]
  sql=canonical_sql(columns,family)
  con.execute('CREATE TABLE normalized AS '+sql)
  raw_count=con.execute('SELECT COUNT(*) FROM normalized').fetchone()[0]
  if not raw_count:raise ValueError('Empty sample member')
  con.execute('CREATE TABLE distinct_rows AS SELECT * FROM normalized QUALIFY ROW_NUMBER() OVER (PARTITION BY source_record_sha256)=1')
  count,invalid,eligible=con.execute('SELECT COUNT(*),COUNT(*) FILTER (WHERE NOT COALESCE(identity_date_valid,false)),COUNT(*) FILTER (WHERE summary_eligible) FROM distinct_rows').fetchone()
  con.execute("COPY (SELECT * FROM distinct_rows ORDER BY pwsid,sample_date DESC) TO "+lit(parquet_path)+" (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 65536)")
  cursor=con.execute("""SELECT pwsid,analyte,result_unit,evidence_scope,COUNT(*),COUNT(detected_value),COUNT(*) FILTER(WHERE result_kind='numeric' AND qualifier IN ('<','<=')),MIN(sample_date)::VARCHAR,MAX(sample_date)::VARCHAR,MIN(detected_value),MAX(detected_value),arg_max(original_record,sample_date),0,COUNT(*) FILTER(WHERE result_kind='presence-absence' AND presence='P'),COUNT(*) FILTER(WHERE result_kind='presence-absence' AND presence='A'),result_kind FROM distinct_rows WHERE summary_eligible GROUP BY 1,2,3,4,16""")
  db=sqlite3.connect(summary_db)
  try:
   db.execute('CREATE TABLE IF NOT EXISTS summaries (pwsid TEXT,analyte TEXT,unit TEXT,scope TEXT,n INTEGER,detects INTEGER,nondetects INTEGER,first_date TEXT,last_date TEXT,min_detect REAL,max_detect REAL,latest_record TEXT,invalid_identity_date INTEGER,present_results INTEGER,absent_results INTEGER,result_kind TEXT,member TEXT)')
   while rows:=cursor.fetchmany(2000):db.executemany('INSERT INTO summaries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[tuple(r)+(member,) for r in rows])
   db.commit()
  finally:db.close()
  return {'member':member,'parser_profile':PARSER_PROFILES[family],'trailing_metadata_padding_rows':padded,'raw_rows':raw_count,'distinct_source_rows':count,'eligible_source_rows':eligible,'excluded_from_summary_rows':count-eligible,'invalid_identity_date_rows':invalid,'sha256':digest(parquet_path),'bytes':parquet_path.stat().st_size}
 finally:con.close()

class Store:
 def __init__(self,client=None,bucket=None,max_total=None,provider=None):
  import boto3
  from botocore.config import Config
  self.bucket=bucket or os.environ['AWS_S3_BUCKET_NAME']
  self.client=client or boto3.client('s3',endpoint_url=os.environ['AWS_ENDPOINT_URL'],region_name=os.environ.get('AWS_DEFAULT_REGION','auto'),config=Config(signature_version='s3v4',connect_timeout=10,read_timeout=90,retries={'max_attempts':3},s3={'addressing_style':'path'}))
  self.max_total=MAX_TOTAL if max_total is None else max_total
  self.provider=provider or os.environ.get('WAREHOUSE_STORAGE_PROVIDER','s3')
  self.lease=None;self.lease_lock=threading.RLock();self.pending_bytes=0
 def json(self,key,with_etag=False):
  from botocore.exceptions import ClientError
  try:
   response=self.client.get_object(Bucket=self.bucket,Key=key)
   with contextlib.closing(response['Body']) as body:data=body.read(10_000_001)
   if len(data)>10_000_000:raise ValueError('Object metadata exceeds byte limit')
   value=json.loads(data)
   return (value,response['ETag']) if with_etag else value
  except ClientError as e:
   if e.response.get('Error',{}).get('Code') in ('NoSuchKey','404'):return (None,None) if with_etag else None
   raise
 def inventory(self):
  # Count the entire bucket, including superseded archive keys, unpublished
  # uploads, historical object versions, and unfinished multipart parts.
  # Permissions/API failures fail closed rather than inventing a zero size.
  # Railway documents that its buckets do not implement object versioning.
  # This explicit deployment setting is not an error-triggered fallback.
  # https://docs.railway.com/storage-buckets#s3-compatibility (reviewed 2026-09-18)
  versioned=False if self.provider=='railway' else self.client.get_bucket_versioning(Bucket=self.bucket).get('Status') in ('Enabled','Suspended')
  operation='list_object_versions' if versioned else 'list_objects_v2'
  field='Versions' if versioned else 'Contents'
  total=0;objects=0;multipart=0
  for page in self.client.get_paginator(operation).paginate(Bucket=self.bucket):
   for obj in page.get(field,[]):total+=int(obj['Size']);objects+=1
  for page in self.client.get_paginator('list_multipart_uploads').paginate(Bucket=self.bucket):
   for upload in page.get('Uploads',[]):
    for parts in self.client.get_paginator('list_parts').paginate(Bucket=self.bucket,Key=upload['Key'],UploadId=upload['UploadId']):
     for part in parts.get('Parts',[]):total+=int(part['Size']);multipart+=int(part['Size'])
  result={'bytes':total,'objects_or_versions':objects,'multipart_bytes':multipart,'versioned':versioned,'checked_at':utc()}
  with LOCK:STATE['persistent_storage_bytes']=total;STATE['storage_accounting_checked_at']=result['checked_at'];STATE['storage_inventory']=result
  return result
 def ensure_capacity(self,additional):
  if additional<0:raise ValueError('Invalid storage allocation')
  actual=self.inventory()['bytes']
  if actual+self.pending_bytes+additional>self.max_total:raise ValueError('Persistent storage budget exceeded; publication paused')
  return actual
 @contextlib.contextmanager
 def publication_lock(self):
  key='v2/publication-lease.json';owner=str(uuid.uuid4());stop=threading.Event()
  # Conditional S3 writes serialize cooperative publishers across replicas.
  # A crashed publisher's lease expires, so restart does not require deletion.
  self.ensure_capacity(1024)
  existing,etag=self.json(key,with_etag=True)
  if existing and existing.get('expires',0)>time.time():raise ValueError('Another warehouse publisher holds the storage lease')
  condition={'IfNoneMatch':'*'}
  if existing:condition={'IfMatch':etag}
  payload=json.dumps({'owner':owner,'expires':time.time()+LEASE_SECONDS}).encode()
  response=self.client.put_object(Bucket=self.bucket,Key=key,Body=payload,**condition)
  self.lease={'key':key,'etag':response['ETag'],'owner':owner,'lost':False}
  def renew():
   while not stop.wait(30):
    try:
     with self.lease_lock:
      body=json.dumps({'owner':owner,'expires':time.time()+LEASE_SECONDS}).encode()
      self.ensure_capacity(len(body))
      response=self.client.put_object(Bucket=self.bucket,Key=key,Body=body,IfMatch=self.lease['etag'])
      self.lease['etag']=response['ETag']
    except Exception:
     with self.lease_lock:self.lease['lost']=True
     return
  thread=threading.Thread(target=renew,daemon=True);thread.start()
  try:yield
  finally:
   stop.set();thread.join(timeout=100)
   with self.lease_lock:
    try:
     body=json.dumps({'owner':owner,'expires':0}).encode()
     self.ensure_capacity(len(body))
     self.client.put_object(Bucket=self.bucket,Key=key,Body=body,IfMatch=self.lease['etag'])
    except Exception:pass # The lease expires if cleanup cannot reach storage.
    self.lease=None
 def write(self,key,body,size,content_type='application/octet-stream'):
  if size>5_000_000_000:raise ValueError('Object exceeds bounded single-upload size')
  with self.lease_lock:
   if not self.lease or self.lease['lost']:raise ValueError('Storage publication lease unavailable')
   self.ensure_capacity(size+1024)
   self.pending_bytes+=size
  try:
   # Single PUTs do not leave billable multipart fragments on interruption.
   self.client.put_object(Bucket=self.bucket,Key=key,Body=body,ContentLength=size,ContentType=content_type)
  finally:
   with self.lease_lock:self.pending_bytes-=size
 def put_json(self,key,value):
  body=json.dumps(value,allow_nan=False).encode();self.write(key,body,len(body),'application/json')
 def put(self,key,path):
  with open(path,'rb') as body:self.write(key,body,path.stat().st_size)
 def verify_size(self,key,size):
  if int(self.client.head_object(Bucket=self.bucket,Key=key)['ContentLength'])!=size:raise ValueError('Retained object size differs from its receipt')
 def get(self,key,path,sha):
  if path.exists() and digest(path)==sha:return
  path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_suffix('.part')
  self.client.download_file(self.bucket,key,str(temporary))
  if digest(temporary)!=sha:temporary.unlink(missing_ok=True);raise ValueError('Object checksum mismatch')
  temporary.replace(path)

def summary_path(ident,sha):return ROOT/'summaries'/f'{ident}-{sha}.sqlite'
def activate(store,receipt):
 # Legacy receipts remain visible as retained raw records, but their summaries
 # are never served as version 2 qualified evidence.
 if receipt.get('schema')==VERSION:
  p=summary_path(receipt['id'],receipt['sha256'])
  store.get(receipt['summary_key'],p,receipt['summary_sha256'])
 with LOCK:STATE['sources'][receipt['id']]=receipt;STATE['errors'].pop(receipt['id'],None)
def distinct_receipts(receipts):
 unique={}
 for r in receipts:
  key=r['sha256']
  if key not in unique or r.get('schema')==VERSION:unique[key]=r
 return list(unique.values())
def status():
 with LOCK:s=json.loads(json.dumps(STATE))
 receipts=distinct_receipts(s['sources'].values());count=sum(x['distinct_source_rows'] for x in receipts)
 eligible=sum(x.get('eligible_source_records',0) for x in receipts if x.get('schema')==VERSION)
 s.update(retained_source_records=count,eligible_source_records=eligible,raw_rows=sum(x['raw_rows'] for x in receipts),published_archives=len(receipts),qualified_archives=sum(x.get('schema')==VERSION for x in receipts),active_archive_bytes=sum(x['stored_bytes'] for x in receipts),stored_bytes=s['persistent_storage_bytes'],storage_budget_bytes=MAX_TOTAL,target_met=eligible>=s['target_minimum_records'],count_definition='retained exact source-field rows deduplicated within each archive member; eligible rows additionally pass identity, date, and typed numeric or documented qualitative-result checks; neither count is an independent-observation or household count; cross-source duplication is not resolved',target_count_basis='eligible_source_records',household_safety_certified=False,coverage_complete=False)
 s['sources']={key:{k:v for k,v in receipt.items() if k not in ('parts','skipped_members')} for key,receipt in s['sources'].items()}
 return s

def ingest(store,item):
 existing=store.json('v2/latest/'+item['id']+'.json') or store.json('v1/latest/'+item['id']+'.json')
 if existing:activate(store,existing)
 with LOCK:STATE['current_archive']=item['id']
 with tempfile.TemporaryDirectory(prefix='ingest-',dir=ROOT) as td:
  work=pathlib.Path(td);archive=work/'source.zip'
  profile=PARSER_PROFILES[item['family']]
  receipt={**item,**download(item['url'],archive,MAX_ARCHIVE),'retrieved_at':utc(),'schema':VERSION,'parser_profile':profile}
  old_profile=(existing or {}).get('parser_profile')
  if existing and existing['sha256']==receipt['sha256'] and existing.get('schema')==VERSION and old_profile==profile:
   log('unchanged',source=item['id']);return
  base='v2/data/'+receipt['sha256']+'/'+profile;summary=work/'summary.sqlite';parts=[];skipped=[];expanded=0
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
    raw.unlink();partpath=work/(hashlib.sha256(member.filename.encode()).hexdigest()[:16]+'.parquet')
    part=process_member(str(text),partpath,summary,item['family'],member.filename);part['encoding']=encoding;part['key']=base+'/'+partpath.name
    parts.append(part);text.unlink();log('member-processed',source=item['id'],member=name,rows=part['distinct_source_rows'])
  if not parts:raise ValueError('No sample tables matched the validated schema')
  db=sqlite3.connect(summary);db.execute('CREATE INDEX IF NOT EXISTS summaries_pws ON summaries(pwsid)');db.commit();db.close()
  # Rebuild qualified summaries from the freshly verified source without
  # duplicating immutable raw data already retained under an older schema.
  # Parquet schema stays explicit; serving reads only the rebuilt summary.
  previous={p['member']:p for p in (existing or {}).get('parts',[])}
  # Version 1 receipts used basenames, while ZIP members can include folders.
  # Match that legacy representation only when both sides are unambiguous.
  old_names=[pathlib.PurePosixPath(n).name for n in previous]
  new_names=[pathlib.PurePosixPath(p['member']).name for p in parts]
  if len(set(old_names))==len(old_names) and len(set(new_names))==len(new_names):
   by_name={pathlib.PurePosixPath(n).name:p for n,p in previous.items()}
   previous={p['member']:by_name[pathlib.PurePosixPath(p['member']).name] for p in parts if pathlib.PurePosixPath(p['member']).name in by_name}
  reusable=bool(existing and existing.get('sha256')==receipt['sha256'] and previous and len(previous)==len(parts) and all(p['member'] in previous and p['raw_rows']==previous[p['member']].get('raw_rows') and p['distinct_source_rows']==previous[p['member']].get('distinct_source_rows') for p in parts))
  archive_key=base+'/original.zip'
  if reusable:
   archive_key=existing.get('archive_key','v1/data/'+receipt['sha256']+'/original.zip')
   store.verify_size(archive_key,receipt['archive_bytes'])
   for part in parts:
    old=previous[part['member']];store.verify_size(old['key'],old['bytes'])
    part.update(key=old['key'],sha256=old['sha256'],bytes=old['bytes'],parquet_schema=old.get('parquet_schema',existing['schema']),parquet_parser_profile=old.get('parquet_parser_profile',old.get('parser_profile','legacy')))
  else:
   for part in parts:part['parquet_schema']=VERSION
  receipt.update(archive_key=archive_key,reused_source_objects=reusable)
  receipt.update(parts=parts,skipped_members=skipped,raw_rows=sum(x['raw_rows'] for x in parts),distinct_source_rows=sum(x['distinct_source_rows'] for x in parts),eligible_source_records=sum(x['eligible_source_rows'] for x in parts),summary_key=base+'/summary.sqlite',summary_sha256=digest(summary))
  receipt['stored_bytes']=receipt['archive_bytes']+summary.stat().st_size+sum(x['bytes'] for x in parts)
  with store.publication_lock():
   metadata_size=len(json.dumps(receipt,allow_nan=False).encode())
   additional=summary.stat().st_size if reusable else receipt['stored_bytes']
   store.ensure_capacity(additional+2*metadata_size+4096)
   if not reusable:
    store.put(archive_key,archive)
    for part in parts:store.put(part['key'],work/pathlib.PurePosixPath(part['key']).name)
   store.put(receipt['summary_key'],summary)
   store.put_json(base+'/receipt.json',receipt)
   store.put_json('v2/latest/'+item['id']+'.json',receipt)
  store.inventory()
  activate(store,receipt);log('archive-published',source=item['id'],records=receipt['distinct_source_rows'],total_records=status()['retained_source_records'])

def pws_report(pwsid):
 if not re.fullmatch('[A-Z0-9]{9}',pwsid):raise ValueError('Invalid complete PWSID')
 with LOCK:loaded=distinct_receipts(STATE['sources'].values())
 receipts=[r for r in loaded if r.get('schema')==VERSION]
 summaries=[];sources=[];matching=0;response_bytes=0;truncated=False;omitted_raw=0
 for receipt in receipts:
  db=sqlite3.connect(f'file:{summary_path(receipt["id"],receipt["sha256"])}?mode=ro',uri=True)
  db.row_factory=sqlite3.Row
  try:
   count=db.execute('SELECT COUNT(*) FROM summaries WHERE pwsid=?',(pwsid,)).fetchone()[0];matching+=count
   if count:sources.append({k:receipt[k] for k in ('id','url','catalogue_url','retrieved_at','sha256')})
   remaining=max(0,MAX_SUMMARIES-len(summaries))
   rows=db.execute('SELECT * FROM summaries WHERE pwsid=? ORDER BY last_date DESC LIMIT ?',(pwsid,remaining)).fetchall()
   if count>remaining:truncated=True
   for row in rows:
    item=dict(row);raw=item['latest_record'];item['source_id']=receipt['id']
    if raw and len(raw.encode())>16384:item['latest_record']=None;item['latest_record_omitted']=True;omitted_raw+=1
    else:item['latest_record']=json.loads(raw) if raw else None
    size=len(json.dumps(item,allow_nan=False).encode())
    if response_bytes+size>MAX_RESPONSE//2:truncated=True;continue
    response_bytes+=size;summaries.append(item)
  finally:db.close()
 return {'schema':VERSION,'pwsid':pwsid,'status':'records-returned' if summaries else 'response-truncated' if matching else 'qualified-archives-unavailable' if not receipts else 'no-records-in-loaded-archives','summaries':summaries,'sources':sources,'archives_checked':len(receipts),'legacy_archives_excluded':len(loaded)-len(receipts),'matching_summary_groups':matching,'returned_summary_groups':len(summaries),'truncated':truncated or omitted_raw>0,'omitted_large_latest_records':omitted_raw,'maximum_summary_groups':MAX_SUMMARIES,'scope':'public-system-samples-not-household','current_safety':'not-determined','cross_source_sample_independence_certified':False,'historical_data':True,'coverage_complete':False}

def loop(stop=None,store_factory=Store,discover_fn=discover):
 stop=stop or threading.Event();store=None
 ROOT.mkdir(parents=True,exist_ok=True)
 while not stop.is_set():
  try:
   if store is None:store=store_factory()
   store.inventory()
   with LOCK:STATE['errors'].pop('storage',None)
  except Exception as e:
   store=None
   with LOCK:STATE['ingestion_status']='storage-unavailable';STATE['errors']['storage']=type(e).__name__
   log('storage-unavailable',error=type(e).__name__)
   stop.wait(STORAGE_RETRY_SECONDS);continue
  try:
   items=discover_fn()
   with LOCK:STATE['catalogue_archives']=len(items);STATE['ingestion_status']='ingesting';STATE['errors'].pop('catalogue',None)
   for item in items:
    try:
     receipt=store.json('v2/latest/'+item['id']+'.json') or store.json('v1/latest/'+item['id']+'.json')
     if receipt:activate(store,receipt)
    except Exception as e:log('restore-error',source=item['id'],error=type(e).__name__)
   for item in items:
    if stop.is_set():break
    try:ingest(store,item)
    except Exception as e:
     with LOCK:STATE['errors'][item['id']]=str(e)[:250]
     log('ingest-error',source=item['id'],error=str(e)[:250])
   with LOCK:STATE['ingestion_status']='cycle-complete-with-gaps' if STATE['errors'] else 'cycle-complete';STATE['current_archive']=None;STATE['last_cycle_at']=utc()
  except Exception as e:
   with LOCK:STATE['ingestion_status']='catalogue-unavailable';STATE['errors']['catalogue']=type(e).__name__
   log('catalogue-unavailable',error=type(e).__name__)
  stop.wait(STORAGE_RETRY_SECONDS if STATE['ingestion_status']=='catalogue-unavailable' else max(1,int(os.environ.get('WAREHOUSE_REFRESH_HOURS','168')))*3600)

class Handler(BaseHTTPRequestHandler):
 def setup(self):
  self.request.settimeout(10)
  super().setup()
 def log_message(self,*args):pass
 def do_GET(self):
  target=urllib.parse.urlsplit(self.path)
  try:
   if target.path=='/healthz':data={'process':'up','published_archives':status()['published_archives']}
   elif target.path=='/status':data=status()
   elif re.fullmatch(r'/pws/[A-Z0-9]{9}',target.path):data=pws_report(target.path.rsplit('/',1)[-1])
   else:self.send_error(404);return
   payload=json.dumps(data,allow_nan=False,default=str).encode()
   if len(payload)>MAX_RESPONSE:
    payload=json.dumps({'schema':VERSION,'error':'RESPONSE_TOO_LARGE','truncated':True,'current_safety':'not-determined'}).encode()
    self.send_response(503)
   else:self.send_response(200)
   self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
  except Exception as e:
   log('query-error',error=type(e).__name__);self.send_error(503,'Evidence temporarily unavailable')
class Server(ThreadingHTTPServer):
 address_family=socket.AF_INET6
 daemon_threads=True
 def __init__(self,*args,**kwargs):
  self.slots=threading.BoundedSemaphore(MAX_CLIENTS)
  super().__init__(*args,**kwargs)
 def process_request(self,request,client_address):
  if not self.slots.acquire(blocking=False):
   try:request.settimeout(1);request.sendall(b'HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nRetry-After: 10\r\nConnection: close\r\n\r\n')
   finally:self.shutdown_request(request)
   return
  try:super().process_request(request,client_address)
  except Exception:self.slots.release();raise
 def process_request_thread(self,request,client_address):
  try:super().process_request_thread(request,client_address)
  finally:self.slots.release()
if __name__=='__main__':
 threading.Thread(target=loop,daemon=True).start()
 log('warehouse-started',schema=VERSION)
 Server(('::',int(os.environ.get('PORT','8080'))),Handler).serve_forever()
