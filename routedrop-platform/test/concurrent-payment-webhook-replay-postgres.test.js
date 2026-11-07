'use strict';
/**
 * Concurrency and replay regression tests against a disposable PostgreSQL schema.
 * Stripe is stubbed; no charge, transfer, or refund can leave this test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {Pool} = require('pg');
const {sql,install,handleStripeEvent} = require('../post-service');

const response = () => ({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
const post = async (routes,path,{id,userId=2,body={}}) => {
 const res=response();
 await routes['POST '+path]({params:{id:String(id)},user:{id:userId,role:'customer'},body},res);
 return res;
};
const withEvent = async (pool,stripe,event,notify) => {
 const c=await pool.connect();
 try { await handleStripeEvent(event,c,stripe,notify); } finally { c.release(); }
};

test('parallel confirmation, duplicated and late payment/refund/recovery webhooks never double-settle', {
 skip: !process.env.ROUTEDROP_TEST_DATABASE_URL && 'requires disposable PostgreSQL'
}, async () => {
 const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 const schema='routedrop_concurrent_replay_ci';
 let pool;
 let chargeCalls=0;
 const notifications=[];
 const notify=async (_db,id,kind)=>notifications.push([Number(id),kind]);
 const normalPi={
  id:'pi_ci_parallel_1',status:'succeeded',currency:'usd',amount:1000,amount_received:1000,
  customer:'cus_ci_customer',payment_method:'pm_ci_card',application_fee_amount:80,
  transfer_data:{destination:'acct_ci_provider'},metadata:{routedrop_deferred_booking_id:'1'}
 };
 const recoveryPi={
  id:'pi_ci_recovery_3',status:'succeeded',currency:'usd',amount:1000,amount_received:1000,
  customer:'cus_ci_customer',payment_method:'pm_ci_new',application_fee_amount:80,
  transfer_data:{destination:'acct_ci_provider'},metadata:{routedrop_deferred_recovery_booking_id:'3'}
 };
 const stripe={
  accounts:{retrieve:async()=>({charges_enabled:true,payouts_enabled:true})},
  paymentIntents:{
   create:async (_params, options)=>{
    chargeCalls++;
    assert.equal(options.idempotencyKey,'routedrop-deferred-charge-v1-1');
    await new Promise(resolve=>setTimeout(resolve,20));
    return normalPi;
   },
   retrieve:async id=>{
    if(id===recoveryPi.id)return recoveryPi;
    throw Error('Unexpected Stripe lookup: '+id);
   }
  }
 };
 try{
  await admin.query('CREATE SCHEMA '+schema);
  pool=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false,
   max:16,options:'-c search_path='+schema+',public'});
  await pool.query('CREATE TABLE users (id BIGINT PRIMARY KEY)');
  await pool.query('CREATE TABLE businesses (id BIGINT PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES users(id),stripe_account_id TEXT)');
  await pool.query('CREATE TABLE listings (id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL REFERENCES businesses(id),slot_start TIMESTAMPTZ)');
  for(const statement of sql)await pool.query(statement);
  await pool.query('INSERT INTO users(id) VALUES(1),(2)');
  await pool.query("INSERT INTO businesses(id,owner_id,stripe_account_id) VALUES(1,1,'acct_ci_provider')");
  await pool.query("INSERT INTO listings(id,business_id,slot_start) VALUES(1,1,now()-interval '1 hour'),(2,1,now()-interval '1 hour'),(3,1,now()-interval '1 hour')");
  await pool.query("INSERT INTO deferred_bookings(id,listing_id,customer_id,stripe_customer_id,payment_method_id,provider_stripe_account_id,status,price_cents,fee_cents,consent_terms,hold_expires_at) VALUES(1,1,2,'cus_ci_customer','pm_ci_card','acct_ci_provider','work_completed',1000,80,'deferred-v1',now()+interval '1 hour')");
  await pool.query("INSERT INTO deferred_bookings(id,listing_id,customer_id,stripe_customer_id,payment_method_id,provider_stripe_account_id,status,price_cents,fee_cents,consent_terms,hold_expires_at,payment_intent_id) VALUES(2,2,2,'cus_ci_customer','pm_ci_card','acct_ci_provider','paid',1000,80,'deferred-v1',now()+interval '1 hour','pi_ci_refund_2')");
  await pool.query("INSERT INTO deferred_bookings(id,listing_id,customer_id,stripe_customer_id,payment_method_id,provider_stripe_account_id,status,price_cents,fee_cents,consent_terms,hold_expires_at,payment_intent_id,recovery_checkout_session_id) VALUES(3,3,2,'cus_ci_customer','pm_ci_card','acct_ci_provider','recovery_pending',1000,80,'deferred-v1',now()+interval '1 hour','pi_ci_failed_3','cs_ci_recovery_3')");
  await pool.query("INSERT INTO deferred_refund_requests(id,booking_id,customer_id,reason,status,refund_id) VALUES(1,2,2,'Refund requested after a completed service','processing','re_ci_refund_2')");
  const routes={};
  const app={get:(path,...handlers)=>routes['GET '+path]=handlers.at(-1),post:(path,...handlers)=>routes['POST '+path]=handlers.at(-1)};
  install(app,{pool,stripe,baseUrl:'https://test.invalid',enabled:true,
   requireDb:()=>{},requireUser:()=>()=>{},safe:fn=>fn,limiter:()=>{},
   forbidden:(res,msg,code=400)=>res.status(code).json({error:msg})});
  // 12 concurrently submitted customer confirmations; exactly one may enter the Stripe call.
  const results=await Promise.all(Array.from({length:12},()=>post(routes,'/api/deferred-bookings/:id/confirm',{id:1,body:{confirmCompletion:true}})));
  assert.equal(results.filter(r=>r.statusCode===200).length,1);
  assert.equal(results.filter(r=>r.statusCode===409).length,11);
  assert.equal(chargeCalls,1);
  const before=(await pool.query('SELECT status,payment_intent_id FROM deferred_bookings WHERE id=1')).rows[0];
  assert.deepEqual(before,{status:'payment_processing',payment_intent_id:normalPi.id});
  await withEvent(pool,stripe,{type:'payment_intent.succeeded',data:{object:normalPi}},notify);
  await withEvent(pool,stripe,{type:'payment_intent.succeeded',data:{object:normalPi}},notify);
  await withEvent(pool,stripe,{type:'payment_intent.payment_failed',data:{object:{...normalPi,status:'requires_payment_method'}}},notify);
  let row=(await pool.query('SELECT status,payment_intent_id,paid_at IS NOT NULL AS paid FROM deferred_bookings WHERE id=1')).rows[0];
  assert.deepEqual(row,{status:'paid',payment_intent_id:normalPi.id,paid:true});
  assert.equal(notifications.filter(([id,kind])=>id===1&&kind==='paid').length,1);
  assert.equal(chargeCalls,1);

  // Refund event repeats or later reports failure after success: do not un-refund or re-notify.
  const refund={id:'re_ci_refund_2',status:'succeeded',payment_intent:'pi_ci_refund_2',amount:1000,metadata:{routedrop_deferred_refund_id:'1'}};
  await withEvent(pool,stripe,{type:'refund.updated',data:{object:refund}},notify);
  await withEvent(pool,stripe,{type:'refund.updated',data:{object:refund}},notify);
  await withEvent(pool,stripe,{type:'refund.failed',data:{object:{...refund,status:'failed'}}},notify);
  row=(await pool.query('SELECT d.status,d.refunded_cents,r.status AS refund_status FROM deferred_bookings d JOIN deferred_refund_requests r ON r.booking_id=d.id WHERE d.id=2')).rows[0];
  assert.deepEqual(row,{status:'refunded',refunded_cents:1000,refund_status:'refunded'});
  assert.equal(notifications.filter(([id,kind])=>id===2&&kind==='refund').length,1);

  // Recovery success replay, late expiration and late original decline cannot undo paid status.
  const session={id:'cs_ci_recovery_3',mode:'payment',payment_status:'paid',payment_intent:recoveryPi.id,customer:'cus_ci_customer',currency:'usd',amount_total:1000,metadata:{deferred_recovery_booking_id:'3'}};
  await withEvent(pool,stripe,{type:'checkout.session.completed',data:{object:session}},notify);
  await withEvent(pool,stripe,{type:'checkout.session.async_payment_succeeded',data:{object:session}},notify);
  await withEvent(pool,stripe,{type:'checkout.session.expired',data:{object:{...session,payment_status:'unpaid'}}},notify);
  await withEvent(pool,stripe,{type:'payment_intent.payment_failed',data:{object:{id:'pi_ci_failed_3',status:'requires_payment_method',customer:'cus_ci_customer',amount:1000,metadata:{routedrop_deferred_booking_id:'3'}}}},notify);
  row=(await pool.query('SELECT status,payment_intent_id,initial_payment_intent_id,recovery_intent_id FROM deferred_bookings WHERE id=3')).rows[0];
  assert.deepEqual(row,{status:'paid',payment_intent_id:recoveryPi.id,initial_payment_intent_id:'pi_ci_failed_3',recovery_intent_id:recoveryPi.id});
  assert.equal(notifications.filter(([id,kind])=>id===3&&kind==='paid').length,1);
  assert.equal(chargeCalls,1);
 } finally {
  if(pool)await pool.end().catch(()=>{});
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  await admin.end();
 }
});
