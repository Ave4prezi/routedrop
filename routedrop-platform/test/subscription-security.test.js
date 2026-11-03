'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeSubscriptionEvent,invoiceSubscriptionId,invoiceEvent,selectSubscription,canStartSubscription,subscriptionView,securityPolicy}=require('../subscription-security');
const sub=(status,extra={})=>({id:'sub_123',customer:'cus_123',status,...extra});
test('subscription changes accept valid signed webhook object shapes',()=>{
 assert.deepEqual(normalizeSubscriptionEvent('customer.subscription.updated',sub('past_due')),{id:'sub_123',customer:'cus_123',status:'past_due',cancelAtPeriodEnd:false,currentPeriodEnd:null});
 assert.equal(normalizeSubscriptionEvent('customer.subscription.deleted',sub('active')).status,'canceled');
 assert.equal(normalizeSubscriptionEvent('customer.subscription.paused',sub('paused')).status,'paused');
 assert.equal(normalizeSubscriptionEvent('customer.subscription.updated',{id:'bad',customer:'cus_123',status:'active'}),null);
 assert.equal(normalizeSubscriptionEvent('invoice.paid',sub('active')),null);
});
test('invoice failure and recovery statuses',()=>{
 assert.equal(invoiceEvent('invoice.payment_failed',{customer:'cus_123',subscription:'sub_123'}).status,'payment_failed');
 assert.equal(invoiceEvent('invoice.paid',{customer:'cus_123',subscription:'sub_123'}).status,'paid');
 assert.equal(invoiceEvent('invoice.payment_failed',{customer:'bad'}),null);
});
test('current Stripe invoice parent schema maps failure to the exact subscription',()=>{
 const invoice={id:'in_qa',customer:'cus_123',parent:{type:'subscription_details',subscription_details:{subscription:'sub_123'}}};
 assert.equal(invoiceSubscriptionId(invoice),'sub_123');
 assert.deepEqual(invoiceEvent('invoice.payment_failed',invoice),{customer:'cus_123',status:'payment_failed',subscriptionId:'sub_123'});
 assert.deepEqual(invoiceEvent('invoice.paid',invoice),{customer:'cus_123',status:'paid',subscriptionId:'sub_123'});
});
test('unrelated invoices cannot overwrite business membership status',()=>{
 assert.equal(invoiceEvent('invoice.payment_failed',{customer:'cus_123',parent:{type:'invoiceitem_details'}}),null);
 assert.equal(invoiceEvent('invoice.paid',{customer:'cus_123',subscription:'unexpected'}),null);
 assert.equal(invoiceEvent('invoice.paid',{customer:'cus_123',parent:{subscription_details:{subscription:'sub_other'}}}).subscriptionId,'sub_other');
});
test('canceled subscriptions remain canceled and can be replaced',()=>{
 const ended=normalizeSubscriptionEvent('customer.subscription.deleted',sub('active'));
 assert.equal(ended.status,'canceled');
 assert.equal(subscriptionView(sub(ended.status)).status,'canceled');
 assert.equal(canStartSubscription([sub(ended.status)]),true);
});
test('prevent duplicate memberships including paused and overdue',()=>{
 for(const status of ['active','trialing','past_due','unpaid','incomplete','paused'])assert.equal(canStartSubscription([sub(status)]),false);
 assert.equal(canStartSubscription([sub('canceled')]),true);
 assert.equal(canStartSubscription([]),true);
 assert.equal(selectSubscription([sub('canceled'),sub('active')]).status,'active');
});
test('subscription visibility shows cancellation and renewal date',()=>{
 const result=subscriptionView(sub('active',{cancel_at_period_end:true,current_period_end:1795000000}));
 assert.equal(result.cancel_at_period_end,true);
 assert.equal(result.current_period_end,1795000000);
 assert.equal(subscriptionView(null).status,'none');
});
test('existing beta accounts are not locked out by email verification rollout',()=>{
 assert.equal(securityPolicy({emailReady:false,emailVerified:false,existingAccount:false}),true);
 assert.equal(securityPolicy({emailReady:true,emailVerified:false,existingAccount:true}),true);
 assert.equal(securityPolicy({emailReady:true,emailVerified:false,existingAccount:false}),false);
 assert.equal(securityPolicy({emailReady:true,emailVerified:true,existingAccount:false}),true);
});
