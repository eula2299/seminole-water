import copy,io,json,pathlib,tempfile,unittest,zipfile
from unittest import mock
from national import environmental_archive as E
from national import warehouse as W
from test_national_warehouse import MemoryS3
from test_national_wqp import fixture

class EnvironmentalArchiveTests(unittest.TestCase):
 def setUp(self):
  self.saved=copy.deepcopy(W.STATE);self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
  self.client=MemoryS3();self.store=W.Store(client=self.client,bucket='test',max_total=10_000_000)
  self.plan=E.Q.make_plan(['MN'],'2020-01-01','2020-01-31');self.calls=0
 def tearDown(self):self.tmp.cleanup();W.STATE.clear();W.STATE.update(self.saved)
 def fetch(self,data=None):
  body=data if data is not None else fixture(Location_HorzCoordReferenceSystemDatum='WGS84')
  def run(url,path,*args):
   self.calls+=1;path.write_bytes(body)
   return {'url':url,'retrieved_at':'2026-09-18T00:00:00Z','bytes':len(body),'sha256':E.Q.sha(path),'http_headers':{}}
  return run
 def create(self,name='first',fetcher=None):return E.EnvironmentalArchive(self.store,self.root/name,self.plan,fetcher or self.fetch())
 def test_durable_results_resume_without_counting_twice_and_preserve_nondetect(self):
  archive=self.create();self.assertEqual(archive.status()['retained_source_rows'],0)
  self.assertTrue(archive.step());self.assertEqual(archive.status()['retained_source_rows'],1)
  report=archive.near(44.5,-93.5);self.assertEqual(report['status'],'records-returned');self.assertFalse(report['household_sample_verified'])
  self.assertEqual(report['records'][0]['value_text'],'<0.005');self.assertEqual(report['records'][0]['activity_id'],'000123')
  self.assertIsNone(report['records'][0]['pwsid']);self.assertEqual(report['records'][0]['detection_condition'],'Not Detected')
  restart=self.create('restart');self.assertFalse(restart.step());self.assertEqual(self.calls,1);self.assertEqual(restart.status()['retained_source_rows'],1)
  self.assertEqual(len(restart.near(44.5,-93.5)['records']),1)
  receipt=next(j['manifest'] for j in restart.data['jobs'].values() if j['status']=='complete')
  self.assertIn(receipt['raw_key'],self.client.objects)
  self.assertTrue(all(p['key'] in self.client.objects for p in receipt['parquet']))
 def test_unknown_coordinate_datum_retains_source_without_false_geographic_match(self):
  archive=self.create(fetcher=self.fetch(fixture(Location_HorzCoordReferenceSystemDatum='UNKNOWN')));archive.step()
  self.assertEqual(archive.status()['retained_source_rows'],1);self.assertEqual(archive.near(44.5,-93.5)['records'],[])
  manifest=next(iter(archive.data['jobs'].values()))['manifest'];self.assertEqual(manifest['rows_without_supported_coordinates'],1)
 def test_standardized_wgs84_is_used_without_assuming_raw_nad83_is_wgs84(self):
  row={'latitude_text':'1','longitude_text':'2','coordinate_datum':'NAD83','standardized_latitude_text':'44.5','standardized_longitude_text':'-93.5','standardized_coordinate_datum':'WGS 1984'}
  self.assertEqual(E.coordinates(row),(44.5,-93.5));row['standardized_latitude_text']='NaN';self.assertIsNone(E.coordinates(row))
 def test_nad83_uses_named_operation_with_accuracy_and_keeps_original_datum(self):
  archive=self.create(fetcher=self.fetch(fixture(Location_HorzCoordReferenceSystemDatum='NAD83')));archive.step()
  record=archive.near(44.5,-93.5)['records'][0]
  self.assertEqual(record['coordinate_datum'],'NAD83');operation=record['coordinate_transform']
  self.assertEqual(operation['source_crs'],'EPSG:4269');self.assertEqual(operation['target_crs'],'EPSG:4326')
  self.assertGreaterEqual(operation['operation_accuracy_m'],0);self.assertLessEqual(operation['operation_accuracy_m'],10)
  self.assertFalse(operation['position_accuracy_verified']);self.assertIn('NAD83 to WGS 84',operation['operation'])
 def test_failed_head_publication_keeps_prior_checkpoint_and_in_memory_counts(self):
  archive=self.create();original=self.store.put_json
  def fail_head(key,value):
   if key==E.PREFIX+'/checkpoint-head.json':raise OSError('interrupted head publication')
   return original(key,value)
  with mock.patch.object(self.store,'put_json',side_effect=fail_head):
   with self.assertRaisesRegex(OSError,'interrupted'):archive.step()
  self.assertEqual(archive.status()['retained_source_rows'],0)
  restart=self.create('restart');self.assertEqual(restart.status()['retained_source_rows'],0)
  restart.step();self.assertEqual(restart.status()['retained_source_rows'],1)
 def test_oversize_partition_splits_without_publishing_partial_rows(self):
  def too_large(*args):raise E.Q.BudgetExceeded('too large')
  archive=self.create(fetcher=too_large);archive.step();s=archive.status()
  self.assertEqual(s['retained_source_rows'],0);self.assertEqual(s['partition_status_counts']['split'],1);self.assertEqual(s['partition_status_counts']['pending'],2)
  self.assertEqual(self.create('restart').status()['partition_status_counts']['pending'],2)
 def test_bad_calendar_date_fails_instead_of_becoming_a_sample(self):
  archive=self.create(fetcher=self.fetch(fixture(Activity_StartDate='2020-01-35')));archive.step();s=archive.status()
  self.assertEqual(s['retained_source_rows'],0);self.assertEqual(s['partition_status_counts']['failed'],1)
 def test_persisted_read_timeout_recovers_as_disjoint_children_and_resumes(self):
  def old_timeout(*args):raise RuntimeError('Source transfer failed after 3 attempts: The read operation timed out')
  archive=self.create(fetcher=old_timeout);archive.step();self.assertEqual(archive.status()['partition_status_counts']['failed'],1)
  restart=self.create('restart');restart.step();s=restart.status()
  self.assertEqual(s['partition_status_counts'],{'pending':1,'complete':1,'split':1,'failed':0})
  self.assertEqual(s['retained_source_rows'],1)
  children=E.Q.split_partition(self.plan['partitions'][0]);jobs=restart.data['jobs']
  self.assertEqual(jobs[children[0]['id']]['status'],'complete');self.assertEqual(jobs[children[1]['id']]['status'],'pending')
  self.assertEqual(jobs[self.plan['partitions'][0]['id']]['split_reason'],'upstream-timeout')
 def test_timeout_recovery_publication_failure_retains_original_failed_checkpoint(self):
  def old_timeout(*args):raise RuntimeError('Source transfer failed after 3 attempts: The read operation timed out')
  archive=self.create(fetcher=old_timeout);archive.step();original=self.store.put_json
  def fail_head(key,value):
   if key==E.PREFIX+'/checkpoint-head.json':raise OSError('interrupted repair')
   return original(key,value)
  with mock.patch.object(self.store,'put_json',side_effect=fail_head):
   with self.assertRaisesRegex(OSError,'interrupted repair'):archive.step()
  self.assertEqual(archive.status()['partition_status_counts']['failed'],1)
  restart=self.create('restart');self.assertEqual(restart.status()['partition_status_counts']['failed'],1)
  restart.step();self.assertEqual(restart.status()['retained_source_rows'],1)
 def test_single_day_timeout_remains_visible_and_does_not_create_duplicate_jobs(self):
  self.plan=E.Q.make_plan(['MN'],'2020-01-06','2020-01-06')
  def old_timeout(*args):raise RuntimeError('Source transfer failed after 3 attempts: The read operation timed out')
  archive=self.create(fetcher=old_timeout)
  for _ in range(3):archive.step()
  self.assertFalse(archive.step());self.assertEqual(archive.status()['partition_status_counts']['failed'],1)
  self.assertEqual(len(archive.data['jobs']),1);self.assertEqual(archive.status()['retained_source_rows'],0)
 def test_geographic_reads_reject_bad_coordinates_and_bound_concurrency(self):
  archive=self.create()
  for lat,lon in [(float('nan'),0),(0,float('inf')),(91,0),(0,181),(True,0)]:
   with self.assertRaises(ValueError):archive.near(lat,lon)
  archive.query_lock.acquire()
  try:self.assertEqual(archive.near(44.5,-93.5)['status'],'busy')
  finally:archive.query_lock.release()
 def test_distinct_tables_with_same_row_number_are_not_collapsed(self):
  body=io.BytesIO()
  with zipfile.ZipFile(body,'w') as z:
   z.writestr('a.csv',fixture(Location_HorzCoordReferenceSystemDatum='WGS84',Result_Characteristic='Arsenic'))
   z.writestr('b.csv',fixture(Location_HorzCoordReferenceSystemDatum='WGS84',Result_Characteristic='Nitrate'))
  archive=self.create(fetcher=self.fetch(body.getvalue()));archive.step();records=archive.near(44.5,-93.5)['records']
  self.assertEqual(len(records),2);self.assertEqual({r['characteristic'] for r in records},{'Arsenic','Nitrate'})

if __name__=='__main__':unittest.main()
