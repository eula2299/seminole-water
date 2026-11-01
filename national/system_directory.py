"""Exact SDWIS directory rows in a compact, verified, read-only index.

The original official ZIP remains retained by the compliance archive. This index
preserves every CSV field and row; directory matches never prove a home's supplier.
"""
import contextlib,csv,gzip,hashlib,io,json,pathlib,re,sqlite3,zipfile
from .wqp_backfill import sha

SCHEMA='sdwis-directory/1'
MAX_DECODED=1_000_000_000
MAX_PACKED=256_000_000
MAX_RECORD=1_000_000
REQUIRED={'PWSID','PWS_NAME','STATE_CODE','CITY_NAME','ZIP_CODE','PWS_ACTIVITY_CODE','PWS_TYPE_CODE'}

def prepare(archive,work):
    db_path=work/'directory.sqlite';packed=work/'directory.sqlite.gz'
    count=0;rows_digest=hashlib.sha256()
    with zipfile.ZipFile(archive) as source:
        members=[m for m in source.infolist() if pathlib.PurePosixPath(m.filename).name.upper()=='SDWA_PUB_WATER_SYSTEMS.CSV']
        if len(members)!=1 or members[0].file_size>1_000_000_000:raise ValueError('Missing or oversized SDWIS system directory')
        db=sqlite3.connect(db_path)
        try:
            db.execute('PRAGMA journal_mode=OFF')
            db.execute('CREATE TABLE systems (row_number INTEGER PRIMARY KEY,pwsid TEXT,name TEXT,state TEXT,city TEXT,zip TEXT,active INTEGER,system_type TEXT,eligible INTEGER,raw BLOB NOT NULL)')
            with source.open(members[0]) as raw,io.TextIOWrapper(raw,encoding='utf-8-sig',newline='') as text:
                reader=csv.DictReader(text,strict=True);headers=reader.fieldnames
                if not headers or len(headers)!=len(set(headers)) or not REQUIRED.issubset(headers):raise ValueError('SDWIS system directory column contract changed')
                db.execute('CREATE TABLE directory_columns (columns TEXT NOT NULL)')
                db.execute('INSERT INTO directory_columns VALUES (?)',[json.dumps(headers)])
                for row in reader:
                    if None in row or any(v is None for v in row.values()):raise ValueError('Malformed SDWIS system directory row')
                    serialized=json.dumps([row[h] for h in headers],ensure_ascii=False,separators=(',',':')).encode()
                    if len(serialized)>MAX_RECORD:raise ValueError('SDWIS directory row exceeds limit')
                    rows_digest.update(serialized+b'\n')
                    count+=1;pwsid=row['PWSID'].strip().upper()
                    db.execute('INSERT INTO systems VALUES (?,?,?,?,?,?,?,?,?,?)',(count,pwsid,row['PWS_NAME'].strip(),row['STATE_CODE'].strip().upper(),row['CITY_NAME'].strip().upper(),row['ZIP_CODE'].strip()[:5],int(row['PWS_ACTIVITY_CODE'].strip()=='A'),row['PWS_TYPE_CODE'].strip(),int(bool(re.fullmatch('[A-Z0-9]{9}',pwsid))),serialized))
            if not count:raise ValueError('Empty SDWIS directory is not published')
            db.execute('CREATE INDEX systems_id ON systems(pwsid)')
            db.execute('CREATE INDEX systems_city ON systems(state,city)')
            db.execute('CREATE INDEX systems_zip ON systems(state,zip)')
            db.execute('CREATE INDEX systems_state ON systems(state)')
            db.commit()
            actual,valid,unique=db.execute('SELECT count(*),sum(eligible),count(DISTINCT CASE WHEN eligible=1 THEN pwsid END) FROM systems').fetchone()
            if actual!=count:raise ValueError('SDWIS directory row-count mismatch')
            if db.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise ValueError('SDWIS directory integrity check failed')
        finally:db.close()
    if db_path.stat().st_size>MAX_DECODED:raise ValueError('SDWIS directory exceeds decoded limit')
    with db_path.open('rb') as src,packed.open('wb') as dst,gzip.GzipFile(fileobj=dst,mode='wb',mtime=0,compresslevel=6) as out:
        while block:=src.read(1024*1024):out.write(block)
    if packed.stat().st_size>MAX_PACKED:raise ValueError('SDWIS directory exceeds packed limit')
    return {'schema':SCHEMA,'file':packed.name,'bytes':packed.stat().st_size,'sha256':sha(packed),'decoded_bytes':db_path.stat().st_size,'decoded_sha256':sha(db_path),'source_rows':count,'rows_sha256':rows_digest.hexdigest(),'valid_identity_rows':valid,'unique_pwsids':unique,'columns':headers,'source_member':members[0].filename}

def restore(store,item,root):
    if item.get('schema')!=SCHEMA or not 0<item.get('bytes',0)<=MAX_PACKED or not 0<item.get('decoded_bytes',0)<=MAX_DECODED:raise ValueError('Invalid directory receipt')
    if not re.fullmatch('[a-f0-9]{64}',item.get('decoded_sha256','')):raise ValueError('Invalid directory checksum')
    root.mkdir(parents=True,exist_ok=True);target=root/(item['decoded_sha256']+'.sqlite')
    if target.exists() and sha(target)==item['decoded_sha256']:verify(target,item);return target
    packed=root/(item['sha256']+'.gz');temporary=target.with_suffix('.part')
    try:
        store.verify_size(item['key'],item['bytes'])
        store.get(item['key'],packed,item['sha256'])
        if packed.stat().st_size!=item['bytes']:raise ValueError('Directory packed-size mismatch')
        size=0;digest=hashlib.sha256()
        with gzip.open(packed,'rb') as src,temporary.open('wb') as out:
            while block:=src.read(1024*1024):
                size+=len(block)
                if size>item['decoded_bytes']:raise ValueError('Directory decoded-size limit exceeded')
                digest.update(block);out.write(block)
        if size!=item['decoded_bytes'] or digest.hexdigest()!=item['decoded_sha256']:raise ValueError('Directory decoded checksum mismatch')
        verify(temporary,item);temporary.replace(target)
        return target
    finally:
        packed.unlink(missing_ok=True);temporary.unlink(missing_ok=True)

def verify(path,item):
    with contextlib.closing(sqlite3.connect(f'file:{path}?mode=ro',uri=True)) as db:
        actual=db.execute('SELECT count(*),sum(eligible),count(DISTINCT CASE WHEN eligible=1 THEN pwsid END) FROM systems').fetchone()
        columns=db.execute('SELECT columns FROM directory_columns').fetchall()
        if len(columns)!=1 or json.loads(columns[0][0])!=item['columns']:raise ValueError('Directory column readback mismatch')
        expected=(item['source_rows'],item['valid_identity_rows'],item['unique_pwsids'])
        if actual!=expected or db.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise ValueError('Directory readback row-count or integrity mismatch')
        digest=hashlib.sha256()
        for row in db.execute('SELECT raw FROM systems ORDER BY row_number'):
            if len(row[0])>MAX_RECORD:raise ValueError('Directory row exceeds limit')
            digest.update(row[0]+b'\n')
        if digest.hexdigest()!=item['rows_sha256']:raise ValueError('Directory original-field readback mismatch')

def records(path,where,args,limit):
    with contextlib.closing(sqlite3.connect(f'file:{path}?mode=ro',uri=True)) as db:
        columns=json.loads(db.execute('SELECT columns FROM directory_columns').fetchone()[0])
        total=db.execute('SELECT count(*) FROM systems WHERE '+where,args).fetchone()[0]
        rows=db.execute('SELECT raw FROM systems WHERE '+where+' ORDER BY name,pwsid,row_number LIMIT ?',[*args,limit]).fetchall()
    result=[]
    for row in rows:
        raw=row[0]
        if len(raw)>MAX_RECORD:raise ValueError('Invalid directory row encoding')
        values=json.loads(raw)
        if not isinstance(values,list) or len(values)!=len(columns) or not all(isinstance(v,str) for v in values):raise ValueError('Invalid directory row fields')
        result.append(dict(zip(columns,values)))
    return result,total
