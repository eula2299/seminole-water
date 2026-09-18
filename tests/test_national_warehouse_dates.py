import pathlib,sqlite3,tempfile,unittest
from national.warehouse import process_member
class SourceDateTests(unittest.TestCase):
 def test_actual_syr4_date_shape(self):
  with tempfile.TemporaryDirectory() as td:
   p=pathlib.Path(td);src=p/'r.tsv'
   src.write_text('"PWSID"\t"SYSTEM_NAME"\t"ANALYTE_NAME"\t"SAMPLE_COLLECTION_DATE"\t"VALUE"\t"UNIT"\t"DETECT"\n"AK2270312"\t"CITY OF HOOPER BAY"\t"COMBINED RADIUM (-226 & -228)"\t"31-AUG-16"\t\t"PCI/L"\t0\n')
   receipt=process_member(str(src),p/'p.parquet',p/'s.sqlite','syr4','fixture')
   self.assertEqual(receipt['identity_date_valid_rows'],1)
   con=sqlite3.connect(p/'s.sqlite');row=con.execute('select pwsid,first_date,nondetects,min_detect from summaries').fetchone();con.close()
   self.assertEqual(row,('AK2270312','2016-08-31',1,None))
if __name__=='__main__':unittest.main()
