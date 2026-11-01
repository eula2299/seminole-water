'use strict';
// One atomic daily counter shared by every help-AI process. No prompts or resident data.
function createAiBudget({connectionString=process.env.DATABASE_URL,pool=null}={}){
 let db=pool,owned=false,ready;
 if(!db&&connectionString){const {Pool}=require('pg');db=new Pool({connectionString,max:1,connectionTimeoutMillis:4000,statement_timeout:5000,application_name:'water-help-budget'});owned=true;db.on('error',()=>{});}
 return {
  shared:!!db,
  async take(limit){
   if(!db)return true;
   if(!Number.isSafeInteger(limit)||limit<1)return false;
   if(!ready)ready=db.query('CREATE TABLE IF NOT EXISTS water_help_ai_budget (day date PRIMARY KEY, calls integer NOT NULL CHECK(calls>=0))').catch(e=>{ready=null;throw e;});
   await ready;
   const r=await db.query(`INSERT INTO water_help_ai_budget(day,calls) VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,1)
    ON CONFLICT(day) DO UPDATE SET calls=water_help_ai_budget.calls+1 WHERE water_help_ai_budget.calls<$1 RETURNING calls`,[limit]);
   return r.rows.length===1;
  },
  close:()=>owned?db.end():Promise.resolve()
 };
}
module.exports={createAiBudget};
