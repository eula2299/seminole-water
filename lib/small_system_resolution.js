'use strict';
function normalize(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim()}
function resolveSmallSystem({address,parcel={},pwsFacilities=[],serviceAreas=[],masterMeters=[],aliases=[]}){
 const clues=[]; const addr=normalize(address),name=normalize(parcel.property_name||parcel.subdivision||parcel.mobile_home_park);
 for(const f of pwsFacilities){let score=0;const reasons=[];if(f.address&&addr===normalize(f.address)){score+=100;reasons.push('exact facility address')};if(name&&normalize(f.name).includes(name)){score+=45;reasons.push('parcel/property name match')};if(parcel.parcel_id&&f.parcel_id===parcel.parcel_id){score+=100;reasons.push('exact parcel id')};if(f.system_type&&/NON.?COMMUNITY|TRANSIENT|MOBILE|MASTER/i.test(f.system_type)){score+=10;reasons.push('small-system type')};if(score)clues.push({pwsid:f.pwsid,score,reasons,kind:'facility'})}
 for(const m of masterMeters){if((m.parcel_id&&m.parcel_id===parcel.parcel_id)||(m.address&&normalize(m.address)===addr))clues.push({pwsid:m.downstream_pwsid||m.retail_pwsid,score:95,reasons:['master-meter registry match'],kind:'master-meter',upstream_pwsid:m.upstream_pwsid})}
 const grouped=new Map();for(const c of clues){if(!grouped.has(c.pwsid))grouped.set(c.pwsid,{pwsid:c.pwsid,score:0,reasons:[],evidence:[]});const g=grouped.get(c.pwsid);g.score+=c.score;g.reasons.push(...c.reasons);g.evidence.push(c)}
 const ranked=[...grouped.values()].sort((a,b)=>b.score-a.score);const winner=ranked[0];const tie=winner&&ranked[1]&&winner.score-ranked[1].score<20;
 return {accepted:Boolean(winner&&!tie&&winner.score>=70),pwsid:winner&&!tie?winner.pwsid:null,confidence:!winner?'none':tie?'ambiguous':winner.score>=100?'high':'medium',candidates:ranked,master_metered:Boolean(winner?.evidence.some(e=>e.kind==='master-meter')),requires_manual_review:Boolean(tie||!winner||winner.score<70)};
}
module.exports={resolveSmallSystem};
