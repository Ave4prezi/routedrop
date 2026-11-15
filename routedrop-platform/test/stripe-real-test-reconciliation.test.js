'use strict';
/**
 * Explicit opt-in REAL STRIPE TEST-MODE reconciliation test.
 *
 * Runs only with a sk_test_ key, a disposable PostgreSQL database, and an
 * already enabled TEST connected account. No production data, live money, or
 * existing RouteDrop sandbox database is used.
 *
 * LIMITATION: The hosted Stripe Checkout page is not automated here. This
 * exercises the normal booking HTTP route that creates a genuine setup Checkout
 * Session, creates/confirms a separate REAL Stripe TEST SetupIntent for that
 * same customer, and delivers a clearly SYNTHETIC, locally signed setup
 * completion event. It then exercises the real provider/customer HTTP routes,
 * makes a REAL Stripe TEST PaymentIntent, retrieves the real payment event
 * from Stripe, and forwards it through an HMAC-verified local webhook endpoint.
 *
 * The event replay tests RouteDrop's signature verification and reconciliation;
 * it is NOT a test of Stripe-to-Render webhook delivery. It intentionally does
 * not claim a real hosted Checkout completion.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const {Pool} = require('pg');
const Stripe = require('stripe');
const post = require('../post-service');

const key = process.env.ROUTEDROP_STRIPE_TEST_KEY || '';
const database = process.env.ROUTEDROP_TEST_DATABASE_URL || '';
const destination = process.env.ROUTEDROP_TEST_PROVIDER_ACCOUNT_ID || '';
const expectedPlatform = process.env.ROUTEDROP_STRIPE_TEST_PLATFORM_ID || '';
const enabled = process.env.ROUTEDROP_REAL_STRIPE_E2E === 'true';
const delay = ms => new Promise(r => setTimeout(r,ms));

test('real Stripe TEST-mode payment and real-event webhook replay after provider completion', {
 skip: !enabled && 'opt-in only: set ROUTEDROP_REAL_STRIPE_E2E=true and configure GitHub Actions secrets',
 timeout: 180000
}, async () => {
 assert.match(key,/^sk_test_[a-zA-Z0-9]+$/,'Only a real sk_test_ key is permitted; NEVER use live Stripe secrets');
 assert.match(destination,/^acct_[A-Za-z0-9]+$/,'Provide a Stripe TEST connected account');
 assert.match(expectedPlatform,/^acct_[A-Za-z0-9]+$/,'Require expected test platform account ID');
 assert.ok(database,'Disposable CI PostgreSQL URL required');
 assert.match(database,/routedrop_ci(?:\?|$)/,'Database must be the CI-only routedrop_ci database');
 assert.notEqual(process.env.ROUTEDROP_LIVE_APPROVED,'true','Live payment approval must be disabled');
 assert.equal(process.env.STRIPE_SECRET_KEY||'', '', 'Do not supply the application production Stripe key');
 assert.equal(process.env.DATABASE_URL||'', '', 'Do not supply any application production database URL');

 const stripe = new Stripe(key, {maxNetworkRetries:0, timeout:25000});
 const platform=await stripe.accounts.retrieve();
 assert.equal(platform.id,expectedPlatform,'Stripe key targets an unexpected account; refusing any charge');
 const connected=await stripe.accounts.retrieve(destination);
 assert.equal(connected.charges_enabled,true,'Test connected account cannot accept charges');
 assert.equal(connected.payouts_enabled,true,'Test connected account not ready');

 const schema='routedrop_real_stripe_ci_'+crypto.randomBytes(5).toString('hex');
 const admin=new Pool({connectionString:database,ssl:false,max:2});
 let db=null, server=null, serverBase='', checkoutSessionId=null;
 const localWebhookSecret='whsec_'+crypto.randomBytes(32).toString('hex');
 const startTime=Math.floor(Date.now()/1000)-60;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  db=new Pool({connectionString:database,ssl:false,options:'-c search_path='+schema+',public',max:8});
  for(const sql of [
   'CREATE TABLE users (id BIGINT PRIMARY KEY,email TEXT NOT NULL,role TEXT NOT NULL,deferred_stripe_customer_id TEXT)',
   'CREATE TABLE businesses (id BIGINT PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES users(id),stripe_account_id TEXT,name TEXT)',
   "CREATE TABLE listings (id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL REFERENCES businesses(id),price_cents INTEGER NOT NULL,slot_start TIMESTAMPTZ NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',neighborhood TEXT)",
   "CREATE TABLE bookings (id BIGINT PRIMARY KEY,listing_id BIGINT NOT NULL REFERENCES listings(id),status TEXT NOT NULL DEFAULT 'awaiting_payment')",
   'CREATE TABLE stripe_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now())'
  ]) await db.query(sql);
  for(const statement of post.sql)await db.query(statement);
  await db.query("INSERT INTO users(id,email,role) VALUES(1,'realstripe-provider@ci.invalid','business'),(2,'realstripe-customer@ci.invalid','customer'),(3,'realstripe-other@ci.invalid','customer')");
  await db.query('INSERT INTO businesses(id,owner_id,stripe_account_id,name) VALUES(1,1,$1,$2)',[destination,'RouteDrop CI Fictional Cleaning']);
  await db.query("INSERT INTO listings(id,business_id,price_cents,slot_start,title,status,neighborhood) VALUES(1,1,7500,now()+interval '24 hours','Synthetic $75 cleaning','active','Decatur CI ONLY')");

  const app=express();
  // Matches the production webhook security path: raw payload -> Stripe HMAC verification
  // -> deduplicate event ID -> transaction -> route handler.
  app.post('/api/stripe/webhook',express.raw({type:'application/json'}),async(req,res)=>{
   let event;
   try{event=stripe.webhooks.constructEvent(req.body,req.get('stripe-signature'),localWebhookSecret);}
   catch{ return res.status(400).json({error:'Invalid webhook signature'}); }
   const client=await db.connect();
   try{
    await client.query('BEGIN');
    const claim=await client.query('INSERT INTO stripe_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[event.id]);
    if(claim.rowCount)await post.handleStripeEvent(event,client,stripe,async()=>{});
    await client.query('COMMIT');
    res.json({received:true});
   }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'Webhook handler rejected verified event'});}
   finally{client.release();}
  });
  app.use(express.json({limit:'16kb'}));
  const forbidden=(res,msg,code=400)=>res.status(code).json({error:msg});
  const requireUser=role=>(req,res,next)=>{
   const id=Number(req.get('x-ci-user'));
   req.user=[1,2,3].includes(id)?{id,role:id===1?'business':'customer',email:id===1?'realstripe-provider@ci.invalid':id===2?'realstripe-customer@ci.invalid':'realstripe-other@ci.invalid'}:null;
   if(!req.user||(role&&role!==req.user.role))return forbidden(res,'Unauthorized',403);
   next();
  };
  const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  post.install(app,{pool:db,stripe,baseUrl:'https://example.invalid',enabled:true,
   verificationEnabled:false,requireDb:(req,res,next)=>next(),requireUser,safe,
   limiter:(req,res,next)=>next(),forbidden,queueDeferredEmail:async()=>{}});
  app.use((err,req,res,next)=>res.status(500).json({error:'Route handler failed'}));
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  serverBase='http://127.0.0.1:'+server.address().port;

  async function request(route,{user=2,body={},method='POST'}={}){
   const response=await fetch(serverBase+route,{method,headers:{'x-ci-user':String(user),'content-type':'application/json'},body:method==='POST'?JSON.stringify(body):undefined});
   return {status:response.status,body:await response.json()};
  }
  async function deliver(event,{valid=true}={}){
   const payload=JSON.stringify(event);
   const sig=stripe.webhooks.generateTestHeaderString({payload,secret:localWebhookSecret});
   const response=await fetch(serverBase+'/api/stripe/webhook',{
    method:'POST',headers:{'content-type':'application/json','stripe-signature':valid?sig:'t=1,v1=bad'},body:payload
   });
   return response.status;
  }
  const bRoot='/api/deferred-bookings';
  let response=await request(bRoot,{body:{listingId:1,consent:true,termsVersion:'deferred-v1'}});
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.match(response.body.url,/^https:\/\//);
  let row=(await db.query('SELECT * FROM deferred_bookings WHERE listing_id=1')).rows[0];
  assert.equal(row.status,'awaiting_card');
  assert.equal(row.fee_cents,600);
  const id=row.id;
  checkoutSessionId=row.setup_session_id;
  const remoteCheckout=await stripe.checkout.sessions.retrieve(checkoutSessionId);
  assert.equal(remoteCheckout.mode,'setup');
  assert.equal(remoteCheckout.status,'open','Hosted Checkout must not be represented as completed');

  // Test-only stand-in for the unautomated hosted card entry.
  // Creates a *genuine* Stripe TEST SetupIntent attached to this test customer.
  const setup=await stripe.setupIntents.create({
   customer:row.stripe_customer_id,payment_method:'pm_card_visa',
   payment_method_types:['card'],usage:'off_session',confirm:true,
   metadata:{routedrop_real_ci_booking:String(id)}
  },{idempotencyKey:'routedrop-real-ci-setup-'+schema});
  assert.equal(setup.status,'succeeded');
  assert.match(setup.payment_method,/^pm_/);

  // This is a local SYNTHETIC checkout.session.completed event, not a Stripe
  // event or proof of hosted Checkout. Backend verifies real SetupIntent.
  const syntheticCheckoutEvent={
   id:'evt_local_checkout_'+crypto.randomBytes(12).toString('hex'),
   type:'checkout.session.completed',
   data:{object:{id:checkoutSessionId,mode:'setup',setup_intent:setup.id,metadata:{deferred_booking_id:String(id)}}}
  };
  assert.equal(await deliver(syntheticCheckoutEvent,{valid:false}),400,'Reject unsigned event');
  assert.equal(await deliver(syntheticCheckoutEvent),200);
  assert.equal(await deliver(syntheticCheckoutEvent),200,'Replay must be idempotent');
  row=(await db.query('SELECT * FROM deferred_bookings WHERE id=$1',[id])).rows[0];
  assert.equal(row.status,'requested');
  assert.equal(row.payment_method_id,setup.payment_method);
  assert.equal((await request(bRoot+'/'+id+'/accept',{user:2})).status,403,'Customer cannot accept');
  assert.equal((await request(bRoot+'/'+id+'/accept',{user:1})).status,200);
  assert.equal((await request(bRoot+'/'+id+'/complete',{user:1})).status,409,'Cannot mark complete before job start');

  // Simulate clock passage ONLY in the throwaway PostgreSQL schema.
  await db.query("UPDATE listings SET slot_start=now()-interval '1 hour' WHERE id=1");
  assert.equal((await request(bRoot+'/'+id+'/complete',{user:1})).status,200);
  row=(await db.query('SELECT * FROM deferred_bookings WHERE id=$1',[id])).rows[0];
  assert.equal(row.status,'work_completed');
  assert.equal(row.confirmed_at,null);
  assert.equal(row.payment_intent_id,null);
  assert.equal((await request(bRoot+'/'+id+'/confirm',{user:3,body:{confirmCompletion:true}})).status,409);
  assert.equal((await request(bRoot+'/'+id+'/confirm',{user:2,body:{}})).status,400);

  // Customer explicitly authorizes exactly one REAL Stripe TEST charge.
  response=await request(bRoot+'/'+id+'/confirm',{user:2,body:{confirmCompletion:true}});
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.equal((await request(bRoot+'/'+id+'/confirm',{user:2,body:{confirmCompletion:true}})).status,409,'No duplicate charge');
  row=(await db.query('SELECT * FROM deferred_bookings WHERE id=$1',[id])).rows[0];
  assert.match(row.payment_intent_id,/^pi_/);
  const payment=await stripe.paymentIntents.retrieve(row.payment_intent_id);
  assert.equal(payment.livemode,false);
  assert.equal(payment.status,'succeeded','Actual Stripe test payment must succeed');
  assert.equal(payment.amount,7500);
  assert.equal(payment.amount_received,7500);
  assert.equal(payment.application_fee_amount,600);
  assert.equal(payment.transfer_data.destination,destination);
  assert.equal(payment.customer,row.stripe_customer_id);
  assert.equal(payment.payment_method,row.payment_method_id);

  // Read a genuine Stripe-emitted event via test-mode API, then forward it
  // through the same HMAC-validated local webhook path. This does not claim
  // Stripe directly delivered the event to a deployed Render endpoint.
  let realEvent;
  for(let i=0;i<24&&!realEvent;i++){
   const events=await stripe.events.list({type:'payment_intent.succeeded',created:{gte:startTime},limit:100});
   realEvent=events.data.find(e=>e.data?.object?.id===payment.id);
   if(!realEvent)await delay(500);
  }
  assert.ok(realEvent,'Real Stripe payment_intent.succeeded event not visible; do not mark paid');
  assert.equal(realEvent.livemode,false);
  assert.equal(await deliver(realEvent,{valid:false}),400);
  assert.equal(await deliver(realEvent),200);
  assert.equal(await deliver(realEvent),200,'Real event replay must be idempotent');

  row=(await db.query('SELECT * FROM deferred_bookings WHERE id=$1',[id])).rows[0];
  assert.equal(row.status,'paid');
  assert.ok(row.confirmed_at);
  assert.ok(row.paid_at);
  assert.equal(row.fee_cents,600);
  assert.equal(row.payment_intent_id,payment.id);
  const duplicate=(await db.query('SELECT COUNT(*)::int AS count FROM stripe_events WHERE id=$1',[realEvent.id])).rows[0].count;
  assert.equal(duplicate,1);
  const intents=await stripe.paymentIntents.list({customer:row.stripe_customer_id,limit:20});
  assert.equal(intents.data.filter(p=>p.metadata?.routedrop_deferred_booking_id===String(id)).length,1,'Single payment intent for this booking');
  console.log('PASS: Genuine Stripe TEST charge and signed webhook replay reconciled. $75 total, $6 fee, $69 provider allocation before Stripe fees.');
  console.log('LIMITATION: Hosted Checkout completion was simulated and Stripe event was forwarded locally, not pushed by Stripe to Render.');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)await db.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  await admin.end();
  // Expire the unused real Checkout session to avoid leaving it bookable.
  if(checkoutSessionId)await stripe.checkout.sessions.expire(checkoutSessionId).catch(()=>{});
 }
});
