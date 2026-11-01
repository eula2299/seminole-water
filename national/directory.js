'use strict';
const {validPwsid,REGION_CODES}=require('./evidence');
const {normalize}=require('./normalization');

// Current directory details can be served from the same verified official ZIP
// already retained by the archive. PostgreSQL observations/history are retained.
function createDirectory({baseUrl=process.env.NATIONAL_ARCHIVE_URL,fetchImpl=fetch}={}){
 if(!baseUrl)return null;
 const base=new URL(baseUrl);
 if(base.username||base.password||base.search||base.hash||!['http:','https:'].includes(base.protocol))throw Error('Invalid directory URL');
 if(base.protocol==='http:'&&!base.hostname.endsWith('.railway.internal')&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('Directory HTTP requires private network');
 async function get(path,{allowTruncated=false}={}){
  const response=await fetchImpl(new URL(path,base),{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});
  if(!response.ok){await response.body?.cancel();throw Error('DIRECTORY_UNAVAILABLE');}
  const reader=response.body.getReader();let bytes=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1000000)throw Error('DIRECTORY_TOO_LARGE');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(data.schema!=='sdwis-directory/1'||!['records-returned','no-matching-records'].includes(data.status)||!Array.isArray(data.records)||data.records.length>100||(!allowTruncated&&data.truncated===true)||data.source?.url!=='https://echo.epa.gov/files/echodownloads/SDWA_latest_downloads.zip'||!(/^[a-f0-9]{64}$/i).test(data.source?.sha256||'')||!Number.isFinite(Date.parse(data.source?.retrieved_at))||(data.status==='no-matching-records'&&data.records.length))throw Error('DIRECTORY_NOT_VERIFIED');
  const rows=data.records.map(raw=>normalize('sdwis','system',raw).data),seen=new Map();
  for(const row of rows){if(seen.has(row.pwsid)&&seen.get(row.pwsid).raw_sha256!==row.raw_sha256)throw Error('DIRECTORY_AMBIGUOUS');seen.set(row.pwsid,row);}
  return {rows:[...seen.values()],source:data.source};
 }
 return {
  async lookupSystem(pwsid){
   if(!validPwsid(pwsid))throw Error('Invalid directory PWSID');
   const result=await get('/directory/system/'+pwsid);
   if(result.rows.some(r=>r.pwsid!==pwsid)||result.rows.length>1)throw Error('DIRECTORY_IDENTITY');
   return {...result,system:result.rows[0]||null};
  },
  async searchSystems({state='',query='',city='',zip='',limit=20,local=false}={}){
   if(state&&!REGION_CODES.includes(state))throw Error('Invalid directory state');
   const result=await get('/directory/search?'+new URLSearchParams({state,query:String(query).slice(0,100),city:String(city).slice(0,100),zip:/^\d{5}(?:-\d{4})?$/.test(String(zip))?String(zip).slice(0,5):'',limit:String(Math.max(1,Math.min(50,Number(limit)||20))),local:String(local)}),{allowTruncated:true});
   if(result.rows.some(r=>state&&r.state!==state))throw Error('DIRECTORY_STATE');
   if(local&&result.rows.some(r=>!r.active||r.system_type!=='CWS'||(!r.pwsid.startsWith(state)&&!/^\d{2}/.test(r.pwsid))||!(city&&r.city?.trim().toUpperCase()===city.trim().toUpperCase()||/^\d{5}/.test(zip)&&r.zip?.slice(0,5)===zip.slice(0,5))))throw Error('DIRECTORY_LOCALITY');
   return result;
  }
 };
}
function withArchiveDirectory(warehouse,directory){
 if(!directory)return warehouse;
 return {...warehouse,
  async lookupSystem(pwsid,options){
   const [legacy,current]=await Promise.allSettled([warehouse.lookupSystem(pwsid,options),directory.lookupSystem(pwsid)]);
   if(current.status==='fulfilled'){
    const base=legacy.status==='fulfilled'?legacy.value:{pwsid,status:'records-returned',observations:[],violations:[],observation_summary:[],counts:{},sources:[]};
    return {...base,status:current.value.system?'records-returned':base.status,system:current.value.system,counts:{...base.counts,system:current.value.system?'1':'0'},directory_source:current.value.source,directory_status:'archive-verified',observation_status:legacy.status==='fulfilled'?base.status:'unavailable'};
   }
   if(legacy.status==='rejected')throw legacy.reason;
   return {...legacy.value,directory_status:'retained-database'};
  },
  async searchSystems(options){try{return (await directory.searchSystems(options)).rows;}catch{return warehouse.searchSystems(options);}},
  async findLocalSystems(options){try{return (await directory.searchSystems({...options,limit:50,local:true})).rows;}catch{return warehouse.findLocalSystems(options);}}
 };
}
module.exports={createDirectory,withArchiveDirectory};
