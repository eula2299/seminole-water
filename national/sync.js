'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {createWarehouse}=require('./warehouse');
const {normalize}=require('./normalization');
const SOURCES=Object.freeze({
 ucmr5:{page:'https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule',url:'https://www.epa.gov/system/files/other-files/2023-08/ucmr5-occurrence-data.zip',maxBytes:150000000,required:['observation']},
 sdwis:{page:'https://echo.epa.gov/tools/data-downloads/sdwa-download-summary',url:'https://echo.epa.gov/files/echodownloads/SDWA_latest_downloads.zip',maxBytes:750000000,required:['system']},
 'sdwis-violations':{page:'https://echo.epa.gov/tools/data-downloads/sdwa-download-summary',url:'https://echo.epa.gov/files/echodownloads/SDWA_latest_downloads.zip',maxBytes:750000000,required:['violation']}
});
function approved(value){const u=new URL(value);if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||!['www.epa.gov','echo.epa.gov'].includes(u.hostname))throw new Error('UNAPPROVED_DOWNLOAD_URL');return u;}
async function request(url,options={},fetchImpl=fetch){
 let u=approved(url);
 for(let n=0;n<4;n++){
  const response=await fetchImpl(u,{...options,redirect:'manual',signal:options.signal||AbortSignal.timeout(1200000),headers:{'User-Agent':'IsMyWaterOK-NationalImport/1.0',...options.headers}});
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();u=approved(new URL(next,u).href);continue;}
  if(!response.ok){await response.body?.cancel();if([429,500,502,503,504].includes(response.status)&&n<3){await new Promise(resolve=>setTimeout(resolve,Math.min(4000,500*2**n)));continue;}throw new Error('SOURCE_HTTP_'+response.status);}
  return response;
 }
 throw new Error('TOO_MANY_SOURCE_REDIRECTS');
}
async function discoverUcmr(fetchImpl=fetch){
 const response=await request(SOURCES.ucmr5.page,{signal:AbortSignal.timeout(30000)},fetchImpl);
 const reader=response.body.getReader();let size=0,chunks=[];
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2000000)throw new Error('SOURCE_PAGE_TOO_LARGE');chunks.push(Buffer.from(part.value));}}finally{await reader.cancel().catch(()=>{});}
 const html=Buffer.concat(chunks).toString('utf8');
 const urls=[...html.matchAll(/href=["']([^"']*ucmr5-occurrence-data\.zip(?:\?[^"']*)?)["']/gi)].map(m=>approved(new URL(m[1].replace(/&amp;/g,'&'),SOURCES.ucmr5.page).href).href);
 if(!urls.length)throw new Error('UCMR5_DOWNLOAD_LINK_NOT_FOUND');
 // Only whole-cycle archives, never alternate by-state/by-method copies of the same samples.
 return [...new Set(urls)].sort().at(-1);
}
async function download(url,destination,{maxBytes,fetchImpl=fetch,log=()=>{}}={}){
 const head=await request(url,{method:'HEAD',signal:AbortSignal.timeout(30000)},fetchImpl);
 const declared=Number(head.headers.get('content-length'))||null;
 if(declared&&declared>maxBytes)throw new Error('SOURCE_EXCEEDS_DOWNLOAD_BUDGET');
 log({event:'download-start',url,declared_bytes:declared,max_bytes:maxBytes,source_modified:head.headers.get('last-modified')});
 const response=await request(url,{},fetchImpl),hash=createHash('sha256');let bytes=0;
 const meter=new Transform({transform(chunk,encoding,cb){bytes+=chunk.length;if(bytes>maxBytes)return cb(new Error('SOURCE_EXCEEDS_DOWNLOAD_BUDGET'));hash.update(chunk);cb(null,chunk);}});
 await pipeline(Readable.fromWeb(response.body),meter,fs.createWriteStream(destination,{flags:'wx',mode:0o600}));
 if(bytes<4)throw new Error('EMPTY_DOWNLOAD');
 return {bytes,sha256:hash.digest('hex'),modified:response.headers.get('last-modified')||head.headers.get('last-modified')};
}
async function fileMetadata(file){const hash=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(file)){bytes+=chunk.length;hash.update(chunk);}return {bytes,sha256:hash.digest('hex'),modified:null};}
async function importArchive(file,source,job,{url=SOURCES[source]?.url,batchSize=500,log=()=>{},python=process.env.PYTHON||'python3',maxRows=15000000}={}){
 if(!SOURCES[source])throw new Error('UNKNOWN_SOURCE');
 const child=spawn(python,[path.join(__dirname,'stream_archive.py'),file,source],{stdio:['ignore','pipe','pipe']});
 let errorText='',complete=false,sourceRows=0,batch=[],batchBytes=0;const kinds=new Set();
 child.stderr.on('data',b=>{if(errorText.length<2000)errorText+=b.toString().slice(0,2000-errorText.length);});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('ARCHIVE_PARSE_FAILED: '+errorText.slice(-500))));});
 // Attach rejection handler immediately while stdout is drained with backpressure.
 exited.catch(()=>{});
 const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
 const flush=async()=>{if(batch.length){await job.batch(batch);batch=[];batchBytes=0;}};
 try{
  for await(const line of lines){
   if(line.length>1000000)throw new Error('SOURCE_ROW_TOO_LARGE');
   const message=JSON.parse(line);
   if(message.type==='complete'){complete=true;continue;}
   if(message.type==='member'){kinds.add(message.kind);log({event:'parse-member',source,member:message.member,kind:message.kind});continue;}
   if(message.type!=='row')throw new Error('INVALID_READER_MESSAGE');
   sourceRows++;if(sourceRows>maxRows)throw new Error('SOURCE_EXCEEDS_ROW_BUDGET');
   const record=normalize(source,message.kind,message.row,{member:message.member,source_url:url});
   batch.push(record);batchBytes+=line.length;
   if(batch.length>=batchSize||batchBytes>2000000)await flush();
   if(sourceRows%50000===0)log({event:'import-progress',source,source_rows:sourceRows});
  }
  await exited;
  if(!complete||!SOURCES[source].required.every(k=>kinds.has(k)))throw new Error('SOURCE_SCHEMA_INCOMPLETE');
  if(!sourceRows)throw new Error('EMPTY_SOURCE_IMPORT');
  await flush();return {source_rows:sourceRows,kinds:[...kinds]};
 }catch(e){child.kill('SIGTERM');await exited.catch(()=>{});throw e;}finally{lines.close();}
}
async function syncSource(source,{warehouse,fetchImpl=fetch,inputFile,sourceUrl,force=false,freshnessMs=7*86400000,log=console.log}={}){
 if(!SOURCES[source])throw new Error('UNKNOWN_SOURCE');
 const own=!warehouse;if(own)warehouse=createWarehouse();
 let job,temp;
 try{
  if(!force&&!inputFile){
   const status=await warehouse.status();const active=status.sources.find(s=>s.source===source);
   if(active?.run_id&&Date.now()-new Date(active.checked_at||active.completed_at).getTime()<freshnessMs)return {source,status:'fresh',run_id:active.run_id};
   // A persisted capacity failure must not redownload the same national ZIP
   // every hour or restart while the database still has no import capacity.
   if(active?.latest_attempt?.error_code==='DATABASE_STORAGE_BUDGET_EXCEEDED'){
    const capacity=await warehouse.importCapacity();
    if(!capacity.can_import){const result={source,status:'storage-paused',...capacity};log({event:'source-capacity-paused',...result});return result;}
   }
  }
  // Lock is acquired before network work to avoid duplicate downloads across web replicas.
  const initialUrl=sourceUrl||SOURCES[source].url;
  job=await warehouse.beginImport(source,initialUrl);
  if(!job)return {source,status:'already-running'};
  const url=sourceUrl||(!inputFile&&source==='ucmr5'?await discoverUcmr(fetchImpl):initialUrl);
  let file=inputFile,meta;
  if(file)meta=await fileMetadata(file);
  else {temp=await fsp.mkdtemp(path.join(os.tmpdir(),'national-water-'));file=path.join(temp,'source.zip');meta=await download(url,file,{maxBytes:SOURCES[source].maxBytes,fetchImpl,log});}
  await job.metadata({...meta,url});
  if(await job.activeHash()===meta.sha256){await job.unchanged();log({event:'source-unchanged',source,sha256:meta.sha256});return {source,status:'unchanged',...meta};}
  const imported=await importArchive(file,source,job,{url,log});
  await job.publish();log({event:'source-published',source,...imported,...meta});
  return {source,status:'published',...imported,...meta};
 }catch(e){await job?.fail(e.code||String(e.message).split(':')[0]).catch(()=>{});throw e;}
 finally{if(temp)await fsp.rm(temp,{recursive:true,force:true});if(own)await warehouse.close();}
}
function startBackgroundSync({warehouse=createWarehouse(),log=event=>console.log('[national-sync]',JSON.stringify(event)),intervalMs=7*86400000}={}){
 let running=false,stopped=false;
 async function tick(){
  if(running||stopped)return;running=true;
  try{
   const status=await warehouse.status();
   if(status.status==='not-connected'){log({event:'not-configured'});return;}
   for(const source of ['ucmr5','sdwis','sdwis-violations']){
    if(stopped)break;
    const existing=status.sources.find(s=>s.source===source);
    if(existing?.run_id&&Date.now()-new Date(existing.checked_at||existing.completed_at).getTime()<intervalMs)continue;
    try{await syncSource(source,{warehouse,log});}catch(e){log({event:'sync-failed',source,error_code:e.code||String(e.message).split(':')[0]});}
   }
  }catch(e){log({event:'warehouse-unavailable',error_code:e.code||'DATABASE_UNAVAILABLE'});}finally{running=false;}
 }
 const first=setTimeout(tick,2000);first.unref();const timer=setInterval(tick,Math.max(60000,Math.min(intervalMs,3600000)));timer.unref();
 return {run:tick,stop(){stopped=true;clearTimeout(first);clearInterval(timer);}};
}
if(require.main===module){
 const args=process.argv.slice(2);const val=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
 if(args.includes('--help')){console.log('node national/sync.js --source ucmr5|sdwis|sdwis-violations|all [--input-file official.zip]\nRequires DATABASE_URL. Imports complete verified snapshots; failed/partial imports are never served.');}
 else (async()=>{const source=val('--source')||'all';for(const s of source==='all'?['ucmr5','sdwis','sdwis-violations']:[source]){try{console.log(JSON.stringify(await syncSource(s,{inputFile:val('--input-file'),force:args.includes('--force'),log:e=>console.log(JSON.stringify(e))})));}catch(e){console.error(JSON.stringify({source:s,status:'failed',error_code:e.code||String(e.message).split(':')[0]}));process.exitCode=1;}}})().catch(e=>{console.error('National import failed:',e.code||'IMPORT_FAILED');process.exitCode=1;});
}
module.exports={SOURCES,approved,request,discoverUcmr,download,importArchive,syncSource,startBackgroundSync};
