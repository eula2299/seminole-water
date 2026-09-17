#!/usr/bin/env python3
"""Bounded, stdout-backpressured ZIP/CSV reader. Never extracts archive members."""
import csv, io, json, pathlib, re, sys, zipfile
csv.field_size_limit(131072)
path, source = sys.argv[1:3]
def key(s): return re.sub('[^a-z0-9]', '', s.lower().lstrip('\ufeff'))
def kind(name, headers):
    keys = {key(h) for h in headers}
    if 'pwsid' not in keys: return None
    if source == 'ucmr5' and {'contaminant','analyticalresultvalue'} <= keys: return 'observation'
    if source in ('sdwis','sdwis-violations'):
        if source=='sdwis' and re.search(r'pub(?:lic)?[_ ]water[_ ]system',name,re.I) and 'pwsname' in keys: return 'system'
        if source=='sdwis-violations' and re.search(r'violations?(?:_enforcement)?\.(csv|txt)$',name,re.I) and 'violationid' in keys: return 'violation'
    return None
def emit(v): print(json.dumps(v,separators=(',',':'),ensure_ascii=True),flush=False)
with zipfile.ZipFile(path) as archive:
    members = archive.infolist()
    if len(members)>5000 or sum(m.file_size for m in members)>10_000_000_000: raise ValueError('Archive exceeds budget')
    recognized=set()
    for member in members:
        if not member.filename.lower().endswith(('.csv','.txt','.tsv')): continue
        # Skip very large unrelated SDWIS tables before decoding them.
        if source=='sdwis' and not re.search(r'pub(?:lic)?[_ ]water[_ ]system',member.filename,re.I): continue
        if source=='sdwis-violations' and not re.search(r'violations?(?:_enforcement)?\.(csv|txt)$',member.filename,re.I): continue
        with archive.open(member) as raw:
            text=io.TextIOWrapper(raw,encoding='cp1252' if source=='ucmr5' else 'utf-8-sig',errors='strict',newline='')
            reader=csv.DictReader(text,delimiter=',' if member.filename.lower().endswith('.csv') else '\t')
            headers=reader.fieldnames or []
            if len(headers)>150 or len(set(headers))!=len(headers): raise ValueError('Invalid header schema')
            table=kind(member.filename,headers)
            if not table: continue
            recognized.add(table)
            emit({'type':'member','member':member.filename,'kind':table,'headers':headers})
            for index,row in enumerate(reader,2):
                if None in row or any(v is None for v in row.values()): raise ValueError(f'Malformed row in {member.filename}:{index}')
                emit({'type':'row','member':member.filename,'kind':table,'row':row})
    required={'ucmr5':{'observation'},'sdwis':{'system'},'sdwis-violations':{'violation'}}[source]
    if not required<=recognized: raise ValueError('Required source tables missing: '+','.join(required-recognized))
    emit({'type':'complete','kinds':sorted(recognized)})
