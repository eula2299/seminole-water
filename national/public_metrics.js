'use strict';
const {randomUUID}=require('node:crypto');

// Only server-built access plans may supply amounts. No addresses or user IDs are stored.
function savingsEvent(report,requestId){
 const money=report?.access_plan?.money_summary;
 const amount=money?.potential_savings_low;
 if(typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||!money.savings_test)return null;
 return {id:/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId||'')?requestId:randomUUID(),cents:Math.round(amount*100),test:money.savings_test};
}
function createPublicMetrics({env=process.env,pool:injectedPool,auth:injectedAuth,now=()=>Date.now()}={}){
 let pool=injectedPool,ready=null,cached=null,pending=null,retryAt=0;
 if(!pool&&env.DATABASE_URL){const {Pool}=require('pg');pool=new Pool({connectionString:env.DATABASE_URL,max:2,connectionTimeoutMillis:3000,statement_timeout:3000,ssl:env.PGSSLMODE==='require'?{rejectUnauthorized:false}:undefined});pool.on('error',()=>console.error('Public savings database temporarily unavailable'));}
 async function initialize(){
  if(!pool)return false;
  if(!ready)ready=pool.query(`CREATE TABLE IF NOT EXISTS water_savings_opportunities (
   request_id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   savings_cents BIGINT NOT NULL CHECK(savings_cents > 0), test_name TEXT NOT NULL
  )`).then(()=>true).catch(e=>{ready=null;throw e;});
  return ready;
 }
 async function record(report,id){const event=savingsEvent(report,id);if(!event||!await initialize())return;
  await pool.query('INSERT INTO water_savings_opportunities (request_id,savings_cents,test_name) VALUES ($1,$2,$3) ON CONFLICT (request_id) DO NOTHING',[event.id,event.cents,event.test]);
 }
 async function savings(){if(!await initialize())return null;
  const {rows}=await pool.query('SELECT COALESCE(SUM(savings_cents),0)::text AS cents, MIN(created_at) AS since, COUNT(*)::text AS opportunities FROM water_savings_opportunities');
  return {potential_savings:Number(rows[0].cents)/100,opportunities:Number(rows[0].opportunities),since:rows[0].since||new Date(now()).toISOString()};
 }
 async function analytics(){
  if(!/^\d+$/.test(env.GA4_PROPERTY_ID||''))return null;
  if(now()<retryAt)return cached;
  if(pending)return pending;
  retryAt=now()+60*1000;
  pending=(async()=>{
   const {GoogleAuth}=require('google-auth-library');
   const auth=injectedAuth||new GoogleAuth({scopes:['https://www.googleapis.com/auth/analytics.readonly'],...(env.GA4_SERVICE_ACCOUNT_JSON?{credentials:JSON.parse(env.GA4_SERVICE_ACCOUNT_JSON)}:{})});
   const client=await auth.getClient();
   const {data}=await client.request({url:`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`,method:'POST',timeout:8000,data:{dateRanges:[{startDate:'2015-08-14',endDate:'today'}],metrics:[{name:'screenPageViews'},{name:'totalUsers'}]}});
   const values=data.rows?.[0]?.metricValues;
   const views=Number(values?.[0]?.value??0),users=Number(values?.[1]?.value??0);
   if(!Number.isSafeInteger(views)||!Number.isSafeInteger(users)||views<0||users<0)throw Error('Invalid analytics totals');
   cached={views,users,updated_at:new Date(now()).toISOString()};return cached;
  })().catch(()=>cached).finally(()=>{pending=null;});
  return pending;
 }
 return {record,async totals(){const [s,a]=await Promise.allSettled([savings(),analytics()]);return {savings:s.status==='fulfilled'?s.value:null,analytics:a.status==='fulfilled'?a.value:null};},async close(){if(pool&&!injectedPool)await pool.end();}};
}
module.exports={createPublicMetrics,savingsEvent};
