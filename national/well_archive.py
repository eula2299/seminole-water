"""Durable USGS National Water-Well Database source records.

State completion records describe wells, not current household chemistry. Only
published, reviewed state components are enabled; no nationwide coverage claim.
"""
from __future__ import annotations
import csv,datetime as dt,hashlib,json,math,pathlib,re,shutil,sqlite3,tempfile,threading,time,urllib.parse,urllib.request

CATALOG={'LA':'64d673e5d34ef477cf3e136b','MI':'65495208d34ee4b6e05c2340','MN':'63065d7ed34e3b967a8bd833'}
ROOT_URL='https://www.sciencebase.gov/catalog/item/'
PREFIX='wells/v1';VERSION='nwwdb-wells/1';MAX_FILE=2_000_000_000;MAX_INDEX=256_000_000
FIELDS=('gwWellName','gwWellOtherName','gwUnitName','gwWellConstructedDepth','latitude','longitude','positionalAccuracy','locationMeasurementMethod','locationDate')
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        while b:=f.read(1024*1024):h.update(b)
    return h.hexdigest()
def allowed(url):
    u=urllib.parse.urlsplit(url)
    if u.scheme!='https' or u.hostname!='www.sciencebase.gov' or u.username or u.password or u.port not in (None,443) or u.fragment or not (u.path.startswith('/catalog/item/') or u.path.startswith('/catalog/file/get/')):raise ValueError('Unapproved well source')
    return url
class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        allowed(newurl);return super().redirect_request(req,fp,code,msg,headers,newurl)
def download(url,path,max_bytes,expected_size=None,expected_md5=None):
    allowed(url);start=time.monotonic();md5=hashlib.md5();h=hashlib.sha256();n=0
    request=urllib.request.Request(url,headers={'User-Agent':'IsMyWaterOK-NWWDB/1 (+https://www.ismywaterok.com)','Accept-Encoding':'identity'})
    with urllib.request.build_opener(OfficialRedirect()).open(request,timeout=45) as r,open(path,'wb') as out:
        if int(r.headers.get('Content-Length','0'))>max_bytes:raise ValueError('Well source exceeds byte budget')
        for block in iter(lambda:r.read(1024*1024),b''):
            n+=len(block)
            if n>max_bytes or time.monotonic()-start>900:raise ValueError('Well source exceeds transfer budget')
            md5.update(block);h.update(block);out.write(block)
    if not n or expected_size is not None and n!=expected_size or expected_md5 and md5.hexdigest()!=expected_md5:raise ValueError('Well source length or publisher checksum mismatch')
    return {'bytes':n,'sha256':h.hexdigest(),'publisher_md5':md5.hexdigest(),'url':url,'retrieved_at':now()}
def dictionary_contract(path):
    with open(path,encoding='utf-8-sig',newline='') as f:
        rows=list(csv.DictReader(f))
    fields={r.get('Attribute',r.get('Column')):r for r in rows if r.get('Entity',r.get('Table'))=='GW_Well'}
    for key in ('latitude','longitude'):
        definition=fields.get(key,{}).get('Definition','')
        if not ('WGS84' in definition or 'World Geodetic System 1984' in definition) or '4326' not in definition:raise ValueError('Well coordinate datum is not explicitly WGS84')
    if fields.get('gwWellConstructedDepth',{}).get('Units') not in ('feet (ft)','ft','feet'):raise ValueError('Well depth unit contract changed')
def make_index(source,dictionary,target):
    dictionary_contract(dictionary)
    db=sqlite3.connect(f'file:{source}?mode=ro&immutable=1',uri=True);db.execute('PRAGMA query_only=ON');db.execute('PRAGMA trusted_schema=OFF')
    out=sqlite3.connect(target);out.execute('PRAGMA cache_size=-8192');out.execute('CREATE TABLE wells (id TEXT PRIMARY KEY,latitude REAL,longitude REAL,record TEXT)')
    total=0;mapped=0;invalid=0
    try:
        if db.execute("SELECT type FROM sqlite_master WHERE name='GW_Well'").fetchone()!=('table',):raise ValueError('Well source table missing')
        columns={r[1] for r in db.execute('PRAGMA table_info(GW_Well)')}
        if not set(FIELDS).issubset(columns):raise ValueError('Well field contract changed')
        if db.execute('SELECT gwWellName FROM GW_Well GROUP BY gwWellName HAVING count(*)>1 LIMIT 1').fetchone():raise ValueError('Conflicting well identities')
        rows=db.execute('SELECT '+','.join(FIELDS)+' FROM GW_Well')
        while batch:=rows.fetchmany(4000):
            for values in batch:
                total+=1;r=dict(zip(FIELDS,values));ident=r['gwWellName']
                try:lat=float(r['latitude']);lon=float(r['longitude'])
                except (ValueError,TypeError):invalid+=1;continue
                if not isinstance(ident,str) or not ident.strip() or len(ident)>512 or not math.isfinite(lat) or not math.isfinite(lon) or not -90<=lat<=90 or not -180<=lon<=180:invalid+=1;continue
                depth=r['gwWellConstructedDepth'];depth=depth if isinstance(depth,(int,float)) and math.isfinite(depth) and depth>=0 else None
                record={'id':ident,'name':'State well '+ident,'latitude':lat,'longitude':lon,'depth_ft':depth,'aquifer':r['gwUnitName'],'coordinate_accuracy':r['positionalAccuracy'],'location_method':r['locationMeasurementMethod'],'location_date':r['locationDate'],'household_connection_verified':False}
                out.execute('INSERT INTO wells VALUES(?,?,?,?)',(ident,lat,lon,json.dumps(record,allow_nan=False)));mapped+=1
            out.commit()
        out.execute('CREATE INDEX wells_point ON wells(latitude,longitude)');out.commit()
    finally:db.close();out.close()
    if target.stat().st_size>MAX_INDEX:raise ValueError('Well spatial index exceeds serving budget')
    if not total:raise ValueError('Empty source is not a well inventory')
    return {'source_well_records':total,'mapped_well_records':mapped,'excluded_spatial_records':invalid,'index_bytes':target.stat().st_size,'index_sha256':sha(target)}

class WellArchive:
    def __init__(self,store,root,downloader=download):
        self.store=store;self.root=pathlib.Path(root);self.root.mkdir(parents=True,exist_ok=True);self.downloader=downloader;self.receipts={};self.errors={};self.checked={};self.lock=threading.RLock();self.query_lock=threading.Lock()
        for state in CATALOG:
            receipt=store.json(f'{PREFIX}/latest/{state}.json')
            if receipt:self._activate(state,receipt)
    def _activate(self,state,receipt):
        if receipt.get('schema')!=VERSION or receipt.get('state')!=state or receipt.get('item_id')!=CATALOG[state] or receipt.get('index_bytes',MAX_INDEX+1)>MAX_INDEX:raise ValueError('Invalid well receipt')
        with self.lock:self.receipts[state]=receipt
    def status(self):
        with self.lock:
            return {'schema':VERSION,'status':'ready' if self.receipts else 'awaiting-acquisition','configured_states':list(CATALOG),'published_states':sorted(self.receipts),'source_well_records':sum(x['source_well_records'] for x in self.receipts.values()),'mapped_well_records':sum(x['mapped_well_records'] for x in self.receipts.values()),'errors':dict(self.errors),'sources':[dict(x) for x in self.receipts.values()],'coverage_complete':False,'household_safety_assessed':False,'count_definition':'Well-construction identities from acquired state records, not water-quality samples or verified home connections.'}
    def step(self):
        due=[s for s in CATALOG if time.monotonic()-self.checked.get(s,-1e12)> (3600 if s in self.errors else 604800)]
        if not due:return False
        state=due[0]
        try:
            self.refresh(state)
            with self.lock:self.errors.pop(state,None)
        except Exception as e:
            with self.lock:self.errors[state]=str(e)[:300]
        finally:
            with self.lock:self.checked[state]=time.monotonic()
        return True
    def refresh(self,state):
        if state not in CATALOG:raise ValueError('Unreviewed state source')
        item_id=CATALOG[state];url=ROOT_URL+item_id
        with tempfile.TemporaryDirectory(prefix='well-',dir=self.root) as td:
            work=pathlib.Path(td);meta_path=work/'metadata.json';self.downloader(url+'?format=json',meta_path,2_000_000)
            meta=json.loads(meta_path.read_text());files=meta.get('files',[])
            if meta.get('id')!=item_id or 'State Water-Well Records' not in meta.get('title','') or 'Harmonized' in meta.get('title',''):raise ValueError('Well metadata identity changed')
            def file(name):
                hits=[f for f in files if f.get('name')==name]
                if len(hits)!=1:raise ValueError('Expected well source file missing or duplicated')
                f=hits[0]
                if f.get('checksum',{}).get('type')!='MD5' or not re.fullmatch('[0-9a-f]{32}',f['checksum']['value']) or not isinstance(f.get('size'),int) or not 0<f['size']<=MAX_FILE:raise ValueError('Invalid well source checksum or size')
                allowed(f['url']);return f
            source=file(f'NWWDB_State_{state}.gpkg');dictionary=file(f'NWWDB_State_{state}_Data_Dictionary.csv');previous=self.receipts.get(state)
            if previous and previous['publisher_md5']==source['checksum']['value'] and previous['dictionary_md5']==dictionary['checksum']['value']:return previous
            if shutil.disk_usage(work).free<source['size']+1_000_000_000:raise ValueError('Insufficient temporary disk for state well archive')
            raw=work/'original.gpkg';contract=work/'dictionary.csv';index=work/'index.sqlite'
            self.downloader(dictionary['url'],contract,1_000_000,dictionary['size'],dictionary['checksum']['value']);dictionary_contract(contract)
            provenance=self.downloader(source['url'],raw,MAX_FILE,source['size'],source['checksum']['value'])
            counts=make_index(raw,contract,index);base=f'{PREFIX}/data/{state}/{provenance["sha256"]}'
            receipt={'schema':VERSION,'state':state,'item_id':item_id,'source_url':url,'source_file_url':source['url'],'source_uploaded_at':source.get('dateUploaded'),'publisher_md5':source['checksum']['value'],'dictionary_md5':dictionary['checksum']['value'],'retrieved_at':provenance['retrieved_at'],'sha256':provenance['sha256'],'raw_key':base+'/original.gpkg','index_key':base+'/index.sqlite','dictionary_key':base+'/dictionary.csv','metadata_key':base+'/metadata.json',**counts,'household_safety_assessed':False}
            with self.store.publication_lock():
                self.store.ensure_capacity(sum(p.stat().st_size for p in (raw,contract,index,meta_path))+2_000_000)
                for key,path in [('raw_key',raw),('index_key',index),('dictionary_key',contract),('metadata_key',meta_path)]:self.store.put(receipt[key],path)
                self.store.put_json(base+'/receipt.json',receipt);self.store.put_json(f'{PREFIX}/latest/{state}.json',receipt)
            # Keep the verified index warm so the first resident does not wait
            # for a large object download after successful acquisition.
            with self.query_lock:
                index.replace(self.root/(state+'-'+receipt['index_sha256']+'.sqlite'))
                self._activate(state,receipt)
            return receipt
    def near(self,lat,lon):
        if not all(isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) for x in (lat,lon)) or abs(lat)>90 or abs(lon)>180:raise ValueError('Invalid well coordinates')
        if not self.query_lock.acquire(blocking=False):return {'status':'busy','records':[],'household_connection_verified':False}
        try:
            with self.lock:receipts=list(self.receipts.values())
            records=[];dy=5000/111000;dx=dy/max(.01,math.cos(math.radians(lat)));truncated=False
            for receipt in receipts:
                # The enabled state components lie wholly within these coarse
                # bounds; this only prunes files, never confirms state or parcel.
                box={'LA':[-95,28,-88,34],'MI':[-91,41,-82,49],'MN':[-98,43,-89,50]}[receipt['state']]
                if lon+dx<box[0] or lon-dx>box[2] or lat+dy<box[1] or lat-dy>box[3]:continue
                path=self.root/(receipt['state']+'-'+receipt['index_sha256']+'.sqlite')
                for old in self.root.glob(receipt['state']+'-*.sqlite'):
                    if old!=path:old.unlink()
                self.store.get(receipt['index_key'],path,receipt['index_sha256'])
                with sqlite3.connect(f'file:{path}?mode=ro&immutable=1',uri=True) as db:
                    found=db.execute('SELECT record FROM wells WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? LIMIT 501',(lat-dy,lat+dy,lon-dx,lon+dx)).fetchall()
                    truncated |= len(found)>500
                    for value, in found[:500]:
                        r=json.loads(value);a,b=map(math.radians,(lat,r['latitude']));dlat=b-a;dlon=math.radians(r['longitude']-lon)
                        distance=6371008.8*2*math.asin(min(1,math.sqrt(math.sin(dlat/2)**2+math.cos(a)*math.cos(b)*math.sin(dlon/2)**2)))
                        if distance>5000:continue
                        records.append({**r,'distance_m':round(distance),'state':receipt['state'],'source_url':receipt['source_url'],'source_uploaded_at':receipt['source_uploaded_at'],'retrieved_at':receipt['retrieved_at'],'source_sha256':receipt['sha256']})
            records.sort(key=lambda r:r['distance_m'])
            return {'schema':VERSION,'status':'records-returned' if records else 'no-records-in-acquired-search','records':records[:20],'truncated':truncated or len(records)>20,'search_radius_m':5000,'states_acquired':[r['state'] for r in receipts],'household_connection_verified':False,'scope':'state-well-construction-records-near-address','current_safety':'not-determined'}
        finally:self.query_lock.release()
