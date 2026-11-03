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

const DAY_MS=24*60*60*1000;
function cancellationEligibility(booking, now=Date.now()){
 const start=new Date(booking?.slot_start).getTime();
 if(!booking||booking.status!=='paid'||!Number.isFinite(start)||start<=now)return {canRequest:false,fullRefund:false,reason:'Only upcoming, paid appointments are eligible.'};
 if((booking.refund_cents||0)>0)return {canRequest:false,fullRefund:false,reason:'A refund was already recorded.'};
 if(booking.dispute_status)return {canRequest:false,fullRefund:false,reason:'A payment dispute needs separate review.'};
 return {canRequest:true,fullRefund:start-now>=DAY_MS,reason:start-now>=DAY_MS?'Full refund eligible (24+ hours notice).':'Within 24 hours: refund at business discretion.'};
}
function refundStatus(refund){
 if(!refund||!['succeeded','pending','requires_action','failed','canceled'].includes(refund.status))return 'needs_review';
 if(refund.status==='succeeded')return 'refunded';
 if(refund.status==='failed'||refund.status==='canceled')return 'needs_review';
 return 'processing';
}
function refundOperation(request){
 if(!Number.isSafeInteger(Number(request?.id))||Number(request.id)<1||!Number.isSafeInteger(Number(request.booking_id))||Number(request.booking_id)<1||!Number.isSafeInteger(Number(request.price_cents))||Number(request.price_cents)<500||typeof request.payment_intent_id!=='string'||!request.payment_intent_id.startsWith('pi_'))throw Error('Invalid refund request');
 return {
  params:{payment_intent:request.payment_intent_id,amount:Number(request.price_cents),reason:'requested_by_customer',reverse_transfer:true,refund_application_fee:true,metadata:{routedrop_booking_id:String(request.booking_id),routedrop_cancellation_request_id:String(request.id)}},
  options:{idempotencyKey:'routedrop-cancellation-refund-'+request.id}
 };
}
module.exports={livePaymentsAllowed,checkoutOutcome,refundableAmount,disputeState,cancellationEligibility,refundStatus,refundOperation};
