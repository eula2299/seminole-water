import csv, json, pathlib, sqlite3, sys, tempfile, unittest
from unittest import mock
from national import syr2
from national import warehouse as W


class Syr2Tests(unittest.TestCase):
    def test_chemical_identity_preserves_forms_and_requires_publisher_code(self):
        self.assertEqual(syr2.chemical('Nitrate (as N)_Chem1040'),
                         {'table':'Nitrate (as N)_Chem1040','analyte':'Nitrate (as N)','code':'1040'})
        self.assertEqual(syr2.chemical('Mercury (inorganic)_Chem1035')['analyte'],'Mercury (inorganic)')
        for table in ('Nitrate', 'Nitrate_Chem104', 'Nitrate_Chem1040\n', 'Chem1040'):
            with self.assertRaises(ValueError):syr2.chemical(table)

    def test_source_count_units_nondetects_and_chemical_identity_are_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);source=root/'source.tsv'
            header=['STATE','ID','PWSID','PWSNAME','SAMPLEID','CHEMID','DATE','DETECT','VALUE','UNITS']
            base=['FL','0001','FL0000001','Utility "North"\tDistrict','0000123','1040','2003-02-19 00:00:00','0','0.05','MG/L']
            zero=base.copy();zero[1]='0002';zero[7]='1';zero[8]='0'
            bad_code=base.copy();bad_code[5]='9999'
            bad_date=base.copy();bad_date[6]='2003-02-30'
            bad_value=base.copy();bad_value[8]='-1'
            missing=base.copy();missing[8]=''
            with source.open('w',newline='') as f:
                writer=csv.writer(f,delimiter='\t');writer.writerow(header)
                writer.writerows([base,base,zero,bad_code,bad_date,bad_value,missing])
            metadata={**syr2.chemical('Nitrate (as N)_Chem1040'),'source_table_rows':7}
            result=W.process_member(str(source),root/'raw.parquet',root/'summary.sqlite','syr2','nitrate.mdb',metadata)
            self.assertEqual(result['raw_rows'],7);self.assertEqual(result['distinct_source_rows'],6)
            self.assertEqual(result['eligible_source_rows'],2)
            with sqlite3.connect(root/'summary.sqlite') as db:
                row=db.execute('SELECT analyte,unit,n,detects,nondetects,min_detect,max_detect,scope,latest_record FROM summaries').fetchone()
            self.assertEqual(row[:8],('Nitrate (as N)','MG/L',2,1,1,0.0,0.0,'system-sampling-context-unspecified'))
            self.assertEqual(json.loads(row[8])['SAMPLEID'],'0000123')
            with self.assertRaisesRegex(ValueError,'row count differs'):
                W.process_member(str(source),root/'bad.parquet',root/'bad.sqlite','syr2','nitrate.mdb',{**metadata,'source_table_rows':8})

    def test_reader_limits_disk_time_and_diagnostics(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=pathlib.Path(tmp)/'output'
            self.assertEqual(syr2.command_to_file([sys.executable,'-c','print("abc",end="")'],target,3,5),3)
            with self.assertRaisesRegex(ValueError,'byte budget'):
                syr2.command_to_file([sys.executable,'-c','print("abcd",end="")'],target,3,5)
            with self.assertRaisesRegex(ValueError,'warning'):
                syr2.command_to_file([sys.executable,'-c','import sys;sys.stderr.write("bad source")'],target,100,5)
            with self.assertRaisesRegex(ValueError,'time budget'):
                syr2.command_to_file([sys.executable,'-c','import time;time.sleep(10)'],target,100,.01)

    def test_export_rejects_unreviewed_multiple_tables_and_cleans_partial_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=pathlib.Path(tmp)/'output.tsv';target.write_text('partial')
            def multiple(args,path,*_):pathlib.Path(path).write_text('Nitrate (as N)_Chem1040\nOther_Chem1041\n')
            with mock.patch.object(syr2,'command_to_file',side_effect=multiple):
                with self.assertRaisesRegex(ValueError,'exactly one'):syr2.export_mdb('source.mdb',target)
            self.assertFalse(target.exists());self.assertFalse(target.with_suffix('.metadata.txt').exists())


if __name__=='__main__':unittest.main()
