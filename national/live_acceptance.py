"""Read-only production checks using a public utility ID, never a home address."""
import datetime,json,pathlib,urllib.request
BASE='https://www.ismywaterok.com'
def read(path,data=None):
    headers={'User-Agent':'IsMyWaterOK-Release-Verification/2','Accept':'application/json'}
    body=None
    if data is not None:headers['Content-Type']='application/json';body=json.dumps(data).encode()
    req=urllib.request.Request(BASE+path,data=body,headers=headers)
    with urllib.request.urlopen(req,timeout=55) as response:
        raw=response.read(8000001)
        if len(raw)>8000000:raise ValueError('Production verification exceeded byte budget')
        return json.loads(raw)
def main():
    health=read('/healthz');status=read('/api/national/status')
    report=read('/api/national/lookup',{'pwsid':'NY7003493','state':'NY','supply_type':'public','include_environment':False})
    inventory=report.get('utility_service_lines',{});resident=report.get('resident_report',{});archive=status.get('historical_archive',{});environment=archive.get('environmental_archive',{})
    checks={'process_up':health.get('process')=='up','inventory_live':inventory.get('status')=='records-returned','exact_utility':len(inventory.get('records',[]))==1 and inventory['records'][0]['pwsid']=='NY7003493','next_step_visible':any('service-line records' in a.get('title','') for a in resident.get('actions',[])),'no_household_assertion':resident.get('household_safety')=='not-determined','retry_policy_live':environment.get('retry_policy','').startswith('one-in-four-slots')}
    result={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks,'health':health,'status':status,'public_utility_report':report}
    pathlib.Path('national-live-acceptance.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'checks':checks,'health':health,'environmental_archive':environment,'inventory':inventory},indent=2))
    if not all(checks.values()):raise ValueError('A deployed acceptance check failed')
if __name__=='__main__':main()
