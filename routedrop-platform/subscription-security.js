'use strict';
const ACTIVE=new Set(['active','trialing']);
const BLOCK_DUPLICATES=new Set(['active','trialing','past_due','unpaid','incomplete','paused']);
const KNOWN=new Set(['incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused']);
function normalizeSubscriptionEvent(type,obj){
 if(!['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed'].includes(type))return null;
 if(!obj||typeof obj.id!=='string'||!obj.id.startsWith('sub_')||typeof obj.customer!=='string'||!obj.customer.startsWith('cus_'))return null;
 const status=type==='customer.subscription.deleted'?'canceled':obj.status;
 if(!KNOWN.has(status))return null;
 return {id:obj.id,customer:obj.customer,status,cancelAtPeriodEnd:!!obj.cancel_at_period_end,currentPeriodEnd:Number.isSafeInteger(obj.current_period_end)?obj.current_period_end:null};
}
function invoiceEvent(type,obj){
 if(!['invoice.paid','invoice.payment_failed'].includes(type)||!obj||typeof obj.customer!=='string'||!obj.customer.startsWith('cus_'))return null;
 return {customer:obj.customer,status:type==='invoice.paid'?'paid':'payment_failed',subscriptionId:typeof obj.subscription==='string'?obj.subscription:null};
}
function selectSubscription(subscriptions){
 const list=Array.isArray(subscriptions)?subscriptions:[];
 return list.find(s=>ACTIVE.has(s.status))||list.find(s=>BLOCK_DUPLICATES.has(s.status))||list[0]||null;
}
function canStartSubscription(subscriptions){
 return !(Array.isArray(subscriptions)&&subscriptions.some(s=>BLOCK_DUPLICATES.has(s.status)));
}
function subscriptionView(sub){
 if(!sub)return {status:'none',cancel_at_period_end:false,current_period_end:null};
 return {status:KNOWN.has(sub.status)?sub.status:'unknown',cancel_at_period_end:!!sub.cancel_at_period_end,current_period_end:Number.isSafeInteger(sub.current_period_end)?sub.current_period_end:null};
}
function securityPolicy({emailReady,emailVerified,existingAccount}){
 // Never lock out preexisting beta testers while no verified email sender is configured.
 return !emailReady||!!emailVerified||!!existingAccount;
}
module.exports={normalizeSubscriptionEvent,invoiceEvent,selectSubscription,canStartSubscription,subscriptionView,securityPolicy};
