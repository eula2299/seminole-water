'use strict';
function origins(c){return [...new Set((c.origin_keys&&c.origin_keys.length?c.origin_keys:[c.id]).filter(Boolean))];}
function contradictoryGroups(claims=[]){
  const groups=new Map();
  for(const c of claims){const key=`${c.topic}::${c.proposition}`;(groups.get(key)||groups.set(key,[]).get(key)).push(c);}
  return [...groups.entries()].map(([key,list])=>({key,list,support:list.filter(x=>x.stance!=='oppose'),oppose:list.filter(x=>x.stance==='oppose')})).filter(x=>x.support.length&&x.oppose.length);
}
function combinations(arr,k,start=0,prefix=[],out=[]){
  if(prefix.length===k){out.push(prefix.slice());return out;}
  for(let i=start;i<arr.length;i++)combinations(arr,k,i+1,[...prefix,arr[i]],out);
  return out;
}
function groupResolvedAfterRemoval(group,removed){
  const left=group.list.filter(c=>origins(c).every(o=>!removed.has(o)));
  return !(left.some(x=>x.stance!=='oppose')&&left.some(x=>x.stance==='oppose'));
}
function findMinimumContradictionCutsets(claims=[],{maxCutSize=3,maxSets=20}={}){
  const groups=contradictoryGroups(claims);
  const allOrigins=[...new Set(groups.flatMap(g=>g.list.flatMap(origins)))];
  if(!groups.length)return {status:'no-explicit-claim-contradictions',groups:[],minimum_cut_size:0,cutsets:[]};
  const cutsets=[];let min=null;
  for(let k=1;k<=Math.min(maxCutSize,allOrigins.length);k++){
    for(const combo of combinations(allOrigins,k)){
      const removed=new Set(combo);
      if(groups.every(g=>groupResolvedAfterRemoval(g,removed))){cutsets.push(combo);if(cutsets.length>=maxSets)break;}
    }
    if(cutsets.length){min=k;break;}
  }
  const unresolved=min===null;
  return {
    status:unresolved?'cutset-exceeds-search-limit':'computed',
    method:'Origin-Level Minimum Contradiction Cut-Set Search v1.0',
    contradictory_group_count:groups.length,
    groups:groups.map(g=>({key:g.key,support_agents:g.support.map(x=>x.agent),oppose_agents:g.oppose.map(x=>x.agent),origins:[...new Set(g.list.flatMap(origins))]})),
    minimum_cut_size:min,
    cutsets:cutsets.map(x=>({remove_origins:x,removal_count:x.length})),
    interpretation:unresolved?'No contradiction-resolving origin cut set was found within the configured search size.':'The listed smallest origin sets are sufficient to eliminate every explicit support/opposition conflict; they identify the evidence units that dominate disagreement, not evidence that should automatically be discarded.'
  };
}
module.exports={findMinimumContradictionCutsets,contradictoryGroups};
