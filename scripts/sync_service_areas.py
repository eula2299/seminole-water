#!/usr/bin/env python3
"""Download the public Seminole County Water Service Areas feature layer.
Uses the fixed public ArcGIS item ID rather than unreliable catalog search.
"""
from __future__ import annotations
import json, os, urllib.parse, urllib.request, datetime
ROOT=os.path.dirname(os.path.dirname(__file__))
DIR=os.path.join(ROOT,'data','service_areas')
SOURCE=os.path.join(DIR,'source.json')
OUT=os.path.join(DIR,'water_service_areas.geojson')
REPORT=os.path.join(DIR,'sync_report.json')

def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'SeminoleWaterMetals/5.0'})
    with urllib.request.urlopen(req,timeout=90) as r:
        return json.load(r)

def atomic_json(path,obj):
    os.makedirs(os.path.dirname(path),exist_ok=True)
    tmp=path+'.tmp'
    with open(tmp,'w',encoding='utf-8') as f: json.dump(obj,f,indent=2)
    os.replace(tmp,path)

def resolve_service(item_id, fallback_url=None):
    meta=get(f'https://www.arcgis.com/sharing/rest/content/items/{item_id}?f=json')
    if meta.get('access') not in ('public','org') and not meta.get('url'):
        raise RuntimeError(f'ArcGIS item is not queryable: {meta}')
    url=meta.get('url')
    if not url:
        data=get(f'https://www.arcgis.com/sharing/rest/content/items/{item_id}/data?f=json')
        urls=[]
        def walk(x):
            if isinstance(x,dict):
                for k,v in x.items():
                    if k.lower()=='url' and isinstance(v,str): urls.append(v)
                    walk(v)
            elif isinstance(x,list):
                for v in x: walk(v)
        walk(data)
        url=next((u for u in urls if 'FeatureServer' in u or 'MapServer' in u),None)
    if not url: url=fallback_url
    if not url: raise RuntimeError('Official ArcGIS item did not expose a service URL')
    return meta,url.rstrip('/')

def select_layer(service_url):
    svc=get(service_url+'?f=json')
    layers=svc.get('layers',[])
    if service_url.rstrip('/').split('/')[-1].isdigit():
        return service_url, get(service_url+'?f=json')
    if not layers: raise RuntimeError('Service has no layers')
    preferred=next((x for x in layers if 'water' in x.get('name','').lower() and 'service' in x.get('name','').lower()),layers[0])
    layer_url=f"{service_url}/{preferred['id']}"
    return layer_url,get(layer_url+'?f=json')

def fetch_all_geojson(layer_url,oid_field,max_record_count=2000):
    ids=get(layer_url+'/query?'+urllib.parse.urlencode({'f':'json','where':'1=1','returnIdsOnly':'true'})).get('objectIds') or []
    if not ids:
        q=layer_url+'/query?'+urllib.parse.urlencode({'f':'geojson','where':'1=1','outFields':'*','returnGeometry':'true','outSR':'4326'})
        fc=get(q)
        return fc
    features=[]
    for i in range(0,len(ids),max_record_count):
        chunk=ids[i:i+max_record_count]
        q=layer_url+'/query?'+urllib.parse.urlencode({'f':'geojson','objectIds':','.join(map(str,chunk)),'outFields':'*','returnGeometry':'true','outSR':'4326'})
        part=get(q)
        features.extend(part.get('features',[]))
    return {'type':'FeatureCollection','features':features}

def main():
    source=json.load(open(SOURCE,encoding='utf-8'))
    report={'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'item_id':source['arcgis_item_id'],'success':False}
    try:
        try:
            meta,service=resolve_service(source['arcgis_item_id'],source.get('fallback_layer_url'))
        except Exception:
            fallback=source.get('fallback_layer_url')
            if not fallback: raise
            meta={'title':source.get('name'),'owner':'sem_es','access':'public'}
            service=fallback.rstrip('/')
        layer_url,layer=select_layer(service)
        oid=layer.get('objectIdField') or layer.get('objectIdFieldName') or 'OBJECTID'
        fc=fetch_all_geojson(layer_url,oid,layer.get('maxRecordCount',2000))
        if not fc.get('features'): raise RuntimeError('Official layer returned zero features')
        for f in fc['features']:
            f.setdefault('properties',{})['_official_item_id']=source['arcgis_item_id']
            f['properties']['_official_layer_url']=layer_url
        atomic_json(OUT,fc)
        report.update({'success':True,'item_title':meta.get('title'),'owner':meta.get('owner'),'access':meta.get('access'),'service_url':service,'layer_url':layer_url,'feature_count':len(fc['features']),'completed_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
        atomic_json(REPORT,report)
        print(json.dumps(report,indent=2))
    except Exception as e:
        report.update({'error':str(e),'completed_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
        atomic_json(REPORT,report)
        raise
if __name__=='__main__': main()
