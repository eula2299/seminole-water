"""Retrospective utility-sampling benchmark; NEVER a household safety model.

Predeclared geographic and temporal holdout. Features use strictly earlier
sampling rounds at the same utility/facility/point/analyte/method/unit. The
endpoint is any reported PFOA/PFOS detection in the next observed sampling round,
not a concentration estimate, health-risk score, or prediction for an untested
home. The held-out archive is a retrospective snapshot, not a prospective trial.
"""
from __future__ import annotations
import csv, datetime as dt, hashlib, io, json, math, pathlib, re, tempfile, zipfile
from collections import Counter, defaultdict
from . import catalog

HOLDOUT_STATES=frozenset('AK AR CA CT FL IL ME MO NV NY OR TX WI'.split())
CUTOFF='2025-01-01'
FEATURES=['last_round_detected','prior_round_detection_rate','log_prior_rounds','last_round_log_mrl','is_pfos']
ANALYTES={'pfoa':'PFOA','perfluorooctanoicacid':'PFOA','perfluorooctanoicacidpfoa':'PFOA','pfos':'PFOS','perfluorooctanesulfonicacid':'PFOS','perfluorooctanesulfonicacidpfos':'PFOS'}

def key(x):return re.sub('[^a-z0-9]','',str(x).lower())
def date(value):
    for fmt in ('%m/%d/%Y','%Y-%m-%d'):
        try:return dt.datetime.strptime(value,fmt).date().isoformat()
        except ValueError:pass
    raise ValueError('Unsupported sample date')

def parse_record(raw,today):
    r={key(k):str(v or '').strip() for k,v in raw.items()}
    chemical=ANALYTES.get(key(r.get('contaminant','')))
    if not chemical:return None
    pws=r.get('pwsid','');facility=r.get('facilityid','');point=r.get('samplepointid','');sample=r.get('sampleid','');method=r.get('methodid') or r.get('analyticalmethod','')
    unit=r.get('units',r.get('unit','')).lower().replace('µ','u').replace('μ','u').replace(' ','')
    if not re.fullmatch('[A-Z]{2}\\d{7}',pws) or not all((facility,point,sample,method)) or unit not in ('ug/l','ng/l'):raise ValueError('Missing verified sampling identity or unit')
    when=date(r.get('collectiondate',r.get('samplecollectiondate','')))
    if not '2023-01-01'<=when<=today:raise ValueError('Sample date outside source cycle or in future')
    sign=(r.get('analyticalresultssign') or r.get('analyticalresultsign') or '=').upper();value=r.get('analyticalresultvalue','')
    mrl=float(r.get('mrl','nan'))
    if not math.isfinite(mrl) or mrl<=0:raise ValueError('Invalid reporting limit')
    if sign in ('<','<=','ND'):label=0
    elif sign=='=' and value and math.isfinite(float(value)) and float(value)>=0:label=int(float(value)>0)
    else:raise ValueError('Unverified result qualifier or value')
    return {'pwsid':pws,'state':pws[:2],'group':(pws,facility,point,chemical,method,unit),'sample':sample,'date':when,'label':label,'mrl':mrl,'chemical':chemical,'qualifier':sign,'value':value}

def transitions(records):
    days=defaultdict(dict)
    for r in records:
        rounds=days[r['group']];old=rounds.get(r['date'])
        if old is None:rounds[r['date']]={**r}
        else:old['label']=max(old['label'],r['label']);old['mrl']=max(old['mrl'],r['mrl'])
    rows=[]
    for group,rounds in sorted(days.items()):
        prior=[]
        for when,r in sorted(rounds.items()):
            if prior:
                last=prior[-1]
                x=[last['label'],sum(v['label'] for v in prior)/len(prior),math.log1p(len(prior)),math.log(last['mrl']),int(r['chemical']=='PFOS')]
                rows.append({'pwsid':r['pwsid'],'state':r['state'],'date':when,'feature_last_date':last['date'],'x':x,'y':r['label'],'chemical':r['chemical']})
            prior.append(r)
    return rows

def split(rows):
    train=[r for r in rows if r['state'] not in HOLDOUT_STATES and r['date']<CUTOFF]
    test=[r for r in rows if r['state'] in HOLDOUT_STATES and r['date']>=CUTOFF]
    if {r['pwsid'] for r in train}&{r['pwsid'] for r in test}:raise ValueError('Utility leakage across split')
    if any(r['feature_last_date']>=r['date'] for r in train+test):raise ValueError('Future or simultaneous feature leakage')
    return train,test

def metrics(y,p):
    import numpy as np
    from sklearn.metrics import roc_auc_score,average_precision_score,precision_score,recall_score
    ece=0.;bins=[]
    for lower in np.linspace(0,.9,10):
        mask=(p>=lower)&(p<(lower+.1) if lower<.89 else p<=1)
        if not mask.any():continue
        actual=float(y[mask].mean());predicted=float(p[mask].mean());n=int(mask.sum());ece+=n/len(y)*abs(actual-predicted)
        bins.append({'count':n,'mean_probability':predicted,'observed_fraction':actual})
    return {'brier_score':float(np.mean((p-y)**2)),'roc_auc':float(roc_auc_score(y,p)) if len(set(y))==2 else None,'average_precision':float(average_precision_score(y,p)) if y.sum() else None,'precision_at_0_5':float(precision_score(y,p>=.5,zero_division=0)),'recall_at_0_5':float(recall_score(y,p>=.5,zero_division=0)),'expected_calibration_error_10_bins':ece,'calibration_bins':bins}

def evaluate(rows):
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    train,test=split(rows)
    if len(train)<1000 or len(test)<1000 or len({r['state'] for r in test})<5:raise ValueError('Insufficient held-out data; no model validation result')
    x=np.asarray([r['x'] for r in train]);y=np.asarray([r['y'] for r in train]);xt=np.asarray([r['x'] for r in test]);yt=np.asarray([r['y'] for r in test])
    if len(set(y))<2 or len(set(yt))<2:raise ValueError('Both detection classes required in train and holdout')
    model=make_pipeline(StandardScaler(),LogisticRegression(C=1,max_iter=1000,random_state=20260918))
    model.fit(x,y);p=model.predict_proba(xt)[:,1]
    baselines={'training_prevalence':np.full(len(test),float(y.mean())),'last_observed_round':xt[:,0],'prior_round_average':xt[:,1]}
    scores={name:metrics(yt,probs) for name,probs in baselines.items()}
    # Resample utility clusters, not nominally independent analyte/date rows.
    utilities=sorted({r['pwsid'] for r in test});indexes={u:i for i,u in enumerate(utilities)};groups=np.asarray([indexes[r['pwsid']] for r in test]);counts=np.bincount(groups)
    model_sums=np.bincount(groups,weights=(p-yt)**2);base_sums=np.bincount(groups,weights=(baselines['last_observed_round']-yt)**2);rng=np.random.default_rng(20260918);improvements=[]
    for _ in range(200):
        selected=rng.integers(0,len(utilities),len(utilities));improvements.append(float((base_sums[selected]-model_sums[selected]).sum()/counts[selected].sum()))
    scaler,estimator=model.steps[0][1],model.steps[1][1]
    def cohort(values):return {'transitions':len(values),'utilities':len({r['pwsid'] for r in values}),'states':sorted({r['state'] for r in values}),'first_target_date':min(r['date'] for r in values),'last_target_date':max(r['date'] for r in values),'detection_fraction':sum(r['y'] for r in values)/len(values)}
    return {'status':'retrospective-evaluation-completed','endpoint':'PFOA/PFOS reported detection in the next observed sampling round at the same utility sampling point','unit_of_analysis':'point/analyte/method/unit sampling-round transition; not independent households','split':{'holdout_states':sorted(HOLDOUT_STATES),'target_date_cutoff':CUTOFF,'train':cohort(train),'held_out':cohort(test),'overlapping_utilities':0},'features':FEATURES,'algorithm':'fixed C=1 standardized logistic regression; no holdout tuning','model_metrics':metrics(yt,p),'baseline_metrics':scores,'utility_cluster_bootstrap':{'replicates':200,'brier_improvement_vs_last_round_95_percent_interval':np.quantile(improvements,[.025,.975]).tolist()},'fitted_parameters':{'mean':scaler.mean_.tolist(),'scale':scaler.scale_.tolist(),'coefficients':estimator.coef_[0].tolist(),'intercept':float(estimator.intercept_[0])},'production_household_inference_enabled':False,'nationally_validated_household_models':0,'limitations':['Retrospective evaluation, not prospective external validation.','Only repeated PFOA/PFOS sampling at previously observed utility sampling points.','Not suitable for untested households, private wells, health risk, or concentration forecasts.','Reporting limits and monitoring selection can affect the detection endpoint.','Record corrections were available in the final archive; historical as-of availability was not reconstructed.'],'prespecified_design_version':'utility-next-round-v1'}

def main():
    import platform, sklearn, numpy
    with catalog._open_epa(catalog.PAGES['ucmr'],30) as response:
        html=b''.join(catalog._bounded_chunks(response,3000000,'Page budget exceeded')).decode('utf8')
    links=catalog.Links();links.feed(html)
    urls=sorted({catalog.approved(catalog.urllib.parse.urljoin(catalog.PAGES['ucmr'],link)) for link in links.links if re.search(r'/ucmr5-occurrence-data\.zip$',link,re.I)})
    if len(urls)!=1:raise ValueError('Ambiguous official whole-cycle archive')
    stats=Counter();records=[];seen={};today=str(dt.date.today())
    with tempfile.TemporaryDirectory() as td:
        source=pathlib.Path(td)/'ucmr5.zip';receipt=catalog.download(urls[0],source,150000000)
        with zipfile.ZipFile(source) as archive:
            members=[m for m in archive.infolist() if re.search(r'(^|/)UCMR5_All\.txt$',m.filename,re.I)]
            if len(members)!=1 or members[0].file_size>1000000000:raise ValueError('Unverified all-results member')
            with archive.open(members[0]) as raw:
                reader=csv.DictReader(io.TextIOWrapper(raw,encoding='cp1252',newline=''),delimiter='\t')
                for row in reader:
                    stats['source_rows_read']+=1
                    if None in row or any(v is None for v in row.values()):raise ValueError('Malformed official source row')
                    try:r=parse_record(row,today)
                    except ValueError:stats['excluded_unverified_target_rows']+=1;continue
                    if r is None:continue
                    ident=(*r['group'],r['sample'],r['date']);signature=(r['label'],r['mrl'],r['qualifier'],r['value'])
                    if ident in seen:
                        if seen[ident]!=signature:raise ValueError('Conflicting official sample identity')
                        stats['exact_identity_duplicates']+=1;continue
                    seen[ident]=signature;records.append(r)
        stats['eligible_target_result_rows']=len(records);rows=transitions(records);stats['sampling_round_transitions']=len(rows)
        report=evaluate(rows);report.update(source={'url':urls[0],'documentation':catalog.PAGES['ucmr'],'member':members[0].filename,**receipt},acquisition_counts=dict(stats),evaluated_at=dt.datetime.now(dt.timezone.utc).isoformat(),runtime_versions={'python':platform.python_version(),'numpy':numpy.__version__,'scikit_learn':sklearn.__version__})
        report['feature_rows_sha256']=hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        pathlib.Path('national-prediction-benchmark.json').write_text(json.dumps(report,indent=2,allow_nan=False))
        print(json.dumps({k:v for k,v in report.items() if k not in ('fitted_parameters',)},indent=2,allow_nan=False))
if __name__=='__main__':main()
