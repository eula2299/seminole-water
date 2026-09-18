import pathlib,sqlite3,tempfile,unittest
from national.warehouse import process_member,summary_path
HEADER='PWSID\tSystem Name\tAnalyte Name\tSample Collection Date\tValue\tUnit\tDetect\tDetection Limit Unit\tSample ID\tResidual Field Total Chlorine mg/L\n'
class QualityTests(unittest.TestCase):
 def parse(self,text):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);p=pathlib.Path(self.tmp.name);source=p/'data.tsv';source.write_text(text,encoding='utf-8');receipt=process_member(str(source),p/'rows.parquet',p/'summary.sqlite','syr4','fixture');db=sqlite3.connect(p/'summary.sqlite');db.row_factory=sqlite3.Row;rows=[dict(x) for x in db.execute('SELECT * FROM summaries')];db.close();return receipt,rows
 def test_quoted_identifiers_and_multiline_fields(self):
  r,rows=self.parse(HEADER+'"NM0000001"\t"TEST\nSYSTEM"\t"ARSENIC"\t"2014-01-01"\t"2"\t"UG/L"\t"1"\t"UG/L"\t"SAMPLE\nONE"\t\n')
  self.assertEqual(r['identity_date_valid_rows'],1);self.assertEqual(rows[0]['pwsid'],'NM0000001');self.assertEqual(rows[0]['min_detect'],2)
 def test_all_invalid_system_ids_fail_publication(self):
  with self.assertRaisesRegex(ValueError,'No rows have valid'):self.parse(HEADER+'bad-id\tName\tLEAD\t2014-01-01\t2\tUG/L\t1\tUG/L\tA\t\n')
 def test_trailing_optional_metadata_can_be_null(self):
  r,rows=self.parse(HEADER+'FL0000001\tName\tLEAD\t2014-01-01\t2\tUG/L\t1\tUG/L\tA\n')
  self.assertEqual(r['identity_date_valid_rows'],1);self.assertEqual(rows[0]['detects'],1)
 def test_invalid_dates_are_not_in_numeric_summaries(self):
  r,rows=self.parse(HEADER+'FL0000001\tName\tLEAD\t2014-01-01\t2\tUG/L\t1\tUG/L\tA\t\nFL0000001\tName\tLEAD\t2999-01-01\t9999\tUG/L\t1\tUG/L\tB\t\n')
  self.assertEqual(r['distinct_source_rows'],2);self.assertEqual(r['identity_date_valid_rows'],1);self.assertEqual(rows[0]['max_detect'],2);self.assertEqual(rows[0]['n'],1)
 def test_missing_result_units_not_replaced_with_limit_units(self):
  r,rows=self.parse(HEADER+'FL0000001\tName\tLEAD\t2014-01-01\t2\t\t1\tUG/L\tA\t\n')
  self.assertEqual(rows[0]['detects'],0);self.assertIsNone(rows[0]['min_detect'])
 def test_american_datetime_not_discarded(self):
  r,rows=self.parse(HEADER+'FL0000001\tName\tLEAD\t11/8/2007 0:00:00\t2\tUG/L\t1\tUG/L\tA\t\n')
  self.assertEqual(r['identity_date_valid_rows'],1);self.assertEqual(rows[0]['first_date'],'2007-11-08')
 def test_embedded_escaped_quotes_are_preserved(self):
  r,rows=self.parse(HEADER+'FL0000001\t"A ""B"" Name"\tLEAD\t2014-01-01\t2\tUG/L\t1\tUG/L\tA\t\n')
  self.assertEqual(r['identity_date_valid_rows'],1);self.assertEqual(rows[0]['min_detect'],2)
 def test_parser_versions_do_not_overwrite_cache_snapshots(self):
  self.assertNotEqual(summary_path('a','b',1),summary_path('a','b',2))
if __name__=='__main__':unittest.main()
