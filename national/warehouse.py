"""Bounded, durable national occurrence ingestion and read-only serving.

The archive retains source records, NOT independently sampled households. Neither
record counts nor statistical summaries are a certification of current safety.
"""
from __future__ import annotations
import contextlib, datetime as dt, gzip, hashlib, io, json, os, pathlib, re, shutil, socket, sqlite3, tempfile, threading, time, urllib.parse, uuid, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
try:
 from .catalog import discover, download
 from .syr2 import chemical, export_mdb
except ImportError:
 from catalog import discover, download
 from syr2 import chemical, export_mdb

VERSION='occurrence-warehouse/2'
PARSER_PROFILES={'ucmr':'ucmr-tab-bound-v2','syr2':'syr2-access-bound-v1','syr3':'syr3-date-microbial-v3','syr4':'syr4-quoted-microbial-v3'}
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
ENVIRONMENTAL_ARCHIVE=None
COMPLIANCE_ARCHIVE=None
WELL_ARCHIVE=None
STATE={'schema':VERSION,'sources':{},'errors':{},'ingestion_status':'starting','serving_ready':False,'restore_pending':[],'current_archive':None,'target_minimum_records':200000000,'trained_prediction_models':0,'persistent_storage_bytes':None,'storage_accounting_checked_at':None}

class StorageBudgetExceeded(ValueError):
 def __init__(self,used,additional,maximum):
  super().__init__('Persistent storage budget exceeded; publication paused')
  self.used=used;self.additional=additional;self.maximum=maximum

class PublicationBusy(ValueError):
 def __init__(self,expires):
  super().__init__('Another warehouse publisher holds the storage lease')
  self.expires=expires

def capacity_retry_ready(failure,used,maximum,now):
 # Retry only after real recovery, with enough room for the failed reservation.
 # A failed lease reservation cannot predict the full publication, so require
 # at least 100 MB recovered and one minute before another bounded attempt.
 error=failure['error']
 return (now-failure['at']>=60 and error.used-used>=100_000_000
         and maximum-used>=max(100_000_000,error.additional))

class CapacityCompactor:
 # Recovery only: one verified index attempt per minute, at most 25 attempts
 # during this process lifetime. Restart resets this limit; it is not a daily cap.
 def __init__(self,candidates_fn=None):
  self.candidates_fn=candidates_fn;self.queue=None;self.attempts=0;self.next_check=0
 def can_recover(self,store,failures,used):
  if self.attempts>=25 or self.queue==[] or getattr(store,'provider',None)!='railway':return False
  return any(isinstance(f['error'],StorageBudgetExceeded) and
             (store.max_total-used<max(100_000_000,f['error'].additional) or f['error'].used-used<100_000_000)
             for f in failures.values())
 def step(self,store,failures,used,now):
  if now<self.next_check or not self.can_recover(store,failures,used):return 0
  self.next_check=now+60
  store.check_publication_lease()
  if self.queue is None:
   if self.candidates_fn is None:
    from .compact_indexes import candidates
    self.candidates_fn=candidates
   self.queue=list(reversed(self.candidates_fn(store)))
  # Bound metadata reads too. Published candidates are largest first; compressed
  # ones are skipped. New indexes already use compression at initial publication.
  for _ in range(min(200,len(self.queue))):
   item=self.queue.pop()
   head=store.client.head_object(Bucket=store.bucket,Key=item['key'])
   if head.get('Metadata',{}).get('water-storage-codec')=='gzip-v1':continue
   self.attempts+=1
   # Existing implementation checks the published checksum, conditional ETag,
   # publication lease and exact decoded readback; it never removes evidence.
   return store.compact_index(item['key'],item['sha256'])
  return 0

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
def mapping(columns,family,source_metadata=None):
 c=lambda *o,**kw:column(columns,*o,**kw)
 if family=='syr2':
  info=chemical((source_metadata or {}).get('table',''))
  return dict(pwsid=c('pwsid',required=True),name=c('pwsname'),analyte=f"CASE WHEN {c('chemid',required=True)}={lit(info['code'])} THEN {lit(info['analyte'])} ELSE NULL END",date=c('date',required=True),value=c('value',required=True),unit=c('units',required=True),qualifier=c('detect',required=True),limit='NULL::VARCHAR',limit_unit=c('units'),sample=c('sampleid'),point=c('samplepointid'),point_type='NULL::VARCHAR',facility='NULL::VARCHAR',source_type='NULL::VARCHAR',origin=c('id'),presence='NULL::VARCHAR')
 if family=='ucmr':
  return dict(pwsid=c('pwsid',required=True),name=c('pwsname'),analyte=c('contaminant',required=True),date=c('collectiondate',required=True),value=c('analyticalresultvalue',required=True),unit=c('units',required=True),qualifier=c('analyticalresultssign',required=True),limit=c('mrl'),limit_unit=c('units'),sample=c('sampleid'),point=c('samplepointid'),point_type=c('samplepointtype'),facility=c('facilityid'),source_type=c('ucmr1sampletype'),origin=c('sampleid'),presence='NULL::VARCHAR')
 return dict(pwsid=c('pwsid',required=True),name=c('systemname','pwsname'),analyte=c('analytename','contaminant',required=True),date=c('samplecollectiondate','collectiondate',required=True),value=c('value','analyticalresultvalue',required=True),unit=c('unit','units',required=True),qualifier=c('detect',required=True),limit=c('detectionlimitvalue'),limit_unit=c('detectionlimitunit'),sample=c('sampleid'),point=c('samplingpointid','samplepointid'),point_type=c('samplingpointtype','samplepointtype'),facility=c('waterfacilityid','facilityid'),source_type=c('sourcetypecode'),origin=c('sixyearid','sixyearreviewid','sampleid'),presence=c('presenceindicatorcode'))
def canonical_sql(columns,family,source_metadata=None):
 m=mapping(columns,family,source_metadata)
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
 # EPA's SYR3/SYR4 dictionaries define P/A only for TC (3100), EC (3014),
 # and FC (3013). These are qualitative results, never concentrations.
 # SYR3 guide, pages 5 and 11:
 # https://www.epa.gov/sites/default/files/2016-12/documents/user_guide_to_obtaining_and_using_syr3_data.pdf
 # https://www.epa.gov/system/files/documents/2024-11/user-guide-to-downloading-and-using-syr4-data_0.pdf
 code=column(columns,'analytecode','analyteid')
 qualitative=f"COALESCE(({valid}) AND {code} IN ('3100','3014','3013') AND {m['presence']} IN ('P','A'),false)" if family in ('syr3','syr4') else 'false'
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

def process_member(source_file,parquet_path,summary_db,family,member,source_metadata=None):
 import duckdb
 con=duckdb.connect()
 con.execute("SET memory_limit='1800MB'; SET threads=2; SET preserve_insertion_order=false")
 con.execute('SET temp_directory='+lit(str(parquet_path.parent/'spill')))
 try:
  source_file,padded=prepare_member(source_file,family,member)
  quoting=lit('"' if family in ('syr2','syr4') else '')
  con.execute("CREATE VIEW raw_input AS SELECT * FROM read_csv("+lit(source_file)+", delim='\t', header=true, all_varchar=true, quote="+quoting+", escape="+quoting+", strict_mode=true, max_line_size=1048576)")
  columns=[x[0] for x in con.execute('SELECT * FROM raw_input LIMIT 0').description]
  sql=canonical_sql(columns,family,source_metadata)
  con.execute('CREATE TABLE normalized AS '+sql)
  raw_count=con.execute('SELECT COUNT(*) FROM normalized').fetchone()[0]
  if not raw_count:raise ValueError('Empty sample member')
  if family=='syr2' and raw_count!=(source_metadata or {}).get('source_table_rows'):raise ValueError('SYR2 export row count differs from source table count')
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
  self.client=client or boto3.client('s3',endpoint_url=os.environ['AWS_ENDPOINT_URL'],region_name=os.environ.get('AWS_DEFAULT_REGION','auto'),config=Config(signature_version='s3v4',connect_timeout=10,read_timeout=90,retries={'max_attempts':3},s3={'addressing_style':'virtual' if (provider or os.environ.get('WAREHOUSE_STORAGE_PROVIDER'))=='railway' else 'path'}))
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
  if actual+self.pending_bytes+additional>self.max_total:raise StorageBudgetExceeded(actual,self.pending_bytes+additional,self.max_total)
  return actual
 def check_publication_lease(self):
  # Read-only preflight prevents a waiting importer from downloading and
  # rebuilding an entire national archive while another publisher is active.
  existing=self.json('v2/publication-lease.json')
  if existing and existing.get('expires',0)>time.time():raise PublicationBusy(existing['expires'])
 @contextlib.contextmanager
 def publication_lock(self):
  key='v2/publication-lease.json';owner=str(uuid.uuid4());stop=threading.Event()
  # Conditional S3 writes serialize cooperative publishers across replicas.
  # A crashed publisher's lease expires, so restart does not require deletion.
  self.ensure_capacity(1024)
  existing,etag=self.json(key,with_etag=True)
  if existing and existing.get('expires',0)>time.time():raise PublicationBusy(existing['expires'])
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
 def write(self,key,body,size,content_type='application/octet-stream',metadata=None):
  if size>5_000_000_000:raise ValueError('Object exceeds bounded single-upload size')
  with self.lease_lock:
   if not self.lease or self.lease['lost']:raise ValueError('Storage publication lease unavailable')
   self.ensure_capacity(size+1024)
   self.pending_bytes+=size
  try:
   # Single PUTs do not leave billable multipart fragments on interruption.
   self.client.put_object(Bucket=self.bucket,Key=key,Body=body,ContentLength=size,ContentType=content_type,**({'Metadata':metadata} if metadata else {}))
  finally:
   with self.lease_lock:self.pending_bytes-=size
 def put_json(self,key,value):
  body=json.dumps(value,allow_nan=False).encode();self.write(key,body,len(body),'application/json')
 def put(self,key,path):
  if self.is_compactable_index(key) and path.stat().st_size<=64_000_000:
   raw=path.read_bytes();packed=gzip.compress(raw,compresslevel=6,mtime=0)
   if len(packed)<len(raw):
    self.write(key,packed,len(packed),metadata=self.codec_metadata(raw));return
  with open(path,'rb') as body:self.write(key,body,path.stat().st_size)
 @staticmethod
 def is_compactable_index(key):return key.startswith('wqp/v1/data/') and key.endswith('/spatial.sqlite')
 @staticmethod
 def codec_metadata(raw):return {'water-storage-codec':'gzip-v1','water-decoded-size':str(len(raw)),'water-decoded-sha256':hashlib.sha256(raw).hexdigest()}
 def verify_size(self,key,size):
  head=self.client.head_object(Bucket=self.bucket,Key=key);metadata=head.get('Metadata',{})
  actual=int(metadata['water-decoded-size']) if metadata.get('water-storage-codec')=='gzip-v1' and self.is_compactable_index(key) else int(head['ContentLength'])
  if actual!=size:raise ValueError('Retained object size differs from its receipt')
 def get(self,key,path,sha):
  if path.exists() and digest(path)==sha:return
  path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_suffix('.part')
  head=self.client.head_object(Bucket=self.bucket,Key=key) if self.is_compactable_index(key) else {}
  metadata=head.get('Metadata',{})
  codec=metadata.get('water-storage-codec')
  if codec and codec!='gzip-v1':raise ValueError('Unknown storage codec')
  if codec:
   size=int(metadata.get('water-decoded-size','-1'))
   if not 0<=size<=64_000_000 or int(head.get('ContentLength',64000001))>64_000_000 or metadata.get('water-decoded-sha256')!=sha:raise ValueError('Invalid compressed index receipt')
  try:
   self.client.download_file(self.bucket,key,str(temporary))
   if codec:
    if temporary.stat().st_size>64_000_000:raise ValueError('Compressed index exceeds limit')
    with gzip.open(temporary,'rb') as f:raw=f.read(size+1)
    if len(raw)!=size or hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('Decoded index checksum mismatch')
    temporary.write_bytes(raw)
   if digest(temporary)!=sha:raise ValueError('Object checksum mismatch')
   temporary.replace(path)
  finally:temporary.unlink(missing_ok=True)
 def compact_index(self,key,sha):
  # Change representation only. Keep the exact original decoded bytes, key and receipt.
  if self.provider!='railway':raise ValueError('Compaction requires the verified non-versioned Railway store')
  if not self.is_compactable_index(key) or not re.fullmatch('[0-9a-f]{64}',sha):raise ValueError('Invalid index identity')
  with self.publication_lock(),tempfile.TemporaryDirectory() as directory:
   head=self.client.head_object(Bucket=self.bucket,Key=key)
   if head.get('Metadata',{}).get('water-storage-codec')=='gzip-v1':return 0
   if not 0<int(head['ContentLength'])<=64_000_000 or not head.get('ETag'):raise ValueError('Index size or identity unavailable')
   path=pathlib.Path(directory)/'original.sqlite';self.get(key,path,sha);raw=path.read_bytes()
   if len(raw)!=head['ContentLength']:raise ValueError('Index changed during read')
   packed=gzip.compress(raw,compresslevel=6,mtime=0)
   if len(packed)>=len(raw):return 0
   if gzip.decompress(packed)!=raw:raise ValueError('Compression roundtrip failed')
   with self.lease_lock:
    if not self.lease or self.lease['lost']:raise ValueError('Storage publication lease unavailable')
   # Atomic replacement uses less stored space; never raises the existing budget.
   result=self.client.put_object(Bucket=self.bucket,Key=key,Body=packed,ContentLength=len(packed),ContentType='application/octet-stream',Metadata=self.codec_metadata(raw),IfMatch=head['ETag'])
   try:self.get(key,pathlib.Path(directory)/'verified.sqlite',sha)
   except Exception:
    # Restore the identical original only if our replacement is still current.
    if result.get('ETag'):self.client.put_object(Bucket=self.bucket,Key=key,Body=raw,ContentLength=len(raw),ContentType=head.get('ContentType','application/octet-stream'),Metadata=head.get('Metadata',{}),IfMatch=result['ETag'])
    raise
   return len(raw)-len(packed)

def summary_path(ident,sha):return ROOT/'summaries'/f'{ident}-{sha}.sqlite'
def published_receipt(receipt):
 # Discovery is not ingestion. Only apply to an activated published receipt.
 # Copy metadata rather than mutating a persisted receipt during readback.
 current=receipt.get('schema')==VERSION
 expected=PARSER_PROFILES.get(receipt.get('family'))
 return {**receipt,'count_state':'published' if current else 'retained-raw-only',
         'parser_current':bool(current and expected and receipt.get('parser_profile')==expected)}

def activate(store,receipt):
 for key in ('id','sha256','raw_rows','distinct_source_rows','stored_bytes'):
  if key not in receipt:raise ValueError('Incomplete published archive receipt: '+key)
 # Legacy raw records remain visible, but legacy summaries are not served.
 if receipt.get('schema')==VERSION:
  p=summary_path(receipt['id'],receipt['sha256'])
  store.get(receipt['summary_key'],p,receipt['summary_sha256'])
 active=published_receipt(receipt)
 with LOCK:STATE['sources'][active['id']]=active;STATE['errors'].pop(active['id'],None)
def distinct_receipts(receipts):
 unique={}
 for r in receipts:
  key=r['sha256']
  if key not in unique or r.get('schema')==VERSION:unique[key]=r
 return list(unique.values())
def status():
 with LOCK:s=json.loads(json.dumps(STATE))
 # The ingestion loop publishes a completed environmental status snapshot.
 # Its live lock can span an object-store checkpoint upload; a drinking-water
 # status/readiness request must never wait for that unrelated transfer.
 if WELL_ARCHIVE:s['well_archive']=WELL_ARCHIVE.status()
 if COMPLIANCE_ARCHIVE:s['compliance_archive']=COMPLIANCE_ARCHIVE.status()
 receipts=distinct_receipts(s['sources'].values());count=sum(x['distinct_source_rows'] for x in receipts)
 eligible=sum(x.get('eligible_source_records',0) for x in receipts if x.get('schema')==VERSION)
 s.update(retained_source_records=count,eligible_source_records=eligible,raw_rows=sum(x['raw_rows'] for x in receipts),published_archives=len(receipts),qualified_archives=sum(x.get('schema')==VERSION for x in receipts),active_archive_bytes=sum(x['stored_bytes'] for x in receipts),stored_bytes=s['persistent_storage_bytes'],storage_budget_bytes=MAX_TOTAL,target_met=eligible>=s['target_minimum_records'],count_definition='retained exact source-field rows deduplicated within each archive member; eligible rows additionally pass identity, date, and typed numeric or documented qualitative-result checks; neither count is an independent-observation or household count; cross-source duplication is not resolved',target_count_basis='eligible_source_records',household_safety_certified=False,coverage_complete=False)
 s['sources']={key:{k:v for k,v in receipt.items() if k not in ('parts','skipped_members')} for key,receipt in ((k,published_receipt(v)) for k,v in s['sources'].items())}
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
   # A fresh full-file checksum confirms the retained source is still current.
   # Preserve original acquisition time; advance only the verified check time.
   checked={**existing,'checked_at':receipt['retrieved_at']}
   with store.publication_lock():
    current=store.json('v2/latest/'+item['id']+'.json')
    if not current or current.get('sha256')!=existing['sha256'] or current.get('parser_profile')!=profile:raise ValueError('Published source changed during freshness check')
    metadata_size=len(json.dumps(checked,allow_nan=False).encode())
    store.ensure_capacity(2*metadata_size+4096)
    store.put_json('v2/data/'+receipt['sha256']+'/'+profile+'/receipt.json',checked)
    store.put_json('v2/latest/'+item['id']+'.json',checked)
   activate(store,checked);log('unchanged',source=item['id']);return
  base='v2/data/'+receipt['sha256']+'/'+profile;summary=work/'summary.sqlite';parts=[];skipped=[];expanded=0
  with zipfile.ZipFile(archive) as z:
   extensions=('.mdb',) if item['family']=='syr2' else ('.txt','.tsv','.csv')
   members=[m for m in z.infolist() if not m.is_dir() and m.filename.lower().endswith(extensions)]
   for member in members:
    name=pathlib.PurePosixPath(member.filename).name;low=name.lower()
    if item['family']=='ucmr' and not re.fullmatch(r'ucmr[1-5]_all\.txt',low):skipped.append({'member':name,'reason':'ancillary-not-observation-table'});continue
    if any(x in low for x in ('paired','hybrid','readme','dictionary','treatment')):skipped.append({'member':name,'reason':'derived-or-documentation-table'});continue
    expanded+=member.file_size
    if expanded>MAX_EXPANDED:raise ValueError('Expanded archive budget exceeded')
    raw=work/'member.raw';text=work/'member.tsv'
    with z.open(member) as src,open(raw,'wb') as dst:shutil.copyfileobj(src,dst,1024*1024)
    encoding='utf-8-sig';source_metadata=None
    if item['family']=='syr2':
     source_metadata=export_mdb(raw,text);encoding='mdbtools-utf8-export'
    else:
     try:
      with open(raw,'r',encoding=encoding) as src,open(text,'w',encoding='utf-8',newline='') as dst:
       while chunk:=src.read(1024*1024):dst.write(chunk)
     except UnicodeDecodeError:
      encoding='cp1252'
      with open(raw,'r',encoding=encoding) as src,open(text,'w',encoding='utf-8',newline='') as dst:
       while chunk:=src.read(1024*1024):dst.write(chunk)
    raw.unlink();partpath=work/(hashlib.sha256(member.filename.encode()).hexdigest()[:16]+'.parquet')
    part=process_member(str(text),partpath,summary,item['family'],member.filename,source_metadata);part['encoding']=encoding;part['key']=base+'/'+partpath.name
    if source_metadata:part['source_table']=source_metadata
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
  receipt.update(count_state='published',parser_current=True)
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

def compliance_report(pwsid):
 if not re.fullmatch('[A-Z0-9]{9}',pwsid):raise ValueError('Invalid complete PWSID')
 if COMPLIANCE_ARCHIVE:
  try:return COMPLIANCE_ARCHIVE.system(pwsid)
  except Exception as e:log('compliance-query-error',error=type(e).__name__)
 return {'pwsid':pwsid,'status':'unavailable','records':[],'current_safety':'not-determined'}

def pws_report(pwsid,include_compliance=True):
 if not re.fullmatch('[A-Z0-9]{9}',pwsid):raise ValueError('Invalid complete PWSID')
 with LOCK:
  loaded=distinct_receipts(STATE['sources'].values());serving_ready=STATE.get('serving_ready',False)
 receipts=[r for r in loaded if r.get('schema')==VERSION]
 summaries=[];sources=[];matching=0;response_bytes=0;truncated=False;omitted_raw=0
 checked_sources=[{k:r[k] for k in ('id','url','catalogue_url','retrieved_at','sha256')} for r in receipts]
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
 compliance=compliance_report(pwsid) if include_compliance else None
 return {'schema':VERSION,'pwsid':pwsid,'status':'records-returned' if summaries else 'response-truncated' if matching else 'qualified-archives-unavailable' if not receipts else 'no-records-in-loaded-archives','serving_ready':serving_ready,'summaries':summaries,'sources':sources,'checked_sources':checked_sources,'compliance':compliance,'archives_checked':len(receipts),'legacy_archives_excluded':len(loaded)-len(receipts),'matching_summary_groups':matching,'returned_summary_groups':len(summaries),'truncated':truncated or omitted_raw>0,'omitted_large_latest_records':omitted_raw,'maximum_summary_groups':MAX_SUMMARIES,'scope':'public-system-samples-not-household','current_safety':'not-determined','cross_source_sample_independence_certified':False,'historical_data':True,'coverage_complete':False}

def loop(stop=None,store_factory=Store,discover_fn=discover):
 global ENVIRONMENTAL_ARCHIVE,COMPLIANCE_ARCHIVE,WELL_ARCHIVE
 stop=stop or threading.Event();store=None;next_catalogue=0;pending_retries={};compactor=CapacityCompactor();directory_bootstrap_attempted=False;chemistry_deferred=False
 with LOCK:STATE['serving_ready']=False;STATE['restore_pending']=[]
 def attempt(source,action):
  try:
   if hasattr(store,'check_publication_lease'):store.check_publication_lease()
   action();pending_retries.pop(source,None)
   with LOCK:STATE['errors'].pop(source,None)
   if source=='compliance':log('compliance-archive-ready',rows=COMPLIANCE_ARCHIVE.status()['retained_association_rows'])
  except Exception as e:
   if isinstance(e,StorageBudgetExceeded):pending_retries[source]={'error':e,'at':time.monotonic(),'action':action}
   elif isinstance(e,PublicationBusy):
    # Recheck the small lease record at most once a minute so an early
    # release recovers promptly; the preflight never starts a download while held.
    pending_retries[source]={'error':e,'retry_at':time.monotonic()+max(5,min(60,e.expires-time.time())),'action':action}
   else:pending_retries.pop(source,None)
   with LOCK:STATE['errors'][source]=str(e)[:250]
   details={'storage_used_bytes':e.used,'storage_required_additional_bytes':e.additional,'storage_budget_bytes':e.maximum} if isinstance(e,StorageBudgetExceeded) else {}
   log('compliance-import-error' if source=='compliance' else 'ingest-error',source=source,error=str(e)[:250],**details)
  finally:
   if source=='compliance':
    with LOCK:STATE['compliance_archive']=COMPLIANCE_ARCHIVE.status()
 ROOT.mkdir(parents=True,exist_ok=True)
 while not stop.is_set():
  try:
   if store is None:store=store_factory()
   inventory=store.inventory()
   with LOCK:STATE['errors'].pop('storage',None)
  except Exception as e:
   store=None
   with LOCK:STATE['ingestion_status']='storage-unavailable';STATE['errors']['storage']=type(e).__name__
   log('storage-unavailable',error=type(e).__name__)
   stop.wait(STORAGE_RETRY_SECONDS);continue
  if ENVIRONMENTAL_ARCHIVE is None and os.environ.get('WAREHOUSE_WQP_ENABLED')=='true':
   try:
    from .environmental_archive import EnvironmentalArchive
    ENVIRONMENTAL_ARCHIVE=EnvironmentalArchive(store,ROOT/'environmental')
    with LOCK:STATE['environmental_archive']=ENVIRONMENTAL_ARCHIVE.status()
   except Exception as e:log('environmental-restore-error',error=str(e)[:250])
  if COMPLIANCE_ARCHIVE is None and os.environ.get('WAREHOUSE_COMPLIANCE_ENABLED')=='true':
   try:
    from .compliance_archive import ComplianceArchive
    COMPLIANCE_ARCHIVE=ComplianceArchive(store,ROOT/'compliance')
    with LOCK:STATE['compliance_archive']=COMPLIANCE_ARCHIVE.status()
   except Exception as e:log('compliance-restore-error',error=str(e)[:250])
  if WELL_ARCHIVE is None and os.environ.get('WAREHOUSE_WELLS_ENABLED')=='true':
   try:
    from .well_archive import WellArchive
    WELL_ARCHIVE=WellArchive(store,ROOT/'wells')
   except Exception as e:log('well-restore-error',error=str(e)[:250])
  if time.monotonic()<next_catalogue:
   try:
    reclaimed=compactor.step(store,pending_retries,inventory['bytes'],time.monotonic())
    if reclaimed:
     inventory=store.inventory()
     log('capacity-index-compacted',bytes_reclaimed=reclaimed,attempts_this_process=compactor.attempts,maximum_attempts_this_process=25)
   except Exception as e:log('capacity-compaction-paused',error=str(e)[:250])
   for source,failure in list(pending_retries.items()):
    if stop.is_set():break
    capacity=isinstance(failure['error'],StorageBudgetExceeded)
    ready=capacity_retry_ready(failure,inventory['bytes'],store.max_total,time.monotonic()) if capacity else time.monotonic()>=failure['retry_at']
    if ready:
     if capacity:log('capacity-recovered-retry',source=source,reclaimed_bytes=failure['error'].used-inventory['bytes'])
     else:log('publication-lease-retry',source=source)
     attempt(source,failure['action'])
     # Re-read accounting before another source can start; every publication
     # still uses the existing lease and full capacity checks.
     try:inventory=store.inventory()
     except Exception:break
     with LOCK:
      STATE['ingestion_status']='cycle-complete-with-gaps' if STATE['errors'] else 'cycle-complete'
      STATE['current_archive']=None;STATE['last_capacity_retry_at' if capacity else 'last_publication_retry_at']=utc()
   if chemistry_deferred:
    directory_failure=pending_retries.get('directory')
    # Resume normal refresh after bootstrap succeeds, or recovery reaches its
    # existing attempt/candidate bounds. Never hide already restored chemistry.
    exhausted=directory_failure and isinstance(directory_failure['error'],StorageBudgetExceeded) and not compactor.can_recover(store,pending_retries,inventory['bytes']) and not capacity_retry_ready(directory_failure,inventory['bytes'],store.max_total,time.monotonic()) and time.monotonic()-directory_failure['at']>=60
    if not directory_failure or exhausted:
     chemistry_deferred=False;next_catalogue=0;continue
   # Restore blocked published snapshots before spending minutes downloading
   # additional historical backfill. Existing query endpoints remain available.
   capacities=[f for f in pending_retries.values() if isinstance(f['error'],StorageBudgetExceeded)]
   if getattr(store,'provider',None)=='railway' and capacities:
    now=time.monotonic();ready_at=min(f['at']+60 for f in capacities)
    if now<ready_at or compactor.can_recover(store,pending_retries,inventory['bytes']):
     stop.wait(min(60,max(1,(ready_at if now<ready_at else compactor.next_check)-now)))
     continue
   if WELL_ARCHIVE:
    try:
     if WELL_ARCHIVE.step():log('well-archive-step',records=WELL_ARCHIVE.status()['source_well_records'],errors=WELL_ARCHIVE.status()['errors'])
    except Exception as e:log('well-acquisition-error',error=str(e)[:250])
   if ENVIRONMENTAL_ARCHIVE:
    try:more=ENVIRONMENTAL_ARCHIVE.step()
    except Exception as e:
     ENVIRONMENTAL_ARCHIVE.phase='acquisition-paused';ENVIRONMENTAL_ARCHIVE.error=str(e)[:250];more=False
     log('environmental-acquisition-paused',error=str(e)[:250])
    with LOCK:STATE['environmental_archive']=ENVIRONMENTAL_ARCHIVE.status()
    stop.wait(2 if more else 300)
   else:stop.wait(min(60,max(1,next_catalogue-time.monotonic())))
   continue
  try:
   items=discover_fn()
   with LOCK:STATE['catalogue_archives']=len(items);STATE['ingestion_status']='ingesting';STATE['errors'].pop('catalogue',None)
   restore_pending=[];published_receipts=0
   for item in items:
    try:
     receipt=store.json('v2/latest/'+item['id']+'.json') or store.json('v1/latest/'+item['id']+'.json')
     if receipt:published_receipts+=1;activate(store,receipt)
    except Exception as e:
     restore_pending.append(item['id']);log('restore-error',source=item['id'],error=type(e).__name__)
   with LOCK:
    STATE['restore_pending']=restore_pending;STATE['published_receipts_checked']=published_receipts
    # Do not admit traffic while only the first few saved archives are loaded.
    # Missing, never-published sources do not block an otherwise usable archive.
    STATE['serving_ready']=not restore_pending
    if not restore_pending:STATE['restored_at']=utc()
   if restore_pending:
    with LOCK:STATE['ingestion_status']='restoring'
    stop.wait(STORAGE_RETRY_SECONDS);continue
   if not directory_bootstrap_attempted and COMPLIANCE_ARCHIVE and hasattr(COMPLIANCE_ARCHIVE,'warm_directory'):
    directory_bootstrap_attempted=True
    attempt('directory',COMPLIANCE_ARCHIVE.warm_directory)
    if 'directory' in pending_retries:
     # Reuse the bounded recovery/retry loop before any full unchanged-source
     # downloads. HTTP serving is already ready from the verified receipts.
     chemistry_deferred=True;next_catalogue=time.monotonic()+max(1,int(os.environ.get('WAREHOUSE_REFRESH_HOURS','168')))*3600
     continue
   for item in items:
    if stop.is_set():break
    attempt(item['id'],lambda item=item:ingest(store,item))
   if COMPLIANCE_ARCHIVE and not stop.is_set():attempt('compliance',COMPLIANCE_ARCHIVE.refresh)
   with LOCK:STATE['ingestion_status']='cycle-complete-with-gaps' if STATE['errors'] else 'cycle-complete';STATE['current_archive']=None;STATE['last_cycle_at']=utc()
  except Exception as e:
   with LOCK:STATE['ingestion_status']='catalogue-unavailable';STATE['errors']['catalogue']=type(e).__name__
   log('catalogue-unavailable',error=type(e).__name__)
  next_catalogue=time.monotonic()+(STORAGE_RETRY_SECONDS if STATE['ingestion_status']=='catalogue-unavailable' else max(1,int(os.environ.get('WAREHOUSE_REFRESH_HOURS','168')))*3600)
  if ENVIRONMENTAL_ARCHIVE:
   with LOCK:STATE['environmental_archive']=ENVIRONMENTAL_ARCHIVE.status()

class Handler(BaseHTTPRequestHandler):
 def setup(self):
  self.request.settimeout(10)
  super().setup()
 def log_message(self,*args):pass
 def do_GET(self):
  target=urllib.parse.urlsplit(self.path)
  try:
   response_status=200
   if target.path=='/healthz':
    inventory=status();ready=inventory.get('serving_ready',False)
    data={'process':'up','serving_ready':ready,'published_archives':inventory['published_archives']}
    if not ready:response_status=503
   elif target.path=='/status':data=status()
   elif re.fullmatch(r'/pws/[A-Z0-9]{9}',target.path):
    params=urllib.parse.parse_qs(target.query,strict_parsing=True,max_num_fields=1)
    if params and params!={'include_compliance':['0']} and params!={'include_compliance':['1']}:raise ValueError('Invalid system query')
    data=pws_report(target.path.rsplit('/',1)[-1],include_compliance=params.get('include_compliance',['1'])==['1'])
   elif re.fullmatch(r'/compliance/[A-Z0-9]{9}',target.path):
    if target.query:raise ValueError('Invalid compliance query')
    data=compliance_report(target.path.rsplit('/',1)[-1])
   elif re.fullmatch(r'/directory/system/[A-Z0-9]{9}',target.path):
    if target.query:raise ValueError('Invalid directory query')
    data=COMPLIANCE_ARCHIVE.directory_system(target.path.rsplit('/',1)[-1]) if COMPLIANCE_ARCHIVE else {'schema':'sdwis-directory/1','status':'not-acquired','records':[],'total_records':0,'matching_records':0,'truncated':False,'household_connection_verified':False}
   elif target.path=='/directory/search':
    params=urllib.parse.parse_qs(target.query,strict_parsing=True,max_num_fields=6,keep_blank_values=True)
    if set(params)-{'state','city','zip','query','limit','local'} or any(len(v)!=1 for v in params.values()):raise ValueError('Invalid directory query')
    data=COMPLIANCE_ARCHIVE.directory_search(**{k:v[0] for k,v in params.items()}) if COMPLIANCE_ARCHIVE else {'schema':'sdwis-directory/1','status':'not-acquired','records':[],'total_records':0,'matching_records':0,'truncated':False,'household_connection_verified':False}
   elif target.path=='/environment/near':
    params=urllib.parse.parse_qs(target.query,strict_parsing=True,max_num_fields=2)
    if set(params)!={'lat','lon'} or any(len(v)!=1 for v in params.values()):raise ValueError('Invalid environmental query')
    data=ENVIRONMENTAL_ARCHIVE.near(float(params['lat'][0]),float(params['lon'][0])) if ENVIRONMENTAL_ARCHIVE else {'status':'not-connected','records':[],'household_sample_verified':False}
   elif target.path=='/wells/near':
    params=urllib.parse.parse_qs(target.query,strict_parsing=True,max_num_fields=2)
    if set(params)!={'lat','lon'} or any(len(v)!=1 for v in params.values()):raise ValueError('Invalid well query')
    data=WELL_ARCHIVE.near(float(params['lat'][0]),float(params['lon'][0])) if WELL_ARCHIVE else {'status':'not-connected','records':[],'household_connection_verified':False}
   else:self.send_error(404);return
   payload=json.dumps(data,allow_nan=False,default=str).encode()
   if len(payload)>MAX_RESPONSE:
    payload=json.dumps({'schema':VERSION,'error':'RESPONSE_TOO_LARGE','truncated':True,'current_safety':'not-determined'}).encode()
    self.send_response(503)
   else:self.send_response(response_status)
   self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
  except (BrokenPipeError,ConnectionResetError,TimeoutError):
   # A cancelled client has no response socket. Writing an error a second time
   # only hides the original slow lookup under another broken-pipe traceback.
   log('query-client-disconnected')
  except Exception as e:
   log('query-error',error=type(e).__name__)
   with contextlib.suppress(BrokenPipeError,ConnectionResetError,TimeoutError):self.send_error(503,'Evidence temporarily unavailable')
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
