import copy
import http.client
import json
import pathlib
import socket
import sqlite3
import tempfile
import threading
import unittest
from unittest import mock
from national import warehouse as W


class ArchiveQueryIsolation(unittest.TestCase):
 def setUp(self):
  self.saved=copy.deepcopy(W.STATE)
  W.STATE['sources']={};W.STATE['errors']={};W.STATE['serving_ready']=False
 def tearDown(self):
  W.STATE.clear();W.STATE.update(self.saved)
 def serve(self):
  class IPv4Server(W.Server):address_family=socket.AF_INET
  server=IPv4Server(('127.0.0.1',0),W.Handler)
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  def close():server.shutdown();server.server_close();thread.join()
  self.addCleanup(close)
  def request(path):
   conn=http.client.HTTPConnection('127.0.0.1',server.server_address[1],timeout=3)
   conn.request('GET',path);response=conn.getresponse();body=response.read();conn.close()
   return response.status,json.loads(body)
  return request
 def test_chemistry_route_does_not_wait_for_compliance(self):
  with tempfile.TemporaryDirectory() as directory,mock.patch.object(W,'ROOT',pathlib.Path(directory)):
   receipt={'id':'ucmr5','schema':W.VERSION,'sha256':'fixture','url':'https://www.epa.gov/data','catalogue_url':'https://www.epa.gov/catalogue','retrieved_at':'2026-10-31'}
   path=W.summary_path('ucmr5','fixture');path.parent.mkdir()
   with sqlite3.connect(path) as db:
    db.execute('CREATE TABLE summaries(pwsid TEXT,analyte TEXT,last_date TEXT,latest_record TEXT)')
    db.executemany('INSERT INTO summaries VALUES(?,?,?,?)',[('NY0000001','Fixture '+str(i),'2020-01-01','{}') for i in range(200)])
   db.close()
   W.STATE['sources']={'ucmr5':receipt};W.STATE['serving_ready']=True
   compliance=mock.Mock();compliance.system.side_effect=RuntimeError('cold compliance shard')
   with mock.patch.object(W,'COMPLIANCE_ARCHIVE',compliance):
    request=self.serve();code,result=request('/pws/NY0000001?include_compliance=0')
    self.assertEqual(code,200);self.assertEqual(len(result['summaries']),200);self.assertTrue(result['serving_ready'])
    self.assertIsNone(result['compliance']);compliance.system.assert_not_called()
    self.assertEqual(result['checked_sources'][0]['sha256'],'fixture')
    code,missing=request('/pws/NY0000002?include_compliance=0')
    self.assertEqual(missing['summaries'],[]);self.assertEqual(missing['checked_sources'][0]['id'],'ucmr5')
    code,issue=request('/compliance/NY0000001')
    self.assertEqual(code,200);self.assertEqual(issue['status'],'unavailable');compliance.system.assert_called_once_with('NY0000001')
 def test_healthcheck_does_not_admit_partly_restored_sources(self):
  request=self.serve()
  self.assertEqual(request('/healthz')[0],503)
  W.STATE['serving_ready']=True
  self.assertEqual(request('/healthz')[0],200)
 def test_status_uses_last_completed_environmental_snapshot_without_waiting_for_upload(self):
  W.STATE['environmental_archive']={'status':'ready','published_partitions':17}
  environmental=mock.Mock();environmental.status.side_effect=RuntimeError('checkpoint upload holds lock')
  with mock.patch.object(W,'ENVIRONMENTAL_ARCHIVE',environmental):
   self.assertEqual(W.status()['environmental_archive']['published_partitions'],17)
   environmental.status.assert_not_called()
 def test_readiness_is_captured_with_the_sources_in_that_response(self):
  def compliance(pwsid):
   W.STATE['serving_ready']=True
   return {'pwsid':pwsid,'status':'no-records-in-snapshot','records':[]}
  with mock.patch.object(W,'compliance_report',compliance):
   result=W.pws_report('NY0000001')
  self.assertTrue(W.STATE['serving_ready']);self.assertFalse(result['serving_ready'])
 def test_failed_restore_retries_before_any_ingestion_or_ready_state(self):
  events=[];fail=[True]
  class Stop:
   done=False
   def is_set(self):return self.done
   def wait(self,seconds):
    events.append(('wait',seconds,W.STATE['serving_ready']));fail[0]=False
  stop=Stop()
  class Storage:
   def inventory(self):return {'bytes':0}
   def json(self,key):return {'id':key.split('/')[-1].split('.')[0]}
  def activate(store,receipt):
   events.append(('restore',receipt['id'],W.STATE['serving_ready']))
   if receipt['id']=='second' and fail[0]:raise OSError('temporary download interruption')
  def ingest(store,item):
   events.append(('ingest',item['id'],W.STATE['serving_ready']));stop.done=True
  with tempfile.TemporaryDirectory() as directory,mock.patch.object(W,'ROOT',pathlib.Path(directory)),mock.patch.object(W,'activate',activate),mock.patch.object(W,'ingest',ingest),mock.patch.object(W,'COMPLIANCE_ARCHIVE',None),mock.patch.object(W,'WELL_ARCHIVE',None),mock.patch.object(W,'ENVIRONMENTAL_ARCHIVE',None),mock.patch.dict(W.os.environ,{'WAREHOUSE_COMPLIANCE_ENABLED':'false','WAREHOUSE_WQP_ENABLED':'false','WAREHOUSE_WELLS_ENABLED':'false'}):
   W.loop(stop=stop,store_factory=Storage,discover_fn=lambda:[{'id':'first'},{'id':'second'}])
  self.assertEqual(events,[('restore','first',False),('restore','second',False),('wait',W.STORAGE_RETRY_SECONDS,False),('restore','first',False),('restore','second',False),('ingest','first',True)])
  self.assertEqual(W.STATE['restore_pending'],[])


if __name__=='__main__':unittest.main()
