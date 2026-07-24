'use strict';

const EARTH_RADIUS_M=6371008.8;

function clamp(x,min=0,max=1){return Math.max(min,Math.min(max,Number(x)||0));}

function offsetCoordinate(lat,lon,eastMeters,northMeters){
  const dLat=(northMeters/EARTH_RADIUS_M)*(180/Math.PI);
  const cos=Math.max(1e-9,Math.cos(Number(lat)*Math.PI/180));
  const dLon=(eastMeters/(EARTH_RADIUS_M*cos))*(180/Math.PI);
  return {lat:Number(lat)+dLat,lon:Number(lon)+dLon};
}

function perturbationGrid(lat,lon,{radiiMeters=[5,15,30],bearings=8,includeCenter=true}={}){
  const points=[];
  if(includeCenter)points.push({lat:Number(lat),lon:Number(lon),radius_m:0,bearing_deg:null,label:'center'});
  for(const radius of radiiMeters){
    for(let i=0;i<bearings;i++){
      const theta=(2*Math.PI*i)/bearings;
      const east=radius*Math.sin(theta),north=radius*Math.cos(theta);
      points.push({...offsetCoordinate(lat,lon,east,north),radius_m:radius,bearing_deg:Math.round(i*360/bearings),label:`${radius}m@${Math.round(i*360/bearings)}°`});
    }
  }
  return points;
}

function summarizeRing(samples,radius){
  const ring=samples.filter(x=>x.radius_m===radius);
  const ids=ring.map(x=>x.pwsid||null);
  const nonNull=ids.filter(Boolean);
  const unique=[...new Set(nonNull)];
  return {
    radius_m:radius,
    samples:ring.length,
    resolved:ring.filter(x=>x.resolved).length,
    pwsids:unique,
    unanimous:ring.length>0&&nonNull.length===ring.length&&unique.length===1,
    unresolved:ring.filter(x=>!x.resolved).length
  };
}

function assessProviderStability({lat,lon,basePwsid=null,resolveAtPoint,radiiMeters=[5,15,30],bearings=8}={}){
  if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon))||typeof resolveAtPoint!=='function'){
    return {status:'not-computed',reason:'valid coordinates and a resolver callback are required',samples:[],rings:[],stable_fraction:0,max_unanimous_radius_m:0,alternate_pwsids:[]};
  }
  const grid=perturbationGrid(lat,lon,{radiiMeters,bearings,includeCenter:true});
  const samples=grid.map(point=>{
    try{
      const out=resolveAtPoint(point.lon,point.lat)||{};
      return {...point,resolved:!!out.pwsid,pwsid:out.pwsid||null,provider:out.provider||null,confidence:out.confidence||null,reason:out.reason||null};
    }catch(error){
      return {...point,resolved:false,pwsid:null,error:error.message};
    }
  });
  const center=samples.find(x=>x.radius_m===0);
  const reference=basePwsid||center?.pwsid||null;
  const comparable=samples.filter(x=>x.radius_m>0);
  const agreeing=comparable.filter(x=>reference&&x.pwsid===reference).length;
  const stableFraction=comparable.length?agreeing/comparable.length:0;
  const rings=radiiMeters.map(r=>summarizeRing(samples,r));
  let maxUnanimous=0;
  for(const ring of rings){
    if(ring.unanimous&&ring.pwsids[0]===reference)maxUnanimous=ring.radius_m;
    else break;
  }
  const alternates=[...new Set(samples.map(x=>x.pwsid).filter(x=>x&&x!==reference))];
  const unresolvedFraction=comparable.length?comparable.filter(x=>!x.resolved).length/comparable.length:1;
  let status='unstable';
  if(reference&&stableFraction>=.95&&unresolvedFraction===0)status='stable';
  else if(reference&&stableFraction>=.75)status='boundary-sensitive';
  else if(reference&&stableFraction>=.5)status='fragile';
  const score=clamp(stableFraction*(1-.5*unresolvedFraction));
  return {
    status,
    reference_pwsid:reference,
    stable_fraction:Number(stableFraction.toFixed(4)),
    stability_score:Number(score.toFixed(4)),
    unresolved_fraction:Number(unresolvedFraction.toFixed(4)),
    max_unanimous_radius_m:maxUnanimous,
    alternate_pwsids:alternates,
    samples,
    rings,
    interpretation:status==='stable'
      ?`The same PWS was returned for at least 95% of coordinate perturbations through ${Math.max(...radiiMeters)} m.`
      :status==='boundary-sensitive'
        ?'Most perturbations keep the same PWS, but nearby coordinate uncertainty can change or remove the assignment.'
        :'The provider assignment is sensitive to small coordinate changes and should not be treated as robust without additional utility confirmation.'
  };
}

module.exports={offsetCoordinate,perturbationGrid,assessProviderStability};
