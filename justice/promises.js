'use strict';
const crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const token=()=>crypto.randomBytes(24).toString('base64url');
const validUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
function createPromises({connectionString=process.env.DATABASE_URL,pool=null}={}){
  let db=pool,ready;
  if(!db&&connectionString){const {Pool}=require('pg');db=new Pool({connectionString,max:2,connectionTimeoutMillis:5000,statement_timeout:8000,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:true}:undefined});db.on('error',()=>{});}
  async function init(){
    if(!db)throw Object.assign(Error('PUBLIC_TRACKER_UNAVAILABLE'),{status:503});
    if(!ready)ready=db.query("CREATE TABLE IF NOT EXISTS water_help_promises (id text PRIMARY KEY, owner_hash text NOT NULL, city text NOT NULL, state text NOT NULL, official text NOT NULL, promise text NOT NULL, source text NOT NULL, due date, status text NOT NULL DEFAULT 'reported', updates jsonb NOT NULL DEFAULT '[]', public boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())").catch(e=>{ready=null;throw e;});
    await ready;
  }
  const fail=()=>{throw Object.assign(Error('INVALID_PROMISE'),{status:400});};
  return {
    async available(){try{await init();return true;}catch{return false;}},
    async list({city='',state=''}={}){await init();const r=await db.query('SELECT id,city,state,official,promise,source,due,status,updates,created_at,updated_at FROM water_help_promises WHERE public=true AND lower(city)=lower($1) AND upper(state)=upper($2) ORDER BY updated_at DESC LIMIT 50',[String(city).slice(0,100),String(state).slice(0,2)]);return {records:r.rows};},
    async create(b){
      if(b.publishConsent!==true||![b.city,b.state,b.official,b.promise,b.source].every(v=>typeof v==='string')||b.city.length<2||b.city.length>100||!/^[A-Z]{2}$/.test(b.state)||b.official.length<2||b.official.length>120||b.promise.length<10||b.promise.length>2000||b.source.length>1000||!validUrl(b.source)||b.due&&!/^\d{4}-\d{2}-\d{2}$/.test(b.due))fail();
      await init();const id=token(),owner=token();await db.query('INSERT INTO water_help_promises(id,owner_hash,city,state,official,promise,source,due,public) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)',[id,hash(owner),b.city,b.state,b.official,b.promise,b.source,b.due||null]);return {id,owner,published:true};
    },
    async update(id,secret,b){
      if(!/^[A-Za-z0-9_-]{20,40}$/.test(id)||!secret||secret.length>100||!['reported','scheduled','in_progress','completed','overdue','withdrawn'].includes(b.status)||typeof b.note!=='string'||b.note.length>2000||b.status!=='withdrawn'&&!validUrl(b.source))fail();
      await init();const event={status:b.status,note:b.note,source:b.source,date:new Date().toISOString()};
      const r=await db.query('UPDATE water_help_promises SET status=$3,public=$4,updates=updates || $5::jsonb,updated_at=now() WHERE id=$1 AND owner_hash=$2 AND jsonb_array_length(updates)<100 RETURNING id',[id,hash(secret),b.status,b.status!=='withdrawn',JSON.stringify([event])]);
      if(!r.rowCount)throw Object.assign(Error('NOT_FOUND'),{status:404});return {updated:true};
    },close:()=>db?.end()
  };
}
module.exports={createPromises};
