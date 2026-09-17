'use strict';
const {fork}=require('node:child_process');
const path=require('node:path');
const {createWarehouse}=require('./warehouse');
const {createEngine}=require('./service');
const {createServer}=require('./server');

// The database is optional for process startup. Its availability is reported separately.
// No user address is stored in the warehouse or passed to ingestion workers.
function createNationalRuntime(){
 const warehouse=createWarehouse();
 const engine=createEngine({warehouse});
 const server=createServer({engine,trustProxy:!!process.env.RAILWAY_ENVIRONMENT_ID});
 let worker=null,closed=false,timer=null;
 async function refresh(){
  if(closed||worker||!process.env.DATABASE_URL||process.env.NATIONAL_SYNC_ENABLED==='false')return;
  try {if(!await warehouse.initialize())return;}catch(error){console.error('National database not ready for refresh:',error.code||error.name);return;}
  if(closed||worker)return;
  worker=fork(path.join(__dirname,'sync.js'),['--source','all'],{stdio:'inherit',env:process.env});
  worker.once('error',error=>console.error('National source worker could not start:',error.code||error.name));
  worker.once('exit',code=>{worker=null;console.log('National source refresh completed with exit code',code);});
 }
 // Recheck independently of first initialization; a temporary database outage
 // must not prevent future imports. The worker skips sources checked this week.
 timer=setInterval(refresh,60*60*1000);timer.unref();
 const ready=warehouse.initialize().then(()=>refresh()).catch(error=>console.error('National warehouse initialization unavailable:',error.code||error.name));
 return {server,engine,ready,async close(){closed=true;clearInterval(timer);worker?.kill('SIGTERM');await warehouse.close();}};
}
module.exports={createNationalRuntime};
