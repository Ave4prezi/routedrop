'use strict';
// One-time Stripe TEST account exercise. No RouteDrop booking metadata, no real money.
const test=require('node:test');
const assert=require('node:assert/strict');
const Stripe=require('stripe');
const crypto=require('node:crypto');
const apiKey=process.env.ROUTEDROP_STRIPE_TEST_KEY||'';
const enabled=process.env.ROUTEDROP_RUN_FAILURE_STRIPE==='true';
const platformExpected='acct_1UW6a5LqRW6nZIst';
const destination='acct_1UZc0kLnWnjdMpkQ';
test('genuine Stripe test-mode declined cards, 3DS, refund and dispute', {skip:!enabled&&'Only enabled by explicit one-shot CI job',timeout:120000},async()=>{
 assert.match(apiKey,/^sk_test_/,'NEVER use a live Stripe key');
 assert.equal(process.env.ROUTEDROP_LIVE_APPROVED,'false');
 const stripe=new Stripe(apiKey,{maxNetworkRetries:1,timeout:20000});
 const platform=await stripe.accounts.retrieve();
 assert.equal(platform.id,platformExpected,'Wrong Stripe account');
 const connected=await stripe.accounts.retrieve(destination);
 assert.equal(connected.id,destination);
 assert.equal(connected.charges_enabled,true,'Only test ready fictional connected account');
 const marker='routedrop-real-failures-'+crypto.randomUUID();
 const metadata={routedrop_failure_ci_run:marker}; // NEVER routedrop_deferred_booking_id
 const customer=await stripe.customers.create({email:'fictional-failures-'+crypto.randomUUID()+'@ci.invalid',metadata});
 assert.ok(customer.id.startsWith('cus_'));
 const defaults={amount:1250,currency:'usd',customer:customer.id,payment_method_types:['card'],metadata};
 const safelyDeclines=async(payment_method,expectedDecline)=>{
  let error;
  try{await stripe.paymentIntents.create({...defaults,payment_method,confirm:true,off_session:true},
    {idempotencyKey:marker+'-'+payment_method});}
  catch(e){error=e;}
  assert.ok(error,'Decline must be refused by Stripe');
  assert.equal(error.code,'card_declined');
  if(expectedDecline)assert.equal(error.decline_code,expectedDecline);
  console.log('PASS Stripe TEST decline',payment_method,error.code,error.decline_code);
 };
 await safelyDeclines('pm_card_visa_chargeDeclined','generic_decline');
 await safelyDeclines('pm_card_visa_chargeDeclinedInsufficientFunds','insufficient_funds');
 // 3D Secure requires customer authentication, and should not become "paid" without it.
 let authError,authIntent;
 try{authIntent=await stripe.paymentIntents.create({...defaults,payment_method:'pm_card_authenticationRequired',confirm:true},
  {idempotencyKey:marker+'-authentication'});}
 catch(e){authError=e;authIntent=e.payment_intent;}
 assert.ok(authIntent,'3DS test PaymentIntent should exist');
 if(typeof authIntent==='string')authIntent=await stripe.paymentIntents.retrieve(authIntent);
 assert.equal(authIntent.status,'requires_action','3DS payment must not settle unattended');
 assert.equal(authIntent.amount_received,0);
 console.log('PASS Stripe TEST 3DS requires_action',authIntent.id);
 // Use a separate new test payment, refund the full amount and reverse fee+transfer.
 const charge=await stripe.paymentIntents.create({
  ...defaults,payment_method:'pm_card_visa',confirm:true,off_session:true,
  application_fee_amount:100,transfer_data:{destination},
 },{idempotencyKey:marker+'-refundable'});
 assert.equal(charge.status,'succeeded');
 assert.equal(charge.amount_received,1250);
 assert.equal(charge.application_fee_amount,100);
 assert.equal(charge.transfer_data.destination,destination);
 const refund=await stripe.refunds.create({
  payment_intent:charge.id,amount:1250,reason:'requested_by_customer',
  reverse_transfer:true,refund_application_fee:true,
  metadata:{routedrop_failure_ci_run:marker}
 },{idempotencyKey:marker+'-full-refund'});
 assert.equal(refund.amount,1250);
 assert.equal(refund.payment_intent,charge.id);
 assert.ok(['succeeded','pending'].includes(refund.status),'Refund must be accepted by Stripe');
 const reread=await stripe.paymentIntents.retrieve(charge.id);
 assert.equal(reread.amount_received,1250);
 const refundedCharge=await stripe.charges.retrieve(charge.latest_charge);
 assert.equal(refundedCharge.amount_refunded,1250);
 assert.equal(refundedCharge.refunded,true);
 console.log('PASS Stripe TEST full refund and requested transfer/fee reversal',charge.id,refund.id,refund.status);
 // Trigger Stripe's genuine dispute simulator for a new, distinct test payment.
 const disputedPayment=await stripe.paymentIntents.create({
  ...defaults,payment_method:'pm_card_createDispute',confirm:true,off_session:true
 },{idempotencyKey:marker+'-dispute'});
 assert.equal(disputedPayment.status,'succeeded');
 let dispute=null;
 for(let attempt=0;attempt<12;attempt++){
  const list=await stripe.disputes.list({limit:20});
  dispute=list.data.find(d=>d.charge===disputedPayment.latest_charge);
  if(dispute)break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.ok(dispute,'Stripe must create a real test dispute on the new payment');
 assert.equal(dispute.charge,disputedPayment.latest_charge);
 console.log('PASS Stripe TEST dispute created',disputedPayment.id,dispute.id,dispute.status);
 console.log('PASS Genuine test scenarios completed',marker);
});
