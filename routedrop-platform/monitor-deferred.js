'use strict';
// RouteDrop staging-only, read-only payment reconciliation. Never retries, charges, refunds, or mutates records.
const {Pool}=require('pg');
const Stripe=require('stripe');

function evaluateBooking(row, now=new Date()) {
 const alerts=[];
 const mins=(t)=>t ? (now-new Date(t))/60000 : null;
 const age=mins(row.confirmed_at||row.recovery_requested_at||row.created_at);
 if (row.status==='payment_processing' && age!==null && age>=15)
  alerts.push({severity:'critical',code:'payment_processing_stuck',booking_id:row.id,detail:'Payment awaiting Stripe confirmation >15 min'});
 if (['payment_failed','recovery_pending','needs_review'].includes(row.status) && age!==null && age>=30)
  alerts.push({severity:'warning',code:'payment_needs_attention',booking_id:row.id,detail:row.status+' >30 min'});
 if (row.refund_status && ['processing','needs_review'].includes(row.refund_status) &&
     mins(row.refund_decided_at||row.refund_requested_at)>=15)
  alerts.push({severity:'critical',code:'refund_needs_reconciliation',booking_id:row.id,detail:'Refund status '+row.refund_status+' >15 min'});
 if (row.status==='paid' && !row.payment_intent_id)
  alerts.push({severity:'critical',code:'paid_missing_intent',booking_id:row.id,detail:'Paid booking has no Stripe payment reference'});
 if (row.status==='refunded' && (Number(row.refunded_cents)!==Number(row.price_cents)||!row.refund_id))
  alerts.push({severity:'critical',code:'refunded_inconsistent',booking_id:row.id,detail:'Refunded booking missing complete refund reference/amount'});
 return alerts;
}
function verifyPayment(row,pi) {
 if (pi?.id!==row.payment_intent_id || pi.status!=='succeeded' || pi.livemode!==false ||
     pi.currency!=='usd' || Number(pi.amount)!==Number(row.price_cents) ||
     Number(pi.amount_received)!==Number(row.price_cents) ||
     Number(pi.application_fee_amount)!==Number(row.fee_cents) ||
     pi.transfer_data?.destination!==row.provider_stripe_account_id)
  return {severity:'critical',code:'stripe_payment_mismatch',booking_id:row.id,detail:'Stripe payment does not match booking terms'};
 return null;
}
function verifyRefund(row,refund) {
 if(refund?.id!==row.refund_id || refund.status!=='succeeded' ||
    Number(refund.amount)!==Number(row.price_cents) || refund.payment_intent!==row.payment_intent_id)
  return {severity:'critical',code:'stripe_refund_mismatch',booking_id:row.id,detail:'Stripe refund is missing, incomplete or mismatched'};
 return null;
}
const bookingsSql=`
 SELECT d.id,d.status,d.created_at,d.confirmed_at,d.recovery_requested_at,
 d.price_cents,d.fee_cents,d.refunded_cents,d.payment_intent_id,d.provider_stripe_account_id,
 rr.status AS refund_status,rr.refund_id,rr.requested_at AS refund_requested_at,rr.decided_at AS refund_decided_at
 FROM deferred_bookings d
 LEFT JOIN deferred_refund_requests rr ON rr.booking_id=d.id
 WHERE (d.status IN ('payment_processing','payment_failed','recovery_pending','needs_review'))
    OR (rr.status IN ('processing','needs_review'))
    OR (d.status IN ('paid','refunded') AND d.paid_at>now()-interval '7 days')
 ORDER BY d.id DESC LIMIT 200`;
async function collect({pool,stripe,now=new Date()}) {
 const {rows}=await pool.query(bookingsSql);
 const alerts=rows.flatMap(row=>evaluateBooking(row,now));
 // Reconcile recent settled records. On a Stripe API outage, report an alert, never infer that money moved.
 let checked=0;
 for(const row of rows.filter(r=>['paid','refunded'].includes(r.status))) {
  if(!row.payment_intent_id) continue;
  try {
   const pi=await stripe.paymentIntents.retrieve(row.payment_intent_id);
   checked++;
   const mismatch=verifyPayment(row,pi);
   if(mismatch) alerts.push(mismatch);
   if(row.status==='refunded' && row.refund_id) {
    const refund=await stripe.refunds.retrieve(row.refund_id);
    const refundMismatch=verifyRefund(row,refund);
    if(refundMismatch)alerts.push(refundMismatch);
   }
  }catch(_e) {
   alerts.push({severity:'critical',code:'stripe_reconciliation_unavailable',booking_id:row.id,detail:'Could not retrieve Stripe record; manually reconcile'});
  }
 }
 const {rows:outbox}=await pool.query(`SELECT count(*)::int AS failed FROM notification_outbox WHERE status='failed'`);
 if(Number(outbox[0].failed)>0) alerts.push({severity:'warning',code:'notification_outbox_failed',detail:String(outbox[0].failed)+' email notifications failed'});
 return {checked_at:now.toISOString(),records_examined:rows.length,stripe_payments_verified:checked,alerts};
}
async function main() {
 if(process.env.ROUTEDROP_STAGING_LOCK!=='true' || !/^sk_test_/.test(process.env.STRIPE_SECRET_KEY||''))
  throw Error('Refusing to run: staging lock and Stripe test key are required');
 if(!process.env.DATABASE_URL)throw Error('Staging DATABASE_URL required');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:15000});
 const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{maxNetworkRetries:0,timeout:10000});
 try {
  const report=await collect({pool,stripe});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.alerts.some(a=>a.severity==='critical'))process.exitCode=2;
  else if(report.alerts.length)process.exitCode=1;
 }finally {await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('RouteDrop monitoring failed:',e.message);process.exitCode=2;});
module.exports={evaluateBooking,verifyPayment,verifyRefund,collect,bookingsSql};
