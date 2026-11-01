import copy,csv,gzip,hashlib,io,json,pathlib,tempfile,unittest,zipfile
from unittest import mock
from national import compliance_archive as C,system_directory as D,warehouse as W
from test_national_warehouse import MemoryS3
from test_national_compliance_archive import row as violation

def system(**values):
    row={'PWSID':'WA0000001','PWS_NAME':'Source water name','STATE_CODE':'WA','CITY_NAME':'Redmond','ZIP_CODE':'00123','PWS_ACTIVITY_CODE':'A','PWS_TYPE_CODE':'CWS','POPULATION_SERVED_COUNT':'00120','SOURCE_NOTE':'Original, quoted text'}
    row.update(values);return row

def table(rows):
    text=io.StringIO();w=csv.DictWriter(text,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows);return text.getvalue()

class SystemDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.saved=copy.deepcopy(W.STATE)
        self.store=W.Store(client=MemoryS3(),bucket='test',max_total=20_000_000);self.rows=[system()]
    def tearDown(self):self.temp.cleanup();W.STATE.clear();W.STATE.update(self.saved)
    def fetch(self,path):
        with zipfile.ZipFile(path,'w') as z:
            z.writestr(zipfile.ZipInfo('SDWA_PUB_WATER_SYSTEMS.csv'),table(self.rows))
            z.writestr(zipfile.ZipInfo('SDWA_VIOLATIONS_ENFORCEMENT.csv'),table([violation()]))
        return {'url':C.URL,'retrieved_at':'2026-10-31T00:00:00Z','bytes':path.stat().st_size,'sha256':C.Q.sha(path)}
    def create(self,name='run'):return C.ComplianceArchive(self.store,self.root/name,self.fetch)
    def test_raw_fields_ids_and_csv_counts_survive_compression_readback_and_restart(self):
        self.rows+=[system(PWSID='010106001',PWS_NAME='Tribal source'),system(PWSID='BAD')]
        archive=self.create();archive.refresh();item=archive.receipt['directory']
        self.assertEqual(item['source_rows'],3);self.assertEqual(item['valid_identity_rows'],2)
        self.assertEqual(archive.directory_system('WA0000001')['records'],[self.rows[0]])
        tribal=self.create('restart').directory_system('010106001')
        self.assertEqual(tribal['records'],[self.rows[1]]);self.assertEqual(tribal['source']['sha256'],archive.receipt['source']['sha256'])
        self.assertEqual(tribal['total_records'],3);self.assertEqual(tribal['matching_records'],1)
        self.assertFalse(tribal['household_connection_verified'])
    def test_local_search_keeps_state_and_tribal_identity_but_excludes_inactive_and_noncommunity(self):
        self.rows += [system(PWSID='CA0000001'),system(PWSID='010106001'),system(PWSID='WA0000002',PWS_ACTIVITY_CODE='I'),system(PWSID='WA0000003',PWS_TYPE_CODE='NTNCWS'),system(PWSID='WA0000004',CITY_NAME='Other',ZIP_CODE='00999')]
        a=self.create();a.refresh()
        r=a.directory_search(state='WA',city='Redmond',local='true')
        self.assertEqual({x['PWSID'] for x in r['records']},{'WA0000001','010106001'})
        self.assertEqual({x['PWSID'] for x in a.directory_search(state='WA',zip='00123',local=True)['records']},{'WA0000001','010106001'})
        self.assertEqual(a.directory_search(state='WA',query='quoted')['records'],[])
        self.assertEqual(a.directory_search(state='WA',query='SOURCE WATER',limit=1)['matching_records'],6)
        self.assertTrue(a.directory_search(state='WA',query='SOURCE WATER',limit=1)['truncated'])
    def test_duplicate_exact_ids_are_explicit_ambiguity_not_an_arbitrary_winner(self):
        self.rows += [system(PWS_NAME='Conflicting source name')]
        a=self.create();a.refresh();r=a.directory_system('WA0000001')
        self.assertEqual(r['status'],'ambiguous');self.assertEqual(r['records'],sorted(self.rows,key=lambda r:r['PWS_NAME']))
        self.assertEqual(r['matching_records'],2)
    def test_bad_directory_or_failed_readback_does_not_replace_published_source(self):
        a=self.create();a.refresh();original=a.receipt['source']['sha256'];self.rows.append(system(PWSID='WA0000002'))
        with mock.patch.object(D,'restore',side_effect=ValueError('Directory readback mismatch')):
            with self.assertRaises(ValueError):a.refresh()
        self.assertEqual(a.receipt['source']['sha256'],original)
        self.assertEqual(self.create('restart').directory_system('WA0000002')['status'],'no-matching-records')
    def test_same_source_upgrade_reuses_original_zip_and_compliance_shards(self):
        a=self.create();a.refresh();old=dict(a.receipt);old.pop('directory')
        with self.store.publication_lock():self.store.put_json(C.PREFIX+'/latest.json',old)
        self.store.client.objects.pop(C.DIRECTORY_PREFIX+'/latest.json') # Simulate a pre-directory published snapshot.
        restarted=self.create('upgrade');self.assertEqual(restarted.directory_system('WA0000001')['status'],'not-acquired')
        with mock.patch.object(self.store,'put',wraps=self.store.put) as put:
            restarted.refresh()
        self.assertEqual([c.args[0] for c in put.call_args_list],[restarted.receipt['directory']['key']])
        self.assertEqual(restarted.receipt['shards'],old['shards']);self.assertEqual(restarted.receipt['raw_key'],old['raw_key'])
    def test_directory_publishes_independently_when_compliance_cannot_fit(self):
        a=self.create();a.refresh();original=a.receipt['source']['sha256'];self.rows.append(system(PWSID='WA0000002'))
        real_prepare=C.prepare
        def oversized(*args):
            result=real_prepare(*args)
            for parts in result['shards'].values():
                for part in parts:part['bytes']+=30_000_000
            return result
        with mock.patch.object(C,'prepare',side_effect=oversized):
            with self.assertRaises(W.StorageBudgetExceeded):a.refresh()
        self.assertEqual(a.receipt['source']['sha256'],original)
        directory=a.directory_system('WA0000002');self.assertEqual(directory['status'],'records-returned')
        self.assertNotEqual(directory['source']['sha256'],original)
        restarted=self.create('restart');self.assertEqual(restarted.directory_system('WA0000002')['records'],[self.rows[-1]])
        self.assertEqual(restarted.status()['directory']['source']['sha256'],directory['source']['sha256'])
        with mock.patch.object(self.store,'put',wraps=self.store.put) as put:
            restarted.refresh()
        self.assertTrue(put.call_args_list)
        self.assertFalse(any(c.args[0].endswith(('source.zip','directory.sqlite.gz')) for c in put.call_args_list))
        self.assertEqual(restarted.receipt['source']['sha256'],directory['source']['sha256'])

    def test_unchanged_checksum_updates_check_time_without_replacing_data(self):
        a=self.create();a.refresh();original=copy.deepcopy(a.receipt);original_directory=copy.deepcopy(a.directory_receipt)
        fetch=a.fetcher
        def later(path):return {**fetch(path),'retrieved_at':'2026-11-15T00:00:00Z'}
        a.fetcher=later
        with mock.patch.object(self.store,'put',wraps=self.store.put) as put:
            self.assertFalse(a.refresh())
        put.assert_not_called()
        self.assertEqual(a.receipt['source']['retrieved_at'],original['source']['retrieved_at'])
        self.assertEqual(a.directory_receipt['source']['retrieved_at'],original_directory['source']['retrieved_at'])
        self.assertEqual(a.status()['directory']['source']['checked_at'],'2026-11-15T00:00:00Z')
        self.assertEqual(self.create('restart').status()['directory']['source']['checked_at'],'2026-11-15T00:00:00Z')

    def test_missing_directory_warms_from_verified_retained_zip_without_live_fetch_or_compliance_rebuild(self):
        a=self.create();a.refresh();old=dict(a.receipt);old.pop('directory')
        with self.store.publication_lock():self.store.put_json(C.PREFIX+'/latest.json',old)
        self.store.client.objects.pop(C.DIRECTORY_PREFIX+'/latest.json')
        restarted=self.create('warm');restarted.fetcher=mock.Mock(side_effect=AssertionError('No live source download'))
        with mock.patch.object(C,'prepare',side_effect=AssertionError('No compliance rebuild')),mock.patch.object(self.store,'put',wraps=self.store.put) as put:
            self.assertTrue(restarted.warm_directory())
        self.assertEqual([c.args[0] for c in put.call_args_list],[restarted.directory_receipt['directory']['key']])
        self.assertEqual(restarted.directory_receipt['source'],old['source'])
        self.assertEqual(restarted.receipt,old);self.assertEqual(restarted.directory_system('WA0000001')['records'],self.rows)
        with mock.patch.object(self.store,'get',side_effect=AssertionError('Existing directory stays active')):
            self.assertFalse(restarted.warm_directory())

    def test_receipt_mismatch_and_query_injection_are_rejected_or_literal(self):
        a=self.create();a.refresh();item=dict(a.receipt['directory']);item['source_rows']+=1
        with self.assertRaisesRegex(ValueError,'row-count'):D.restore(self.store,item,self.root/'bad')
        self.assertEqual(a.directory_search(query="' OR 1=1 --")['records'],[])
        for kwargs in ({'limit':51},{'local':True,'state':'WA'},{'zip':'bad'},{'local':'garbage'}):
            with self.assertRaises(ValueError):a.directory_search(**kwargs)
    def test_malformed_row_and_missing_required_column_fail_closed(self):
        raw=self.root/'bad.zip'
        with zipfile.ZipFile(raw,'w') as z:z.writestr('SDWA_PUB_WATER_SYSTEMS.csv','PWSID,PWS_NAME\nWA0000001,A\n')
        with self.assertRaisesRegex(ValueError,'column contract'):D.prepare(raw,self.root)

if __name__=='__main__':unittest.main()
