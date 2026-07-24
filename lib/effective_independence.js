'use strict';
function effectiveN(records,{originKey=r=>r.origin_sample_key||r.sample_id||r.record_fingerprint,publisherKey=r=>r.source_family||r.source_id||'UNKNOWN'}={}){
 const origins=new Map();for(const r of records){const o=originKey(r);if(!origins.has(o))origins.set(o,new Set());origins.get(o).add(publisherKey(r))}
 const raw=records.length,unique=origins.size,replicas=raw-unique;
 return {raw_record_count:raw,unique_originating_samples:unique,publisher_replica_count:replicas,effective_n:unique,replication_factor:unique?raw/unique:null,confidence_multiplier:raw?Math.sqrt(unique/raw):0};
}
function correlatedEffectiveN(clusterSizes,intraclassCorrelation=.5){let n=0,den=0;for(const m of clusterSizes){n+=m;den+=m*(1+(m-1)*intraclassCorrelation)}return n? n*n/den:0}
module.exports={effectiveN,correlatedEffectiveN};
