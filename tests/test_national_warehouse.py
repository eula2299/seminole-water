import json,pathlib,sqlite3,tempfile,unittest
from national.warehouse import process_member,canonical_sql,status
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
   self.assertEqual(row,(0,None,'source-water'))
 def test_status_is_not_publisher_inventory(self):
  self.assertEqual(status()['retained_source_records'],0);self.assertFalse(status()['target_met']);self.assertFalse(status()['household_safety_certified'])
if __name__=='__main__':unittest.main()
