'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {recoveryEligible,verifiedRecoveryCharge,handleStripeEvent,install}=require('../post-service');

const booking=(override={})=>({
 id:41,customer_id:5,status:'payment_failed',price_cents:10000,fee_cents:800,
 payment_intent_id:'pi_old_41',stripe_customer_id:'cus_test_41',
 payment_method_id:'pm_old_41',provider_stripe_account_id:'acct_test_provider',
 current_provider_account:'acct_test_provider',
 recovery_checkout_session_id:null,refunded_cents:0,dispute_reason:null,...override
});
const oldIntent=(override={})=>({
 id:'pi_old_41',status:'requires_action',amount:10000,currency:'usd',
 customer:'cus_test_41',application_fee_amount:800,
 transfer_data:{destination:'acct_test_provider'},
 metadata:{routedrop_deferred_booking_id:'41'},...override
});
const recovered=(override={})=>({
 id:'pi_recovery_41',status:'succeeded',currency:'usd',amount:10000,amount_received:10000,
 customer:'cus_test_41',payment_method:'pm_new_41',application_fee_amount:800,
 transfer_data:{destination:'acct_test_provider'},
 metadata:{routedrop_deferred_recovery_booking_id:'41'},...override
});
test('3D Secure or declined payment can use recovery only if original intent is independently verified unpaid',()=>{
 assert.equal(recoveryEligible(booking(),oldIntent()),true);
 assert.equal(recoveryEligible(booking(),oldIntent({status:'requires_payment_method'})),true);
 for(const status of ['processing','succeeded','requires_capture'])assert.equal(recoveryEligible(booking(),oldIntent({status})),false);
 assert.equal(recoveryEligible(booking(),oldIntent({amount:10100})),false);
 assert.equal(recoveryEligible(booking(),oldIntent({application_fee_amount:700})),false);
 assert.equal(recoveryEligible(booking(),oldIntent({transfer_data:{destination:'acct_other'}})),false);
 assert.equal(recoveryEligible(booking({status:'paid'}),oldIntent()),false);
 assert.equal(recoveryEligible(booking({refunded_cents:800}),oldIntent()),false);
 assert.equal(recoveryEligible(booking({dispute_reason:'bad service'}),oldIntent()),false);
 assert.equal(recoveryEligible(booking({recovery_checkout_session_id:'cs_old'}),oldIntent()),false);
});
test('recovery payment verifies exact amount, Stripe customer, destination and 8% fee',()=>{
 assert.equal(verifiedRecoveryCharge(recovered(),booking()),true);
 assert.equal(verifiedRecoveryCharge(recovered({amount_received:9999}),booking()),false);
 assert.equal(verifiedRecoveryCharge(recovered({customer:'cus_wrong'}),booking()),false);
 assert.equal(verifiedRecoveryCharge(recovered({application_fee_amount:799}),booking()),false);
 assert.equal(verifiedRecoveryCharge(recovered({transfer_data:{destination:'acct_other'}}),booking()),false);
 assert.equal(verifiedRecoveryCharge(recovered({metadata:{routedrop_deferred_recovery_booking_id:'42'}}),booking()),false);
 assert.equal(verifiedRecoveryCharge(recovered({payment_method:null}),booking()),false);
});
test('recovery cancels the original intent before creating one authenticated hosted Stripe session, never a second off-session charge',async()=>{
 const calls=[],routes={};
 const app={post:(path,...middleware)=>{routes[path]=middleware.at(-1);},get(){}};
 const pool={
  query:async(sql,params)=>{
   calls.push(['db',sql.slice(0,80)]);
   if(sql.startsWith('SELECT d.*,b.stripe_account_id AS current_provider_account'))return {rows:[booking()],rowCount:1};
   if(sql.startsWith("UPDATE deferred_bookings SET status='recovery_pending'"))return {rows:[{id:41}],rowCount:1};
   if(sql.startsWith("UPDATE deferred_bookings SET recovery_checkout_session_id"))return {rows:[{id:41}],rowCount:1};
   throw Error('Unexpected SQL in mock '+sql);
  }
 };
 const stripe={
  paymentIntents:{
   retrieve:async id=>{calls.push(['pi-retrieve',id]);return oldIntent();},
   cancel:async(id)=>{calls.push(['pi-cancel',id]);return oldIntent({status:'canceled'});},
   create:async()=>{throw Error('Off-session payment creation is prohibited during recovery');}
  },
  accounts:{retrieve:async()=>({charges_enabled:true,payouts_enabled:true})},
  checkout:{sessions:{
   create:async(options,idempotency)=>{calls.push(['checkout-create',options,idempotency]);return {id:'cs_recover_41',url:'https://checkout.stripe.com/test/recover'};},
   retrieve:async()=>{throw Error('Unexpected session lookup')},
   expire:async()=>{}
  }}
 };
 const forbidden=(res,msg,status=400)=>res.status(status).json({error:msg});
 install(app,{pool,stripe,baseUrl:'https://beta.example.test',enabled:true,
  requireDb:()=>{},requireUser:()=>()=>{},safe:fn=>fn,limiter:()=>{},forbidden});
 const req={params:{id:'41'},user:{id:5},body:{}};
 const response={statusCode:200,json(v){this.body=v;return this;},status(v){this.statusCode=v;return this;}};
 await routes['/api/deferred-bookings/:id/recover'](req,response);
 assert.equal(response.statusCode,200);
 assert.equal(response.body.url,'https://checkout.stripe.com/test/recover');
 assert.ok(calls.findIndex(c=>c[0]==='pi-cancel')<calls.findIndex(c=>c[0]==='checkout-create'));
 assert.equal(calls.filter(c=>c[0]==='checkout-create').length,1);
 const checkout=calls.find(c=>c[0]==='checkout-create');
 assert.equal(checkout[1].mode,'payment');
 assert.equal(checkout[1].line_items[0].price_data.unit_amount,10000);
 assert.equal(checkout[1].payment_intent_data.application_fee_amount,800);
 assert.equal(checkout[1].payment_intent_data.transfer_data.destination,'acct_test_provider');
 assert.equal(checkout[2].idempotencyKey,'routedrop-deferred-recovery-checkout-v1-41');
});
test('recovery webhooks require matching booking and session, paid Stripe charge, and the original 8% split',async()=>{
 const writes=[];
 const db={query:async(sql,params)=>{
  writes.push({sql,params});
  if(sql.startsWith('SELECT * FROM deferred_bookings'))return {rows:[booking({status:'recovery_pending',recovery_checkout_session_id:'cs_recover_41'})],rowCount:1};
  return {rows:[{id:41}],rowCount:1};
 }};
 const stripe={paymentIntents:{retrieve:async()=>recovered()}};
 const session={mode:'payment',id:'cs_recover_41',payment_status:'paid',payment_intent:'pi_recovery_41',
  customer:'cus_test_41',currency:'usd',amount_total:10000,metadata:{deferred_recovery_booking_id:'41'}};
 const emailEvents=[];
 await handleStripeEvent({type:'checkout.session.completed',data:{object:session}},db,stripe,async(db,id,kind)=>emailEvents.push({id,kind}));
 assert.equal(writes.length,2);
 assert.match(writes[1].sql,/initial_payment_intent_id=payment_intent_id/);
 assert.equal(emailEvents.length,1);assert.deepEqual(emailEvents[0],{id:41,kind:'paid'});
 const tampered={...session,id:'cs_other'};
 writes.length=0;emailEvents.length=0;
 await handleStripeEvent({type:'checkout.session.completed',data:{object:tampered}},db,stripe,async(db,id,kind)=>emailEvents.push({id,kind}));
 assert.equal(writes.length,1);assert.equal(emailEvents.length,0);
});
test('expired authenticated recovery checkout enters manual review, with no second automatic charge',async()=>{
 const writes=[];
 const db={query:async(sql,params)=>{writes.push({sql,params});return {rows:[{id:41}],rowCount:1};}};
 await handleStripeEvent({type:'checkout.session.expired',data:{object:{id:'cs_recover_41',mode:'payment',metadata:{deferred_recovery_booking_id:'41'}}}},db,{},async()=>{});
 assert.equal(writes.length,1);
 assert.match(writes[0].sql,/status='needs_review'/);
 assert.deepEqual(writes[0].params,[41,'cs_recover_41']);
});
