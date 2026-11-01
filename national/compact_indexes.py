"""Lossless, bounded WQP index compaction. Dry-run unless --apply is explicit.

No record, object key or receipt is removed. Compression can be reversed by
reading through Store.get and writing those identical decoded bytes back.
"""
import argparse,gzip,json,pathlib,tempfile
from .warehouse import Store,digest

def candidates(store):
    head=store.json('wqp/v1/checkpoint-head.json')
    if not head or head.get('schema')!='wqp-durable/1' or head.get('key') not in ('wqp/v1/checkpoint-a.gz','wqp/v1/checkpoint-b.gz') or head.get('bytes',20000001)>20000000:
        raise ValueError('Invalid published WQP checkpoint')
    with tempfile.TemporaryDirectory() as directory:
        p=pathlib.Path(directory)/'checkpoint.gz';store.get(head['key'],p,head['sha256'])
        with gzip.open(p,'rb') as f:raw=f.read(100000001)
        if len(raw)>100000000:raise ValueError('Checkpoint exceeds limit')
        data=json.loads(raw)
    result={}
    for job in data.get('jobs',{}).values():
        if job.get('status')!='complete':continue
        item=(job.get('manifest') or {}).get('index',{})
        if store.is_compactable_index(item.get('key','')) and 0<item.get('bytes',0)<=64000000:
            previous=result.get(item['key'])
            if previous and previous['sha256']!=item['sha256']:raise ValueError('Conflicting published index hashes')
            result[item['key']]=item
    return sorted(result.values(),key=lambda item:item['bytes'],reverse=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');parser.add_argument('--limit',type=int,default=10)
    args=parser.parse_args()
    if not 1<=args.limit<=200:parser.error('limit must be 1–200')
    store=Store()
    if store.provider!='railway':raise ValueError('Compaction requires the verified non-versioned Railway store')
    items=candidates(store);print(json.dumps({'event':'compaction-plan','published_indexes':len(items),'limit':args.limit,'apply':args.apply}),flush=True)
    changed=0;saved=0
    for item in items:
        head=store.client.head_object(Bucket=store.bucket,Key=item['key'])
        if head.get('Metadata',{}).get('water-storage-codec')=='gzip-v1':continue
        if not args.apply:
            print(json.dumps({'key':item['key'],'decoded_bytes':item['bytes'],'sha256':item['sha256']}),flush=True)
        else:
            reclaimed=store.compact_index(item['key'],item['sha256']);saved+=reclaimed
            print(json.dumps({'event':'index-compacted','key':item['key'],'bytes_reclaimed':reclaimed,'decoded_sha256':item['sha256']}),flush=True)
        changed+=1
        if changed>=args.limit:break
    print(json.dumps({'event':'compaction-finished','processed':changed,'bytes_reclaimed':saved,'inventory':store.inventory() if args.apply else None}),flush=True)
if __name__=='__main__':main()
