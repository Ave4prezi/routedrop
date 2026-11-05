'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {paymentFee,legitimateAmount,payable,chargeParameters,verifiedCharge,handleStripeEvent,ACTIVE,sql}=require('../post-service');

function booking(overrides={}) {
 return {id:41,status:'work_completed',price_cents:10000,fee_cents:800,
  payment_method_id:'pm_test_abc',stripe_customer_id:'cus_test_abc',payment_intent_id:null,
  stripe_account_id:'acct_test_abc',dispute_reason:null,...overrides};
}
test('8% RouteDrop fee uses immutable integer cents with no extra customer surcharge',()=>{
 assert.equal(paymentFee(10000),800);
 assert.equal(paymentFee(2500),200);
 assert.equal(paymentFee(999),80);
 assert.equal(legitimateAmount(499),false);
 assert.equal(legitimateAmount(500),true);
 assert.equal(legitimateAmount(500001),false);
 assert.equal(legitimateAmount(100.25),false);
});
test('only confirmed completed and undisputed jobs can initiate a payment',()=>{
 assert.equal(payable(booking()),true);
 for(const status of ['awaiting_card','requested','accepted','payment_processing','paid','disputed','payment_failed','canceled','needs_review']){
  assert.equal(payable(booking({status})),false,status);
 }
 assert.equal(payable(booking({dispute_reason:'work not done'})),false);
 assert.equal(payable(booking({payment_intent_id:'pi_existing'})),false);
 assert.equal(payable(booking({fee_cents:900})),false);
 assert.equal(payable(booking({payment_method_id:null})),false);
});
test('Stripe Connect destination charge is off-session and never created during booking',()=>{
 const charge=chargeParameters(booking(),'acct_test_abc');
 assert.deepEqual(charge,{
  params:{amount:10000,currency:'usd',customer:'cus_test_abc',payment_method:'pm_test_abc',
   payment_method_types:['card'],off_session:true,confirm:true,
   application_fee_amount:800,transfer_data:{destination:'acct_test_abc'},
   metadata:{routedrop_deferred_booking_id:'41'}},
  options:{idempotencyKey:'routedrop-deferred-charge-v1-41'}
 });
 assert.deepEqual(charge,chargeParameters(booking(),'acct_test_abc'));
 assert.throws(()=>chargeParameters(booking({price_cents:10000,fee_cents:999}),'acct_test_abc'));
 assert.throws(()=>chargeParameters(booking(),''));
});
test('a signed webhook must match exact expected charge amount, customer, provider and fee',()=>{
 const b=booking({status:'payment_processing'});
 const pi={id:'pi_test_abc',status:'succeeded',amount:10000,amount_received:10000,currency:'usd',
  customer:'cus_test_abc',payment_method:'pm_test_abc',application_fee_amount:800,
  transfer_data:{destination:'acct_test_abc'},metadata:{routedrop_deferred_booking_id:'41'}};
 assert.equal(verifiedCharge(pi,b),true);
 assert.equal(verifiedCharge({...pi,amount_received:9999},b),false);
 assert.equal(verifiedCharge({...pi,application_fee_amount:0},b),false);
 assert.equal(verifiedCharge({...pi,customer:'cus_wrong'},b),false);
 assert.equal(verifiedCharge({...pi,transfer_data:{destination:'acct_wrong'}},b),false);
 assert.equal(verifiedCharge({...pi,metadata:{routedrop_deferred_booking_id:'42'}},b),false);
 assert.equal(verifiedCharge({...pi,status:'requires_action'},b),false);
});
test('only verified Stripe SetupIntent creates a provider booking request',async()=>{
 const event={type:'checkout.session.completed',data:{object:{mode:'setup',id:'cs_test_1',metadata:{deferred_booking_id:'41'},setup_intent:'seti_test_1'}}};
 const writes=[];
 const client={query:async(sql,params)=>{writes.push({sql,params});return {rowCount:1};}};
 const stripe={setupIntents:{retrieve:async()=>({id:'seti_test_1',customer:'cus_test_abc',payment_method:'pm_test_abc',status:'succeeded'})}};
 await handleStripeEvent(event,client,stripe);
 assert.equal(writes.length,1);
 assert.match(writes[0].sql,/status='requested'/);
 assert.match(writes[0].sql,/hold_expires_at>now/);
 assert.deepEqual(writes[0].params,[41,'cs_test_1','seti_test_1','pm_test_abc','cus_test_abc']);
 const incomplete={setupIntents:{retrieve:async()=>({...await stripe.setupIntents.retrieve(),status:'requires_action'})}};
 await assert.rejects(()=>handleStripeEvent(event,client,incomplete),/not confirmed/);
 assert.equal(writes.length,1);
});
test('an expired setup session cancels its reservation without taking payment',async()=>{
 const queries=[];
 await handleStripeEvent({type:'checkout.session.expired',data:{object:{mode:'setup',id:'cs_expired',metadata:{deferred_booking_id:'41'}}}},
  {query:async(sql,params)=>{queries.push({sql,params});return {rowCount:1};}},{});
 assert.equal(queries.length,1);
 assert.match(queries[0].sql,/status='canceled'/);
 assert.deepEqual(queries[0].params,[41,'cs_expired']);
});
test('confirmed Stripe payment can finalize only an authorized in-progress booking',async()=>{
 const b=booking({status:'payment_processing'});
 const pi={id:'pi_test_abc',status:'succeeded',amount:10000,amount_received:10000,currency:'usd',
  customer:b.stripe_customer_id,payment_method:b.payment_method_id,application_fee_amount:800,
  transfer_data:{destination:b.stripe_account_id},metadata:{routedrop_deferred_booking_id:'41'}};
 const statements=[];
 const client={query:async(sql,params)=>{
  statements.push({sql,params});
  if(sql.startsWith('SELECT d.*'))return {rows:[b],rowCount:1};
  return {rowCount:1};
 }};
 await handleStripeEvent({type:'payment_intent.succeeded',data:{object:pi}},client,{});
 assert.equal(statements.length,2);
 assert.match(statements[1].sql,/status='paid'/);
 assert.deepEqual(statements[1].params,[41,'pi_test_abc']);
 const tampered={...pi,application_fee_amount:300};
 await assert.rejects(()=>handleStripeEvent({type:'payment_intent.succeeded',data:{object:tampered}},client,{}),/Unexpected/);
 assert.equal(statements.length,3);
});
test('existing paid booking schema is untouched by isolated migration',()=>{
 const all=sql.join('\n');
 assert.match(all,/CREATE TABLE IF NOT EXISTS deferred_bookings/);
 assert.doesNotMatch(all,/ALTER TABLE bookings/);
 assert.match(all,/one_active_deferred_booking_per_slot/);
 assert.equal(ACTIVE.includes('paid'),true);
});
