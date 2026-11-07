'use strict';
const providerReady=env=>!!(env.RESEND_API_KEY && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ROUTEDROP_EMAIL_FROM||'') && /^https:\/\//.test(env.PUBLIC_URL||''));
function emailLink(base,path,token){return base.replace(/\/+$/,'')+'/?'+path+'='+encodeURIComponent(token);}
function isActionToken(v){return typeof v==='string' && /^[0-9a-f]{64}$/.test(v);}
function cleanForEmail(v,max=120){return String(v||'').replace(/[\r\n\t<>]/g,' ').trim().slice(0,max);}
function notification(kind,details){
 const title=cleanForEmail(details.title),name=cleanForEmail(details.name,90),date=cleanForEmail(details.date,70),amount=cleanForEmail(details.amount,32);
 const messages={
  booking_customer:{subject:'RouteDrop booking confirmed',body:`Your booking for ${title} on ${date} has been confirmed. Total: ${amount}. View your booking in RouteDrop.`},
  booking_business:{subject:'RouteDrop: new paid booking',body:`You have a new paid booking for ${title} on ${date}. Customer: ${name}. Sign in to Business Studio for details.`},
  cancellation_customer:{subject:'RouteDrop cancellation request received',body:`Your cancellation request for ${title} has been submitted. Review status in My Bookings.`},
  cancellation_business:{subject:'RouteDrop cancellation needs review',body:`A customer requested cancellation for ${title} on ${date}. Review the request in Business Studio.`},
  refund_customer:{subject:'RouteDrop refund update',body:`A refund for ${title} totaling ${amount} was recorded. Check My Bookings for status.`},
  refund_business:{subject:'RouteDrop booking refunded',body:`A refund was recorded for ${title}. Check Business Studio for details.`},
  deferred_requested_customer:{subject:'RouteDrop request submitted — $0 charged',body:`Your service request for ${title} on ${date} was submitted. Quoted price: ${amount}. Your card was saved securely, and $0 was charged. The provider must accept your request. You will authorize payment only after service completion.`},
  deferred_requested_business:{subject:'RouteDrop: new booking request',body:`You have a new service request for ${title} on ${date}. Customer: ${name}. Review and accept or decline in Business Studio. No payment has been collected.`},
  deferred_accepted_customer:{subject:'RouteDrop booking accepted',body:`Your booking for ${title} on ${date} has been accepted. The quoted service price is ${amount}. No payment is due until the service is completed and you confirm.`},
  deferred_declined_customer:{subject:'RouteDrop booking request declined',body:`Your request for ${title} on ${date} was declined by the provider. No payment was charged.`},
  deferred_completed_customer:{subject:'RouteDrop: please confirm completed work',body:`The provider marked ${title} as completed. Sign in to My Bookings to confirm the service and approve payment of ${amount}, or report a problem. No charge is initiated just because the provider marked the work completed.`},
  deferred_disputed_business:{subject:'RouteDrop: customer reported a service issue',body:`The customer reported a problem with ${title}. Payment collection is paused. Sign in to Business Studio and contact support for resolution.`},
  deferred_paid_customer:{subject:'RouteDrop payment receipt',body:`Stripe confirmed your payment for ${title}: ${amount}. Review the booking in RouteDrop for details.`},
  deferred_paid_business:{subject:'RouteDrop payment confirmed',body:`Payment was confirmed for ${title}: ${amount}. RouteDrop's platform application fee is 8% before any applicable Stripe fees. Review Business Studio for payout details.`},
  deferred_failed_customer:{subject:'RouteDrop payment needs attention',body:`Payment for ${title} could not be confirmed. No automatic retry will occur. Sign in to RouteDrop and contact support to resolve the payment without risking duplicate charges.`},
  deferred_failed_business:{subject:'RouteDrop service payment needs review',body:`Payment for ${title} could not be confirmed. Do not collect a second payment outside RouteDrop until support reconciles the charge.`},
  deferred_refund_requested_business:{subject:'RouteDrop: customer refund request',body:`The customer requested a refund review for ${title} (${amount}). Review it in Business Studio. No refund has been issued yet.`},
  deferred_refund_declined_customer:{subject:'RouteDrop refund request declined',body:`Your refund request for ${title} was declined. Contact RouteDrop support if you need further assistance.`},
  deferred_refund_business:{subject:'RouteDrop full refund confirmed',body:`The full refund for ${title} was confirmed. The customer amount, connected-account transfer, and RouteDrop application fee were submitted for reversal; verify settlement in Stripe.`},
  deferred_refund_customer:{subject:'RouteDrop refund status updated',body:`A Stripe refund or refund update was recorded for ${title}. Sign in to RouteDrop for details. Refund status and final settlement must be verified before the amount is considered returned.`},
  deferred_review_requested_customer:{subject:'RouteDrop: review completed; your approval is needed',body:`Support reviewed your service issue for ${title}. Payment remains blocked. Sign in to RouteDrop to accept or decline the proposed resolution. No charge occurs unless you also separately confirm the work and authorize payment of ${amount}.`},
  deferred_review_requested_business:{subject:'RouteDrop: waiting for customer resolution decision',body:`Support reviewed the issue with ${title}. The customer must accept the proposed resolution and separately confirm payment. No funds have been collected.`},
  deferred_review_closed_customer:{subject:'RouteDrop: dispute closed without payment',body:`Support closed the service dispute for ${title}. No charge was initiated for this booking.`},
  deferred_review_closed_business:{subject:'RouteDrop: dispute closed without payment',body:`Support closed the service dispute for ${title}. No payment will be collected for this booking.`},
  deferred_dispute_customer:{subject:'RouteDrop payment dispute under review',body:`A payment dispute was recorded for ${title}. Sign in to RouteDrop for the current status and support details.`},
  subscription_failed:{subject:'RouteDrop membership payment failed',body:'Your RouteDrop business membership payment could not be completed. Sign in to Business Studio to update billing details.'},
  subscription_paid:{subject:'RouteDrop membership payment received',body:'Your RouteDrop business membership payment was received. Manage billing from Business Studio.'}
 };
 return messages[kind]||null;
}
async function deliverEmail({to,subject,text},env=process.env,send=fetch){
 if(!providerReady(env))throw Error('Email sender is not configured');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!subject||!text)throw Error('Invalid email message');
 const response=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.ROUTEDROP_EMAIL_FROM,to:[to],subject,text}) ,signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Email provider rejected message ('+response.status+')');
 return true;
}
module.exports={providerReady,emailLink,isActionToken,cleanForEmail,notification,deliverEmail};
