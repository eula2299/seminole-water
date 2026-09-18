'use strict';
const { randomUUID } = require('node:crypto');
const { validPwsid } = require('./evidence');
const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS national_water;
CREATE TABLE IF NOT EXISTS national_water.runs (
 id uuid PRIMARY KEY, source text NOT NULL, status text NOT NULL CHECK(status IN ('running','complete','failed')),
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 source_url text NOT NULL, source_modified text, source_sha256 text, source_bytes bigint,
 source_rows bigint NOT NULL DEFAULT 0, unique_records bigint NOT NULL DEFAULT 0,
 observation_count bigint NOT NULL DEFAULT 0, system_count bigint NOT NULL DEFAULT 0,
 violation_count bigint NOT NULL DEFAULT 0, first_sample date, last_sample date, error_code text
);
CREATE INDEX IF NOT EXISTS national_runs_source_idx ON national_water.runs(source,started_at DESC);
CREATE TABLE IF NOT EXISTS national_water.sources (
 source text PRIMARY KEY, active_run uuid REFERENCES national_water.runs(id), checked_at timestamptz
);
CREATE TABLE IF NOT EXISTS national_water.records (
 run_id uuid NOT NULL REFERENCES national_water.runs(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('system','observation','violation')),
 record_key text NOT NULL, pwsid text NOT NULL CHECK(pwsid ~ '^[A-Z0-9]{9}$'),
 observed_at date, data jsonb NOT NULL, PRIMARY KEY(run_id,kind,record_key)
);
CREATE INDEX IF NOT EXISTS national_records_pws_idx ON national_water.records(run_id,pwsid,kind,observed_at DESC);
CREATE INDEX IF NOT EXISTS national_records_state_idx ON national_water.records((data->>'state')) WHERE kind='system';
`;
function unavailable() { return {status:'not-connected',national_unique_observations_ingested:'0',counts:{observations:'0',systems:'0',violation_records:'0'},sources:[],count_scope:'active verified imports; excludes publisher inventory and legacy county records'}; }
function createWarehouse({connectionString=process.env.DATABASE_URL,pool}={}) {
 let own=false, initialized=false, initializing;
 if (!pool && connectionString) { const {Pool}=require('pg'); pool=new Pool({connectionString,max:4,connectionTimeoutMillis:4000,idleTimeoutMillis:10000,statement_timeout:20000,lock_timeout:3000,application_name:'ismywaterok-national'}); own=true; pool.on('error',()=>{}); }
 async function initialize() {
  if (!pool) return false;
  if (initialized) return true;
  if (!initializing) initializing=pool.query(SCHEMA).then(()=>{initialized=true;return true;}).finally(()=>{initializing=null;});
  return initializing;
 }
 async function query(sql,args=[]) { if (!await initialize()) throw new Error('NATIONAL_DATABASE_NOT_CONFIGURED');return pool.query(sql,args); }
 async function status() {
  if (!pool) return unavailable();
  const result=await query(`SELECT s.source,s.checked_at,r.id AS run_id,r.completed_at,r.source_url,r.source_modified,
   r.source_sha256,r.source_bytes::text,r.source_rows::text,r.unique_records::text,r.observation_count::text,
   r.system_count::text,r.violation_count::text,r.first_sample::text,r.last_sample::text,
   (SELECT json_build_object('status',x.status,'started_at',x.started_at,'error_code',x.error_code) FROM national_water.runs x WHERE x.source=s.source ORDER BY x.started_at DESC LIMIT 1) latest_attempt
   FROM national_water.sources s LEFT JOIN national_water.runs r ON r.id=s.active_run ORDER BY s.source`);
  const sum=k=>result.rows.reduce((n,r)=>n+BigInt(r[k]||0),0n).toString();
  return {status:result.rows.some(r=>r.run_id)?'available':'awaiting-import',national_unique_observations_ingested:sum('observation_count'),
   counts:{observations:sum('observation_count'),systems:sum('system_count'),violation_records:sum('violation_count')},sources:result.rows,
   count_scope:'active verified imports; sample/analyte/method observations, not households or publisher inventory',coverage_verified:false};
 }
 async function lookupSystem(pwsid,{limit=120}={}) {
  if(!validPwsid(pwsid)) throw new Error('Invalid full federal PWSID');
  limit=Math.max(1,Math.min(250,Number(limit)||120));
  if(!pool) return {pwsid,status:'not-connected',system:null,observations:[],violations:[],observation_summary:[],counts:{},sources:[]};
  const base=`FROM national_water.records r JOIN national_water.sources s ON s.active_run=r.run_id WHERE r.pwsid=$1`;
  const result=await query(`SELECT r.kind,r.data ${base} AND r.kind='system' LIMIT 1`,[pwsid]);
  const [obs,viol,summary,counts,sources]=await Promise.all([
   query(`SELECT r.data ${base} AND r.kind='observation' ORDER BY r.observed_at DESC,r.record_key LIMIT $2`,[pwsid,limit]),
   query(`SELECT data FROM (SELECT DISTINCT ON (r.data->>'violation_id') r.data,r.observed_at ${base} AND r.kind='violation' ORDER BY r.data->>'violation_id',(r.data->>'enforcement_date') DESC NULLS LAST) v ORDER BY observed_at DESC NULLS LAST LIMIT $2`,[pwsid,limit]),
   query(`SELECT r.data->>'analyte' AS analyte,r.data->>'unit' AS unit,count(*)::text AS sample_results,
    count(*) FILTER(WHERE r.data->>'censored'='true')::text AS non_detects,
    min(r.observed_at)::text AS first_sample,max(r.observed_at)::text AS last_sample,
    min((r.data->>'value')::numeric) AS minimum_detected,max((r.data->>'value')::numeric) AS maximum_detected
    ${base} AND r.kind='observation' GROUP BY r.data->>'analyte',r.data->>'unit' ORDER BY analyte`,[pwsid]),
   query(`SELECT r.kind,count(*)::text AS count ${base} GROUP BY r.kind`,[pwsid]),
   query(`SELECT DISTINCT s.source,x.completed_at,x.source_modified,x.source_url,x.source_sha256 ${base.replace('WHERE','JOIN national_water.runs x ON x.id=s.active_run WHERE')}`,[pwsid])
  ]);
  return {pwsid,status:counts.rows.length?'records-returned':'no-matching-records',system:result.rows[0]?.data||null,
   observations:obs.rows.map(r=>({...r.data,source_url:sources.rows.find(s=>s.source===r.data.source)?.source_url,scope:'public-system-not-household'})),violations:viol.rows.map(r=>({...r.data,source_url:sources.rows.find(s=>s.source===r.data.source)?.source_url,scope:'public-system-not-household'})),observation_summary:summary.rows,
   counts:Object.fromEntries(counts.rows.map(r=>[r.kind,r.count])),sources:sources.rows,
   truncated:{observations:Number(counts.rows.find(r=>r.kind==='observation')?.count||0)>limit,violation_records:Number(counts.rows.find(r=>r.kind==='violation')?.count||0)>limit},scope:'public-system-not-household'};
 }
 async function searchSystems({state='',query:term='',limit=20}={}) {
  if(!pool)return [];
  const like=String(term).trim().slice(0,100).replace(/[\\%_]/g,'\\$&');
  const r=await query(`SELECT r.pwsid,r.data->>'name' AS name,r.data->>'state' AS state,r.data->>'city' AS city,r.data->>'active' AS active
    FROM national_water.records r JOIN national_water.sources s ON s.active_run=r.run_id
    WHERE r.kind='system' AND ($1='' OR r.data->>'state'=$1) AND ($2='' OR r.data->>'name' ILIKE '%'||$2||'%' OR r.pwsid=$2)
    ORDER BY r.data->>'name',r.pwsid LIMIT $3`,[String(state).toUpperCase(),like,Math.max(1,Math.min(50,Number(limit)||20))]);return r.rows;
 }
 // A dedicated connection holds a PostgreSQL advisory lock throughout download/import.
 async function beginImport(source,sourceUrl) {
  await initialize(); if(!pool)throw new Error('NATIONAL_DATABASE_NOT_CONFIGURED');
  const client=await pool.connect();
  try {
   const got=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',['ismywaterok-national:'+source]);
   if(!got.rows[0].locked){client.release();return null;}
   const id=randomUUID();
   const budget=Number(process.env.NATIONAL_MAX_DATABASE_BYTES||3000000000);
   if(!Number.isFinite(budget)||budget<1000000)throw new Error('INVALID_DATABASE_BUDGET');
   let rowsSinceBudget=20000;
   async function cleanup(runIds){for(const runId of runIds){let deleted;do{const r=await client.query('DELETE FROM national_water.records WHERE ctid IN (SELECT ctid FROM national_water.records WHERE run_id=$1 LIMIT 5000)',[runId]);deleted=r.rowCount;}while(deleted);}}
   await client.query(`INSERT INTO national_water.sources(source) VALUES($1) ON CONFLICT DO NOTHING`,[source]);
   // Interrupted imports are invisible; discard their rows before another import starts.
   const old=await client.query(`SELECT id FROM national_water.runs WHERE source=$1 AND id NOT IN (SELECT active_run FROM national_water.sources WHERE active_run IS NOT NULL)`,[source]);
   await cleanup(old.rows.map(r=>r.id));
   await client.query(`DELETE FROM national_water.runs WHERE source=$1 AND id NOT IN (SELECT active_run FROM national_water.sources WHERE active_run IS NOT NULL)`,[source]);
   await client.query(`INSERT INTO national_water.runs(id,source,status,source_url) VALUES($1,$2,'running',$3)`,[id,source,sourceUrl]);
   let released=false;
   const release=async()=>{if(!released){released=true;await client.query('SELECT pg_advisory_unlock(hashtext($1))',['ismywaterok-national:'+source]).catch(()=>{});client.release();}};
   return {
    id,
    async metadata(meta){await client.query(`UPDATE national_water.runs SET source_modified=$2,source_sha256=$3,source_bytes=$4,source_url=COALESCE($5,source_url) WHERE id=$1`,[id,meta.modified||null,meta.sha256,meta.bytes,meta.url||null]);},
    async batch(records){
     if(!records.length)return;
     rowsSinceBudget+=records.length;if(rowsSinceBudget>=20000){const used=await client.query('SELECT pg_database_size(current_database())::text AS bytes');if(Number(used.rows[0].bytes)>=budget)throw new Error('DATABASE_STORAGE_BUDGET_EXCEEDED');rowsSinceBudget=0;}
     // Duplicate keys within an input batch are inserted once; source_rows records the raw count.
     const unique=new Map();for(const r of records){const k=r.kind+':'+r.record_key,prev=unique.get(k);if(prev&&JSON.stringify(prev.data)!==JSON.stringify(r.data))throw new Error('CONFLICTING_SOURCE_RECORD');unique.set(k,r);}const distinct=[...unique.values()];
     await client.query(`INSERT INTO national_water.records(run_id,kind,record_key,pwsid,observed_at,data)
      SELECT $1,x.kind,x.record_key,x.pwsid,x.observed_at::date,x.data FROM jsonb_to_recordset($2::jsonb)
      AS x(kind text,record_key text,pwsid text,observed_at text,data jsonb) ON CONFLICT(run_id,kind,record_key) DO UPDATE SET data=CASE WHEN national_water.records.data=excluded.data THEN excluded.data ELSE NULL END`,[id,JSON.stringify(distinct)]);
     await client.query(`UPDATE national_water.runs SET source_rows=source_rows+$2 WHERE id=$1`,[id,records.length]);
    },
    async publish(){
     try {await client.query('BEGIN');
      // This scans only the staged run once, never the whole warehouse per request.
      await client.query(`UPDATE national_water.runs SET status='complete',completed_at=now(),
       unique_records=c.n,observation_count=c.observations,system_count=c.systems,violation_count=c.violations,
       first_sample=c.first_sample,last_sample=c.last_sample FROM
       (SELECT count(*) AS n,count(*) FILTER(WHERE kind='observation') AS observations,
       count(*) FILTER(WHERE kind='system') AS systems,count(*) FILTER(WHERE kind='violation') AS violations,
       min(observed_at) FILTER(WHERE kind='observation') AS first_sample,max(observed_at) FILTER(WHERE kind='observation') AS last_sample
       FROM national_water.records WHERE run_id=$1) c WHERE id=$1`,[id]);
      const valid=await client.query('SELECT unique_records::text FROM national_water.runs WHERE id=$1',[id]);
      if(valid.rows[0].unique_records==='0')throw new Error('EMPTY_SOURCE_IMPORT');
      await client.query('UPDATE national_water.sources SET active_run=$2,checked_at=now() WHERE source=$1',[source,id]);
      await client.query('COMMIT');
      // Retain just the active snapshot, with small run metadata for freshness/failure audit.
      // Cleanup does not change a successfully committed publication into a failed import.
      try{const prior=await client.query('SELECT id FROM national_water.runs WHERE source=$1 AND id<>$2',[source,id]);await cleanup(prior.rows.map(r=>r.id));}catch{/* Retry stale-row cleanup under the next import lock. */}
     }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{await release();}
    },
    async fail(code='IMPORT_FAILED'){if(released)return;try{await client.query(`UPDATE national_water.runs SET status='failed',completed_at=now(),error_code=$2 WHERE id=$1`,[id,String(code).slice(0,80)]);await cleanup([id]);}finally{await release();}},
    async activeHash(){const r=await client.query('SELECT r.source_sha256 FROM national_water.sources s JOIN national_water.runs r ON r.id=s.active_run WHERE s.source=$1',[source]);return r.rows[0]?.source_sha256;},
    async unchanged(){await client.query('UPDATE national_water.sources SET checked_at=now() WHERE source=$1',[source]);await client.query('DELETE FROM national_water.runs WHERE id=$1',[id]);await release();}
   };
  }catch(e){await client.query('SELECT pg_advisory_unlock(hashtext($1))',['ismywaterok-national:'+source]).catch(()=>{});client.release();throw e;}
 }
 async function close(){if(own)await pool.end();}
 return {initialize,status,lookupSystem,searchSystems,beginImport,close};
}
module.exports={createWarehouse,SCHEMA};
