'use strict';
function livePaymentsAllowed(secretKey, approval){
 return !/^(sk|rk)_live_/.test(secretKey||'') || approval === 'true';
}
function checkoutOutcome(type, object){
 if (!object || object.mode==='subscription') return null;
 if ((type==='checkout.session.completed' && object.payment_status==='paid') || type==='checkout.session.async_payment_succeeded') return 'paid';
 if (type==='checkout.session.expired' || type==='checkout.session.async_payment_failed') return 'canceled';
 return null;
}
function refundableAmount(type, charge){
 if(type!=='charge.refunded' || !charge || typeof charge.payment_intent!=='string')return null;
 return Number.isSafeInteger(charge.amount_refunded) && charge.amount_refunded>=0 ? charge.amount_refunded : null;
}
function disputeState(type, dispute){
 if(!['charge.dispute.created','charge.dispute.updated','charge.dispute.closed'].includes(type) || !dispute || typeof dispute.payment_intent!=='string')return null;
 return typeof dispute.status==='string' ? dispute.status : 'under_review';
}
module.exports={livePaymentsAllowed,checkoutOutcome,refundableAmount,disputeState};
