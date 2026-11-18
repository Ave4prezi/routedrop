'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ddl,validTask,registerDayWorkRoutes}=require('../day-work-pilot');
const draft=()=>({title:'Fictional yard cleanup',city:'Hartselle, AL',summary:'Test-only cleanup of a fictional garden area.',payDisplay:'Example: $50 total',startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString()});
test('day-work validation requires pay, description and bounded future time',()=>{
 assert.ok(validTask(draft()));
 for(const change of [{title:'x'},{city:''},{payDisplay:''},{summary:'short'},{startsAt:'invalid'},{startsAt:new Date(0).toISOString()},{endsAt:new Date(Date.now()+90*3600000).toISOString()}])assert.equal(validTask({...draft(),...change}),null);
});
test('day-work cards escape task content and expose completion to the proper actor',()=>{
 const vm=require('node:vm'),fs=require('node:fs');const ctx={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../public/opportunity-ui.js'),'utf8'),ctx);
 const ui=ctx.window.RouteDropOpportunities;
 const task={id:1,title:'<img onerror=x>',city:'Test city',summary:'<script>x</script>',pay_display:'$50',starts_at:draft().startsAt,ends_at:draft().endsAt,status:'assigned',is_worker:true};
 const html=ui.dayWork([task],true);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('data-day-action="complete"'));assert.ok(!html.includes('data-day-action="confirm"'));
 assert.ok(!ui.dayWork([task],false).includes(task.title));
});
test('signed-in task flow enforces ownership, worker selection and completion permissions',{skip:!process.env.TEST_DATABASE_URL&&!process.env.PGLITE_TEST_MODULE},async()=>{
 const express=require('express');
 const schema='daywork_test_'+Date.now();let pool,raw;
 if(process.env.PGLITE_TEST_MODULE){const {PGlite}=require(process.env.PGLITE_TEST_MODULE);raw=new PGlite();pool={query:async(sql,args)=>{const r=await raw.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0};},connect:async()=>({...pool,release(){}})};}
 else {const {Pool}=require('pg');pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema});raw=new Pool({connectionString:process.env.TEST_DATABASE_URL});await raw.query('CREATE SCHEMA '+schema);}
 let server;
 try{
  await pool.query('CREATE TABLE users(id BIGINT PRIMARY KEY)');await pool.query('CREATE TABLE businesses(owner_id BIGINT,pilot_screening_status TEXT)');
  await pool.query('INSERT INTO users(id) VALUES(1),(2),(3),(4)');for(const sql of ddl)await pool.query(sql);
  const app=express();app.use(express.json());
  registerDayWorkRoutes(app,{pool,requireDb:(q,s,n)=>n(),requireUser:()=>((req,res,next)=>{if(!req.headers['x-test-user'])return res.status(401).json({error:'Sign in'});req.user={id:Number(req.headers['x-test-user'])};next();}),safe:f=>(q,s,n)=>Promise.resolve(f(q,s)).catch(n),forbidden:(res,error,code)=>res.status(code).json({error})});
  app.use((e,q,s,n)=>s.status(500).json({error:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  async function call(user,path='',action,body){const r=await fetch(base+'/api/pilot/day-work'+path,{method:action?'POST':'GET',headers:{'content-type':'application/json',...(user?{'x-test-user':String(user)}:{})},...(action?{body:JSON.stringify(body||{})}:{})});return {code:r.status,data:await r.json()};}
  assert.equal((await call(null)).code,401);assert.equal((await call(1,'',true,{...draft(),payDisplay:''})).code,400);
  const posted=await call(1,'',true,draft());assert.equal(posted.code,201);const id=posted.data.task.id;
  assert.equal((await call(1,'/'+id+'/interest',true)).code,409,'cannot self-apply');
  assert.equal((await call(2,'/'+id+'/interest',true)).code,200);assert.equal((await call(2,'/'+id+'/interest',true)).code,200,'idempotent interest');
  assert.equal((await call(2,'/'+id+'/interests')).code,404,'worker cannot see other interested accounts');
  assert.equal((await call(1,'/'+id+'/interests')).data.interests.length,1);
  assert.equal((await call(3,'/'+id+'/select',true,{workerId:2})).code,409,'other user cannot select');
  assert.equal((await call(1,'/'+id+'/select',true,{workerId:3})).code,409,'cannot select uninterested account');
  assert.equal((await call(1,'/'+id+'/select',true,{workerId:2})).code,200);
  assert.equal((await call(3,'/'+id+'/interest',true)).code,409,'assigned task closed');
  assert.equal((await call(1,'/'+id+'/select',true,{workerId:2})).code,409,'cannot reassign');
  assert.equal((await call(1,'/'+id+'/confirm',true)).code,409,'cannot confirm before worker completion');
  assert.equal((await call(1,'/'+id+'/complete',true)).code,409,'poster cannot complete as worker');
  assert.equal((await call(2,'/'+id+'/complete',true)).code,200);
  assert.equal((await call(2,'/'+id+'/confirm',true)).code,409,'worker cannot confirm own work');
  assert.equal((await call(1,'/'+id+'/confirm',true)).code,200);
  assert.equal((await call(1)).data.tasks[0].status,'completed');assert.equal((await call(3)).data.tasks.length,0);
  assert.equal((await call(1,'/'+id+'/cancel',true)).code,409,'cannot cancel completed task');
  const task=(await call(1,'',true,draft())).data.task;
  await call(2,'/'+task.id+'/interest',true);await call(2,'/'+task.id+'/withdraw',true);assert.equal((await call(1,'/'+task.id+'/interests')).data.interests.length,0);
  assert.equal((await call(1,'/'+task.id+'/cancel',true)).code,200);
  await pool.query("INSERT INTO businesses VALUES(4,'suspended')");assert.equal((await call(4,'',true,draft())).code,403);
  const board=(await call(1)).data;assert.equal(board.payments_enabled,false);assert.ok(board.tasks.every(t=>!('poster_id' in t)&&!('worker_id' in t)));
 }finally{if(server)await new Promise(r=>server.close(r));if(process.env.PGLITE_TEST_MODULE)await raw.close();else{await pool.end();await raw.query('DROP SCHEMA '+schema+' CASCADE');await raw.end();}}
});
