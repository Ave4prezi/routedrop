'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {livePaymentsAllowed,checkoutOutcome,refundableAmount,disputeState}=require('../payment-safeguards');
test('live keys stay locked until explicit approval',()=>{
 assert.equal(livePaymentsAllowed('sk_live_example',undefined),false);
 assert.equal(livePaymentsAllowed('sk_live_example','false'),false);
 assert.equal(livePaymentsAllowed('rk_live_example','false'),false);
 assert.equal(livePaymentsAllowed('sk_live_example','true'),true);
 assert.equal(livePaymentsAllowed('sk_test_example',undefined),true);
});
test('only confirmed paid checkouts can mark a booking paid',()=>{
 assert.equal(checkoutOutcome('checkout.session.completed',{mode:'payment',payment_status:'paid'}),'paid');
 assert.equal(checkoutOutcome('checkout.session.completed',{mode:'payment',payment_status:'unpaid'}),null);
 assert.equal(checkoutOutcome('checkout.session.completed',{mode:'subscription',payment_status:'paid'}),null);
 assert.equal(checkoutOutcome('checkout.session.async_payment_succeeded',{mode:'payment'}),'paid');
 assert.equal(checkoutOutcome('checkout.session.expired',{mode:'payment'}),'canceled');
 assert.equal(checkoutOutcome('checkout.session.async_payment_failed',{mode:'payment'}),'canceled');
});
test('refund amount requires a charge refund and linked payment intent',()=>{
 assert.equal(refundableAmount('charge.refunded',{payment_intent:'pi_abc',amount_refunded:2500}),2500);
 assert.equal(refundableAmount('charge.refunded',{payment_intent:'pi_abc',amount_refunded:-1}),null);
 assert.equal(refundableAmount('charge.succeeded',{payment_intent:'pi_abc',amount_refunded:2500}),null);
 assert.equal(refundableAmount('charge.refunded',{amount_refunded:2500}),null);
});
test('dispute updates only accept recognized dispute events',()=>{
 assert.equal(disputeState('charge.dispute.created',{payment_intent:'pi_abc',status:'needs_response'}),'needs_response');
 assert.equal(disputeState('charge.dispute.closed',{payment_intent:'pi_abc',status:'won'}),'won');
 assert.equal(disputeState('charge.succeeded',{payment_intent:'pi_abc',status:'won'}),null);
 assert.equal(disputeState('charge.dispute.created',{status:'needs_response'}),null);
});
