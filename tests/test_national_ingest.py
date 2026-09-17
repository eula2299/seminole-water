import importlib.util,json,pathlib,tempfile,unittest,zipfile
spec=importlib.util.spec_from_file_location('ingest',pathlib.Path(__file__).parents[1]/'national'/'ingest.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class IngestionTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.out=self.root/'out'
 def tearDown(self):self.tmp.cleanup()
 def run_import(self,text,**kwargs):
  p=self.root/'data.csv';p.write_text(text);return m.ingest(p,self.out,'fixture','https://echo.epa.gov/fixture.csv',fmt='jsonl',**kwargs)
 def test_identifier_and_censoring_preserved(self):
  r=self.run_import('PWSID,value\n090000023,<0.005\n');part=pathlib.Path(r['directory'])/r['parts'][0]['file'];raw=json.loads(json.loads(part.read_text())['raw_json']);self.assertEqual(raw['PWSID'],'090000023');self.assertEqual(raw['value'],'<0.005')
 def test_batch_partitioning_and_hashes(self):
  r=self.run_import('v\n1\n2\n3\n',batch_rows=2);self.assertEqual(len(r['parts']),2)
  for part in r['parts']:self.assertEqual(m.sha(pathlib.Path(r['directory'])/part['file']),part['sha256'])
 def test_raw_rows_not_counted_as_independent_measurements(self):
  r=self.run_import('v\n1\n1\n');self.assertEqual(r['raw_rows_written'],'2');self.assertIsNone(r['unique_observations']);self.assertIsNone(r['independent_samples'])
 def test_replay_row_hash_is_stable(self):
  a=self.run_import('v\n1\n');b=self.run_import('v\n1\n');read=lambda r:json.loads((pathlib.Path(r['directory'])/r['parts'][0]['file']).read_text());self.assertEqual(read(a)['raw_sha256'],read(b)['raw_sha256'])
 def test_malformed_input_is_not_published(self):
  with self.assertRaises(ValueError):self.run_import('a,b\n1,2\n3\n',batch_rows=1)
  self.assertEqual(list(self.out.iterdir()),[])
 def test_duplicate_headers_rejected(self):
  with self.assertRaises(ValueError):self.run_import('a,a\n1,2\n')
 def test_required_columns_enforced(self):
  with self.assertRaises(ValueError):self.run_import('a\n1\n',required_columns=['PWSID'])
 def test_zero_rows_not_published(self):
  with self.assertRaises(ValueError):self.run_import('a\n')
 def test_budget_does_not_publish_partial_success(self):
  with self.assertRaises(ValueError):self.run_import('a\n1\n2\n',max_rows=1)
  self.assertEqual(list(self.out.iterdir()),[])
 def test_unapproved_provenance_rejected(self):
  for url in ['http://echo.epa.gov/a','https://example.com/a','https://user:pass@echo.epa.gov/a']:
   with self.assertRaises(ValueError):m.official_url(url)
 def test_zip_path_never_extracted(self):
  p=self.root/'data.zip'
  with zipfile.ZipFile(p,'w') as z:z.writestr('../../outside.csv','PWSID,v\nFL0123456,ND\n')
  r=m.ingest(p,self.out,'fixture','https://echo.epa.gov/fixture.zip',fmt='jsonl');self.assertEqual(r['raw_rows_written'],'1');self.assertFalse((self.root.parent/'outside.csv').exists())
 def test_html_error_page_rejected(self):
  with self.assertRaises(ValueError):self.run_import('<html>Error</html>\ntext\n')
 @unittest.skipUnless(importlib.util.find_spec('pyarrow'),'PyArrow not installed in local environment')
 def test_parquet_roundtrip(self):
  import pyarrow.parquet as pq
  p=self.root/'data.csv';p.write_text('PWSID,v\nNY0123456,<1\n');r=m.ingest(p,self.out,'fixture','https://echo.epa.gov/fixture.csv');rows=pq.read_table(pathlib.Path(r['directory'])/r['parts'][0]['file']).to_pylist();self.assertEqual(json.loads(rows[0]['raw_json'])['PWSID'],'NY0123456')
if __name__=='__main__':unittest.main()
