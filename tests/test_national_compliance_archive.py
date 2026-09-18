import copy,csv,hashlib,io,pathlib,tempfile,unittest,zipfile
from unittest import mock
from national import compliance_archive as C
from national import warehouse as W
from test_national_warehouse import MemoryS3

def row(**values):
    result={k:'' for k in sorted(C.REQUIRED)}
    result.update(SUBMISSIONYEARQUARTER='2026Q2',PWSID='010106001',VIOLATION_ID='000123',ENFORCEMENT_ID='000001',VIOLATION_CODE='02',VIOLATION_CATEGORY_CODE='MCL',CONTAMINANT_CODE='2950',VIOLATION_STATUS='Resolved',NON_COMPL_PER_BEGIN_DATE='10/01/2018',NON_COMPL_PER_END_DATE='12/31/2018',ENFORCEMENT_DATE='12/03/2018',IS_HEALTH_BASED_IND='Y')
    result.update(values);return result

class ComplianceArchiveTests(unittest.TestCase):
    def setUp(self):
        self.saved=copy.deepcopy(W.STATE);self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
        self.store=W.Store(client=MemoryS3(),bucket='test',max_total=10_000_000);self.rows=[row(),row(ENFORCEMENT_ID='000002')]
    def tearDown(self):self.temp.cleanup();W.STATE.clear();W.STATE.update(self.saved)
    def fetch(self,path):
        text=io.StringIO();writer=csv.DictWriter(text,fieldnames=list(self.rows[0]));writer.writeheader();writer.writerows(self.rows)
        with zipfile.ZipFile(path,'w') as z:
            z.writestr('SDWA_VIOLATIONS_ENFORCEMENT.csv',text.getvalue())
            z.writestr('SDWA_REF_CODE_VALUES.csv','VALUE_TYPE,VALUE_CODE,VALUE_DESCRIPTION\nCONTAMINANT_CODE,2950,Example source description\n')
        return {'url':C.URL,'retrieved_at':C.Q.now(),'bytes':path.stat().st_size,'sha256':C.Q.sha(path)}
    def create(self,name='run'):return C.ComplianceArchive(self.store,self.root/name,self.fetch)
    def test_association_rows_do_not_inflate_violation_count_and_preserve_identifiers(self):
        archive=self.create();archive.refresh();result=archive.system('010106001')
        self.assertEqual(result['association_rows'],2);self.assertEqual(result['distinct_violation_ids'],1)
        self.assertEqual(result['records'][0]['PWSID'],'010106001');self.assertEqual(result['records'][0]['VIOLATION_ID'],'000123')
        self.assertEqual(result['records'][0]['ENFORCEMENT_ID'],'000001');self.assertEqual(result['records'][0]['NON_COMPL_PER_BEGIN_DATE'],'10/01/2018')
        self.assertEqual(result['records'][0]['code_descriptions']['CONTAMINANT_CODE'],'Example source description')
        self.assertFalse(result['current_advisories_checked']);self.assertEqual(result['current_safety'],'not-determined')
        restarted=self.create('restart');self.assertEqual(restarted.status()['retained_association_rows'],2);self.assertEqual(restarted.system('010106001')['association_rows'],2)
    def test_same_shard_never_returns_another_system_and_invalid_identity_stays_unmapped(self):
        bucket=hashlib.sha256(b'010106001').hexdigest()[0]
        other=next(f'NY{i:07d}' for i in range(1000) if hashlib.sha256(f'NY{i:07d}'.encode()).hexdigest()[0]==bucket)
        self.rows.extend([row(PWSID=other),row(PWSID='INVALID')])
        archive=self.create();archive.refresh()
        self.assertEqual(archive.status()['retained_association_rows'],4);self.assertEqual(archive.status()['excluded_identity_rows'],1)
        self.assertEqual(archive.system('010106001')['association_rows'],2)
        self.assertTrue(all(r['PWSID']=='010106001' for r in archive.system('010106001')['records']))
        with self.assertRaises(ValueError):archive.system('INVALID')
    def test_failed_publication_preserves_previous_snapshot(self):
        archive=self.create();archive.refresh();old=archive.receipt['source']['sha256'];self.rows.append(row(VIOLATION_ID='000999'))
        original=self.store.put_json
        def fail(key,value):
            if key==C.PREFIX+'/latest.json':raise OSError('publication interrupted')
            return original(key,value)
        with mock.patch.object(self.store,'put_json',side_effect=fail):
            with self.assertRaises(OSError):archive.refresh()
        self.assertEqual(archive.receipt['source']['sha256'],old);self.assertEqual(self.create('restart').system('010106001')['association_rows'],2)
    def test_response_is_bounded_and_missing_records_are_not_an_advisory_check(self):
        self.rows=[row(ENFORCEMENT_ID=str(i)) for i in range(120)];archive=self.create();archive.refresh();result=archive.system('010106001')
        self.assertEqual(len(result['records']),100);self.assertTrue(result['truncated']);self.assertEqual(result['distinct_violation_ids'],1)
        archive.query_lock.acquire()
        try:self.assertEqual(archive.system('010106001')['status'],'busy')
        finally:archive.query_lock.release()
    def test_enforcement_without_linked_violation_remains_available_and_is_not_a_violation(self):
        self.rows.append(row(VIOLATION_ID='',ENFORCEMENT_ID='UNLINKED',NON_COMPL_PER_BEGIN_DATE=''))
        archive=self.create();archive.refresh();result=archive.system('010106001')
        self.assertEqual(result['association_rows'],3);self.assertEqual(result['distinct_violation_ids'],1);self.assertEqual(result['unlinked_enforcement_rows'],1)
        self.assertEqual(archive.status()['excluded_identity_rows'],0);self.assertEqual(archive.status()['unlinked_enforcement_rows'],1)
        self.assertTrue(any(r['VIOLATION_ID']=='' and r['ENFORCEMENT_ID']=='UNLINKED' for r in result['records']))

if __name__=='__main__':unittest.main()
