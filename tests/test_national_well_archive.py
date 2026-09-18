import csv,hashlib,json,pathlib,shutil,sqlite3,tempfile,unittest
from national import well_archive as W

class Store:
    def __init__(self):self.objects={};self.fail=None
    def json(self,key):return json.loads(self.objects[key]) if key in self.objects else None
    def put_json(self,key,value):
        if key==self.fail:raise OSError('fixture failed publication')
        self.objects[key]=json.dumps(value).encode()
    def put(self,key,path):self.objects[key]=path.read_bytes()
    def get(self,key,path,sha):
        path.write_bytes(self.objects[key])
        if W.sha(path)!=sha:raise ValueError('fixture checksum mismatch')
    def ensure_capacity(self,n):return 0
    def publication_lock(self):
        import contextlib
        return contextlib.nullcontext()

def fixture(root):
    raw=root/'source.gpkg';dictionary=root/'dictionary.csv'
    with sqlite3.connect(raw) as d:
        d.execute('CREATE TABLE GW_Well ('+','.join(k+' '+('REAL' if k in ('latitude','longitude','gwWellConstructedDepth') else 'TEXT') for k in W.FIELDS)+')')
        d.executemany('INSERT INTO GW_Well VALUES (?,?,?,?,?,?,?,?,?)',[
          ('001','Alternate','Fixture aquifer',123,30,-92,'Reported 10 feet','GPS','2000-01-01'),
          ('002',None,None,-9,30.01,-92.01,None,None,None),
          ('003',None,None,None,None,None,None,None,None)])
    with dictionary.open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['Table','Column','Definition','Units']);w.writeheader()
        for key in ('latitude','longitude'):w.writerow({'Table':'GW_Well','Column':key,'Definition':'World Geodetic System 1984 (EPSG code 4326)','Units':'decimal degrees'})
        w.writerow({'Table':'GW_Well','Column':'gwWellConstructedDepth','Definition':'Constructed depth','Units':'feet (ft)'})
    return raw,dictionary

class WellTests(unittest.TestCase):
    def test_index_excludes_unlocated_wells_and_invalid_depth_without_losing_raw_count(self):
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);raw,dictionary=fixture(root);out=root/'index.sqlite';c=W.make_index(raw,dictionary,out)
            self.assertEqual(c['source_well_records'],3);self.assertEqual(c['mapped_well_records'],2);self.assertEqual(c['excluded_spatial_records'],1)
            with sqlite3.connect(out) as d:
                rows={r[0]:json.loads(r[1]) for r in d.execute('select id,record from wells')}
            self.assertEqual(rows['001']['depth_ft'],123);self.assertIsNone(rows['002']['depth_ft']);self.assertFalse(rows['001']['household_connection_verified'])
    def test_unknown_coordinate_datum_and_conflicting_well_ids_are_not_published(self):
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);raw,dictionary=fixture(root);dictionary.write_text(dictionary.read_text().replace('4326','4269'))
            with self.assertRaises(ValueError):W.make_index(raw,dictionary,root/'bad.sqlite')
            dictionary.write_text(dictionary.read_text().replace('4269','4326'))
            with sqlite3.connect(raw) as d:d.execute("update GW_Well set gwWellName='001' where gwWellName='002'")
            with self.assertRaises(ValueError):W.make_index(raw,dictionary,root/'duplicate.sqlite')
    def test_bounded_geographic_query_retains_source_and_never_confirms_household(self):
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);raw,dictionary=fixture(root);index=root/'index.sqlite';counts=W.make_index(raw,dictionary,index);store=Store();store.put('index',index)
            receipt={'schema':W.VERSION,'state':'LA','item_id':W.CATALOG['LA'],'index_key':'index','source_url':W.ROOT_URL+W.CATALOG['LA'],'source_uploaded_at':'2023-01-01','retrieved_at':W.now(),'sha256':W.sha(raw),**counts}
            store.put_json(W.PREFIX+'/latest/LA.json',receipt);archive=W.WellArchive(store,root/'cache');r=archive.near(30,-92)
            self.assertEqual(len(r['records']),2);self.assertEqual(r['records'][0]['distance_m'],0);self.assertFalse(r['household_connection_verified']);self.assertEqual(archive.status()['source_well_records'],3)
            self.assertEqual(archive.near(50,-100)['records'],[])
            with self.assertRaises(ValueError):archive.near(float('nan'),-92)
    def test_unsupported_receipts_and_nonofficial_downloads_fail_closed(self):
        for u in ['http://www.sciencebase.gov/catalog/item/1','https://www.sciencebase.gov.evil.test/catalog/item/1','https://www.sciencebase.gov@evil.test/catalog/item/1','https://www.sciencebase.gov/other']:
            with self.assertRaises(ValueError):W.allowed(u)
        with tempfile.TemporaryDirectory() as t:
            store=Store();store.put_json(W.PREFIX+'/latest/LA.json',{'schema':'wrong'})
            with self.assertRaises(ValueError):W.WellArchive(store,pathlib.Path(t))
    def test_failed_publication_preserves_prior_state_snapshot_and_restart(self):
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t);raw,dictionary=fixture(root);store=Store();ident=W.CATALOG['LA']
            files={'original.gpkg':raw,'dictionary.csv':dictionary}
            def fetch(url,path,max_bytes,expected_size=None,expected_md5=None):
                if '?format=json' in url:
                    meta={'id':ident,'title':'National Water-Well Database: State Water-Well Records for Louisiana','files':[{'name':'NWWDB_State_LA.gpkg' if key=='original.gpkg' else 'NWWDB_State_LA_Data_Dictionary.csv','size':p.stat().st_size,'checksum':{'type':'MD5','value':hashlib.md5(p.read_bytes()).hexdigest()},'url':'https://www.sciencebase.gov/catalog/file/get/'+key,'dateUploaded':'2023-01-01'} for key,p in files.items()]};path.write_text(json.dumps(meta))
                else:shutil.copyfile(files[url.rsplit('/',1)[-1]],path)
                return {'bytes':path.stat().st_size,'sha256':W.sha(path),'retrieved_at':W.now(),'url':url}
            archive=W.WellArchive(store,root/'archive',downloader=fetch);old=archive.refresh('LA');key=W.PREFIX+'/latest/LA.json'
            with sqlite3.connect(raw) as d:d.execute("update GW_Well set gwWellConstructedDepth=999 where gwWellName='001'")
            store.fail=key
            with self.assertRaises(OSError):archive.refresh('LA')
            self.assertEqual(store.json(key)['sha256'],old['sha256']);self.assertEqual(archive.receipts['LA']['sha256'],old['sha256'])
            restored=W.WellArchive(store,root/'restart');self.assertEqual(restored.near(30,-92)['records'][0]['depth_ft'],123)

if __name__=='__main__':unittest.main()
