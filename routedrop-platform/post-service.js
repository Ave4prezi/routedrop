'use strict';

// Isolated RouteDrop beta: zero-upfront booking + customer-authorized post-service charge.
// This module is inert unless the caller explicitly enables it with a Stripe TEST key.
const ACTIVE = ['awaiting_card','requested','accepted','work_completed','payment_processing','payment_failed','recovery_pending','needs_review','disputed','paid','refunded'];
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
function recoveryEligible(booking,pi) {
 return booking && booking.status==='payment_failed' && !!booking.payment_intent_id &&
  !booking.recovery_checkout_session_id && !booking.dispute_reason && Number(booking.refunded_cents||0)===0 &&
  pi && pi.id===booking.payment_intent_id &&
  ['requires_action','requires_payment_method','requires_confirmation','canceled'].includes(pi.status) &&
  pi.customer===booking.stripe_customer_id &&
  pi.currency==='usd' && Number(pi.amount)===Number(booking.price_cents) &&
  Number(pi.application_fee_amount)===Number(booking.fee_cents) &&
  pi.transfer_data?.destination===booking.provider_stripe_account_id &&
  String(pi.metadata?.routedrop_deferred_booking_id)===String(booking.id);
}
function verifiedRecoveryCharge(pi,booking) {
 return pi && pi.status==='succeeded' && pi.currency==='usd' &&
  Number(pi.amount)===Number(booking.price_cents) &&
  Number(pi.amount_received)===Number(booking.price_cents) &&
  pi.customer===booking.stripe_customer_id &&
  Number(pi.application_fee_amount)===Number(booking.fee_cents) &&
  pi.transfer_data?.destination===booking.provider_stripe_account_id &&
  String(pi.metadata?.routedrop_deferred_recovery_booking_id)===String(booking.id) &&
  typeof pi.id==='string' && pi.id.startsWith('pi_') &&
  typeof pi.payment_method==='string' && pi.payment_method.startsWith('pm_');
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
 "CREATE TABLE IF NOT EXISTS deferred_bookings (id BIGSERIAL PRIMARY KEY, listing_id BIGINT NOT NULL REFERENCES listings(id), customer_id BIGINT NOT NULL REFERENCES users(id), stripe_customer_id TEXT NOT NULL, setup_session_id TEXT UNIQUE, setup_intent_id TEXT UNIQUE, payment_method_id TEXT, payment_intent_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'awaiting_card' CHECK (status IN ('awaiting_card','requested','accepted','work_completed','payment_processing','paid','payment_failed','recovery_pending','needs_review','disputed','refunded','canceled')), price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 500 AND 500000), fee_cents INTEGER NOT NULL CHECK (fee_cents>=0), consent_terms TEXT NOT NULL, consent_at TIMESTAMPTZ NOT NULL DEFAULT now(), hold_expires_at TIMESTAMPTZ NOT NULL, accepted_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, dispute_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE UNIQUE INDEX IF NOT EXISTS one_active_deferred_booking_per_slot ON deferred_bookings(listing_id) WHERE status IN ('awaiting_card','requested','accepted','work_completed','payment_processing','payment_failed','recovery_pending','needs_review','disputed','paid','refunded')",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS provider_stripe_account_id TEXT",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS refunded_cents INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS stripe_dispute_status TEXT",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS stripe_dispute_id TEXT",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS recovery_checkout_session_id TEXT UNIQUE",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS recovery_intent_id TEXT UNIQUE",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS initial_payment_intent_id TEXT",
 "ALTER TABLE deferred_bookings ADD COLUMN IF NOT EXISTS recovery_requested_at TIMESTAMPTZ",
 "CREATE TABLE IF NOT EXISTS deferred_support_agents (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, added_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE TABLE IF NOT EXISTS deferred_dispute_reviews (booking_id BIGINT PRIMARY KEY REFERENCES deferred_bookings(id) ON DELETE CASCADE, state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','awaiting_customer','customer_declined','customer_accepted','closed_no_charge')), original_reason TEXT NOT NULL, resolution_note TEXT, reviewed_by BIGINT REFERENCES users(id), reviewed_at TIMESTAMPTZ, customer_accepted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE TABLE IF NOT EXISTS deferred_dispute_events (id BIGSERIAL PRIMARY KEY, booking_id BIGINT NOT NULL REFERENCES deferred_bookings(id) ON DELETE CASCADE, actor_id BIGINT REFERENCES users(id), action TEXT NOT NULL, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS deferred_dispute_events_booking ON deferred_dispute_events(booking_id,created_at)",
 "CREATE INDEX IF NOT EXISTS deferred_bookings_customer ON deferred_bookings(customer_id)",
 "CREATE INDEX IF NOT EXISTS deferred_bookings_listing ON deferred_bookings(listing_id)",
 "CREATE TABLE IF NOT EXISTS deferred_refund_requests (id BIGSERIAL PRIMARY KEY, booking_id BIGINT NOT NULL UNIQUE REFERENCES deferred_bookings(id), customer_id BIGINT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','refunded','declined','needs_review')), refund_id TEXT UNIQUE, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_by BIGINT REFERENCES users(id), decided_at TIMESTAMPTZ)",
 "CREATE INDEX IF NOT EXISTS deferred_refund_requests_customer ON deferred_refund_requests(customer_id)"
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
 if ((event.type==='checkout.session.completed' || event.type==='checkout.session.expired' || event.type==='checkout.session.async_payment_succeeded') &&
     obj.mode==='payment' && validId(obj.metadata?.deferred_recovery_booking_id)) {
  const id=Number(obj.metadata.deferred_recovery_booking_id);
  if(event.type==='checkout.session.expired') {
   const canceled=await client.query("UPDATE deferred_bookings SET status='needs_review' WHERE id=$1 AND status='recovery_pending' AND recovery_checkout_session_id=$2 RETURNING id",[id,obj.id]);
   if(canceled.rowCount)await queueDeferredEmail(client,id,'failed');
   return;
  }
  if (obj.payment_status!=='paid' || typeof obj.payment_intent!=='string') return;
  const row=await client.query("SELECT * FROM deferred_bookings WHERE id=$1 FOR UPDATE",[id]);
  const booking=row.rows[0];
  if (!booking || booking.status!=='recovery_pending' || booking.recovery_checkout_session_id!==obj.id ||
      booking.stripe_customer_id!==obj.customer || obj.currency!=='usd' || Number(obj.amount_total)!==Number(booking.price_cents) ) return;
  const pi=await stripe.paymentIntents.retrieve(obj.payment_intent);
  if(!verifiedRecoveryCharge(pi,booking))throw Error('Stripe recovery payment did not match the agreed amount and destination');
  await client.query("UPDATE deferred_bookings SET status='paid',initial_payment_intent_id=payment_intent_id,payment_intent_id=$2,recovery_intent_id=$2,paid_at=now() WHERE id=$1 AND status='recovery_pending' AND recovery_checkout_session_id=$3",[id,pi.id,obj.id]);
  await queueDeferredEmail(client,id,'paid');
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
 if ((event.type==='refund.updated'||event.type==='refund.failed') &&
     validId(obj.metadata?.routedrop_deferred_refund_id) && typeof obj.payment_intent==='string' && typeof obj.id==='string') {
  const id=Number(obj.metadata.routedrop_deferred_refund_id);
  const row=await client.query("SELECT r.id,r.status,r.refund_id,r.booking_id,d.price_cents,d.payment_intent_id FROM deferred_refund_requests r JOIN deferred_bookings d ON d.id=r.booking_id WHERE r.id=$1 FOR UPDATE OF r,d",[id]);
  const data=row.rows[0];
  if(data && ['processing','needs_review'].includes(data.status) && (!data.refund_id||data.refund_id===obj.id) &&
      data.payment_intent_id===obj.payment_intent && Number(data.price_cents)===Number(obj.amount)) {
   if(event.type==='refund.updated' && obj.status==='succeeded') {
    await client.query("UPDATE deferred_refund_requests SET status='refunded',refund_id=$2 WHERE id=$1 AND status IN ('processing','needs_review')",[id,obj.id]);
    await client.query("UPDATE deferred_bookings SET status='refunded',refunded_cents=price_cents WHERE id=$1 AND status IN ('paid','needs_review')",[data.booking_id]);
    await queueDeferredEmail(client,data.booking_id,'refund');
   } else if(event.type==='refund.failed' || ['failed','canceled'].includes(obj.status)) {
    await client.query("UPDATE deferred_refund_requests SET status='needs_review',refund_id=$2 WHERE id=$1 AND status IN ('processing','needs_review')",[id,obj.id]);
   }
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
  const q=await pool.query("SELECT d.id,d.status,d.price_cents,d.fee_cents,d.created_at,d.dispute_reason,(SELECT r.state FROM deferred_dispute_reviews r WHERE r.booking_id=d.id) AS review_state,l.title,l.slot_start,l.neighborhood,b.name AS business_name FROM deferred_bookings d JOIN listings l ON l.id=d.listing_id JOIN businesses b ON b.id=l.business_id WHERE "+filter+" ORDER BY d.created_at DESC LIMIT 100",[req.user.id]);
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
  await queueDeferredEmail(pool,Number(req.params.id),'accepted').catch(err=>console.error('Deferred booking notification unavailable',err.message));
  res.json({ok:true,status:'accepted'});
 }));
 app.post('/api/deferred-bookings/:id/decline',...business,safe(async(req,res)=>{
  const q=await pool.query("UPDATE deferred_bookings d SET status='canceled' FROM listings l JOIN businesses b ON l.business_id=b.id WHERE d.listing_id=l.id AND b.owner_id=$1 AND d.id=$2 AND d.status='requested' RETURNING d.id",[req.user.id,Number(req.params.id)]);
  if(!q.rowCount)return forbidden(res,'Booking cannot be declined.',409);
  await queueDeferredEmail(pool,Number(req.params.id),'declined').catch(err=>console.error('Deferred booking notification unavailable',err.message));
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
  await queueDeferredEmail(pool,Number(req.params.id),'completed').catch(err=>console.error('Deferred booking notification unavailable',err.message));
  res.json({ok:true,status:'work_completed',message:'Customer must confirm completion before any charge.'});
 }));
 app.post('/api/deferred-bookings/:id/dispute',...customer,safe(async(req,res)=>{
  const id=Number(req.params.id),reason=typeof req.body?.reason==='string'?req.body.reason.trim().slice(0,500):'';
  if(!validId(id)||reason.length<10)return forbidden(res,'Please describe the issue in at least 10 characters.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("UPDATE deferred_bookings SET status='disputed',dispute_reason=$3 WHERE id=$1 AND customer_id=$2 AND status='work_completed' AND payment_intent_id IS NULL RETURNING id",[id,req.user.id,reason]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'This booking cannot be disputed from its current status.',409);}
   await client.query("INSERT INTO deferred_dispute_reviews(booking_id,state,original_reason) VALUES($1,'open',$2) ON CONFLICT(booking_id) DO UPDATE SET state='open',original_reason=EXCLUDED.original_reason,resolution_note=NULL,reviewed_by=NULL,reviewed_at=NULL,customer_accepted_at=NULL,updated_at=now()",[id,reason]);
   await client.query("INSERT INTO deferred_dispute_events(booking_id,actor_id,action,note) VALUES($1,$2,'reported',$3)",[id,req.user.id,reason]);
   await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
  await queueDeferredEmail(pool,id,'disputed').catch(err=>console.error('Deferred booking notification unavailable',err.message));
  res.json({ok:true,status:'disputed',message:'No payment was initiated. Independent support review is required.'});
 }));
 // Support privileges are provisioned out of band. No user can self-register as support.
 const supportMember=async id=>(await pool.query('SELECT 1 FROM deferred_support_agents WHERE user_id=$1',[id])).rowCount>0;
 app.get('/api/support/deferred-disputes',...read,safe(async(req,res)=>{
  if(!await supportMember(req.user.id))return forbidden(res,'Support access required.',403);
  const q=await pool.query("SELECT d.id,d.status,d.price_cents,d.dispute_reason,l.title,l.slot_start,b.name AS business_name,COALESCE(r.state,'open') AS review_state,r.resolution_note,r.reviewed_at FROM deferred_bookings d JOIN listings l ON l.id=d.listing_id JOIN businesses b ON b.id=l.business_id LEFT JOIN deferred_dispute_reviews r ON r.booking_id=d.id WHERE d.status='disputed' AND d.payment_intent_id IS NULL ORDER BY d.completed_at ASC LIMIT 100");
  res.json({disputes:q.rows});
 }));
 app.post('/api/support/deferred-disputes/:id/decision',...read,safe(async(req,res)=>{
  if(!await supportMember(req.user.id))return forbidden(res,'Support access required.',403);
  const id=Number(req.params.id),decision=req.body?.decision,note=typeof req.body?.note==='string'?req.body.note.trim().slice(0,500):'';
  if(!validId(id)||!['close_no_charge','request_customer_approval'].includes(decision)||note.length<12)return forbidden(res,'Choose a resolution and enter a reason of at least 12 characters.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("SELECT d.id,d.customer_id,d.dispute_reason,d.payment_intent_id,d.paid_at,d.status,b.owner_id FROM deferred_bookings d JOIN listings l ON l.id=d.listing_id JOIN businesses b ON b.id=l.business_id WHERE d.id=$1 FOR UPDATE OF d",[id]);
   const d=q.rows[0];
   if(!d||d.status!=='disputed'||!d.dispute_reason||d.payment_intent_id||d.paid_at){
    await client.query('ROLLBACK');return forbidden(res,'Only unpaid, disputed bookings can use this resolution workflow.',409);
   }
   if(String(req.user.id)===String(d.customer_id)||String(req.user.id)===String(d.owner_id)){
    await client.query('ROLLBACK');return forbidden(res,'An involved party cannot resolve this dispute.',403);
   }
   await client.query("INSERT INTO deferred_dispute_reviews(booking_id,state,original_reason) VALUES($1,'open',$2) ON CONFLICT(booking_id) DO NOTHING",[id,d.dispute_reason]);
   const claim=await client.query("UPDATE deferred_dispute_reviews SET state=$2,resolution_note=$3,reviewed_by=$4,reviewed_at=now(),updated_at=now() WHERE booking_id=$1 AND state IN ('open','customer_declined') RETURNING booking_id",[id,decision==='close_no_charge'?'closed_no_charge':'awaiting_customer',note,req.user.id]);
   if(!claim.rowCount){await client.query('ROLLBACK');return forbidden(res,'This dispute already received a decision.',409);}
   if(decision==='close_no_charge'){
    const changed=await client.query("UPDATE deferred_bookings SET status='canceled' WHERE id=$1 AND status='disputed' AND payment_intent_id IS NULL AND paid_at IS NULL RETURNING id",[id]);
    if(!changed.rowCount)throw Error('Dispute status changed before closure');
   }
   await client.query("INSERT INTO deferred_dispute_events(booking_id,actor_id,action,note) VALUES($1,$2,$3,$4)",[id,req.user.id,decision,note]);
   await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
  await queueDeferredEmail(pool,id,decision==='close_no_charge'?'review_closed':'review_requested').catch(err=>console.error('Deferred review notification unavailable',err.message));
  res.json({ok:true,status:decision==='close_no_charge'?'closed_no_charge':'awaiting_customer',message:decision==='close_no_charge'?'Dispute closed without a charge.':'Customer approval requested; payment remains blocked until the customer expressly reopens and confirms.'});
 }));
 app.post('/api/deferred-bookings/:id/accept-resolution',...customer,safe(async(req,res)=>{
  const id=Number(req.params.id);
  if(!validId(id)||req.body?.acceptResolution!==true)return forbidden(res,'Customer must explicitly accept the resolution.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("SELECT d.id FROM deferred_bookings d JOIN deferred_dispute_reviews r ON r.booking_id=d.id WHERE d.id=$1 AND d.customer_id=$2 AND d.status='disputed' AND d.payment_intent_id IS NULL AND d.paid_at IS NULL AND r.state='awaiting_customer' FOR UPDATE OF d,r",[id,req.user.id]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'No approved resolution is awaiting your acceptance.',409);}
   await client.query("UPDATE deferred_dispute_reviews SET state='customer_accepted',customer_accepted_at=now(),updated_at=now() WHERE booking_id=$1 AND state='awaiting_customer'",[id]);
   const changed=await client.query("UPDATE deferred_bookings SET status='work_completed',dispute_reason=NULL WHERE id=$1 AND status='disputed' AND payment_intent_id IS NULL RETURNING id",[id]);
   if(!changed.rowCount)throw Error('Booking changed before customer acceptance');
   await client.query("INSERT INTO deferred_dispute_events(booking_id,actor_id,action) VALUES($1,$2,'customer_accepted')",[id,req.user.id]);
   await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
  res.json({ok:true,status:'work_completed',message:'You accepted the reviewed resolution. No charge was made. You must separately confirm the completed service and approve payment to proceed.'});
 }));
 app.post('/api/deferred-bookings/:id/decline-resolution',...customer,safe(async(req,res)=>{
  const id=Number(req.params.id);
  if(!validId(id))return forbidden(res,'Invalid booking.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("SELECT d.id FROM deferred_bookings d JOIN deferred_dispute_reviews r ON r.booking_id=d.id WHERE d.id=$1 AND d.customer_id=$2 AND d.status='disputed' AND d.payment_intent_id IS NULL AND r.state='awaiting_customer' FOR UPDATE OF d,r",[id,req.user.id]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'No proposed resolution is awaiting your decision.',409);}
   await client.query("UPDATE deferred_dispute_reviews SET state='customer_declined',updated_at=now() WHERE booking_id=$1 AND state='awaiting_customer'",[id]);
   await client.query("INSERT INTO deferred_dispute_events(booking_id,actor_id,action) VALUES($1,$2,'customer_declined')",[id,req.user.id]);
   await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
  res.json({ok:true,status:'disputed',message:'You declined the proposal. No payment will be collected while support reviews the issue.'});
 }));
 app.get('/api/deferred-refunds',...read,safe(async(req,res)=>{
  const condition=req.user.role==='customer'?'r.customer_id=$1':'b.owner_id=$1';
  const q=await pool.query("SELECT r.id,r.booking_id,r.status,r.reason,r.requested_at,d.price_cents,l.title,l.slot_start FROM deferred_refund_requests r JOIN deferred_bookings d ON d.id=r.booking_id JOIN listings l ON l.id=d.listing_id JOIN businesses b ON b.id=l.business_id WHERE "+condition+" ORDER BY r.requested_at DESC LIMIT 100",[req.user.id]);
  res.json({requests:q.rows});
 }));
 app.post('/api/deferred-bookings/:id/request-refund',...customer,safe(async(req,res)=>{
  const id=Number(req.params.id),reason=typeof req.body?.reason==='string'?req.body.reason.trim().slice(0,500):'';
  if(!validId(id)||reason.length<10)return forbidden(res,'Explain the refund request in at least 10 characters.',400);
  const q=await pool.query("INSERT INTO deferred_refund_requests(booking_id,customer_id,reason) SELECT d.id,d.customer_id,$3 FROM deferred_bookings d WHERE d.id=$1 AND d.customer_id=$2 AND d.status='paid' AND d.refunded_cents=0 AND d.stripe_dispute_status IS NULL AND NOT EXISTS (SELECT 1 FROM deferred_refund_requests r WHERE r.booking_id=d.id) ON CONFLICT(booking_id) DO NOTHING RETURNING id",[id,req.user.id,reason]);
  if(!q.rowCount)return forbidden(res,'Only one refund request can be submitted for a paid booking. Contact support for an existing request.',409);
  await queueDeferredEmail(pool,id,'refund_requested').catch(err=>console.error('Deferred booking notification unavailable',err.message));
  res.status(201).json({ok:true,status:'pending',message:'Refund review requested. No refund issued yet.'});
 }));
 app.post('/api/deferred-refunds/:id/decision',...business,safe(async(req,res)=>{
  const id=Number(req.params.id),decision=req.body?.decision;
  if(!validId(id)||!['approve','decline'].includes(decision))return forbidden(res,'Invalid refund request or decision.',400);
  const client=await pool.connect();let row;
  try {
   await client.query('BEGIN');
   const q=await client.query(
    "SELECT r.*,d.price_cents,d.payment_intent_id,d.status AS booking_status,d.refunded_cents,d.stripe_dispute_status FROM deferred_refund_requests r JOIN deferred_bookings d ON d.id=r.booking_id JOIN listings l ON l.id=d.listing_id JOIN businesses b ON b.id=l.business_id WHERE r.id=$1 AND b.owner_id=$2 FOR UPDATE OF r,d",
    [id,req.user.id]);
   row=q.rows[0];
   if(!row || row.status!=='pending'){await client.query('ROLLBACK');return forbidden(res,'Refund request already reviewed or inaccessible.',409);}
   if(decision==='decline'){
    await client.query("UPDATE deferred_refund_requests SET status='declined',decided_by=$2,decided_at=now() WHERE id=$1 AND status='pending'",[id,req.user.id]);
    await queueDeferredEmail(client,row.booking_id,'refund_declined');
    await client.query('COMMIT');
    return res.json({ok:true,status:'declined',message:'Refund request declined.'});
   }
   if(row.booking_status!=='paid' || row.refunded_cents!==0 || row.stripe_dispute_status || !row.payment_intent_id){
    await client.query('ROLLBACK');
    return forbidden(res,'Refund is not eligible for automatic processing. Contact support.',409);
   }
   await client.query("UPDATE deferred_refund_requests SET status='processing',decided_by=$2,decided_at=now() WHERE id=$1 AND status='pending'",[id,req.user.id]);
   await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
  try{
   const refund=await stripe.refunds.create({
    payment_intent:row.payment_intent_id,amount:row.price_cents,
    reverse_transfer:true,refund_application_fee:true,reason:'requested_by_customer',
    metadata:{routedrop_deferred_booking_id:String(row.booking_id),routedrop_deferred_refund_id:String(id)}
   },{idempotencyKey:'routedrop-deferred-full-refund-v1-'+id});
   if(!refund || !refund.id || !['succeeded','pending','requires_action'].includes(refund.status))
    throw Error('Unexpected Stripe refund status');
   if(refund.status==='succeeded'){
    // DB settlement + receipt are atomic: no "refunded" record without the booking update.
    const settled=await pool.connect();
    try{
     await settled.query('BEGIN');
     const changed=await settled.query("UPDATE deferred_refund_requests SET status='refunded',refund_id=$2 WHERE id=$1 AND status='processing' RETURNING booking_id",[id,refund.id]);
     if(changed.rowCount){
      const changedBooking=await settled.query("UPDATE deferred_bookings SET status='refunded',refunded_cents=price_cents WHERE id=$1 AND status IN ('paid','needs_review') RETURNING id",[row.booking_id]);
      if(!changedBooking.rowCount)throw Error('Refund recorded by Stripe but booking needs manual reconciliation');
      await queueDeferredEmail(settled,row.booking_id,'refund');
     }
     await settled.query('COMMIT');
    }catch(e){await settled.query('ROLLBACK').catch(()=>{});throw e;}finally{settled.release();}
   }else{
    await pool.query("UPDATE deferred_refund_requests SET refund_id=$2 WHERE id=$1 AND status='processing'",[id,refund.id]);
   }
   return res.json({ok:true,status:refund.status==='succeeded'?'refunded':'processing',message:refund.status==='succeeded'?'Full refund confirmed by Stripe.':'Refund submitted; awaiting final Stripe confirmation.'});
  }catch(err){
   // A timeout could mean Stripe accepted the refund. Never initiate another API refund automatically.
   await pool.query("UPDATE deferred_refund_requests SET status='needs_review' WHERE id=$1 AND status='processing'",[id]).catch(()=>{});
   return forbidden(res,'Refund result requires manual Stripe reconciliation. Do not submit another refund.',503);
  }
 }));
 app.post('/api/deferred-bookings/:id/recover',...customer,safe(async(req,res)=>{
  const id=Number(req.params.id);
  if(!validId(id) || !stripe || !baseUrl)return forbidden(res,'Payment recovery is unavailable.',503);
  // Do not offer recovery for ambiguous or unlinked charges. Support must reconcile those.
  const found=await pool.query("SELECT d.*,b.stripe_account_id AS current_provider_account FROM deferred_bookings d JOIN listings l ON l.id=d.listing_id JOIN businesses b ON b.id=l.business_id WHERE d.id=$1 AND d.customer_id=$2",[id,req.user.id]);
  const booking=found.rows[0];
  if(booking?.status==='recovery_pending' && booking.recovery_checkout_session_id){
   try {
    const existing=await stripe.checkout.sessions.retrieve(booking.recovery_checkout_session_id);
    if(existing.status==='open' && existing.mode==='payment' && existing.customer===booking.stripe_customer_id &&
      String(existing.metadata?.deferred_recovery_booking_id)===String(id) && typeof existing.url==='string')
     return res.json({url:existing.url,message:'Continue the existing secure payment checkout.'});
   }catch(err){}
   return forbidden(res,'Recovery checkout is unavailable. Contact support to reconcile payment.',409);
  }
  if(!booking || !booking.payment_intent_id || booking.status!=='payment_failed')return forbidden(res,'This booking requires manual payment review.',409);
  if(booking.provider_stripe_account_id!==booking.current_provider_account)return forbidden(res,'Provider payout account changed; contact support.',409);
  let original;
  try {
   original=await stripe.paymentIntents.retrieve(booking.payment_intent_id);
   if(!recoveryEligible(booking,original))return forbidden(res,'The payment result is not safe to retry. Contact support.',409);
   if(original.status!=='canceled') {
    original=await stripe.paymentIntents.cancel(original.id,{}, {idempotencyKey:'routedrop-deferred-cancel-before-recovery-'+id});
    if(original.status!=='canceled')return forbidden(res,'The previous payment could not be canceled. Contact support.',409);
   }
  }catch(err){
   return forbidden(res,'Unable to verify the previous payment. Do not retry automatically; contact support.',503);
  }
  const claim=await pool.query("UPDATE deferred_bookings SET status='recovery_pending',recovery_requested_at=now() WHERE id=$1 AND customer_id=$2 AND status='payment_failed' AND payment_intent_id=$3 AND recovery_checkout_session_id IS NULL AND dispute_reason IS NULL AND refunded_cents=0 RETURNING id",[id,req.user.id,original.id]);
  if(!claim.rowCount)return forbidden(res,'Payment recovery already started or the booking changed.',409);
  try {
   const account=await stripe.accounts.retrieve(booking.provider_stripe_account_id);
   if(!account.charges_enabled || !account.payouts_enabled)throw Error('Provider account unavailable');
   const session=await stripe.checkout.sessions.create({
    mode:'payment',payment_method_types:['card'],customer:booking.stripe_customer_id,
    client_reference_id:String(id),
    line_items:[{price_data:{currency:'usd',unit_amount:booking.price_cents,product_data:{name:'RouteDrop service payment · Booking '+id}},quantity:1}],
    payment_intent_data:{application_fee_amount:booking.fee_cents,transfer_data:{destination:booking.provider_stripe_account_id},metadata:{routedrop_deferred_recovery_booking_id:String(id)}},
    metadata:{deferred_recovery_booking_id:String(id)},
    success_url:baseUrl+'/?recovery=return',cancel_url:baseUrl+'/?recovery=cancel',
    expires_at:Math.floor(Date.now()/1000)+30*60
   },{idempotencyKey:'routedrop-deferred-recovery-checkout-v1-'+id});
   const updated=await pool.query("UPDATE deferred_bookings SET recovery_checkout_session_id=$2 WHERE id=$1 AND status='recovery_pending' AND recovery_checkout_session_id IS NULL RETURNING id",[id,session.id]);
   if(!updated.rowCount){
    await stripe.checkout.sessions.expire(session.id).catch(()=>{});
    throw Error('Recovery status changed');
   }
   return res.json({url:session.url,message:'Secure recovery checkout. No second off-session charge will be attempted.'});
  }catch(err){
   await pool.query("UPDATE deferred_bookings SET status='needs_review' WHERE id=$1 AND status='recovery_pending' AND recovery_checkout_session_id IS NULL",[id]).catch(()=>{});
   return forbidden(res,'Secure checkout could not be confirmed. Contact support before trying again.',503);
  }
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
module.exports={sql,ACTIVE,paymentFee,legitimateAmount,payable,chargeParameters,recoveryEligible,verifiedCharge,verifiedRecoveryCharge,handleStripeEvent,install};
