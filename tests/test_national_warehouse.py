import contextlib,copy,hashlib,http.client,io,json,pathlib,shutil,socket,sqlite3,tempfile,threading,unittest,zipfile
from unittest import mock
from national import warehouse as W
from national.warehouse import process_member,canonical_sql,status
from botocore.exceptions import ClientError
class WarehouseTests(unittest.TestCase):
 def test_documented_microbial_presence_is_never_a_numeric_detection(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);f=p/'input.tsv'
   header='ANALYTE_CODE\tPWSID\tANALYTE_NAME\tSAMPLE_COLLECTION_DATE\tVALUE\tUNIT\tDETECT\tPRESENCE_INDICATOR_CODE\tSAMPLING_POINT_TYPE\n'
   rows=['3100\tAK2270312\tCOLIFORM (TCR)\t31-AUG-16\t\t\t\tP\tDS',
         '3100\tAK2270312\tCOLIFORM (TCR)\t01-SEP-16\t\t\t\tA\tDS',
         '3100\tAK2270312\tCOLIFORM (TCR)\t02-SEP-16\t\t\t\t?\tDS',
         '9999\tAK2270312\tUNKNOWN\t01-SEP-16\t\t\t\tP\tDS']
   f.write_text(header+'\n'.join(rows)+'\n')
   r=process_member(str(f),p/'x.parquet',p/'s.sqlite','syr4','microbes.txt');self.assertEqual(r['eligible_source_rows'],2)
   with sqlite3.connect(p/'s.sqlite') as db:row=db.execute('SELECT result_kind,n,detects,nondetects,min_detect,max_detect,present_results,absent_results,unit FROM summaries').fetchone()
   self.assertEqual(row,('presence-absence',2,0,0,None,None,1,1,'presence/absence'))
 def test_syr4_quoted_fields_short_dates_and_nondetect_units(self):
  import csv,duckdb
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);f=p/'input.tsv'
   with f.open('w',newline='') as out:
    writer=csv.writer(out,delimiter='\t',quoting=csv.QUOTE_ALL)
    writer.writerow(['PWSID','System Name','Analyte Name','Sample Collection Date','Value','Unit','Detect','Detection Limit Value','Detection Limit Unit','Sampling Point Type'])
    writer.writerows([['AK2270312','Utility "A"\tNorth','RADIUM','31-AUG-16','','','0','1','PCI/L','EP'],['AK2270312','Utility "A"\tNorth','RADIUM','21-APR-15','0.188','PCI/L','1','','','EP']])
   r=process_member(str(f),p/'x.parquet',p/'s.sqlite','syr4','test.txt')
   self.assertEqual(r['raw_rows'],2);self.assertEqual(r['invalid_identity_date_rows'],0);self.assertEqual(r['eligible_source_rows'],2)
   with sqlite3.connect(p/'s.sqlite') as db:rows=db.execute('SELECT pwsid,n,detects,nondetects,unit,first_date,last_date,min_detect,max_detect FROM summaries').fetchall()
   self.assertEqual(rows,[('AK2270312',2,1,1,'PCI/L','2015-04-21','2016-08-31',0.188,0.188)])
   with duckdb.connect() as db:self.assertEqual(db.execute('SELECT DISTINCT system_name FROM read_parquet(?)',[str(p/'x.parquet')]).fetchall(),[('Utility "A"\tNorth',)])
 def test_date_and_bound_parsing_rejects_malformed_values(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);f=p/'input.tsv'
   header='PWSID\tAnalyte Name\tSample Collection Date\tValue\tUnit\tDetect\tDetection Limit Value\tDetection Limit Unit\n'
   rows=['FL0000001\tARSENIC\t9/16/2009 0:00:00\t\tUG/L\t0\t1\tMG/L',
         'FL0000001\tARSENIC\t2009-09-16 BAD\t2\tUG/L\t1\t1\tMG/L',
         'FL0000001\tARSENIC\t2009-09-16\tbad\tUG/L\t0\t1\tMG/L',
         'FL0000001\tARSENIC\t2/30/2009 0:00:00\t2\tUG/L\t1\t1\tMG/L']
   f.write_text(header+'\n'.join(rows)+'\n')
   r=process_member(str(f),p/'x.parquet',p/'s.sqlite','syr3','fixture')
   self.assertEqual(r['eligible_source_rows'],1);self.assertEqual(r['invalid_identity_date_rows'],2)
   with sqlite3.connect(p/'s.sqlite') as db:self.assertEqual(db.execute('SELECT unit,detects,nondetects,max_detect FROM summaries').fetchall(),[('MG/L',0,1,None)])
 def test_syr3_ancillary_padding_is_exact_and_auditable(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);f=p/'input.tsv'
   header=['field'+str(n) for n in range(26)]+['Residual Field Free Chlorine mg/L','Residual Field Total Chlorine mg/L']
   prefix=['preserved']*26
   f.write_text('\t'.join(header)+'\n'+'\t'.join(prefix+[';'])+'\n')
   path,count=W.prepare_member(str(f),'syr3','folder/alkalinity.txt')
   self.assertEqual(count,1);self.assertEqual(pathlib.Path(path).read_text().splitlines()[1].split('\t'),prefix+[';',''])
   self.assertEqual(f.read_text().splitlines()[1].split('\t'),prefix+[';'])
   f.write_text('\t'.join(header)+'\n'+'\t'.join(prefix+['unexpected'])+'\n')
   with self.assertRaisesRegex(ValueError,'field count'):W.prepare_member(str(f),'syr3','alkalinity.txt')
   self.assertEqual(W.prepare_member(str(f),'syr3','other.txt'),(str(f),0))
 def test_ucmr_preserves_ids_nondetects_and_real_zero(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);f=p/'input.tsv';header='PWSID\tPWSName\tContaminant\tCollectionDate\tAnalyticalResultValue\tUnits\tAnalyticalResultsSign\tMRL\tSampleID\tSamplePointType\n'
   a='010106001\tExample\tPFAS-A\t9/27/2023\t\tµg/L\t<\t0.003\tA\tEP\n'
   b='CA0000001\tExample\tPFAS-A\t9/27/2023\t0\tµg/L\t=\t0.003\tB\tEP\n'
   f.write_text(header+a+a+b,encoding='utf-8');r=process_member(str(f),p/'x.parquet',p/'sum.sqlite','ucmr','test')
   self.assertEqual(r['raw_rows'],3);self.assertEqual(r['distinct_source_rows'],2)
   db=sqlite3.connect(p/'sum.sqlite');rows=db.execute('select pwsid,detects,nondetects,min_detect,unit from summaries order by pwsid').fetchall();db.close()
   self.assertEqual(rows,[('010106001',0,1,None,'µg/L'),('CA0000001',1,0,0.0,'µg/L')])
 def test_unknown_schema_fails(self):
  with self.assertRaises(ValueError):canonical_sql(['fake'],'ucmr')
 def test_missing_is_not_zero_and_raw_scope_preserved(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);f=p/'i.tsv';f.write_text('PWSID\tAnalyte Name\tSample Collection Date\tValue\tUnit\tDetect\tSource Type Code\nFL0000001\tLEAD\t2008-01-01 00:00:00.000\t\tUG/L\t1\tRW\n')
   r=process_member(str(f),p/'x.parquet',p/'s.sqlite','syr3','fixture')
   db=sqlite3.connect(p/'s.sqlite');row=db.execute('select detects,min_detect,scope from summaries').fetchone();db.close()
   self.assertIsNone(row)
   self.assertEqual(r['eligible_source_rows'],0)
   import duckdb
   con=duckdb.connect()
   try:self.assertEqual(con.execute('SELECT detected_value,evidence_scope FROM read_parquet(?)',[str(p/'x.parquet')]).fetchone(),(None,'source-water'))
   finally:con.close()
 def test_status_is_not_publisher_inventory(self):
  self.assertEqual(status()['retained_source_records'],0);self.assertFalse(status()['target_met']);self.assertFalse(status()['household_safety_certified'])

class MemoryS3:
 def __init__(self,versioned=False):self.objects={};self.versions=[];self.multipart=[];self.versioned=versioned;self.serial=0;self.metadata={}
 def get_bucket_versioning(self,**kwargs):return {'Status':'Enabled'} if self.versioned else {}
 def get_paginator(self,operation):
  owner=self
  class Pages:
   def paginate(self,**kwargs):
    if operation=='list_objects_v2':return [{'Contents':[{'Key':k,'Size':len(v[0])} for k,v in owner.objects.items()]}]
    if operation=='list_object_versions':return [{'Versions':owner.versions}]
    if operation=='list_multipart_uploads':return [{'Uploads':[{'Key':'orphan','UploadId':'unfinished'}]}] if owner.multipart else [{}]
    if operation=='list_parts':return [{'Parts':[{'Size':n} for n in owner.multipart]}]
    raise AssertionError(operation)
  return Pages()
 def get_object(self,Key,**kwargs):
  if Key not in self.objects:raise ClientError({'Error':{'Code':'NoSuchKey'}},'GetObject')
  body,etag=self.objects[Key];return {'Body':io.BytesIO(body),'ETag':etag}
 def put_object(self,Key,Body,**kwargs):
  current=self.objects.get(Key)
  if kwargs.get('IfNoneMatch')=='*' and current or kwargs.get('IfMatch') and (not current or kwargs['IfMatch']!=current[1]):raise ClientError({'Error':{'Code':'PreconditionFailed'}},'PutObject')
  body=Body.read() if hasattr(Body,'read') else Body;self.serial+=1;etag='"'+str(self.serial)+'"';self.objects[Key]=(body,etag)
  self.metadata[Key]=kwargs.get('Metadata',{})
  self.versions.append({'Key':Key,'Size':len(body),'VersionId':str(self.serial)})
  return {'ETag':etag}
 def download_file(self,bucket,key,path):pathlib.Path(path).write_bytes(self.objects[key][0])
 def head_object(self,Key,**kwargs):return {'ContentLength':len(self.objects[Key][0]),'ETag':self.objects[Key][1],'Metadata':self.metadata.get(Key,{})}

class HardenedWarehouseTests(unittest.TestCase):
 def setUp(self):self.saved=copy.deepcopy(W.STATE)
 def tearDown(self):W.STATE.clear();W.STATE.update(self.saved)
 def test_invalid_future_untyped_and_negative_records_are_retained_but_not_summarized(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);f=p/'input.tsv'
   header='PWSID\tPWSName\tContaminant\tCollectionDate\tAnalyticalResultValue\tUnits\tAnalyticalResultsSign\tMRL\tSampleID\tSamplePointType\n'
   rows=[('CA0000001','9/27/2023','1','ug/L','=','A'),('CA0000001','9/27/2099','999','ug/L','=','B'),('CA0000001','2/30/2023','888','ug/L','=','C'),('bad','9/27/2023','777','ug/L','=','D'),('CA0000001','9/27/2023','-1','ug/L','=','E'),('CA0000001','9/27/2023','666','','=','F'),('CA0000001','9/27/2023','inf','ug/L','=','G'),('CA0000001','9/27/2023','','ug/L','<','H'),('CA0000001','9/27/2023','0','ug/L','=','I')]
   lines=['\t'.join([pid,'Example','PFAS-A',date,value,unit,sign,'0.003',sample,'EP'])+'\n' for pid,date,value,unit,sign,sample in rows]
   f.write_text(header+''.join(lines)+lines[0])
   result=process_member(str(f),p/'part.parquet',p/'summary.sqlite','ucmr','fixture')
   self.assertEqual(result['raw_rows'],10);self.assertEqual(result['distinct_source_rows'],9);self.assertEqual(result['eligible_source_rows'],3)
   with sqlite3.connect(p/'summary.sqlite') as db:summary=db.execute('SELECT n,detects,nondetects,last_date,min_detect,max_detect FROM summaries').fetchall()
   self.assertEqual(summary,[(3,2,1,'2023-09-27',0.0,1.0)])
 def test_bucket_inventory_includes_old_partial_versioned_and_multipart_bytes(self):
  client=MemoryS3(versioned=True)
  for key,size in [('old',70),('active',20),('unfinished',15),('active',25)]:client.put_object(Key=key,Body=b'x'*size)
  client.multipart=[7,9]
  store=W.Store(client=client,bucket='test',max_total=145)
  self.assertEqual(store.inventory()['bytes'],146)
  with self.assertRaisesRegex(ValueError,'budget'):store.ensure_capacity(1)
 def test_publisher_lease_excludes_competing_writers_and_each_write_checks_budget(self):
  client=MemoryS3();first=W.Store(client=client,bucket='test',max_total=10000);second=W.Store(client=client,bucket='test',max_total=10000)
  with first.publication_lock():
   with self.assertRaisesRegex(ValueError,'lease'):
    with second.publication_lock():pass
   first.put_json('v2/data/test',{'ok':True})
   with self.assertRaisesRegex(ValueError,'budget'):first.put_json('too-large',{'text':'x'*10000})
  self.assertNotIn('too-large',client.objects)
  with second.publication_lock():second.put_json('after-release',{'ok':True})
 def test_railway_provider_uses_documented_unversioned_inventory_without_hiding_other_failures(self):
  client=MemoryS3();client.get_bucket_versioning=mock.Mock(side_effect=RuntimeError('unsupported'))
  client.put_object(Key='retained',Body=b'12345')
  self.assertEqual(W.Store(client=client,bucket='test',provider='railway').inventory()['bytes'],5)
  client.get_bucket_versioning.assert_not_called()
  with self.assertRaises(RuntimeError):W.Store(client=client,bucket='test',provider='s3').inventory()
 def test_same_raw_archive_is_rebuilt_when_legacy_schema_changes(self):
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);archive=p/'official.zip'
   text='PWSID\tPWSName\tContaminant\tCollectionDate\tAnalyticalResultValue\tUnits\tAnalyticalResultsSign\tMRL\nCA0000001\tExample\tPFAS-A\t9/27/2023\t1\tug/L\t=\t0.003\n'
   with zipfile.ZipFile(archive,'w') as z:z.writestr('folder/ucmr5_all.txt',text)
   sha=W.digest(archive);item={'id':'ucmr5','family':'ucmr','url':'https://www.epa.gov/source.zip','catalogue_url':'https://www.epa.gov/catalogue'}
   client=MemoryS3();store=W.Store(client=client,bucket='test',max_total=1000000)
   old={**item,'schema':'occurrence-warehouse/1','sha256':sha,'distinct_source_rows':99,'raw_rows':99,'stored_bytes':100}
   client.put_object(Key='v1/latest/ucmr5.json',Body=json.dumps(old).encode())
   def download(url,destination,max_bytes):shutil.copyfile(archive,destination);return {'sha256':sha,'archive_bytes':archive.stat().st_size}
   with mock.patch.object(W,'ROOT',p),mock.patch.object(W,'download',download):
    W.ingest(store,item)
    receipt=store.json('v2/latest/ucmr5.json');self.assertEqual(receipt['schema'],W.VERSION);self.assertEqual(receipt['eligible_source_records'],1)
    report=W.pws_report('CA0000001');self.assertEqual(report['summaries'][0]['max_detect'],1.0)
    # A schema migration must recalculate qualification without re-uploading
    # already retained source objects or consuming their storage a second time.
    legacy=copy.deepcopy(receipt);legacy['schema']='occurrence-warehouse/1'
    legacy['parts'][0]['member']='ucmr5_all.txt'
    client.put_object(Key='v1/latest/ucmr5.json',Body=json.dumps(legacy).encode())
    client.objects.pop('v2/latest/ucmr5.json')
    with mock.patch.object(store,'put',wraps=store.put) as uploaded:
     W.ingest(store,item)
    updated=store.json('v2/latest/ucmr5.json')
    self.assertTrue(updated['reused_source_objects']);self.assertEqual(updated['eligible_source_records'],1)
    self.assertEqual([call.args[0] for call in uploaded.call_args_list],[updated['summary_key']])
    # An unchanged ZIP must be requalified after a parser correction.
    outdated=copy.deepcopy(updated);outdated['parser_profile']='old-parser'
    client.put_object(Key='v2/latest/ucmr5.json',Body=json.dumps(outdated).encode())
    with mock.patch.object(W,'process_member',wraps=W.process_member) as parsed:W.ingest(store,item)
    parsed.assert_called_once();self.assertEqual(store.json('v2/latest/ucmr5.json')['parser_profile'],W.PARSER_PROFILES['ucmr'])
   self.assertIn('v1/latest/ucmr5.json',client.objects)
 def test_legacy_summaries_cannot_be_served_as_schema2(self):
  W.STATE['sources']={'old':{'id':'old','schema':'occurrence-warehouse/1','sha256':'abc','distinct_source_rows':300000000,'raw_rows':300000000,'stored_bytes':1}}
  self.assertEqual(W.status()['eligible_source_records'],0);self.assertFalse(W.status()['target_met'])
  report=W.pws_report('CA0000001');self.assertEqual(report['archives_checked'],0);self.assertEqual(report['status'],'qualified-archives-unavailable')
 def test_summary_limit_is_global_and_reports_truncation(self):
  with tempfile.TemporaryDirectory() as t,mock.patch.object(W,'ROOT',pathlib.Path(t)),mock.patch.object(W,'MAX_SUMMARIES',1):
   p=W.summary_path('current','sha');p.parent.mkdir()
   with sqlite3.connect(p) as db:
    db.execute('CREATE TABLE summaries(pwsid TEXT,analyte TEXT,last_date TEXT,latest_record TEXT)')
    db.executemany('INSERT INTO summaries VALUES(?,?,?,?)',[('CA0000001','A','2023-01-01','{}'),('CA0000001','B','2023-01-01','{}')])
   W.STATE['sources']={'current':{'id':'current','schema':W.VERSION,'sha256':'sha','url':'https://www.epa.gov/data','catalogue_url':'https://www.epa.gov/catalogue','retrieved_at':'2026-01-01'}}
   report=W.pws_report('CA0000001');self.assertTrue(report['truncated']);self.assertEqual(report['matching_summary_groups'],2);self.assertEqual(len(report['summaries']),1)
 def test_storage_initialization_retries(self):
  class Stop:
   done=False
   def is_set(self):return self.done
   def set(self):self.done=True
   def wait(self,seconds):return self.done
  stop=Stop();calls=[]
  def factory():
   calls.append(1)
   if len(calls)==1:raise OSError('temporary storage outage')
   return type('Storage',(),{'inventory':lambda self:{'bytes':0}})()
  def discover():stop.set();return []
  with tempfile.TemporaryDirectory() as t,mock.patch.object(W,'ROOT',pathlib.Path(t)):W.loop(stop=stop,store_factory=factory,discover_fn=discover)
  self.assertEqual(len(calls),2)
 def test_http_response_budget_returns_explicit_error_without_large_body(self):
  class IPv4Server(W.Server):address_family=socket.AF_INET
  with mock.patch.object(W,'MAX_RESPONSE',256),mock.patch.object(W,'status',return_value={'too_large':'x'*1000}):
   server=IPv4Server(('127.0.0.1',0),W.Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   try:
    connection=http.client.HTTPConnection('127.0.0.1',server.server_address[1],timeout=3);connection.request('GET','/status');response=connection.getresponse();body=response.read();connection.close()
    self.assertEqual(response.status,503);self.assertLessEqual(len(body),256);self.assertTrue(json.loads(body)['truncated'])
   finally:server.shutdown();server.server_close();thread.join()
 def test_http_concurrency_is_bounded(self):
  class IPv4Server(W.Server):address_family=socket.AF_INET
  with mock.patch.object(W,'MAX_CLIENTS',1):
   server=IPv4Server(('127.0.0.1',0),W.Handler);left,right=socket.socketpair()
   try:
    server.slots.acquire();server.process_request(left,('127.0.0.1',1));self.assertIn(b'503 Service Unavailable',right.recv(1024))
   finally:right.close();server.server_close()
if __name__=='__main__':unittest.main()


class LosslessCompactionTests(unittest.TestCase):
 def test_compaction_preserves_exact_index_and_receipt_at_full_budget(self):
  raw=b'SQLite format 3\x00'+b'original water records\n'*20000;sha=hashlib.sha256(raw).hexdigest();key='wqp/v1/data/fixture/source/spatial.sqlite'
  client=MemoryS3();client.put_object(Key=key,Body=raw)
  store=W.Store(client=client,bucket='test',provider='railway',max_total=len(raw)+4096)
  saved=store.compact_index(key,sha);self.assertGreater(saved,len(raw)*.8)
  self.assertEqual(len(client.objects[key][0]),len(raw)-saved)
  store.verify_size(key,len(raw));self.assertEqual(store.compact_index(key,sha),0)
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'index';store.get(key,p,sha);self.assertEqual(p.read_bytes(),raw)
  self.assertIn(key,client.objects)
 def test_wrong_receipt_never_replaces_evidence(self):
  client=MemoryS3();key='wqp/v1/data/fixture/source/spatial.sqlite';raw=b'unchanged'*1000;client.put_object(Key=key,Body=raw)
  store=W.Store(client=client,bucket='test',provider='railway',max_total=100000)
  with self.assertRaisesRegex(ValueError,'checksum'):store.compact_index(key,'a'*64)
  self.assertEqual(client.objects[key][0],raw)
 def test_new_index_writes_are_compressed_and_decode_is_bounded(self):
  client=MemoryS3();key='wqp/v1/data/fixture/source/spatial.sqlite';store=W.Store(client=client,bucket='test',provider='railway',max_total=1000000)
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'index';raw=b'repeat'*10000;p.write_bytes(raw);sha=hashlib.sha256(raw).hexdigest()
   with store.publication_lock():store.put(key,p)
   self.assertLess(len(client.objects[key][0]),len(raw));p.unlink();store.get(key,p,sha);self.assertEqual(p.read_bytes(),raw);p.unlink()
   client.metadata[key]['water-decoded-size']='64000001'
   with self.assertRaisesRegex(ValueError,'Invalid compressed'):store.get(key,p,sha)
   self.assertFalse(p.exists())

class CapacityRecoveryTests(unittest.TestCase):
 def test_retry_needs_time_recovered_bytes_and_complete_reservation(self):
  failure={'error':W.StorageBudgetExceeded(950_000_000,300_000_000,1_000_000_000),'at':100}
  self.assertFalse(W.capacity_retry_ready(failure,600_000_000,1_000_000_000,159))
  self.assertFalse(W.capacity_retry_ready(failure,900_000_000,1_000_000_000,160))
  self.assertFalse(W.capacity_retry_ready(failure,800_000_000,1_000_000_000,160))
  self.assertTrue(W.capacity_retry_ready(failure,600_000_000,1_000_000_000,160))
  self.assertFalse(W.capacity_retry_ready(failure,950_000_000,2_000_000_000,160))
 def test_storage_exception_carries_exact_reservation_without_changing_limit(self):
  client=MemoryS3();client.put_object(Key='existing',Body=b'1234567')
  store=W.Store(client=client,bucket='test',max_total=10);store.pending_bytes=2
  with self.assertRaises(W.StorageBudgetExceeded) as raised:store.ensure_capacity(4)
  self.assertEqual((raised.exception.used,raised.exception.additional,raised.exception.maximum),(7,6,10))
  self.assertEqual(client.objects['existing'][0],b'1234567')
 def test_only_capacity_failed_source_retries_before_weekly_catalogue(self):
  clock=[0];calls=[];discoveries=[];saved=copy.deepcopy(W.STATE)
  class Stop:
   done=False
   def is_set(self):return self.done
   def wait(self,seconds):
    clock[0]+=600
    if clock[0]>3600:raise AssertionError('Recovery was not retried')
  stop=Stop()
  class Storage:
   max_total=1_000_000_000
   def inventory(self):return {'bytes':950_000_000 if clock[0]==0 else 600_000_000}
   def json(self,key):return None
  def discover():discoveries.append(1);return [{'id':n} for n in ['unchanged','capacity','bad-schema']]
  def ingest(store,item):
   source=item['id'];calls.append(source)
   if source=='bad-schema':raise ValueError('Invalid source schema')
   if source=='capacity':
    if calls.count(source)==1:raise W.StorageBudgetExceeded(950_000_000,300_000_000,store.max_total)
    stop.done=True
  try:
   W.STATE['errors']={}
   with tempfile.TemporaryDirectory() as t,mock.patch.object(W,'ROOT',pathlib.Path(t)),mock.patch.object(W,'ingest',ingest),mock.patch.object(W.time,'monotonic',side_effect=lambda:clock[0]),mock.patch.object(W,'ENVIRONMENTAL_ARCHIVE',None),mock.patch.object(W,'WELL_ARCHIVE',None),mock.patch.object(W,'COMPLIANCE_ARCHIVE',None),mock.patch.dict(W.os.environ,{'WAREHOUSE_WQP_ENABLED':'false','WAREHOUSE_COMPLIANCE_ENABLED':'false','WAREHOUSE_WELLS_ENABLED':'false'}):
    W.loop(stop=stop,store_factory=Storage,discover_fn=discover)
   self.assertEqual(calls,['unchanged','capacity','bad-schema','capacity']);self.assertEqual(len(discoveries),1)
   self.assertNotIn('capacity',W.STATE['errors']);self.assertIn('bad-schema',W.STATE['errors'])
  finally:W.STATE.clear();W.STATE.update(saved)
 def test_compliance_capacity_retry_stops_after_success(self):
  clock=[0];saved=copy.deepcopy(W.STATE)
  class Stop:
   def is_set(self):return clock[0]>2400
   def wait(self,seconds):clock[0]+=600
  class Storage:
   max_total=1_000_000_000
   def inventory(self):return {'bytes':950_000_000 if clock[0]==0 else 600_000_000}
  class Compliance:
   calls=0
   def status(self):return {'retained_association_rows':self.calls}
   def refresh(self):
    self.calls+=1
    if self.calls==1:raise W.StorageBudgetExceeded(950_000_000,300_000_000,1_000_000_000)
  compliance=Compliance()
  try:
   W.STATE['errors']={}
   with tempfile.TemporaryDirectory() as t,mock.patch.object(W,'ROOT',pathlib.Path(t)),mock.patch.object(W.time,'monotonic',side_effect=lambda:clock[0]),mock.patch.object(W,'ENVIRONMENTAL_ARCHIVE',None),mock.patch.object(W,'WELL_ARCHIVE',None),mock.patch.object(W,'COMPLIANCE_ARCHIVE',compliance),mock.patch.dict(W.os.environ,{'WAREHOUSE_WQP_ENABLED':'false','WAREHOUSE_WELLS_ENABLED':'false'}):
    W.loop(stop=Stop(),store_factory=Storage,discover_fn=lambda:[])
   self.assertEqual(compliance.calls,2);self.assertNotIn('compliance',W.STATE['errors'])
  finally:W.STATE.clear();W.STATE.update(saved)

class PublicationRecoveryTests(unittest.TestCase):
 def test_busy_error_preserves_expiry_and_preflight_never_writes(self):
  client=MemoryS3();lease={'owner':'existing','expires':1234};client.put_object(Key='v2/publication-lease.json',Body=json.dumps(lease).encode())
  store=W.Store(client=client,bucket='test',max_total=10000);serial=client.serial
  with mock.patch.object(W.time,'time',return_value=1200):
   with self.assertRaises(W.PublicationBusy) as raised:store.check_publication_lease()
   self.assertEqual(raised.exception.expires,1234)
   with self.assertRaises(W.PublicationBusy) as raised:
    with store.publication_lock():self.fail('Must not acquire active lease')
   self.assertEqual(raised.exception.expires,1234)
  self.assertEqual(client.serial,serial)
  with mock.patch.object(W.time,'time',return_value=1234):store.check_publication_lease()
 def test_loop_waits_for_renewed_lease_before_any_expensive_occurrence_or_compliance_work(self):
  clock=[0];calls=[];saved=copy.deepcopy(W.STATE);client=MemoryS3()
  def lease(expires):client.put_object(Key='v2/publication-lease.json',Body=json.dumps({'owner':'publisher','expires':expires}).encode())
  lease(1006);store=W.Store(client=client,bucket='test',max_total=10000)
  class Stop:
   def is_set(self):return clock[0]>=16
   def wait(self,seconds):
    clock[0]+=2
    if clock[0]==4:lease(1012)
  class Compliance:
   def status(self):return {'retained_association_rows':5}
   def refresh(self):calls.append(('compliance',clock[0]))
  try:
   W.STATE['errors']={}
   with tempfile.TemporaryDirectory() as t,mock.patch.object(W,'ROOT',pathlib.Path(t)),mock.patch.object(W.time,'monotonic',side_effect=lambda:clock[0]),mock.patch.object(W.time,'time',side_effect=lambda:1000+clock[0]),mock.patch.object(W,'ingest',side_effect=lambda store,item:calls.append((item['id'],clock[0]))),mock.patch.object(W,'ENVIRONMENTAL_ARCHIVE',None),mock.patch.object(W,'WELL_ARCHIVE',None),mock.patch.object(W,'COMPLIANCE_ARCHIVE',Compliance()),mock.patch.dict(W.os.environ,{'WAREHOUSE_WQP_ENABLED':'false','WAREHOUSE_WELLS_ENABLED':'false'}):
    W.loop(stop=Stop(),store_factory=lambda:store,discover_fn=lambda:[{'id':'ucmr5'}])
   self.assertEqual(calls,[('ucmr5',12),('compliance',12)])
   self.assertNotIn('ucmr5',W.STATE['errors']);self.assertNotIn('compliance',W.STATE['errors'])
   self.assertIn('last_publication_retry_at',W.STATE)
  finally:W.STATE.clear();W.STATE.update(saved)
 def test_early_lease_release_is_detected_within_one_minute_without_downloads_while_held(self):
  clock=[0];calls=[];saved=copy.deepcopy(W.STATE);client=MemoryS3()
  def lease(expires):client.put_object(Key='v2/publication-lease.json',Body=json.dumps({'owner':'publisher','expires':expires}).encode())
  lease(2800);store=W.Store(client=client,bucket='test',max_total=10000)
  class Stop:
   def is_set(self):return clock[0]>=80
   def wait(self,seconds):
    clock[0]+=10
    if clock[0]==20:lease(0)
  try:
   W.STATE['errors']={}
   with tempfile.TemporaryDirectory() as t,mock.patch.object(W,'ROOT',pathlib.Path(t)),mock.patch.object(W.time,'monotonic',side_effect=lambda:clock[0]),mock.patch.object(W.time,'time',side_effect=lambda:1000+clock[0]),mock.patch.object(W,'ingest',side_effect=lambda store,item:calls.append(clock[0])),mock.patch.object(W,'ENVIRONMENTAL_ARCHIVE',None),mock.patch.object(W,'WELL_ARCHIVE',None),mock.patch.object(W,'COMPLIANCE_ARCHIVE',None),mock.patch.dict(W.os.environ,{'WAREHOUSE_WQP_ENABLED':'false','WAREHOUSE_WELLS_ENABLED':'false','WAREHOUSE_COMPLIANCE_ENABLED':'false'}):
    W.loop(stop=Stop(),store_factory=lambda:store,discover_fn=lambda:[{'id':'ucmr5'}])
   self.assertEqual(calls,[60]);self.assertNotIn('ucmr5',W.STATE['errors'])
  finally:W.STATE.clear();W.STATE.update(saved)

class AutomaticCapacityCompactionTests(unittest.TestCase):
 def fixture(self,count=30):
  items=[{'key':f'wqp/v1/data/{i}/source/spatial.sqlite','sha256':str(i).zfill(64)} for i in range(count)]
  class Client:
   compressed=set();reads=[]
   def head_object(self,Bucket,Key):
    self.reads.append(Key)
    return {'Metadata':{'water-storage-codec':'gzip-v1'} if Key in self.compressed else {}}
  class Store:
   provider='railway';max_total=1_000_000_000;bucket='fixture';busy=False
   def __init__(self):self.client=Client();self.compacted=[]
   def check_publication_lease(self):
    if self.busy:raise W.PublicationBusy(9999)
   def compact_index(self,key,sha):self.compacted.append((key,sha));return 55_000_000
  store=Store();factory=mock.Mock(return_value=items)
  failed={'compliance':{'error':W.StorageBudgetExceeded(950_000_000,300_000_000,store.max_total),'at':0}}
  return store,factory,failed,items
 def test_recovery_only_skips_compressed_and_limits_one_attempt_per_minute(self):
  store,factory,failed,items=self.fixture();compactor=W.CapacityCompactor(factory)
  self.assertEqual(compactor.step(store,{},950_000_000,0),0)
  self.assertEqual(compactor.step(store,failed,600_000_000,0),0);factory.assert_not_called()
  store.client.compressed={items[0]['key']}
  self.assertEqual(compactor.step(store,failed,950_000_000,0),55_000_000)
  self.assertEqual(store.compacted,[(items[1]['key'],items[1]['sha256'])])
  self.assertEqual(compactor.step(store,failed,950_000_000,59),0)
  self.assertEqual(compactor.step(store,failed,950_000_000,60),55_000_000)
  self.assertEqual(len(store.compacted),2);factory.assert_called_once_with(store)
 def test_limit_is_25_attempts_per_process_not_an_unbounded_recovery_job(self):
  store,factory,failed,items=self.fixture();compactor=W.CapacityCompactor(factory)
  for minute in range(40):compactor.step(store,failed,950_000_000,minute*60)
  self.assertEqual(compactor.attempts,25);self.assertEqual(len(store.compacted),25)
  self.assertEqual(len(store.client.reads),25);factory.assert_called_once()
 def test_recovery_continues_until_reclaimed_threshold_also_allows_retry(self):
  store,factory,failed,items=self.fixture();compactor=W.CapacityCompactor(factory)
  failed['compliance']['error']=W.StorageBudgetExceeded(998_000_000,1_000_000,store.max_total)
  self.assertFalse(W.capacity_retry_ready(failed['compliance'],900_000_000,store.max_total,60))
  self.assertEqual(compactor.step(store,failed,900_000_000,60),55_000_000)
  self.assertTrue(W.capacity_retry_ready(failed['compliance'],845_000_000,store.max_total,120))
  self.assertEqual(compactor.step(store,failed,845_000_000,120),0)
 def test_busy_lease_prevents_candidate_download_or_compaction(self):
  store,factory,failed,items=self.fixture();compactor=W.CapacityCompactor(factory);store.busy=True
  with self.assertRaises(W.PublicationBusy):compactor.step(store,failed,950_000_000,0)
  factory.assert_not_called();self.assertEqual(store.compacted,[]);self.assertEqual(compactor.attempts,0)
  store.busy=False
  self.assertEqual(compactor.step(store,failed,950_000_000,59),0)
  self.assertEqual(compactor.step(store,failed,950_000_000,60),55_000_000)
 def test_no_automatic_mutation_for_other_storage_provider_or_noncapacity_error(self):
  store,factory,failed,items=self.fixture();compactor=W.CapacityCompactor(factory);store.provider='s3'
  self.assertEqual(compactor.step(store,failed,950_000_000,0),0)
  store.provider='railway';failed['compliance']['error']=ValueError('Invalid schema')
  self.assertEqual(compactor.step(store,failed,950_000_000,0),0);factory.assert_not_called()
 def test_failed_verification_consumes_a_bounded_attempt_without_reporting_reclaimed_space(self):
  store,factory,failed,items=self.fixture();compactor=W.CapacityCompactor(factory)
  store.compact_index=mock.Mock(side_effect=ValueError('Decoded index checksum mismatch'))
  with self.assertRaisesRegex(ValueError,'checksum'):compactor.step(store,failed,950_000_000,0)
  self.assertEqual(compactor.attempts,1)
  self.assertEqual(compactor.step(store,failed,950_000_000,1),0)
