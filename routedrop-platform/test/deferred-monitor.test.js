'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateBooking,verifyPayment,verifyRefund,collect,bookingsSql}=require('../monitor-deferred');

const now=new Date('2026-11-07T07:00:00Z');
const base={id:'9',status:'paid',created_at:'2026-11-07T06:00:00Z',confirmed_at:'2026-11-07T06:10:00Z',
 price_cents:1000,fee_cents:80,refunded_cents:0,payment_intent_id:'pi_ok',
 provider_stripe_account_id:'acct_provider',paid_at:'2026-11-07T06:11:00Z',
 refund_status:null,refund_id:null,recovery_requested_at:null};
const pi={id:'pi_ok',status:'succeeded',livemode:false,amount:1000,amount_received:1000,currency:'usd',
 application_fee_amount:80,transfer_data:{destination:'acct_provider'}};
test('payment monitor flags stuck processing, unresolved recoveries and refunds',()=>{
 assert.deepEqual(evaluateBooking({...base,status:'payment_processing',confirmed_at:'2026-11-07T06:20:00Z'},now).map(x=>x.code),['payment_processing_stuck']);
 assert.deepEqual(evaluateBooking({...base,status:'recovery_pending',recovery_requested_at:'2026-11-07T06:10:00Z'},now).map(x=>x.code),['payment_needs_attention']);
 assert.deepEqual(evaluateBooking({...base,refund_status:'needs_review',refund_decided_at:'2026-11-07T06:30:00Z'},now).map(x=>x.code),['refund_needs_reconciliation']);
 assert.deepEqual(evaluateBooking({...base,status:'refunded',refunded_cents:999,refund_id:null},now).map(x=>x.code),['refunded_inconsistent']);
 assert.deepEqual(evaluateBooking(base,now),[]);
});
test('reconciliation verifies exact Stripe amount, mode, fee and destination',()=>{
 assert.equal(verifyPayment(base,pi),null);
 for(const bad of [
  {...pi,status:'requires_payment_method'}, {...pi,amount_received:0},
  {...pi,application_fee_amount:79},{...pi,livemode:true},
  {...pi,transfer_data:{destination:'acct_other'}}
 ])assert.equal(verifyPayment(base,bad).code,'stripe_payment_mismatch');
 assert.equal(verifyRefund({...base,refund_id:'re_ok'}, {id:'re_ok',payment_intent:'pi_ok',amount:1000,status:'succeeded'}),null);
 assert.equal(verifyRefund({...base,refund_id:'re_ok'}, {id:'re_ok',payment_intent:'pi_ok',amount:999,status:'succeeded'}).code,'stripe_refund_mismatch');
});
test('monitor reads data only, reports Stripe errors, and includes failed notifications',async()=>{
 const queries=[];
 const pool={query:async sql=>{
  queries.push(sql);
  if(sql===bookingsSql)return {rows:[base,{...base,id:'10',payment_intent_id:'pi_unavailable'}]};
  return {rows:[{failed:2}]};
 }};
 const stripe={paymentIntents:{retrieve:async id=>{
  if(id==='pi_unavailable')throw Error('Stripe unavailable');
  return pi;
 }},refunds:{retrieve:async()=>{throw Error('not expected');}}};
 const report=await collect({pool,stripe,now});
 assert.equal(report.records_examined,2);
 assert.equal(report.stripe_payments_verified,1);
 assert.deepEqual(report.alerts.map(x=>x.code),['stripe_reconciliation_unavailable','notification_outbox_failed']);
 assert.equal(queries.length,2);
 assert.ok(queries.every(q=>/^\s*SELECT/i.test(q)));
});
