import contextlib,copy,hashlib,http.client,io,json,pathlib,shutil,socket,sqlite3,tempfile,threading,unittest,zipfile
from unittest import mock
from national import warehouse as W
from national.warehouse import process_member,canonical_sql,status
from botocore.exceptions import ClientError
class WarehouseTests(unittest.TestCase):
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
 def __init__(self,versioned=False):self.objects={};self.versions=[];self.multipart=[];self.versioned=versioned;self.serial=0
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
  self.versions.append({'Key':Key,'Size':len(body),'VersionId':str(self.serial)})
  return {'ETag':etag}
 def download_file(self,bucket,key,path):pathlib.Path(path).write_bytes(self.objects[key][0])
 def head_object(self,Key,**kwargs):return {'ContentLength':len(self.objects[Key][0])}

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
   with zipfile.ZipFile(archive,'w') as z:z.writestr('ucmr5_all.txt',text)
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
    legacy={**receipt,'schema':'occurrence-warehouse/1'}
    client.put_object(Key='v1/latest/ucmr5.json',Body=json.dumps(legacy).encode())
    client.objects.pop('v2/latest/ucmr5.json')
    with mock.patch.object(store,'put',wraps=store.put) as uploaded:
     W.ingest(store,item)
    updated=store.json('v2/latest/ucmr5.json')
    self.assertTrue(updated['reused_source_objects']);self.assertEqual(updated['eligible_source_records'],1)
    self.assertEqual([call.args[0] for call in uploaded.call_args_list],[updated['summary_key']])
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
