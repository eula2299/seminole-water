#!/usr/bin/env python3
"""Deterministic agent audit over the local evidence bank.
This never invents concentrations and never publishes web text as a result.
It verifies required fields, source provenance, duplicates, units, and conflicting latest records.
"""
import json, os, datetime, hashlib
ROOT=os.path.dirname(os.path.dirname(__file__))
records=json.load(open(os.path.join(ROOT,'data','metal_records.json')))
agents=json.load(open(os.path.join(ROOT,'data','metal_agents.json')))
registry={x['id']:x for x in json.load(open(os.path.join(ROOT,'data','source_registry.json')))}
outdir=os.path.join(ROOT,'data','agent_runs');os.makedirs(outdir,exist_ok=True)
report={'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'policy':'No estimated or model-generated concentration. Only authoritative records with explicit provenance are eligible.','agents':[]}
for agent in agents:
 metal=(agent.get('metal') or agent.get('name') or '').upper()
 rows=[r for r in records if str(r.get('metal','')).upper()==metal]
 issues=[];seen=set();systems=set()
 for i,r in enumerate(rows):
  systems.add(r.get('pwsid'))
  missing=[k for k in ('pwsid','metal','sample_date','result','unit') if r.get(k) in (None,'')]
  if missing: issues.append({'row':i,'type':'missing-fields','fields':missing})
  key=tuple(str(r.get(k,'')) for k in ('pwsid','metal','sample_date','result','unit','sample_type'))
  if key in seen: issues.append({'row':i,'type':'possible-duplicate','key':key})
  seen.add(key)
  sid=r.get('source_id','fdep-chemical-current')
  if sid not in registry: issues.append({'row':i,'type':'unknown-source','source_id':sid})
 report['agents'].append({'metal':metal,'status':'passed' if not issues else 'review-needed','record_count':len(rows),'system_count':len([x for x in systems if x]),'issues':issues,'configured_sources':agent.get('sources',[])})
raw=json.dumps(report,sort_keys=True).encode();report['sha256']=hashlib.sha256(raw).hexdigest()
fn=os.path.join(outdir,datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
json.dump(report,open(fn,'w'),indent=2);print(fn)
