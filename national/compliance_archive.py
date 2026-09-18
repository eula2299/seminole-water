"""Retain the official SDWIS violation/enforcement snapshot outside PostgreSQL.

Rows represent violation/enforcement associations, not independent violations,
water samples, household exposures, or current advisories. Raw source fields are
preserved as text. Requests read only the acquired shard for a complete PWSID.
"""
from __future__ import annotations
import csv, hashlib, io, json, os, pathlib, re, shutil, tempfile, threading, urllib.parse, urllib.request, zipfile
from . import wqp_backfill as Q

URL='https://echo.epa.gov/files/echodownloads/SDWA_latest_downloads.zip'
DOCUMENTATION='https://echo.epa.gov/tools/data-downloads/sdwa-download-summary'
PREFIX='sdwis-compliance/v1'
MAX_SHARD=128_000_000
MAX_CACHE=384_000_000
REQUIRED={'SUBMISSIONYEARQUARTER','PWSID','VIOLATION_ID','ENFORCEMENT_ID','VIOLATION_CODE','VIOLATION_CATEGORY_CODE','CONTAMINANT_CODE','VIOLATION_STATUS','NON_COMPL_PER_BEGIN_DATE','NON_COMPL_PER_END_DATE','ENFORCEMENT_DATE','IS_HEALTH_BASED_IND'}

def literal(value):return "'"+str(value).replace("'","''")+"'"
def identifier(value):return '"'+value.replace('"','""')+'"'

class EchoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        target=urllib.parse.urlsplit(newurl)
        if target.scheme!='https' or target.hostname!='echo.epa.gov' or target.username or target.password or target.port not in (None,443):raise ValueError('Refusing unofficial SDWIS redirect')
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def download(path):
    return Q.download(URL,path,750_000_000,90,1,opener=urllib.request.build_opener(EchoRedirect()).open)

def prepare(archive,work):
    import duckdb
    definitions={}
    with zipfile.ZipFile(archive) as source:
        members=[m for m in source.infolist() if pathlib.PurePosixPath(m.filename).name.upper()=='SDWA_VIOLATIONS_ENFORCEMENT.CSV']
        if len(members)!=1 or members[0].file_size>5_000_000_000:raise ValueError('Missing or oversized SDWIS violation table')
        if shutil.disk_usage(work).free < members[0].file_size+1_500_000_000:raise ValueError('Insufficient temporary storage for complete SDWIS import')
        csv_path=work/'violations.csv'
        with source.open(members[0]) as src,csv_path.open('wb') as dst:shutil.copyfileobj(src,dst,1024*1024)
        refs=[m for m in source.infolist() if pathlib.PurePosixPath(m.filename).name.upper()=='SDWA_REF_CODE_VALUES.CSV']
        if len(refs)>1 or refs and refs[0].file_size>1_000_000:raise ValueError('Unexpected SDWIS reference table')
        if refs:
            with source.open(refs[0]) as raw:
                for row in csv.DictReader(io.TextIOWrapper(raw,encoding='utf-8-sig',newline='')):
                    if row['VALUE_TYPE'] not in ('VIOLATION_CATEGORY_CODE','VIOLATION_CODE','CONTAMINANT_CODE','ENFORCEMENT_ACTION_TYPE_CODE'):continue
                    values=definitions.setdefault(row['VALUE_TYPE'],{});code=row['VALUE_CODE'];description=row['VALUE_DESCRIPTION']
                    if code in values and values[code]!=description:raise ValueError('Conflicting SDWIS code definitions')
                    values[code]=description
    with csv_path.open(encoding='utf-8-sig',newline='') as handle:headers=next(csv.reader(handle))
    if len(headers)!=len(set(headers)) or not REQUIRED.issubset(headers) or any(not re.fullmatch('[A-Z_]+',h) for h in headers):raise ValueError('SDWIS column contract changed')
    con=duckdb.connect();con.execute("SET memory_limit='512MB'; SET threads=1; SET partitioned_write_max_open_files=16")
    con.execute('SET temp_directory='+literal(work/'spill'))
    try:
        columns='{'+','.join(literal(h)+":'VARCHAR'" for h in headers)+'}'
        required_text='['+','.join(literal(h) for h in headers)+']'
        con.execute('CREATE VIEW raw AS SELECT * FROM read_csv('+literal(csv_path)+',header=true,delim=\',\',quote=\'"\',escape=\'"\',columns='+columns+',force_not_null='+required_text+',strict_mode=true)')
        con.execute("CREATE VIEW normalized AS SELECT *, upper(trim(PWSID)) AS _pwsid, regexp_full_match(upper(trim(PWSID)),'[A-Z0-9]{9}') AND (trim(VIOLATION_ID)<>'' OR trim(ENFORCEMENT_ID)<>'') AS _eligible FROM raw")
        rows,excluded,unlinked=con.execute("SELECT count(*),count(*) FILTER (WHERE NOT _eligible),count(*) FILTER (WHERE _eligible AND trim(VIOLATION_ID)='') FROM normalized").fetchone()
        if not rows:raise ValueError('Empty SDWIS snapshot is not published')
        # Preserve all rows, including unmappable identities. The serving path
        # excludes them explicitly instead of changing the source or its count.
        output=work/'shards'
        con.execute('COPY (SELECT *, substr(sha256(_pwsid),1,1) AS shard FROM normalized) TO '+literal(output)+" (FORMAT PARQUET,COMPRESSION ZSTD,PARTITION_BY(shard),ROW_GROUP_SIZE 2048)")
        shards={};actual=0
        for directory in sorted(output.iterdir()):
            shard=directory.name.removeprefix('shard=')
            if not re.fullmatch('[0-9a-f]',shard):raise ValueError('Invalid SDWIS shard')
            parts=[]
            for path in sorted(directory.glob('*.parquet')):
                n=con.execute('SELECT count(*) FROM read_parquet(?)',[str(path)]).fetchone()[0];actual+=n
                parts.append({'file':str(path.relative_to(work)),'rows':n,'bytes':path.stat().st_size,'sha256':Q.sha(path)})
            if sum(p['bytes'] for p in parts)>MAX_SHARD:raise ValueError('SDWIS shard exceeds bounded query budget')
            shards[shard]=parts
        if actual!=rows:raise ValueError('SDWIS Parquet row count mismatch')
        return {'source_rows':rows,'excluded_identity_rows':excluded,'unlinked_enforcement_rows':unlinked,'shards':shards,'columns':headers,'code_definitions':definitions}
    finally:con.close();csv_path.unlink(missing_ok=True)

class ComplianceArchive:
    def __init__(self,store,root,fetcher=download):
        self.store=store;self.root=pathlib.Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.cache=self.root/'cache';self.cache.mkdir(exist_ok=True);self.fetcher=fetcher
        self.lock=threading.RLock();self.query_lock=threading.Lock();self.error=None;self.phase='ready'
        self.receipt=store.json(PREFIX+'/latest.json')
        if self.receipt and self.receipt.get('schema')!='sdwis-compliance/1':raise ValueError('Unsupported compliance receipt')

    def status(self):
        with self.lock:r=self.receipt or {}
        return {'schema':'sdwis-compliance/1','status':self.phase,'retained_association_rows':r.get('source_rows',0),'excluded_identity_rows':r.get('excluded_identity_rows',0),'unlinked_enforcement_rows':r.get('unlinked_enforcement_rows',0),'source_url':URL,'documentation_url':DOCUMENTATION,'retrieved_at':r.get('source',{}).get('retrieved_at'),'sha256':r.get('source',{}).get('sha256'),'count_definition':'Violation/enforcement rows, including enforcement without a linked violation. A violation can have multiple enforcement rows. Not water samples or current advisories.','household_safety_assessed':False,'error':self.error}

    def refresh(self):
        self.phase='acquiring';self.error=None
        try:
            with tempfile.TemporaryDirectory(prefix='import-',dir=self.root) as temporary:
                work=pathlib.Path(temporary);raw=work/'source.zip';source=self.fetcher(raw)
                if self.receipt and self.receipt['source']['sha256']==source['sha256']:self.phase='ready';return False
                artifacts=prepare(raw,work);base=PREFIX+'/data/'+source['sha256']
                for parts in artifacts['shards'].values():
                    for part in parts:part['key']=base+'/'+part['file']
                receipt={'schema':'sdwis-compliance/1','source':source,'raw_key':base+'/source.zip',**artifacts}
                with self.store.publication_lock():
                    self.store.ensure_capacity(source['bytes']+sum(p['bytes'] for parts in artifacts['shards'].values() for p in parts)+1_000_000)
                    self.store.put(receipt['raw_key'],raw)
                    for parts in artifacts['shards'].values():
                        for part in parts:self.store.put(part['key'],work/part['file'])
                    self.store.put_json(base+'/receipt.json',receipt)
                    self.store.put_json(PREFIX+'/latest.json',receipt)
                with self.lock:self.receipt=receipt
                self.phase='ready';return True
        except Exception as exc:
            self.phase='acquisition-failed';self.error=str(exc)[:250];raise

    def system(self,pwsid):
        if not re.fullmatch('[A-Z0-9]{9}',pwsid):raise ValueError('Invalid complete PWSID')
        base={'schema':'sdwis-compliance/1','pwsid':pwsid,'records':[],'scope':'public-system-compliance-not-household','current_safety':'not-determined','current_advisories_checked':False}
        with self.lock:receipt=self.receipt
        if not receipt:return {**base,'status':'not-acquired'}
        if not self.query_lock.acquire(blocking=False):return {**base,'status':'busy'}
        try:
            shard=hashlib.sha256(pwsid.encode()).hexdigest()[0];parts=receipt['shards'].get(shard,[])
            provenance={'url':URL,'documentation_url':DOCUMENTATION,'retrieved_at':receipt['source']['retrieved_at'],'sha256':receipt['source']['sha256']}
            if not parts:return {**base,'status':'no-records-in-snapshot','source':provenance,'truncated':False,'association_rows':0}
            size=sum(p['bytes'] for p in parts)
            if size>MAX_SHARD:raise ValueError('Compliance shard exceeds budget')
            keep={p['sha256']+'.parquet' for p in parts};cached=sorted(self.cache.glob('*.parquet'),key=lambda p:p.stat().st_mtime);used=sum(p.stat().st_size for p in cached)
            for path in cached:
                if used+size<=MAX_CACHE:break
                if path.name not in keep:used-=path.stat().st_size;path.unlink()
            paths=[]
            for part in parts:
                path=self.cache/(part['sha256']+'.parquet');self.store.get(part['key'],path,part['sha256']);os.utime(path,None);paths.append(str(path))
            import duckdb
            con=duckdb.connect();con.execute("SET memory_limit='128MB'; SET threads=1")
            try:
                files='['+','.join(literal(p) for p in paths)+']'
                con.execute('CREATE VIEW selected AS SELECT * FROM read_parquet('+files+') WHERE _eligible AND _pwsid='+literal(pwsid))
                total,violations,unlinked=con.execute("SELECT count(*),count(DISTINCT NULLIF(trim(VIOLATION_ID),'')),count(*) FILTER(WHERE trim(VIOLATION_ID)='') FROM selected").fetchone()
                periods=[r[0] for r in con.execute('SELECT DISTINCT SUBMISSIONYEARQUARTER FROM selected ORDER BY SUBMISSIONYEARQUARTER LIMIT 10').fetchall()]
                rows=con.execute("SELECT "+','.join(identifier(c) for c in receipt['columns'])+" FROM selected ORDER BY try_strptime(NON_COMPL_PER_BEGIN_DATE,'%m/%d/%Y') DESC NULLS LAST,VIOLATION_ID,ENFORCEMENT_ID LIMIT 100").fetchall()
                records=[dict(zip(receipt['columns'],row)) for row in rows]
                for record in records:record['code_descriptions']={column:values[record[column]] for column,values in receipt.get('code_definitions',{}).items() if record.get(column) in values}
            finally:con.close()
            return {**base,'status':'records-returned' if total else 'no-records-in-snapshot','records':records,'association_rows':total,'distinct_violation_ids':violations,'unlinked_enforcement_rows':unlinked,'submission_periods':periods,'truncated':total>len(records),'source':provenance,'selection':'At most 100 source rows, ordered by reported noncompliance start date. Multiple rows may refer to the same violation; some enforcement records have no linked violation ID. This historical snapshot is not a current advisory check.'}
        finally:self.query_lock.release()
