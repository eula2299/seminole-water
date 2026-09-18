"""Bounded, read-only discovery of the EPA Water ICAT source contract."""
import json, pathlib, urllib.request, re
ROOT='https://www.arcgis.com/sharing/rest/content/items/'
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'IsMyWaterOK-Source-Contract/1'}),timeout=30) as response:
        raw=response.read(6_000_001)
        if len(raw)>6_000_000: raise ValueError('Source contract exceeds byte budget')
        return json.loads(raw)
def nodes(value):
    if isinstance(value,dict):
        yield value
        for v in value.values():yield from nodes(v)
    elif isinstance(value,list):
        for v in value:yield from nodes(v)
def main():
    report={'source':'https://www.epa.gov/waterfinancecenter/water-infrastructure-and-capacity-assessment-tool','items':{},'services':{}}
    app=get(ROOT+'6440cde018c540e08068234cc4f410e8/data?f=json')
    report['items']['6440cde018c540e08068234cc4f410e8']=app
    ids=sorted({n['itemId'] for n in nodes(app) if isinstance(n.get('itemId'),str) and re.fullmatch('[0-9a-f]{32}',n['itemId'])})[:12]
    for ident in ids:
        try:report['items'][ident]={'metadata':get(ROOT+ident+'?f=json'),'data':get(ROOT+ident+'/data?f=json')}
        except Exception as e:report['items'][ident]={'error':str(e)}
    urls=sorted({n['url'] for n in nodes(report['items']) if isinstance(n.get('url'),str) and re.match(r'https://[^/]+/(?:.*/)?(?:FeatureServer|MapServer)(?:/\d+)?$',n['url'])})[:20]
    for url in urls:
        try:report['services'][url]=get(url+'?f=json')
        except Exception as e:report['services'][url]={'error':str(e)}
    pathlib.Path('national-coverage-source-contract.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'item_ids':ids,'services':{u:{'name':d.get('name'),'layers':d.get('layers'),'tables':d.get('tables'),'fields':d.get('fields'),'error':d.get('error')} for u,d in report['services'].items()}},indent=2))
if __name__=='__main__':main()
