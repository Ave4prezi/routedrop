'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {chargeParameters,verifiedCharge,handleStripeEvent}=require('./post-service');
const booking={id:1,status:'work_completed',price_cents:7500,fee_cents:600,stripe_customer_id:'cus_test',payment_method_id:'pm_test',provider_stripe_account_id:'acct_test',payment_reference:'reference-a'};
test('new charges use permanent reference and distinct idempotency keys',()=>{
 const a=chargeParameters(booking,'acct_test');
 const b=chargeParameters({...booking,payment_reference:'reference-b'},'acct_test');
 assert.equal(a.params.metadata.routedrop_payment_reference,'reference-a');
 assert.notEqual(a.options.idempotencyKey,b.options.idempotencyKey);
});
test('successful payment must match permanent reference',()=>{
 const pi={...chargeParameters(booking,'acct_test').params,id:'pi_test',status:'succeeded',amount_received:7500};
 assert.equal(verifiedCharge(pi,booking),true);
 assert.equal(verifiedCharge(pi,{...booking,payment_reference:'reference-b'}),false);
});
test('unmatched webhook is recorded without changing booking',async()=>{
 const calls=[];
 const client={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{...booking,status:'payment_processing'}]};}};
 await handleStripeEvent({id:'evt_test',type:'payment_intent.succeeded',data:{object:{id:'pi_test',metadata:{routedrop_deferred_booking_id:'1',routedrop_payment_reference:'wrong'}}}},client,{});
 assert.equal(calls.length,2);
 assert.match(calls[1].sql,/INSERT INTO deferred_payment_reconciliation/);
});
