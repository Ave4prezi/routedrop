'use strict';
/**
 * Stripe TEST-MODE contract simulation, exercised through real HTTP routes and
 * disposable PostgreSQL. Stripe is mocked here: NO network charge or live payment.
 * Running against Stripe's own sandbox remains a separate pre-release requirement.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {Pool}=require('pg');
const post=require('../post-service');

test('fictional $75 service: $0 booking, saved test card, acceptance, completion, customer approval, 8% Connect fee and idempotent webhook',{
 skip:!process.env.ROUTEDROP_TEST_DATABASE_URL && 'requires disposable PostgreSQL',timeout:90000
},async()=>{
 const schema='routedrop_deferred_lifecycle_ci';
 const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 let db,server;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  db=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false,options:'-c search_path='+schema+',public',max:8});
  for(const sql of [
   'CREATE TABLE users (id BIGINT PRIMARY KEY,email TEXT NOT NULL,role TEXT NOT NULL)',
   'CREATE TABLE businesses (id BIGINT PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES users(id),stripe_account_id TEXT,name TEXT)',
   "CREATE TABLE listings (id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL REFERENCES businesses(id),price_cents INTEGER NOT NULL,slot_start TIMESTAMPTZ NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',neighborhood TEXT)",
   "CREATE TABLE bookings (id BIGINT PRIMARY KEY,listing_id BIGINT NOT NULL REFERENCES listings(id),status TEXT NOT NULL DEFAULT 'awaiting_payment')"
  ])await db.query(sql);
  for(const sql of post.sql)await db.query(sql);
  await db.query("INSERT INTO users(id,email,role) VALUES(1,'fictional-provider@ci.invalid','business'),(2,'fictional-customer@ci.invalid','customer'),(3,'other-customer@ci.invalid','customer')");
  await db.query("INSERT INTO businesses(id,owner_id,stripe_account_id,name) VALUES(1,1,'acct_test_routedrop_provider','Example Cleaning')");
  await db.query("INSERT INTO listings(id,business_id,price_cents,slot_start,title,status,neighborhood) VALUES(1,1,7500,now()+interval '1 day','Fictional $75 House Cleaning','active','East Decatur')");
  let customerCalls=0,sessionCalls=0,chargeCalls=0;
  const customerId='cus_test_routedrop_ci';
  const cardId='pm_test_routedrop_ci';
  const piId='pi_test_routedrop_ci';
  const accountId='acct_test_routedrop_provider';
  const intentData=[];
  const stripe={
   customers:{create:async(params,opts)=>{
    customerCalls++;
    assert.equal(params.email,'fictional-customer@ci.invalid');
    assert.match(opts.idempotencyKey,/routedrop-deferred-customer-/);
    return {id:customerId};
   }},
   accounts:{retrieve:async(id)=>{
    assert.equal(id,accountId);
    return {id,charges_enabled:true,payouts_enabled:true};
   }},
   checkout:{sessions:{create:async(params,opts)=>{
    sessionCalls++;
    assert.equal(params.mode,'setup');
    assert.equal(params.customer,customerId);
    assert.equal(params.payment_method_types[0],'card');
    assert.match(opts.idempotencyKey,/routedrop-deferred-setup-/);
    assert.equal(params.line_items,undefined,'setup must not charge a customer');
    return {id:'cs_test_routedrop_ci',url:'https://checkout.stripe.com/c/test_fictional_route_ci'};
   }}},
   setupIntents:{retrieve:async(id)=>{
    assert.equal(id,'seti_test_routedrop_ci');
    return {id,customer:customerId,payment_method:cardId,status:'succeeded'};
   }},
   paymentIntents:{create:async(params,opts)=>{
    chargeCalls++;
    intentData.push({params,opts});
    assert.equal(params.amount,7500);
    assert.equal(params.application_fee_amount,600);
    assert.equal(params.transfer_data.destination,accountId);
    assert.equal(params.customer,customerId);
    assert.equal(params.payment_method,cardId);
    assert.equal(params.off_session,true);
    assert.equal(params.confirm,true);
    assert.match(opts.idempotencyKey,/^routedrop-deferred-charge-v1-/);
    return {id:piId,status:'succeeded'};
   }}
  };
  const app=express();
  app.use(express.json({limit:'16kb'}));
  const forbidden=(res,msg,code=400)=>res.status(code).json({error:msg});
  const requireUser=role=>(req,res,next)=>{
   const id=Number(req.get('x-ci-user'));
   req.user=[1,2,3].includes(id)?{id,role:id===1?'business':'customer'}:null;
   if(!req.user || (role&&req.user.role!==role))return forbidden(res,'Unauthorized',403);
   next();
  };
  const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  post.install(app,{pool:db,stripe,baseUrl:'https://example.invalid',enabled:true,verificationEnabled:false,
   requireDb:(req,res,next)=>next(),requireUser,safe,limiter:(req,res,next)=>next(),
   forbidden,queueDeferredEmail:async()=>{}});
  app.use((err,req,res,next)=>res.status(500).json({error:'CI integration handler failed'}));
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function req(route,{user=2,body={},method='POST'}={}){
   const res=await fetch(base+route,{method,headers:{'x-ci-user':String(user),'content-type':'application/json'},body:method==='POST'?JSON.stringify(body):undefined});
   const json=await res.json();
   return {status:res.status,body:json};
  }
  const booking='/api/deferred-bookings';
  assert.equal((await req(booking,{body:{listingId:1}})).status,400,'explicit agreement required');
  assert.equal(customerCalls,0);
  const started=await req(booking,{body:{listingId:1,consent:true,termsVersion:'deferred-v1'}});
  assert.equal(started.status,200,JSON.stringify(started.body));
  assert.match(started.body.message,/No upfront payment/);
  assert.equal(sessionCalls,1);
  assert.equal(chargeCalls,0,'no customer charge at booking');
  const bookingRow=async()=>(await db.query('SELECT * FROM deferred_bookings WHERE listing_id=1')).rows[0];
  let b=await bookingRow();
  const id=b.id;
  assert.equal(b.status,'awaiting_card');
  assert.equal(b.price_cents,7500);
  assert.equal(b.fee_cents,600);
  assert.equal(b.payment_method_id,null);
  assert.equal((await req(booking,{body:{listingId:1,consent:true,termsVersion:'deferred-v1'}})).status,409,'one active booking per slot');
  assert.equal((await req(booking+'/'+id+'/accept',{user:1})).status,409,'cannot accept until Stripe confirms card setup');

  // Simulate Stripe's signed webhook handler AFTER a verified successful SetupIntent.
  const webhook=async(event)=>{
   const client=await db.connect();
   try{await client.query('BEGIN');await post.handleStripeEvent(event,client,stripe,async()=>{});await client.query('COMMIT');}
   catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
  };
  const setup={type:'checkout.session.completed',data:{object:{
   id:'cs_test_routedrop_ci',mode:'setup',setup_intent:'seti_test_routedrop_ci',
   metadata:{deferred_booking_id:String(id)}
  }}};
  await webhook(setup);
  await webhook(setup);
  b=await bookingRow();
  assert.equal(b.status,'requested');
  assert.equal(b.payment_method_id,cardId);
  assert.equal(chargeCalls,0);
  assert.equal((await req(booking+'/'+id+'/accept',{user:2})).status,403,'customer cannot accept as provider');
  assert.equal((await req(booking+'/'+id+'/accept',{user:1})).status,200);
  assert.equal((await req(booking+'/'+id+'/complete',{user:1})).status,409,'cannot finish before scheduled job');
  assert.equal((await req(booking+'/'+id+'/confirm',{user:2,body:{confirmCompletion:true}})).status,409,'no payment before completion');
  assert.equal(chargeCalls,0);
  // Test time passage only in disposable database; production listing is untouched.
  await db.query("UPDATE listings SET slot_start=now()-interval '1 hour' WHERE id=1");
  assert.equal((await req(booking+'/'+id+'/complete',{user:1})).status,200);
  assert.equal(chargeCalls,0,'no charge on provider completion');
  assert.equal((await req(booking+'/'+id+'/confirm',{user:2,body:{}})).status,400,'requires explicit customer confirmation');
  assert.equal((await req(booking+'/'+id+'/confirm',{user:3,body:{confirmCompletion:true}})).status,409,'another customer cannot authorize charge');
  assert.equal(chargeCalls,0);
  const confirmed=await req(booking+'/'+id+'/confirm',{user:2,body:{confirmCompletion:true}});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status,'payment_processing','must wait for Stripe final confirmation');
  assert.equal(chargeCalls,1);
  b=await bookingRow();
  assert.equal(b.status,'payment_processing');
  assert.equal(b.payment_intent_id,piId);
  assert.equal(b.fee_cents,600);
  assert.equal((await req(booking+'/'+id+'/confirm',{user:2,body:{confirmCompletion:true}})).status,409);
  assert.equal(chargeCalls,1,'idempotent charge request');
  const pi={id:piId,status:'succeeded',amount:7500,amount_received:7500,currency:'usd',
   customer:customerId,payment_method:cardId,application_fee_amount:600,
   transfer_data:{destination:accountId},metadata:{routedrop_deferred_booking_id:String(id)}};
  await webhook({type:'payment_intent.succeeded',data:{object:pi}});
  await webhook({type:'payment_intent.succeeded',data:{object:pi}});
  b=await bookingRow();
  assert.equal(b.status,'paid');
  assert.equal(b.payment_intent_id,piId);
  assert.ok(b.paid_at);
  assert.equal(chargeCalls,1);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM deferred_bookings')).rows[0].count,1);
  assert.equal(customerCalls,1,'Stripe test customer created once');
  assert.equal(intentData[0].params.amount-intentData[0].params.application_fee_amount,6900);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)await db.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  await admin.end();
 }
});