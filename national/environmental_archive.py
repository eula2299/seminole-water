"""Durable WQP acquisition and bounded geographic reads of acquired evidence.

Every completed partition retains the official response and normalized Parquet.
The serving index contains the latest reported result per location/analyte/unit/
method/fraction within each partition. It never assigns a household or PWSID.
"""
from __future__ import annotations
import contextlib, copy, datetime as dt, gzip, hashlib, json, math, os, pathlib, re, shutil, sqlite3, tempfile, threading, time
from functools import lru_cache
from . import wqp_backfill as Q

PREFIX='wqp/v1'
MAX_CHECKPOINT=100_000_000
MAX_INDEX=64_000_000
MAX_CACHE=256_000_000

def literal(value):return "'"+str(value).replace("'","''")+"'"
def intersects(a,b):return bool(a and b and a[0]<=b[2] and a[2]>=b[0] and a[1]<=b[3] and a[3]>=b[1])

@lru_cache(maxsize=2)
def transformer(epsg):
    from pyproj import Transformer, network
    network.set_network_enabled(False)
    # Use an available, named operation with known accuracy. Missing regional
    # grids must not trigger an unlabelled ballpark or a network download.
    return Transformer.from_crs(epsg,4326,always_xy=True,allow_ballpark=False,only_best=False,accuracy=10)

@lru_cache(maxsize=8192)
def transform_point(epsg,lat,lon):
    try:
        t=transformer(epsg);x,y=t.transform(lon,lat,errcheck=True)
        op=t.get_last_used_operation();area=op.area_of_use
        if not (math.isfinite(x) and math.isfinite(y) and -180<=x<=180 and -90<=y<=90 and 0<=op.accuracy<=10):return None
        if area and not (area.south<=lat<=area.north and (area.west<=lon<=area.east if area.west<=area.east else lon>=area.west or lon<=area.east)):return None
        return y,x,{'source_crs':'EPSG:'+str(epsg),'target_crs':'EPSG:4326','operation':op.description,'operation_accuracy_m':op.accuracy,'position_accuracy_verified':False}
    except Exception:return None

def mapped_coordinates(row):
    for prefix,datum_key in [('standardized_', 'standardized_coordinate_datum'),('', 'coordinate_datum')]:
        datum=''.join(c for c in row.get(datum_key,'').upper() if c.isalnum())
        try:lat=float(row[prefix+'latitude_text']);lon=float(row[prefix+'longitude_text'])
        except (ValueError,KeyError,TypeError):continue
        if not (math.isfinite(lat) and math.isfinite(lon) and -90<=lat<=90 and -180<=lon<=180):continue
        if datum in ('WGS84','WGS1984','EPSG4326'):return lat,lon,{'source_crs':'EPSG:4326','target_crs':'EPSG:4326','operation':'Source reports WGS84 coordinates','position_accuracy_verified':False}
        epsg=4269 if datum in ('NAD83','NAD1983','EPSG4269') else 4267 if datum in ('NAD27','NAD1927','EPSG4267') else None
        if epsg:
            mapped=transform_point(epsg,lat,lon)
            if mapped:return mapped
    return None

def coordinates(row):
    mapped=mapped_coordinates(row)
    return mapped[:2] if mapped else None

def materialize(directory,counts):
    import duckdb
    con=duckdb.connect();con.execute("SET memory_limit='512MB'; SET threads=1")
    con.execute('SET temp_directory='+literal(directory/'spill'))
    index=directory/'spatial.sqlite';db=sqlite3.connect(index)
    db.execute('CREATE TABLE readings (id TEXT PRIMARY KEY,latitude REAL,longitude REAL,sample_date TEXT,record TEXT)')
    output=[];missing_coordinates=0
    try:
        for part in counts['parts']:
            source=directory/part['file'];target=source.with_suffix('.parquet')
            with source.open() as f:first=json.loads(next(f))
            types={key:('BOOLEAN' if key=='household_sample_verified' else 'BIGINT' if key=='raw_row_number' else 'VARCHAR') for key in first}
            columns='{'+','.join(literal(k)+':'+literal(v) for k,v in types.items())+'}'
            con.execute('COPY (SELECT * FROM read_json('+literal(source)+',columns='+columns+',format=\'newline_delimited\')) TO '+literal(target)+" (FORMAT PARQUET, COMPRESSION ZSTD)")
            with source.open() as f:
                for line in f:
                    row=json.loads(line);point=mapped_coordinates(row)
                    if point is None:missing_coordinates+=1;continue
                    lat,lon,operation=point;row['coordinate_transform']=operation
                    key=Q.digest([row.get(k,'') for k in ['organization_id','site_id','characteristic','unit_text','method_id','sample_fraction']]+[lat,lon])
                    db.execute('INSERT INTO readings VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sample_date=excluded.sample_date,record=excluded.record WHERE excluded.sample_date>readings.sample_date',(key,lat,lon,row['sample_date'],Q.canonical(row)))
            db.commit()
            actual=con.execute('SELECT count(*) FROM read_parquet(?)',[str(target)]).fetchone()[0]
            if actual!=part['rows']:raise ValueError('Parquet row count differs from validated source rows')
            output.append({'file':target.name,'rows':actual,'sha256':Q.sha(target),'bytes':target.stat().st_size})
            source.unlink()
        db.execute('CREATE INDEX readings_point ON readings(latitude,longitude)')
        bounds=db.execute('SELECT min(longitude),min(latitude),max(longitude),max(latitude) FROM readings').fetchone()
        groups=db.execute('SELECT count(*) FROM readings').fetchone()[0];db.commit()
    finally:db.close();con.close()
    if index.stat().st_size>MAX_INDEX:raise Q.BudgetExceeded('Spatial index exceeds bounded serving size; split the partition.')
    return {'parquet':output,'index':{'file':index.name,'bytes':index.stat().st_size,'sha256':Q.sha(index)},'geo_bounds':list(bounds) if groups else None,'mapped_summary_groups':groups,'rows_without_supported_coordinates':missing_coordinates}

class EnvironmentalArchive:
    def __init__(self,store,root,plan=None,fetcher=Q.download):
        self.store=store;self.root=pathlib.Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.cache=self.root/'cache';self.cache.mkdir(exist_ok=True)
        self.fetcher=fetcher;self.initial_plan=plan;self.data=None;self.head=None
        self.lock=threading.RLock();self.query_lock=threading.Lock();self.phase='restoring';self.error=None
        with store.publication_lock():
            self._reload()
            if self.head is None:self._save()

    def _reload(self):
        head=self.store.json(PREFIX+'/checkpoint-head.json')
        if head and self.head and head['sha256']==self.head['sha256']:return
        if head:
            if head.get('schema')!='wqp-durable/1' or head['key'] not in (PREFIX+'/checkpoint-a.gz',PREFIX+'/checkpoint-b.gz') or head['bytes']>20_000_000:raise ValueError('Invalid environmental checkpoint')
            path=self.root/'checkpoint.gz';self.store.get(head['key'],path,head['sha256'])
            with gzip.open(path,'rb') as src:blob=src.read(MAX_CHECKPOINT+1)
            if len(blob)>MAX_CHECKPOINT:raise ValueError('Environmental checkpoint exceeds limit')
            data=json.loads(blob);Q.validate_plan(data['plan'])
        else:
            plan=self.initial_plan or Q.make_plan(list(Q.STATES),'1900-01-01',str(dt.date.today()))
            Q.validate_plan(plan)
            data={'plan':plan,'jobs':{p['id']:{'partition':p,'status':'pending','attempts':0} for p in plan['partitions']}}
        with self.lock:self.data=data;self.head=head;self.phase='ready'

    def _save(self):
        blob=Q.canonical(self.data).encode()
        if len(blob)>MAX_CHECKPOINT:raise ValueError('Environmental checkpoint exceeds limit')
        path=self.root/'next-checkpoint.gz';path.write_bytes(gzip.compress(blob,compresslevel=6,mtime=0))
        # Two alternating slots preserve the referenced checkpoint if a process
        # dies between uploading the next blob and atomically moving the head.
        slot='b' if self.head and self.head['key'].endswith('/checkpoint-a.gz') else 'a'
        key=PREFIX+'/checkpoint-'+slot+'.gz'
        self.store.ensure_capacity(path.stat().st_size+4096)
        self.store.put(key,path)
        head={'schema':'wqp-durable/1','key':key,'sha256':Q.sha(path),'bytes':path.stat().st_size,'updated_at':Q.now()}
        self.store.put_json(PREFIX+'/checkpoint-head.json',head)
        self.head=head

    def status(self):
        with self.lock:
            jobs=list((self.data or {}).get('jobs',{}).values());plan=(self.data or {}).get('plan',{})
            counts={s:sum(j['status']==s for j in jobs) for s in ('pending','complete','split','failed')}
            failures=[{'state':j['partition']['state'],'start':j['partition']['start'],'end':j['partition']['end'],'attempts':j['attempts'],'error':j.get('error')} for j in jobs if j['status']=='failed']
            return {'schema':'wqp-durable/1','status':self.phase,'source':'WQP-WQX3','source_url':Q.ENDPOINT,'plan_id':plan.get('plan_id'),'published_partitions':counts['complete'],'partition_status_counts':counts,'failed_partitions':failures[:12],'failed_partitions_truncated':len(failures)>12,'retained_source_rows':sum(j.get('manifest',{}).get('counts',{}).get('raw_result_rows',0) for j in jobs if j['status']=='complete'),'count_definition':'Acquired environmental result rows; not independent samples or household measurements. Do not add overlapping program totals.','household_safety_assessed':False,'coverage_complete':False,'error':self.error,'last_published_at':(self.head or {}).get('updated_at')}

    def _recover_timeouts(self):
        # Earlier releases parked read timeouts behind every unattempted year.
        # Preserve those failures as split parents and durably resume smaller,
        # disjoint date ranges. A timeout never becomes an empty success.
        repairs=[];retries=[]
        for ident,job in self.data['jobs'].items():
            error=job.get('error') or ''
            if job['status']=='failed' and error.startswith('Source transfer failed after ') and ('timed out' in error or 'total time budget' in error):
                children=Q.split_partition(job['partition'])
                if children:repairs.append((ident,children))
            elif (job['status']=='failed' and job.get('parser_profile')!=Q.PARSER_PROFILE
                    and re.fullmatch(r'Malformed WQX3 CSV row \d+\.',error)):
                # Retry once under the reviewed footer contract. An unrelated
                # malformed row still fails; never pad missing chemistry fields.
                retries.append(ident)
        if not repairs and not retries:return
        with self.lock:
            previous=self.data;self.data=copy.deepcopy(previous)
            for ident,children in repairs:
                self.data['jobs'][ident].update(status='split',split_reason='upstream-timeout')
                for child in children:self.data['jobs'].setdefault(child['id'],{'partition':child,'status':'pending','attempts':0})
            for ident in retries:
                job=self.data['jobs'][ident]
                job.update(status='pending',previous_error=job.get('error'),previous_attempts=job['attempts'],
                           attempts=0,parser_profile=Q.PARSER_PROFILE)
            try:self._save()
            except Exception:self.data=previous;raise

    def step(self):
        with self.store.publication_lock():self._reload();self._recover_timeouts()
        with self.lock:
            pending=[j for j in self.data['jobs'].values() if j['status'] in ('pending','failed') and j['attempts']<3]
            if not pending:self.phase='complete-with-gaps' if any(j['status']=='failed' for j in self.data['jobs'].values()) else 'plan-acquired';return False
            job=copy.deepcopy(sorted(pending,key=lambda j:(j['attempts'],-int(j['partition']['start'][:4]),j['partition']['state'],j['partition']['start']))[0])
            self.phase='acquiring';self.error=None
        part=job['partition'];ident=part['id'];manifest=None;failure=None;children=[]
        with tempfile.TemporaryDirectory(prefix='partition-',dir=self.root) as temporary:
            work=pathlib.Path(temporary);raw=work/'source.bin'
            try:
                if shutil.disk_usage(work).free<2_000_000_000:raise ValueError('Insufficient temporary disk for bounded WQP partition')
                source=self.fetcher(Q.query_url(part),raw,64*1024*1024,45,2)
                counts=Q.normalize(raw,work,part,source,256*1024*1024,250000)
                artifacts=materialize(work,counts)
                base=PREFIX+'/data/'+ident+'/'+source['sha256']
                for item in artifacts['parquet']+[artifacts['index']]:item['key']=base+'/'+item['file']
                manifest={'schema':'wqp-durable-partition/1','partition':part,'source':source,'counts':{k:v for k,v in counts.items() if k!='parts'},**artifacts,'raw_key':base+'/source.bin','completed_at':Q.now(),'household_sample_verified':False}
            except Q.BudgetExceeded as exc:failure=str(exc)[:500];children=Q.split_partition(part)
            except Exception as exc:failure=str(exc)[:500]
            with self.store.publication_lock():
                self._reload()
                current=self.data['jobs'].get(ident)
                if current and current['status'] in ('complete','split'):return True
                if manifest:
                    needed=source['bytes']+sum(x['bytes'] for x in artifacts['parquet']+[artifacts['index']])+2_000_000
                    self.store.ensure_capacity(needed)
                    self.store.put(manifest['raw_key'],raw)
                    for item in artifacts['parquet']+[artifacts['index']]:self.store.put(item['key'],work/item['file'])
                    self.store.put_json(base+'/manifest.json',manifest)
                with self.lock:
                    previous=self.data;self.data=copy.deepcopy(previous)
                    self.data['jobs'][ident]={**{k:job[k] for k in ('previous_error','previous_attempts') if k in job},'partition':part,'status':'complete' if manifest else 'split' if children else 'failed','attempts':job['attempts']+1,'error':failure,'manifest':manifest,'parser_profile':Q.PARSER_PROFILE}
                    for child in children:self.data['jobs'].setdefault(child['id'],{'partition':child,'status':'pending','attempts':0})
                    try:self._save()
                    except Exception:self.data=previous;raise
                    self.phase='ready';self.error=failure
        return True

    def near(self,lat,lon):
        if not all(isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) for x in (lat,lon)) or abs(lat)>90 or abs(lon)>180:raise ValueError('Invalid geographic query')
        if not self.query_lock.acquire(blocking=False):return {'status':'busy','records':[],'household_sample_verified':False}
        try:
            dy=5000/111320;dx=dy/max(.01,math.cos(math.radians(lat)))
            boxes=[[max(-180,lon-dx),max(-90,lat-dy),min(180,lon+dx),min(90,lat+dy)]]
            if lon-dx < -180:boxes.append([lon-dx+360,max(-90,lat-dy),180,min(90,lat+dy)])
            if lon+dx > 180:boxes.append([-180,max(-90,lat-dy),lon+dx-360,min(90,lat+dy)])
            with self.lock:receipts=[j['manifest'] for j in (self.data or {}).get('jobs',{}).values() if j['status']=='complete' and any(intersects(j['manifest']['geo_bounds'],b) for b in boxes)]
            receipts.sort(key=lambda r:r['partition']['end'],reverse=True)
            records=[];sources=[];omitted=0;seen=set()
            for receipt in receipts[:4]:
                item=receipt['index']
                if item['bytes']>MAX_INDEX:omitted+=1;continue
                path=self.cache/(item['sha256']+'.sqlite')
                cached=sorted(self.cache.glob('*.sqlite'),key=lambda p:p.stat().st_mtime)
                used=sum(p.stat().st_size for p in cached)
                for old in cached:
                    if used+item['bytes']<=MAX_CACHE:break
                    if old!=path:used-=old.stat().st_size;old.unlink()
                self.store.get(item['key'],path,item['sha256']);os.utime(path,None)
                with sqlite3.connect(f'file:{path}?mode=ro',uri=True) as db:
                    for box in boxes:
                        found=db.execute('SELECT latitude,longitude,record FROM readings WHERE longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ? ORDER BY sample_date DESC LIMIT 101',(box[0],box[2],box[1],box[3])).fetchall()
                        if len(found)>100:omitted+=1
                        for a,b,value in found[:100]:
                            row=json.loads(value);key=row['raw_file_sha256']+':'+row['raw_table']+':'+str(row['raw_row_number'])
                            if key in seen:continue
                            seen.add(key);row['latitude']=a;row['longitude']=b;records.append(row)
                sources.append({'url':receipt['source']['url'],'retrieved_at':receipt['source']['retrieved_at'],'sha256':receipt['source']['sha256'],'partition':receipt['partition']})
            records.sort(key=lambda r:r['sample_date'],reverse=True)
            return {'status':'records-returned' if records else 'no-records-in-bounded-acquired-search','records':records[:50],'sources':sources,'truncated':len(receipts)>4 or len(records)>50 or omitted>0,'matching_partitions':len(receipts),'partitions_checked':len(sources),'search_bounds':boxes,'scope':'environmental-monitoring-not-household','household_sample_verified':False,'current_safety':'not-determined','selection':'Latest result per site/analyte/unit/method/fraction within at most four recent acquired partitions; 5 km bounding envelope, not a hydraulic connection or a complete inventory.'}
        finally:self.query_lock.release()
