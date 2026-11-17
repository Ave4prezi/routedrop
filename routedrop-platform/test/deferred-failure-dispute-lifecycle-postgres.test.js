'use strict';
// Full RouteDrop deferred workflow integration against an isolated disposable PostgreSQL schema.
// Stripe is intentionally stubbed: no payments, bank transfers or refunds are initiated.
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {sql,install,handleStripeEvent}=require('../post-service');

const namespace='routedrop_refund_failure_dispute_ci';
const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
function routesFor(pool,stripe){
 const routes={};
 const app={get:(path,...handlers)=>{routes['GET '+path]=handlers.at(-1);},post:(path,...handlers)=>{routes['POST '+path]=handlers.at(-1);}};
 const forbidden=(res,message,code=400)=>res.status(code).json({error:message});
 install(app,{pool,stripe,baseUrl:'https://test.invalid',enabled:true,
  requireDb:()=>{},requireUser:()=>()=>{},safe:fn=>fn,limiter:()=>{},forbidden});
 return routes;
}
async function post(routes,path,{id,userId,body={},role='customer'}={}){
 const res=response();
 await routes['POST '+path]({params:{id:String(id)},user:{id:userId,role},body},res);
 return res;
}
test('refund, card failure/recovery and disputes remain isolated, enforce ownership and prevent duplicate charges', {
 skip:!process.env.ROUTEDROP_TEST_DATABASE_URL&&'requires disposable PostgreSQL'
},async()=>{
 const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 let pool;
 const stripeCalls={refunds:[],charge:[],cancel:[],checkouts:[]};
 let payMode='decline';
 const stripe={
  accounts:{retrieve:async()=>({charges_enabled:true,payouts_enabled:true})},
  refunds:{create:async(params,opts)=>{
   stripeCalls.refunds.push({params,opts});
   return {id:'re_ci_full_1',status:'succeeded'};
  }},
  paymentIntents:{
   create:async(params,opts)=>{
    stripeCalls.charge.push({params,opts});
    if(payMode==='decline')throw Object.assign(new Error('Test card declined'),{type:'StripeCardError',payment_intent:{id:'pi_ci_failed_1'}});
    throw Error('Unexpected attempt to create another off-session charge');
   },
   retrieve:async id=>{
    if(id==='pi_ci_failed_1')return {id,status:'requires_payment_method',amount:10000,currency:'usd',
     customer:'cus_ci_fail',application_fee_amount:800,transfer_data:{destination:'acct_ci_provider'},
     metadata:{routedrop_deferred_booking_id:'3'}};
    if(id==='pi_ci_recovered_1')return {id,status:'succeeded',amount:10000,amount_received:10000,currency:'usd',
     customer:'cus_ci_fail',payment_method:'pm_ci_new',application_fee_amount:800,
     transfer_data:{destination:'acct_ci_provider'},metadata:{routedrop_deferred_recovery_booking_id:'3'}};
    throw Error('Unknown Stripe test intent '+id);
   },
   cancel:async id=>{stripeCalls.cancel.push(id);return {id,status:'canceled'};}
  },
  checkout:{sessions:{
   create:async(params,opts)=>{
    stripeCalls.checkouts.push({params,opts});
    return {id:'cs_ci_recovery',url:'https://checkout.stripe.com/test/recover-ci'};
   },
   retrieve:async id=>({id,status:'open',mode:'payment',customer:'cus_ci_fail',
     url:'https://checkout.stripe.com/test/recover-ci',metadata:{deferred_recovery_booking_id:'3'}}),
   expire:async()=>{throw Error('An authorized recovery session must not be expired');}
  }}
 };
 try{
  await admin.query('CREATE SCHEMA '+namespace);
  pool=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false,
   options:'-c search_path='+namespace+',public'});
  await pool.query('CREATE TABLE users (id BIGINT PRIMARY KEY)');
  await pool.query('CREATE TABLE businesses (id BIGINT PRIMARY KEY, owner_id BIGINT NOT NULL REFERENCES users(id), stripe_account_id TEXT)');
  await pool.query('CREATE TABLE listings (id BIGINT PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id), slot_start TIMESTAMPTZ)');
  for(const statement of sql)await pool.query(statement);
  await pool.query('INSERT INTO users(id) VALUES (5),(9),(10),(11)');
  await pool.query("INSERT INTO businesses(id,owner_id,stripe_account_id) VALUES(1,9,'acct_ci_provider')");
  await pool.query("INSERT INTO listings(id,business_id,slot_start) VALUES (1,1,now()-interval '1 hour'),(2,1,now()-interval '1 hour'),(3,1,now()-interval '1 hour'),(4,1,now()-interval '1 hour')");
  await pool.query("INSERT INTO deferred_bookings (id,listing_id,customer_id,stripe_customer_id,payment_method_id,provider_stripe_account_id,price_cents,fee_cents,consent_terms,hold_expires_at,status,payment_intent_id) VALUES (1,1,5,'cus_ci_paid','pm_ci_paid','acct_ci_provider',10000,800,'deferred-v1',now()+interval '1 hour','paid','pi_ci_paid_1'),(2,2,5,'cus_ci_dispute','pm_ci_dispute','acct_ci_provider',10000,800,'deferred-v1',now()+interval '1 hour','work_completed',NULL),(3,3,5,'cus_ci_fail','pm_ci_fail','acct_ci_provider',10000,800,'deferred-v1',now()+interval '1 hour','work_completed',NULL),(4,4,5,'cus_ci_stripe_dispute','pm_ci_other','acct_ci_provider',10000,800,'deferred-v1',now()+interval '1 hour','paid','pi_ci_disputed_4')");
  const routes=routesFor(pool,stripe);
  // 1: customer must own booking; provider must own business; full refund reverses transfer and 8% fee.
  let result=await post(routes,'/api/deferred-bookings/:id/request-refund',{id:1,userId:11,body:{reason:'Test service was not performed as expected'}});
  assert.equal(result.statusCode,409);
  result=await post(routes,'/api/deferred-bookings/:id/request-refund',{id:1,userId:5,body:{reason:'Service was incomplete and I need a refund review'}});
  assert.equal(result.statusCode,201);assert.equal(result.body.status,'pending');
  const pending=await pool.query('SELECT id FROM deferred_refund_requests WHERE booking_id=1');
  const refundId=pending.rows[0].id;
  result=await post(routes,'/api/deferred-refunds/:id/decision',{id:refundId,userId:10,role:'business',body:{decision:'approve'}});
  assert.equal(result.statusCode,409);assert.equal(stripeCalls.refunds.length,0);
  result=await post(routes,'/api/deferred-refunds/:id/decision',{id:refundId,userId:9,role:'business',body:{decision:'approve'}});
  assert.equal(result.statusCode,200);assert.equal(result.body.status,'refunded');
  assert.equal(stripeCalls.refunds.length,1);
  const first=stripeCalls.refunds[0];
  assert.equal(first.params.payment_intent,'pi_ci_paid_1');
  assert.equal(first.params.amount,10000);
  assert.equal(first.params.reverse_transfer,true);
  assert.equal(first.params.refund_application_fee,true);
  assert.equal(first.opts.idempotencyKey,'routedrop-deferred-full-refund-v1-'+refundId);
  const refundState=await pool.query('SELECT d.status,d.refunded_cents,r.status AS refund_status FROM deferred_bookings d JOIN deferred_refund_requests r ON r.booking_id=d.id WHERE d.id=1');
  assert.deepEqual(refundState.rows[0],{status:'refunded',refunded_cents:10000,refund_status:'refunded'});
  result=await post(routes,'/api/deferred-refunds/:id/decision',{id:refundId,userId:9,role:'business',body:{decision:'approve'}});
  assert.equal(result.statusCode,409);assert.equal(stripeCalls.refunds.length,1);
  result=await post(routes,'/api/deferred-bookings/:id/request-refund',{id:1,userId:5,body:{reason:'Customer attempted to submit a second refund'}});
  assert.equal(result.statusCode,409);
  // 2: customer dispute before approving payment blocks charging the saved card.
  result=await post(routes,'/api/deferred-bookings/:id/dispute',{id:2,userId:5,body:{reason:'short'}});
  assert.equal(result.statusCode,400);
  result=await post(routes,'/api/deferred-bookings/:id/dispute',{id:2,userId:11,body:{reason:'The booked service was not completed'}});
  assert.equal(result.statusCode,409);
  result=await post(routes,'/api/deferred-bookings/:id/dispute',{id:2,userId:5,body:{reason:'The booked service was not completed'}});
  assert.equal(result.statusCode,200);assert.equal(result.body.status,'disputed');
  const beforeCharge=stripeCalls.charge.length;
  result=await post(routes,'/api/deferred-bookings/:id/confirm',{id:2,userId:5,body:{confirmCompletion:true}});
  assert.equal(result.statusCode,409);assert.equal(stripeCalls.charge.length,beforeCharge);
  const disputed=await pool.query('SELECT status,dispute_reason,payment_intent_id FROM deferred_bookings WHERE id=2');
  assert.equal(disputed.rows[0].status,'disputed');assert.equal(disputed.rows[0].payment_intent_id,null);
  // 3: decline saved card -> no repeat off-session charge; user gets authenticated recovery.
  result=await post(routes,'/api/deferred-bookings/:id/confirm',{id:3,userId:5,body:{confirmCompletion:true}});
  assert.equal(result.statusCode,409);
  assert.equal(stripeCalls.charge.length,1);
  assert.equal(stripeCalls.charge[0].params.application_fee_amount,800);
  let card=await pool.query('SELECT status,payment_intent_id FROM deferred_bookings WHERE id=3');
  assert.deepEqual(card.rows[0],{status:'payment_failed',payment_intent_id:'pi_ci_failed_1'});
  result=await post(routes,'/api/deferred-bookings/:id/confirm',{id:3,userId:5,body:{confirmCompletion:true}});
  assert.equal(result.statusCode,409);assert.equal(stripeCalls.charge.length,1);
  result=await post(routes,'/api/deferred-bookings/:id/recover',{id:3,userId:5});
  assert.equal(result.statusCode,200);assert.equal(stripeCalls.cancel.length,1);assert.equal(stripeCalls.checkouts.length,1);
  assert.equal(stripeCalls.checkouts[0].params.mode,'payment');
  assert.equal(stripeCalls.checkouts[0].params.payment_intent_data.application_fee_amount,800);
  result=await post(routes,'/api/deferred-bookings/:id/recover',{id:3,userId:5});
  assert.equal(result.statusCode,200);assert.equal(stripeCalls.checkouts.length,1);
  assert.equal(stripeCalls.charge.length,1);
  // Stripe confirms recovery through verified webhook; no extra off-session attempt.
  const db=await pool.connect();
  try{
   await handleStripeEvent({type:'checkout.session.completed',data:{object:{
    id:'cs_ci_recovery',mode:'payment',payment_status:'paid',payment_intent:'pi_ci_recovered_1',
    customer:'cus_ci_fail',currency:'usd',amount_total:10000,
    metadata:{deferred_recovery_booking_id:'3'}
   }}},db,stripe);
  }finally{db.release();}
  card=await pool.query('SELECT status,payment_intent_id,initial_payment_intent_id,recovery_intent_id FROM deferred_bookings WHERE id=3');
  assert.deepEqual(card.rows[0],{status:'paid',payment_intent_id:'pi_ci_recovered_1',
   initial_payment_intent_id:'pi_ci_failed_1',recovery_intent_id:'pi_ci_recovered_1'});
  result=await post(routes,'/api/deferred-bookings/:id/recover',{id:3,userId:5});
  assert.equal(result.statusCode,409);assert.equal(stripeCalls.charge.length,1);
  // 4: provider/cardholder dispute after paying requires support review; no refund action.
  const disputeDb=await pool.connect();
  try{await handleStripeEvent({type:'charge.dispute.created',data:{object:{
   id:'dp_ci_postpaid',payment_intent:'pi_ci_disputed_4',status:'needs_response'
  }}},disputeDb,stripe);}finally{disputeDb.release();}
  const contested=await pool.query('SELECT status,stripe_dispute_status,stripe_dispute_id FROM deferred_bookings WHERE id=4');
  assert.deepEqual(contested.rows[0],{status:'disputed',stripe_dispute_status:'needs_response',stripe_dispute_id:'dp_ci_postpaid'});
  result=await post(routes,'/api/deferred-bookings/:id/request-refund',{id:4,userId:5,body:{reason:'A card dispute already exists for this payment'}});
  assert.equal(result.statusCode,409);assert.equal(stripeCalls.refunds.length,1);
 }finally{
  if(pool)await pool.end().catch(()=>{});
  await admin.query('DROP SCHEMA IF EXISTS '+namespace+' CASCADE').catch(()=>{});
  await admin.end();
 }
});
