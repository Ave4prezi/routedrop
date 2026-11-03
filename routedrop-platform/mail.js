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
