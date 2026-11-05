'use strict';

// Isolated RouteDrop beta: zero-upfront booking + customer-authorized post-service charge.
// This module is inert unless the caller explicitly enables it with a Stripe TEST key.
const ACTIVE = ['awaiting_card','requested','accepted','work_completed','payment_processing','payment_failed','needs_review','disputed','paid'];
const FEE_RATE = 0.08;
const paymentFee = cents => Math.round(cents*FEE_RATE);
const legitimateAmount = cents => Number.isSafeInteger(cents) && cents >= 500 && cents <= 500000;
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
function payable(booking) {
 return booking && booking.status === 'work_completed' && !!booking.payment_method_id &&
  legitimateAmount(Number(booking.price_cents)) && Number(booking.fee_cents) === paymentFee(Number(booking.price_cents)) &&
  !booking.payment_intent_id && !booking.dispute_reason;
}
function chargeParameters(booking, accountId) {
 if (!payable(booking) || typeof booking.stripe_customer_id !== 'string' || !booking.stripe_customer_id.startsWith('cus_') ||
     typeof booking.payment_method_id !== 'string' || !booking.payment_method_id.startsWith('pm_') ||
     typeof accountId !== 'string' || !accountId.startsWith('acct_') || (booking.provider_stripe_account_id && booking.provider_stripe_account_id!==accountId) || !validId(booking.id)) throw Error('Booking is not chargeable');
 return {
  params: { amount:Number(booking.price_cents), currency:'usd',
   customer:booking.stripe_customer_id, payment_method:booking.payment_method_id,
   payment_method_types:['card'], off_session:true, confirm:true,
   application_fee_amount:Number(booking.fee_cents), transfer_data:{destination:accountId},
   metadata:{routedrop_deferred_booking_id:String(booking.id)} },
  options: { idempotencyKey:'routedrop-deferred-charge-v1-'+booking.id }
 };
}
function verifiedCharge(pi, booking) {
 return pi && pi.status === 'succeeded' &&
   pi.currency === 'usd' && Number(pi.amount_received) === Number(booking.price_cents) &&
   Number(pi.amount) === Number(booking.price_cents) &&
   pi.customer === booking.stripe_customer_id &&
   pi.payment_method === booking.payment_method_id &&
   Number(pi.application_fee_amount) === Number(booking.fee_cents) &&
   pi.transfer_data?.destination === (booking.provider_stripe_account_id || booking.stripe_account_id) &&
   String(pi.metadata?.routedrop_deferred_booking_id) === String(booking.id) &&
   typeof pi.id === 'string' && pi.id.startsWith('pi_');
}
const sql = [
 "ALTER TABLE users ADD COLUMN IF NOT EXISTS deferred_stripe_customer_id TEXT",
 "CREATE UNIQUE INDEX IF NOT EXISTS unique_deferred_stripe_customer ON users(deferred_stripe_customer_id) WHERE deferred_stripe_customer_id IS NOT NULL",
 "CREATE TABLE IF NOT EXISTS deferred_bookings (id BIGSERIAL PRIMARY KEY, listing_id BIGINT NOT NULL REFERENCES listings(id), customer_id BIGINT NOT NULL REFERENCES users(id), stripe_customer_id TEXT NOT NULL, setup_session_id TEXT UNIQUE, setup_intent_id TEXT UNIQUE, payment_method_id TEXT, payment_intent_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'awaiting_card' CHECK (status IN ('awaiting_card','requested','accepted','work_completed','payment_processing','paid','payment_failed','needs_review','disputed','canceled')), price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 500 AND 500000), fee_cents INTEGER NOT NULL CHECK (fee_cents>=0), consent_terms TEXT NOT NULL, consent_at TIMESTAMPTZ NOT NULL DEFAULT now(), hold_expires_at TIMESTAMPTZ NOT NULL, accepted_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, dispute_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE UNIQUE INDEX IF NOT EXISTS one_active_deferred_booking_per_slot ON deferred_bookings(listing_id) WHERE status IN ('awaiting_card','requested','accepted','work_completed','payment_processing','payment_failed','needs_review','disputed','paid')",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS provider_stripe_account_id TEXT",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS refunded_cents INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS stripe_dispute_status TEXT",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS stripe_dispute_id TEXT",
 "CREATE INDEX IF NOT EXISTS deferred_bookings_customer ON deferred_bookings(customer_id)",
 "CREATE INDEX IF NOT EXISTS deferred_bookings_listing ON deferred_bookings(listing_id)"
];
async function handleStripeEvent(event, client, stripe, queueDeferredEmail=async()=>{}) {
 const obj=event.data.object;
 if ((event.type==='checkout.session.completed' || event.type==='checkout.session.expired') &&
     obj.mode==='setup' && validId(obj.metadata?.deferred_booking_id)) {
  const id=Number(obj.metadata.deferred_booking_id);
  if (event.type==='checkout.session.expired') {
   await client.query("UPDATE deferred_bookings SET status='canceled' WHERE id=$1 AND setup_session_id=$2 AND status='awaiting_card'",[id,obj.id]);
   return;
  }
  // A success redirect is not proof of card setup: independently verify Stripe's SetupIntent.
  if (typeof obj.setup_intent !== 'string') throw Error('Missing Stripe SetupIntent');
  const intent=await stripe.setupIntents.retrieve(obj.setup_intent);
  if (intent.status!=='succeeded' || typeof intent.payment_method!=='string' || !intent.payment_method.startsWith('pm_')) throw Error('Stripe card setup not confirmed');
  const updated=await client.query(
   "UPDATE deferred_bookings SET status='requested',setup_intent_id=$3,payment_method_id=$4 WHERE id=$1 AND setup_session_id=$2 AND status='awaiting_card' AND hold_expires_at>now() AND stripe_customer_id=$5 RETURNING id",
   [id,obj.id,intent.id,intent.payment_method,intent.customer]);
  if (updated.rowCount===0) return; // duplicate or expired; never revive canceled reservations
  await queueDeferredEmail(client,id,'requested');
  return;
 }
 if ((event.type==='payment_intent.succeeded' || event.type==='payment_intent.payment_failed') &&
     validId(obj.metadata?.routedrop_deferred_booking_id) && typeof obj.id==='string') {
  const id=Number(obj.metadata.routedrop_deferred_booking_id);
  const query=await client.query("SELECT d.*,b.stripe_account_id FROM deferred_bookings d JOIN listings l ON l.id=d.listing_id JOIN businesses b ON b.id=l.business_id WHERE d.id=$1 FOR UPDATE OF d",[id]);
  const booking=query.rows[0];
  if (!booking || !['payment_processing','needs_review','payment_failed'].includes(booking.status) || (booking.payment_intent_id && booking.payment_intent_id!==obj.id)) return;
  if (event.type==='payment_intent.succeeded') {
   if (!verifiedCharge(obj,booking)) throw Error('Unexpected deferred payment properties');
   await client.query("UPDATE deferred_bookings SET status='paid',payment_intent_id=$2,paid_at=now() WHERE id=$1 AND status IN ('payment_processing','needs_review','payment_failed')",[id,obj.id]);
   await queueDeferredEmail(client,id,'paid');
  } else if (obj.customer===booking.stripe_customer_id && Number(obj.amount)===Number(booking.price_cents)) {
   await client.query("UPDATE deferred_bookings SET status='payment_failed',payment_intent_id=$2 WHERE id=$1 AND status IN ('payment_processing','needs_review','payment_failed')",[id,obj.id]);
   await queueDeferredEmail(client,id,'failed');
  }
 }
 if (event.type.startsWith('charge.dispute.') && typeof obj.payment_intent==='string') {
  // Stripe Charge disputes usually do NOT carry the PaymentIntent's metadata.
  const changed=await client.query("UPDATE deferred_bookings SET status='disputed',stripe_dispute_status=$2,stripe_dispute_id=$3 WHERE payment_intent_id=$1 AND status IN ('paid','disputed','needs_review') RETURNING id",[obj.payment_intent,obj.status||'under_review',obj.id||null]);
  for(const row of changed.rows||[])await queueDeferredEmail(client,row.id,'payment_dispute');
 }
 if (event.type==='charge.refunded' && typeof obj.payment_intent==='string' && Number.isSafeInteger(obj.amount_refunded) && obj.amount_refunded>0) {
  // Record refunds; support must reconcile transfer reversal and the 8% application fee.
  const changed=await client.query("UPDATE deferred_bookings SET refunded_cents=GREATEST(refunded_cents,$2),status='needs_review' WHERE payment_intent_id=$1 AND status IN ('paid','needs_review') RETURNING id",[obj.payment_intent,obj.amount_refunded]);
  for(const row of changed.rows||[])await queueDeferredEmail(client,row.id,'refund');
 }
}
function install(app, {pool,stripe,baseUrl,enabled,requireDb,requireUser,safe,limiter,forbidden,queueDeferredEmail=async()=>{}}) {
 const guard=(req,res,next)=>enabled ? next() : forbidden(res,'Deferred booking is disabled in this beta.',503);
 const customer=[guard,requireDb,requireUser('customer'),limiter];
 const business=[guard,requireDb,requireUser('business'),limiter];
 const read=[guard,requireDb,requireUser()];
 const expire=()=>pool.query("UPDATE deferred_bookings SET status='canceled' WHERE status='awaiting_card' AND hold_expires_at<now()");
 app.get('/api/deferred-bookings',...read,safe(async(req,res)=>{
  const filter=req.user.role==='customer'?'d.customer_id=$1':'b.owner_id=$1';
  const q=await pool.query("SELECT d.id,d.status,d.price_cents,d.fee_cents,d.created_at,d.dispute_reason,l.title,l.slot_start,l.neighborhood,b.name AS business_name FROM deferred_bookings d JOIN listings l ON l.id=d.listing_id JOIN businesses b ON b.id=l.business_id WHERE "+filter+" ORDER BY d.created_at DESC LIMIT 100",[req.user.id]);
  res.json({bookings:q.rows});
 }));
 app.post('/api/deferred-bookings',...customer,safe(async(req,res)=>{
  if (!stripe || !baseUrl) return forbidden(res,'Stripe test configuration required.',503);
  if (req.body.consent!==true || req.body.termsVersion!=='deferred-v1') return forbidden(res,'Agree to save a card for the quoted post-service payment before booking.',400);
  const listingId=Number(req.body.listingId);
  if(!validId(listingId)) return forbidden(res,'Invalid listing.',400);
  // Separate Stripe Customer; idempotency prevents duplicate customers if the request is retried.
  let stripeCustomer=(await pool.query('SELECT deferred_stripe_customer_id FROM users WHERE id=$1',[req.user.id])).rows[0]?.deferred_stripe_customer_id;
  if(!stripeCustomer){
   const c=await stripe.customers.create({email:req.user.email,metadata:{routedrop_customer_user_id:String(req.user.id)}},{idempotencyKey:'routedrop-deferred-customer-'+req.user.id});
   await pool.query('UPDATE users SET deferred_stripe_customer_id=$1 WHERE id=$2 AND deferred_stripe_customer_id IS NULL',[c.id,req.user.id]);
   stripeCustomer=(await pool.query('SELECT deferred_stripe_customer_id FROM users WHERE id=$1',[req.user.id])).rows[0]?.deferred_stripe_customer_id;
  }
  const client=await pool.connect();let booking,offer;
  try {
   await client.query('BEGIN');
   await client.query("UPDATE deferred_bookings SET status='canceled' WHERE status='awaiting_card' AND hold_expires_at<now()");
   offer=(await client.query("SELECT l.id,l.price_cents,l.slot_start,l.title,b.stripe_account_id FROM listings l JOIN businesses b ON b.id=l.business_id WHERE l.id=$1 AND l.status='active' AND l.slot_start>now() FOR UPDATE OF l",[listingId])).rows[0];
   if(!offer || !legitimateAmount(offer.price_cents)){await client.query('ROLLBACK');return forbidden(res,'Service is no longer available.',409);}
   const existing=(await client.query("SELECT 1 FROM bookings WHERE listing_id=$1 AND status IN ('awaiting_payment','paid','completed')",[listingId])).rowCount;
   if(existing){await client.query('ROLLBACK');return forbidden(res,'This service slot is already booked.',409);}
   if(!offer.stripe_account_id){await client.query('ROLLBACK');return forbidden(res,'Provider has not connected payouts.',409);}
   booking=(await client.query("INSERT INTO deferred_bookings(listing_id,customer_id,stripe_customer_id,provider_stripe_account_id,price_cents,fee_cents,consent_terms,hold_expires_at) VALUES($1,$2,$3,$4,$5,$6,'deferred-v1',now()+interval '45 minutes') RETURNING id",[listingId,req.user.id,stripeCustomer,offer.stripe_account_id,offer.price_cents,paymentFee(offer.price_cents)])).rows[0];
   await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK').catch(()=>{});if(err.code==='23505')return forbidden(res,'This service slot is already booked.',409);throw err;}finally{client.release();}
  try {
   const account=await stripe.accounts.retrieve(offer.stripe_account_id);
   if(!account.charges_enabled||!account.payouts_enabled) throw Error('Provider payouts are not ready');
   const session=await stripe.checkout.sessions.create({
    mode:'setup',payment_method_types:['card'],customer:stripeCustomer,
    client_reference_id:String(booking.id),metadata:{deferred_booking_id:String(booking.id)},
    setup_intent_data:{metadata:{routedrop_deferred_booking_id:String(booking.id)}},
    success_url:baseUrl+'/?card=return',cancel_url:baseUrl+'/?card=cancel',
    expires_at:Math.floor(Date.now()/1000)+30*60
   },{idempotencyKey:'routedrop-deferred-setup-'+booking.id});
   await pool.query("UPDATE deferred_bookings SET setup_session_id=$1 WHERE id=$2 AND status='awaiting_card'",[session.id,booking.id]);
   return res.json({url:session.url,message:'No upfront payment. Card secured by Stripe.'});
  }catch(err){
   await pool.query("UPDATE deferred_bookings SET status='canceled' WHERE id=$1 AND status='awaiting_card'",[booking.id]).catch(()=>{});
   return forbidden(res,'Unable to reserve the service or save a card. Please try again.',503);
  }
 }));
 app.post('/api/deferred-bookings/:id/accept',...business,safe(async(req,res)=>{
  const q=await pool.query("UPDATE deferred_bookings d SET status='accepted',accepted_at=now() FROM listings l JOIN businesses b ON l.business_id=b.id WHERE d.listing_id=l.id AND b.owner_id=$1 AND d.id=$2 AND d.status='requested' AND l.slot_start>now() RETURNING d.id",[req.user.id,Number(req.params.id)]);
  if(!q.rowCount)return forbidden(res,'Booking cannot be accepted.',409);
  await queueDeferredEmail(pool,Number(req.params.id),'accepted');
  res.json({ok:true,status:'accepted'});
 }));
 app.post('/api/deferred-bookings/:id/decline',...business,safe(async(req,res)=>{
  const q=await pool.query("UPDATE deferred_bookings d SET status='canceled' FROM listings l JOIN businesses b ON l.business_id=b.id WHERE d.listing_id=l.id AND b.owner_id=$1 AND d.id=$2 AND d.status='requested' RETURNING d.id",[req.user.id,Number(req.params.id)]);
  if(!q.rowCount)return forbidden(res,'Booking cannot be declined.',409);
  await queueDeferredEmail(pool,Number(req.params.id),'declined');
  res.json({ok:true,status:'canceled'});
 }));
 app.post('/api/deferred-bookings/:id/cancel',...customer,safe(async(req,res)=>{
  const q=await pool.query("UPDATE deferred_bookings SET status='canceled' WHERE id=$1 AND customer_id=$2 AND status IN ('awaiting_card','requested','accepted') RETURNING id",[Number(req.params.id),req.user.id]);
  if(!q.rowCount)return forbidden(res,'Booking cannot be canceled online. Contact support.',409);
  res.json({ok:true,status:'canceled'});
 }));
 app.post('/api/deferred-bookings/:id/complete',...business,safe(async(req,res)=>{
  const q=await pool.query("UPDATE deferred_bookings d SET status='work_completed',completed_at=now() FROM listings l JOIN businesses b ON l.business_id=b.id WHERE d.listing_id=l.id AND b.owner_id=$1 AND d.id=$2 AND d.status='accepted' AND l.slot_start<=now() RETURNING d.id",[req.user.id,Number(req.params.id)]);
  if(!q.rowCount)return forbidden(res,'Accepted booking must reach its scheduled start before completion.',409);
  await queueDeferredEmail(pool,Number(req.params.id),'completed');
  res.json({ok:true,status:'work_completed',message:'Customer must confirm completion before any charge.'});
 }));
 app.post('/api/deferred-bookings/:id/dispute',...customer,safe(async(req,res)=>{
  const reason=typeof req.body.reason==='string'?req.body.reason.trim().slice(0,500):'';
  if(reason.length<10)return forbidden(res,'Please describe the issue in at least 10 characters.',400);
  const q=await pool.query("UPDATE deferred_bookings SET status='disputed',dispute_reason=$3 WHERE id=$1 AND customer_id=$2 AND status='work_completed' RETURNING id",[Number(req.params.id),req.user.id,reason]);
  if(!q.rowCount)return forbidden(res,'This booking cannot be disputed from its current status.',409);
  await queueDeferredEmail(pool,Number(req.params.id),'disputed');
  res.json({ok:true,status:'disputed',message:'No payment was initiated. Support review is required.'});
 }));
 app.post('/api/deferred-bookings/:id/confirm',...customer,safe(async(req,res)=>{
  // Customer explicitly confirms completed work before we attempt the saved-card charge.
  if(req.body.confirmCompletion!==true)return forbidden(res,'Confirm completion and payment of the displayed amount.',400);
  const id=Number(req.params.id);
  let booking,accountId,charge;
  const client=await pool.connect();
  try {
   await client.query('BEGIN');
   const q=await client.query("SELECT d.*,b.stripe_account_id AS current_provider_account FROM deferred_bookings d JOIN listings l ON l.id=d.listing_id JOIN businesses b ON b.id=l.business_id WHERE d.id=$1 AND d.customer_id=$2 FOR UPDATE OF d",[id,req.user.id]);
   booking=q.rows[0];accountId=booking?.provider_stripe_account_id;
   if(accountId !== booking?.current_provider_account)throw Error('Provider payout account changed; support review required');
   charge=chargeParameters(booking,accountId);
   const account=await stripe.accounts.retrieve(accountId);
   if(!account.charges_enabled||!account.payouts_enabled){await client.query('ROLLBACK');return forbidden(res,'Provider payouts are temporarily unavailable.',503);}
   await client.query("UPDATE deferred_bookings SET status='payment_processing',confirmed_at=now() WHERE id=$1 AND status='work_completed'",[id]);
   await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK').catch(()=>{});return forbidden(res,'Booking cannot be charged at this time. Contact support if you already confirmed.',409);}finally{client.release();}
  try {
   const pi=await stripe.paymentIntents.create(charge.params,charge.options);
   await pool.query("UPDATE deferred_bookings SET payment_intent_id=$2,status=CASE WHEN $3 IN ('succeeded','processing') THEN 'payment_processing' ELSE 'needs_review' END WHERE id=$1 AND status='payment_processing' AND (payment_intent_id IS NULL OR payment_intent_id=$2)",[id,pi.id,pi.status]);
   return res.json({ok:true,status:['succeeded','processing'].includes(pi.status)?'payment_processing':'needs_review',message:['succeeded','processing'].includes(pi.status)?'Payment submitted. Final status will be confirmed by Stripe.':'Card may require authentication or support review. No automatic retry will occur.'});
  }catch(err){
   // Network errors are ambiguous. Never automatically retry or take another payment.
   // Card authentication failures require a customer recovery flow and support reconciliation.
   if(err?.type==='StripeCardError'){
    await pool.query("UPDATE deferred_bookings SET status='payment_failed',payment_intent_id=COALESCE(payment_intent_id,$2) WHERE id=$1 AND status='payment_processing'",[id,err.payment_intent?.id||null]).catch(()=>{});
    return forbidden(res,'Card requires an update or authentication. No automatic retry will occur; contact support.',409);
   }
   return forbidden(res,'Payment result is being verified. Do not retry; contact support.',503);
  }
 }));
}
module.exports={sql,ACTIVE,paymentFee,legitimateAmount,payable,chargeParameters,verifiedCharge,handleStripeEvent,install};
