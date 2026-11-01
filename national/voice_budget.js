'use strict';
// An atomic deployment-wide daily attempt counter. It stores no call content.
function createVoiceBudget({connectionString=process.env.DATABASE_URL,pool=null}={}){
 let db=pool,owned=false,ready;
 if(!db&&connectionString){const {Pool}=require('pg');db=new Pool({connectionString,max:1,connectionTimeoutMillis:4000,statement_timeout:5000,application_name:'water-voice-budget'});owned=true;db.on('error',()=>{});}
 return {
  shared:!!db,
  async take(limit){
   if(!Number.isSafeInteger(limit)||limit<1)return false;
   if(!db)return true;
   if(!ready)ready=db.query('CREATE TABLE IF NOT EXISTS water_voice_budget (day date PRIMARY KEY, calls integer NOT NULL CHECK(calls>=0))').catch(e=>{ready=null;throw e;});
   await ready;
   const result=await db.query(`INSERT INTO water_voice_budget(day,calls) VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,1)
    ON CONFLICT(day) DO UPDATE SET calls=water_voice_budget.calls+1 WHERE water_voice_budget.calls<$1 RETURNING calls`,[limit]);
   return result.rows.length===1;
  },
  close:()=>owned?db.end():Promise.resolve()
 };
}
module.exports={createVoiceBudget};
