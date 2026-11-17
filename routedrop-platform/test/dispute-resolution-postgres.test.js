'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {sql,install}=require('../post-service');

const makeRes=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(payload){this.body=payload;return this;}});
function routesFor(pool,stripe){
 const routes={};
 const app={get:(path,...handlers)=>{routes['GET '+path]=handlers.at(-1);},post:(path,...handlers)=>{routes['POST '+path]=handlers.at(-1);}};
 install(app,{pool,stripe,baseUrl:'https://test.invalid',enabled:true,requireDb:()=>{},requireUser:()=>()=>{},safe:f=>f,limiter:()=>{},forbidden:(res,msg,code=400)=>res.status(code).json({error:msg})});
 return routes;
}
async function post(routes,path,{id,userId,body={}}){
 const res=makeRes();
 await routes['POST '+path]({params:{id:String(id)},user:{id:userId},body},res);
 return res;
}

test('support resolution requires independent reviewer, preserves customer payment control, and records audit', {
 skip:!process.env.ROUTEDROP_TEST_DATABASE_URL&&'requires disposable PostgreSQL'
},async()=>{
 const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 const schema='routedrop_dispute_resolution_ci';
 let pool;
 let chargeCount=0;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  pool=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false,options:'-c search_path='+schema+',public'});
  await pool.query('CREATE TABLE users (id BIGINT PRIMARY KEY)');
  await pool.query('CREATE TABLE businesses (id BIGINT PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES users(id),stripe_account_id TEXT)');
  await pool.query('CREATE TABLE listings (id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL REFERENCES businesses(id),slot_start TIMESTAMPTZ)');
  for(const statement of sql)await pool.query(statement);
  for(const statement of sql)await pool.query(statement); // migration repeat-safe
  await pool.query('INSERT INTO users(id) VALUES(1),(2),(3),(4),(5)');
  await pool.query("INSERT INTO businesses(id,owner_id,stripe_account_id) VALUES(12,2,'acct_ci_provider')");
  await pool.query("INSERT INTO listings(id,business_id,slot_start) VALUES (8,12,now()-interval '1 hour'),(9,12,now()-interval '1 hour')");
  await pool.query("INSERT INTO deferred_support_agents(user_id) VALUES(1),(2),(3)");
  await pool.query("INSERT INTO deferred_bookings(id,listing_id,customer_id,stripe_customer_id,payment_method_id,provider_stripe_account_id,status,price_cents,fee_cents,consent_terms,hold_expires_at) VALUES (7,8,1,'cus_ci_customer','pm_ci_card','acct_ci_provider','work_completed',10000,800,'deferred-v1',now()+interval '1 hour'),(8,9,1,'cus_ci_customer','pm_ci_card','acct_ci_provider','work_completed',10000,800,'deferred-v1',now()+interval '1 hour')");
  const stripe={accounts:{retrieve:async()=>({charges_enabled:true,payouts_enabled:true})},paymentIntents:{create:async()=>{chargeCount++;throw Error('Unexpected payment');}}};
  const routes=routesFor(pool,stripe);
  const dispute='/api/deferred-bookings/:id/dispute',decision='/api/support/deferred-disputes/:id/decision',confirm='/api/deferred-bookings/:id/confirm';
  let r=await post(routes,dispute,{id:7,userId:1,body:{reason:'Service was not performed as promised'}});assert.equal(r.statusCode,200);
  r=await post(routes,confirm,{id:7,userId:1,body:{confirmCompletion:true}});assert.equal(r.statusCode,409);assert.equal(chargeCount,0);
  r=await post(routes,decision,{id:7,userId:4,body:{decision:'close_no_charge',note:'Independent customer complaint confirmed'}});assert.equal(r.statusCode,403);
  r=await post(routes,decision,{id:7,userId:2,body:{decision:'close_no_charge',note:'Business owner cannot adjudicate'}});assert.equal(r.statusCode,403);
  r=await post(routes,decision,{id:7,userId:1,body:{decision:'close_no_charge',note:'Customer cannot adjudicate own dispute'}});assert.equal(r.statusCode,403);
  r=await post(routes,decision,{id:7,userId:3,body:{decision:'request_customer_approval',note:'Reviewed parties reached conditional agreement'}});assert.equal(r.statusCode,200);
  r=await post(routes,decision,{id:7,userId:3,body:{decision:'close_no_charge',note:'Second decision must not succeed'}});assert.equal(r.statusCode,409);
  let booking=(await pool.query('SELECT d.status,d.dispute_reason,d.payment_intent_id,r.state FROM deferred_bookings d JOIN deferred_dispute_reviews r ON r.booking_id=d.id WHERE d.id=7')).rows[0];
  assert.equal(booking.status,'disputed');assert.equal(booking.state,'awaiting_customer');assert.equal(booking.payment_intent_id,null);
  r=await post(routes,'/api/deferred-bookings/:id/accept-resolution',{id:7,userId:5,body:{acceptResolution:true}});assert.equal(r.statusCode,409);
  r=await post(routes,'/api/deferred-bookings/:id/accept-resolution',{id:7,userId:1,body:{acceptResolution:false}});assert.equal(r.statusCode,400);
  r=await post(routes,confirm,{id:7,userId:1,body:{confirmCompletion:true}});assert.equal(r.statusCode,409);assert.equal(chargeCount,0);
  r=await post(routes,'/api/deferred-bookings/:id/accept-resolution',{id:7,userId:1,body:{acceptResolution:true}});assert.equal(r.statusCode,200);assert.equal(chargeCount,0);
  booking=(await pool.query('SELECT d.status,d.dispute_reason,d.payment_intent_id,r.state FROM deferred_bookings d JOIN deferred_dispute_reviews r ON r.booking_id=d.id WHERE d.id=7')).rows[0];
  assert.deepEqual(booking,{status:'work_completed',dispute_reason:null,payment_intent_id:null,state:'customer_accepted'});
  // Customer may dispute again before the separate payment authorization.
  r=await post(routes,dispute,{id:7,userId:1,body:{reason:'The revised service was still unsatisfactory'}});assert.equal(r.statusCode,200);
  r=await post(routes,decision,{id:7,userId:3,body:{decision:'close_no_charge',note:'Customer rejection accepted, no charge owed'}});assert.equal(r.statusCode,200);
  r=await post(routes,confirm,{id:7,userId:1,body:{confirmCompletion:true}});assert.equal(r.statusCode,409);
  booking=(await pool.query('SELECT d.status,d.dispute_reason,d.payment_intent_id,r.state FROM deferred_bookings d JOIN deferred_dispute_reviews r ON r.booking_id=d.id WHERE d.id=7')).rows[0];
  assert.equal(booking.status,'canceled');assert.equal(booking.state,'closed_no_charge');assert.equal(booking.payment_intent_id,null);
  // Customer rejection does not unlock charging or allow a provider to decide.
  r=await post(routes,dispute,{id:8,userId:1,body:{reason:'Second issue awaiting settlement'}});assert.equal(r.statusCode,200);
  r=await post(routes,decision,{id:8,userId:3,body:{decision:'request_customer_approval',note:'Suggested remediation for customer review'}});assert.equal(r.statusCode,200);
  r=await post(routes,'/api/deferred-bookings/:id/decline-resolution',{id:8,userId:1});assert.equal(r.statusCode,200);
  r=await post(routes,confirm,{id:8,userId:1,body:{confirmCompletion:true}});assert.equal(r.statusCode,409);
  assert.equal(chargeCount,0);
  const history=await pool.query("SELECT action FROM deferred_dispute_events WHERE booking_id=7 ORDER BY id");
  assert.deepEqual(history.rows.map(row=>row.action),['reported','request_customer_approval','customer_accepted','reported','close_no_charge']);
 }finally{
  if(pool)await pool.end().catch(()=>{});
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  await admin.end();
 }
});
