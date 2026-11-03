'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');
const Stripe = require('stripe');
const { providerReady, emailLink, isActionToken, notification, deliverEmail } = require('./mail');
const { livePaymentsAllowed, checkoutOutcome, refundableAmount, disputeState, cancellationEligibility, refundStatus, refundOperation } = require('./payment-safeguards');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const port = Number(process.env.PORT || 10000);
const baseUrl = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const databaseUrl = process.env.DATABASE_URL || '';
const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = stripeKey ? new Stripe(stripeKey) : null;
const liveKey = /^(sk|rk)_live_/.test(stripeKey);
const paymentsApproved = livePaymentsAllowed(stripeKey,process.env.ROUTEDROP_LIVE_APPROVED);
const emailReady = providerReady(process.env);
const paymentsReady = !!(stripe && stripeWebhookSecret && paymentsApproved);
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } }) : null;
const safe = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
const forbidden = (res, msg, code=400) => res.status(code).json({ error: msg });
const clean = (v, len=120) => typeof v === 'string' ? v.trim().slice(0, len) : '';
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
const usd = value => Number.isSafeInteger(value) && value>=500 && value<=500000;
let ready = false;

app.use(helmet({
 contentSecurityPolicy: { directives: { defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'"], imgSrc:["'self'","data:"], connectSrc:["'self'"], objectSrc:["'none'"], frameAncestors:["'none'"], upgradeInsecureRequests: process.env.NODE_ENV==='production' ? [] : null } },
 referrerPolicy: { policy:'no-referrer' }
}));
app.use(cookieParser());
app.use((req,res,next) => {
 if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
 next();
});
app.use('/api', rateLimit({ windowMs:15*60*1000, limit:200, standardHeaders:'draft-7', legacyHeaders:false }));
const authLimiter = rateLimit({ windowMs:15*60*1000, limit:12, standardHeaders:'draft-7', legacyHeaders:false });
const checkoutLimiter = rateLimit({windowMs:15*60*1000, limit:15, standardHeaders:'draft-7', legacyHeaders:false});

const schema = String.raw; // no dynamic SQL interpolation in schema below
const ddl = [
 "CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','business')), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE TABLE IF NOT EXISTS businesses (id BIGSERIAL PRIMARY KEY, owner_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, city TEXT NOT NULL, category TEXT NOT NULL, stripe_account_id TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE TABLE IF NOT EXISTS listings (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT NOT NULL, neighborhood TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 500 AND 500000), slot_start TIMESTAMPTZ NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 30 AND 480), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE TABLE IF NOT EXISTS bookings (id BIGSERIAL PRIMARY KEY, listing_id BIGINT NOT NULL REFERENCES listings(id), customer_id BIGINT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','paid','completed','canceled')), price_cents INTEGER NOT NULL, fee_cents INTEGER NOT NULL, checkout_session_id TEXT UNIQUE, payment_intent_id TEXT, hold_expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_slot ON bookings(listing_id) WHERE status IN ('awaiting_payment','paid','completed')",
 "CREATE INDEX IF NOT EXISTS listings_active_time ON listings(status, slot_start)",
 "CREATE INDEX IF NOT EXISTS bookings_customer ON bookings(customer_id)",
 "CREATE INDEX IF NOT EXISTS bookings_listing ON bookings(listing_id)",
 "CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS subscription_customer_id TEXT UNIQUE",
 "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS subscription_id TEXT",
 "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none'",
 "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS last_invoice_status TEXT",
 "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_cents INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dispute_status TEXT",
 "CREATE TABLE IF NOT EXISTS cancellation_requests (id BIGSERIAL PRIMARY KEY, booking_id BIGINT NOT NULL UNIQUE REFERENCES bookings(id), customer_id BIGINT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','closed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT 'pending' CHECK(resolution IN ('pending','processing','refunded','declined','needs_review'))",
 "ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS refund_id TEXT",
 "ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS decided_by BIGINT REFERENCES users(id)",
 "ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ",
 "ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS eligible_full_refund BOOLEAN",
 "ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS refund_amount_cents INTEGER",
 "ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ",
 "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ",
 "CREATE TABLE IF NOT EXISTS email_action_tokens (token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')), expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS email_tokens_user_purpose ON email_action_tokens(user_id,purpose)",
 "CREATE TABLE IF NOT EXISTS notification_outbox (id BIGSERIAL PRIMARY KEY, event_key TEXT UNIQUE NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0, available_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS notification_outbox_due ON notification_outbox(status,available_at)"
];
async function startDatabase() {
 if (!pool) return;
 try {
  for (const statement of ddl) await pool.query(statement);
  ready = true;
  console.log('RouteDrop PostgreSQL ready');
 } catch(err) { ready=false; console.error('Database unavailable:',err.message); }
}
function requireDb(req,res,next) { if (!ready) return forbidden(res,'Accounts are not yet enabled. The private beta database is pending setup.',503); next(); }
function setCookie(res,token) { res.cookie('__Host-rd_session',token,{secure:process.env.NODE_ENV==='production',httpOnly:true,sameSite:'lax',path:'/',maxAge:7*24*60*60*1000}); }
async function sessionUser(req,res,next) {
 try {
  req.user=null;
  const token=req.cookies['__Host-rd_session'];
  if (token && ready && /^[a-f0-9]{64}$/.test(token)) {
   const result=await pool.query("SELECT u.id,u.full_name,u.email,u.role,(u.email_verified_at IS NOT NULL) AS email_verified FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",[hash(token)]);
   req.user=result.rows[0]||null;
  }
  next();
 } catch(nextError){next(nextError);}
}
function requireUser(role) { return (req,res,next) => {
 if (!req.user) return forbidden(res,'Please sign in.',401);
 if (role && req.user.role!==role) return forbidden(res,'Account does not have permission.',403);
 next();
};}
async function createSession(userId,res) {
 const token=random();
 await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now() + interval '7 days')",[hash(token),userId]);
 setCookie(res,token);
}
function checkMutation(req,res,next) {
 if (!['POST','PATCH','PUT','DELETE'].includes(req.method))return next();
 if (req.path==='/api/stripe/webhook') return next();
 const origin=req.get('origin');
 const expected=baseUrl || ((req.protocol==='https'?'https://':'http://')+req.get('host'));
 if (origin!==expected) return forbidden(res,'Invalid request origin.',403);
 const csrf=req.cookies.routedrop_csrf;
 if (!csrf || csrf!==req.get('x-csrf-token') || !/^[a-f0-9]{64}$/.test(csrf)) return forbidden(res,'Refresh the page and try again.',403);
 next();
}
app.get('/health', (req,res)=>res.status(200).json({service:'RouteDrop platform beta',server:'up',database:ready?'ready':'not configured',payments:paymentsReady?'configured':'not configured',mode:liveKey?(paymentsApproved?'live':'live_locked'):'beta'}));
app.post('/api/stripe/webhook', express.raw({type:'application/json'}),safe(async(req,res)=>{
 if (!paymentsReady) return forbidden(res,'Payments not configured',503);
 let event;
 try { event=stripe.webhooks.constructEvent(req.body,req.get('stripe-signature'),stripeWebhookSecret); }
 catch(e) {return forbidden(res,'Invalid webhook signature',400);}
 if (!ready) return forbidden(res,'Database not ready',503);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const logged=await client.query('INSERT INTO stripe_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[event.id]);
  if (!logged.rowCount){await client.query('COMMIT');return res.json({received:true});}
  const session=event.data.object;
  const bookingId=Number(session.metadata&&session.metadata.booking_id);
  if (Number.isSafeInteger(bookingId)&&bookingId>0){
   if (checkoutOutcome(event.type,session)==='paid'){
    await client.query("UPDATE bookings SET status='paid',payment_intent_id=$3 WHERE id=$1 AND checkout_session_id=$2 AND status='awaiting_payment'",[bookingId,session.id,typeof session.payment_intent==='string'?session.payment_intent:null]);
    await queueBookingEmail(client,bookingId,'booking','checkout-'+session.id);
   } else if (checkoutOutcome(event.type,session)==='canceled'){
    await client.query("UPDATE bookings SET status='canceled' WHERE id=$1 AND checkout_session_id=$2 AND status='awaiting_payment'",[bookingId,session.id]);
   }
  }
  if(event.type==='checkout.session.completed' && session.mode==='subscription' && session.customer && session.subscription){
   await client.query("UPDATE businesses SET subscription_id=$1 WHERE subscription_customer_id=$2",[session.subscription,session.customer]);
  }
  if(event.type.startsWith('customer.subscription.') && session.customer){
   const status=event.type==='customer.subscription.deleted'?'canceled':session.status;
   await client.query("UPDATE businesses SET subscription_id=$1,subscription_status=$2 WHERE subscription_customer_id=$3 AND (subscription_id IS NULL OR subscription_id=$1)",[session.id,status,session.customer]);
  }
  if((event.type==='invoice.paid'||event.type==='invoice.payment_failed') && session.customer){
   await client.query('UPDATE businesses SET last_invoice_status=$1 WHERE subscription_customer_id=$2',[event.type==='invoice.paid'?'paid':'payment_failed',session.customer]);
   const owner=await client.query("SELECT u.email FROM businesses b JOIN users u ON u.id=b.owner_id WHERE b.subscription_customer_id=$1",[session.customer]);
   if(owner.rowCount)await enqueueNotification(client,'invoice-'+event.id,owner.rows[0].email,event.type==='invoice.paid'?'subscription_paid':'subscription_failed',{});
  }
  if(refundableAmount(event.type,session)!==null){
   await client.query('UPDATE bookings SET refund_cents=GREATEST(refund_cents,$1) WHERE payment_intent_id=$2',[refundableAmount(event.type,session),session.payment_intent]);
   const full=await client.query("UPDATE bookings SET status='canceled' WHERE payment_intent_id=$1 AND refund_cents>=price_cents AND status='paid' RETURNING id",[session.payment_intent]);
   for(const row of full.rows){
    await client.query("UPDATE cancellation_requests SET resolution='refunded',status='closed' WHERE booking_id=$1 AND resolution IN ('processing','needs_review')",[row.id]);
    await queueBookingEmail(client,row.id,'refund','refunded');
   }
  }
  if((event.type==='refund.updated'||event.type==='refund.failed') && session.payment_intent){
   const state=event.type==='refund.failed'?'needs_review':refundStatus(session);
   if(state==='refunded'){
    await client.query('UPDATE bookings SET refund_cents=GREATEST(refund_cents,$1) WHERE payment_intent_id=$2',[session.amount||0,session.payment_intent]);
    await client.query("UPDATE bookings SET status='canceled' WHERE payment_intent_id=$1 AND refund_cents>=price_cents AND status='paid'",[session.payment_intent]);
   }
   if(state==='refunded'||state==='needs_review'){
    await client.query("UPDATE cancellation_requests SET resolution=$2,status=CASE WHEN $2='refunded' THEN 'closed' ELSE status END WHERE refund_id=$1 OR (id::text=$3 AND resolution IN ('processing','needs_review'))",[session.id,state,session.metadata?.routedrop_cancellation_request_id||'']);
    if(state==='refunded'){
     const matches=await client.query("SELECT id FROM bookings WHERE payment_intent_id=$1 AND status='canceled'",[session.payment_intent]);
     for(const row of matches.rows)await queueBookingEmail(client,row.id,'refund','refunded');
    }
   }
  }
  if(disputeState(event.type,session)!==null){
   await client.query('UPDATE bookings SET dispute_status=$1 WHERE payment_intent_id=$2',[disputeState(event.type,session),session.payment_intent]);
  }
  await client.query('COMMIT');
  res.json({received:true});
 }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}));
app.use(express.json({limit:'16kb'}));
app.use(checkMutation);
app.use(sessionUser);
app.get('/api/config',(req,res)=>{
 if(!req.cookies.routedrop_csrf || !/^[a-f0-9]{64}$/.test(req.cookies.routedrop_csrf)){
  res.cookie('routedrop_csrf',random(),{secure:process.env.NODE_ENV==='production',httpOnly:false,sameSite:'lax',path:'/',maxAge:7*24*60*60*1000});
 }
 res.json({database:ready,payments:paymentsReady,status:ready?'beta':'setup_required',email_enabled:emailReady,payments_mode:liveKey?(paymentsApproved?'live':'live_locked'):'test',public_url:baseUrl});
});
async function issueEmailAction(userId,email,purpose) {
 if(!emailReady||!baseUrl)return false;
 const token=random(),ttl=purpose==='reset'?'30 minutes':'24 hours';
 await pool.query("DELETE FROM email_action_tokens WHERE user_id=$1 AND purpose=$2",[userId,purpose]);
 await pool.query("INSERT INTO email_action_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+($4::text)::interval)",[hash(token),userId,purpose,ttl]);
 const url=emailLink(baseUrl,purpose==='reset'?'reset':'verify',token);
 try {
  await deliverEmail({to:email,subject:purpose==='reset'?'Reset your RouteDrop password':'Verify your RouteDrop email',text:purpose==='reset'?'Use this secure link within 30 minutes to reset your RouteDrop password: '+url:'Verify your email address within 24 hours: '+url});
  return true;
 }catch(err){
  console.error('RouteDrop account email delivery failed',purpose,err.message);
  await pool.query("DELETE FROM email_action_tokens WHERE token_hash=$1",[hash(token)]).catch(()=>{});
  return false;
 }
}
async function enqueueNotification(db,eventKey,to,kind,details) {
 if(!emailReady||!to)return;
 const msg=notification(kind,details);
 if(!msg)return;
 await db.query("INSERT INTO notification_outbox(event_key,recipient,subject,body) VALUES ($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING",[eventKey,to,msg.subject,msg.body]);
}
async function queueBookingEmail(db,bookingId,kind,keyPrefix) {
 const q=await db.query("SELECT k.id,k.price_cents,l.title,l.slot_start,cu.email AS customer_email,cu.full_name AS customer_name,bu.email AS business_email FROM bookings k JOIN listings l ON l.id=k.listing_id JOIN businesses b ON b.id=l.business_id JOIN users cu ON cu.id=k.customer_id JOIN users bu ON bu.id=b.owner_id WHERE k.id=$1",[bookingId]);
 if(!q.rowCount)return;
 const b=q.rows[0],details={title:b.title,date:new Date(b.slot_start).toLocaleString('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short'})+' CT',amount:'USD '+(Number(b.price_cents)/100).toFixed(2),name:b.customer_name};
 for(const side of ['customer','business']){
  const category=kind+'_'+side;
  if(notification(category,details))await enqueueNotification(db,keyPrefix+'-'+b.id+'-'+category,b[side+'_email'],category,details);
 }
}
let outboxBusy=false;
async function processNotificationOutbox(){
 if(outboxBusy||!ready||!emailReady)return;
 outboxBusy=true;
 try{
  const r=await pool.query("UPDATE notification_outbox SET status='sending',attempts=attempts+1 WHERE id IN (SELECT id FROM notification_outbox WHERE status='pending' AND available_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING id,recipient,subject,body,attempts");
  for(const m of r.rows){
   try{
    await deliverEmail({to:m.recipient,subject:m.subject,text:m.body});
    await pool.query("UPDATE notification_outbox SET status='sent',sent_at=now(),last_error=NULL WHERE id=$1",[m.id]);
   }catch(e){
    await pool.query("UPDATE notification_outbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,available_at=now()+((LEAST(3600,attempts*attempts*60))::text||' seconds')::interval,last_error=$2 WHERE id=$1",[m.id,String(e.message).slice(0,150)]);
   }
  }
 }catch(e){console.error('RouteDrop notification worker error',e.message);}finally{outboxBusy=false;}
}
setInterval(()=>{processNotificationOutbox().catch(e=>console.error('Mail worker error',e.message));},30000).unref();
app.post('/api/auth/request-verification',requireDb,requireUser(),authLimiter,safe(async(req,res)=>{
 if(!emailReady)return forbidden(res,'Email sending is not configured yet.',503);
 const q=await pool.query("SELECT email,email_verified_at FROM users WHERE id=$1",[req.user.id]);
 if(q.rows[0]?.email_verified_at)return res.json({ok:true,message:'Your email is already verified.'});
 if(!q.rowCount)return forbidden(res,'Account not found.',404);
 const sent=await issueEmailAction(req.user.id,q.rows[0].email,'verify');
 if(!sent)return forbidden(res,'Could not send verification email. Try again later.',503);
 res.json({ok:true,message:'Verification link sent. Check your inbox.'});
}));
app.post('/api/auth/verify',requireDb,authLimiter,safe(async(req,res)=>{
 const token=req.body.token;if(!isActionToken(token))return forbidden(res,'Invalid or expired verification link.',400);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query("DELETE FROM email_action_tokens WHERE token_hash=$1 AND purpose='verify' AND expires_at>now() RETURNING user_id",[hash(token)]);
  if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'Invalid or expired verification link.',400);}
  await client.query('UPDATE users SET email_verified_at=now() WHERE id=$1',[q.rows[0].user_id]);
  await client.query('COMMIT');
  res.json({ok:true,message:'Email verified. You can now use your account.'});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}));
app.post('/api/auth/forgot-password',requireDb,authLimiter,safe(async(req,res)=>{
 const email=clean(req.body.email,254).toLowerCase();
 if(!emailReady)return forbidden(res,'Email sending is not configured yet.',503);
 if(isEmail(email)){
  const q=await pool.query('SELECT id FROM users WHERE email=$1',[email]);
  if(q.rowCount)await issueEmailAction(q.rows[0].id,email,'reset');
 }
 res.json({ok:true,message:'If this email has an account, you will receive a password reset link.'});
}));
app.post('/api/auth/reset-password',requireDb,authLimiter,safe(async(req,res)=>{
 const token=req.body.token,password=String(req.body.password||'');
 if(!isActionToken(token)||password.length<12||password.length>128)return forbidden(res,'Invalid reset link or password. Use 12–128 characters.');
 const pw=await bcrypt.hash(password,12);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query("DELETE FROM email_action_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>now() RETURNING user_id",[hash(token)]);
  if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'Reset link is invalid or expired.',400);}
  await client.query('UPDATE users SET password_hash=$2 WHERE id=$1',[q.rows[0].user_id,pw]);
  await client.query('DELETE FROM sessions WHERE user_id=$1',[q.rows[0].user_id]);
  await client.query('DELETE FROM email_action_tokens WHERE user_id=$1',[q.rows[0].user_id]);
  await client.query('COMMIT');
  res.clearCookie('__Host-rd_session',{path:'/'});
  res.json({ok:true,message:'Password changed. Please log in again.'});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}));
app.post('/api/register',requireDb,authLimiter,safe(async(req,res)=>{
 const name=clean(req.body.name,90),email=clean(req.body.email,254).toLowerCase(),password=String(req.body.password||''),role=req.body.role;
 const businessName=clean(req.body.businessName,120),city=clean(req.body.city,100),category=clean(req.body.category,40);
 if(!name||!isEmail(email)||password.length<12||password.length>128||!['customer','business'].includes(role))return forbidden(res,'Provide name, email, role, and a password of 12–128 characters.');
 if(role==='business' && (!businessName||!city||!category))return forbidden(res,'Complete the business details.');
 const pw=await bcrypt.hash(password,12);
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const u=await client.query('INSERT INTO users(email,full_name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[email,name,pw,role]);
  if(role==='business')await client.query('INSERT INTO businesses(owner_id,name,city,category) VALUES($1,$2,$3,$4)',[u.rows[0].id,businessName,city,category]);
  await client.query('COMMIT');
  await createSession(u.rows[0].id,res);
  res.status(201).json({ok:true});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return forbidden(res,'Email is already registered.',409);throw e;}finally{client.release();}
}));
app.post('/api/login',requireDb,authLimiter,safe(async(req,res)=>{
 const email=clean(req.body.email,254).toLowerCase(),password=String(req.body.password||'');
 const found=await pool.query('SELECT id,password_hash FROM users WHERE email=$1',[email]);
 const hashToCheck=found.rows[0]?.password_hash || '$2a$12$ydzYsIdIjOoOP1fi1gbF7Os10QXaYjK.hOSvG.Civaj6pcCHXy1ti';
 const match=await bcrypt.compare(password,hashToCheck);
 if(!match||!found.rows[0])return forbidden(res,'Email or password is incorrect.',401);
 await createSession(found.rows[0].id,res);
 res.json({ok:true});
}));
app.post('/api/logout',requireDb,requireUser(),safe(async(req,res)=>{
 const token=req.cookies['__Host-rd_session'];
 if(token)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(token)]);
 res.clearCookie('__Host-rd_session',{path:'/'});
 res.json({ok:true});
}));
app.get('/api/me',requireDb,safe(async(req,res)=>{
 if(!req.user)return res.json({user:null});
 let business=null;
 if(req.user.role==='business'){
  const r=await pool.query('SELECT id,name,city,category, (stripe_account_id IS NOT NULL) AS stripe_connected FROM businesses WHERE owner_id=$1',[req.user.id]);
  business=r.rows[0]||null;
 }
 res.json({user:req.user,business});
}));
app.get('/api/listings',requireDb,safe(async(req,res)=>{
 const data=await pool.query("SELECT l.id,l.title,l.category,l.neighborhood,l.price_cents,l.slot_start,l.duration_minutes,b.name AS business_name,b.city FROM listings l JOIN businesses b ON b.id=l.business_id WHERE l.status='active' AND l.slot_start>now() AND NOT EXISTS(SELECT 1 FROM bookings k WHERE k.listing_id=l.id AND k.status IN ('awaiting_payment','paid','completed')) ORDER BY l.slot_start ASC LIMIT 100");
 res.json({listings:data.rows});
}));
app.post('/api/listings',requireDb,requireUser('business'),safe(async(req,res)=>{
 const title=clean(req.body.title,120),category=clean(req.body.category,50),neighborhood=clean(req.body.neighborhood,100),price=Number(req.body.priceCents),start=new Date(req.body.slotStart),mins=Number(req.body.durationMinutes||60);
 if(!title||!category||!neighborhood||!usd(price)||isNaN(start.getTime())||start.getTime()<Date.now()+10*60*1000||start.getTime()>Date.now()+60*24*60*60*1000||!Number.isInteger(mins)||mins<30||mins>480)return forbidden(res,'Check all service fields. Minimum price is $5 and opening must be within 60 days.');
 const r=await pool.query('INSERT INTO listings(business_id,title,category,neighborhood,price_cents,slot_start,duration_minutes) SELECT id,$2,$3,$4,$5,$6,$7 FROM businesses WHERE owner_id=$1 RETURNING id',[req.user.id,title,category,neighborhood,price,start.toISOString(),mins]);
 if(!r.rowCount)return forbidden(res,'Register a business first.',403);
 res.status(201).json({listing:r.rows[0]});
}));
app.get('/api/bookings',requireDb,requireUser(),safe(async(req,res)=>{
 const clause=req.user.role==='customer'?'k.customer_id=$1':'b.owner_id=$1';
 const r=await pool.query("SELECT k.id,k.status,k.price_cents,k.fee_cents,k.refund_cents,k.dispute_status,k.created_at,(SELECT cr.resolution FROM cancellation_requests cr WHERE cr.booking_id=k.id) AS cancellation_request_status,l.title,l.slot_start,l.neighborhood,b.name AS business_name FROM bookings k JOIN listings l ON l.id=k.listing_id JOIN businesses b ON b.id=l.business_id WHERE "+clause+" ORDER BY k.created_at DESC LIMIT 100",[req.user.id]);
 res.json({bookings:r.rows});
}));
app.post('/api/bookings/:id/request-cancellation',requireDb,requireUser('customer'),safe(async(req,res)=>{
 const id=Number(req.params.id),reason=clean(req.body.reason,500);
 if(!Number.isSafeInteger(id)||id<1||reason.length<10)return forbidden(res,'Enter a cancellation reason of at least 10 characters.');
 const q=await pool.query("SELECT k.status,k.refund_cents,k.dispute_status,l.slot_start FROM bookings k JOIN listings l ON l.id=k.listing_id WHERE k.id=$1 AND k.customer_id=$2",[id,req.user.id]);
 const policy=cancellationEligibility(q.rows[0]);
 if(!policy.canRequest)return forbidden(res,policy.reason,409);
 const r=await pool.query("INSERT INTO cancellation_requests(booking_id,customer_id,reason,eligible_full_refund) SELECT k.id,k.customer_id,$3,$4 FROM bookings k JOIN listings l ON l.id=k.listing_id WHERE k.id=$1 AND k.customer_id=$2 AND k.status='paid' AND l.slot_start>now() AND k.refund_cents=0 AND k.dispute_status IS NULL ON CONFLICT (booking_id) DO NOTHING RETURNING id",[id,req.user.id,reason,policy.fullRefund]);
 if(!r.rowCount)return forbidden(res,'This booking is no longer eligible or a request already exists.',409);
 res.status(201).json({ok:true,message:policy.fullRefund?'Cancellation requested. Full refund eligible; awaiting business confirmation.':'Cancellation requested inside 24 hours. Refund is subject to business approval.'});
}));
app.get('/api/business/cancellation-requests',requireDb,requireUser('business'),safe(async(req,res)=>{
 const r=await pool.query("SELECT cr.id,cr.booking_id,cr.reason,cr.resolution AS status,cr.eligible_full_refund,cr.refund_id,cr.refund_amount_cents,cr.created_at,l.title,l.slot_start,k.price_cents,k.status AS booking_status,k.refund_cents FROM cancellation_requests cr JOIN bookings k ON k.id=cr.booking_id JOIN listings l ON l.id=k.listing_id JOIN businesses b ON b.id=l.business_id WHERE b.owner_id=$1 ORDER BY cr.created_at DESC LIMIT 100",[req.user.id]);
 res.json({requests:r.rows});
}));
app.post('/api/business/cancellation-requests/:id/decision',requireDb,requireUser('business'),checkoutLimiter,safe(async(req,res)=>{
 if(!paymentsReady)return forbidden(res,'Payment processing unavailable.',503);
 const id=Number(req.params.id),decision=req.body.decision;
 if(!Number.isSafeInteger(id)||id<1||!['approve','decline'].includes(decision))return forbidden(res,'Invalid cancellation request or decision.');
 // Claim the decision before contacting Stripe. Never hold a transaction open across a Stripe request.
 const client=await pool.connect();let request;
 try{
  await client.query('BEGIN');
  const r=await client.query("SELECT cr.id,cr.resolution,cr.eligible_full_refund,cr.refund_id,k.id AS booking_id,k.status AS booking_status,k.price_cents,k.refund_cents,k.dispute_status,k.payment_intent_id,l.slot_start FROM cancellation_requests cr JOIN bookings k ON k.id=cr.booking_id JOIN listings l ON l.id=k.listing_id JOIN businesses b ON b.id=l.business_id WHERE cr.id=$1 AND b.owner_id=$2 FOR UPDATE OF cr,k",[id,req.user.id]);
  request=r.rows[0];
  if(!request){await client.query('ROLLBACK');return forbidden(res,'Request not found.',404);}
  if(request.resolution!=='pending'){await client.query('ROLLBACK');return forbidden(res,'Request already handled.',409);}
  const policy=cancellationEligibility({status:request.booking_status,slot_start:request.slot_start,refund_cents:request.refund_cents,dispute_status:request.dispute_status});
  if(decision==='decline'){
   if(request.eligible_full_refund){await client.query('ROLLBACK');return forbidden(res,'The 24-hour cancellation policy requires a full refund. Approve this request or contact support.',409);}
   await client.query("UPDATE cancellation_requests SET resolution='declined',status='closed',decided_by=$2,decided_at=now() WHERE id=$1",[id,req.user.id]);
   await client.query('COMMIT');return res.json({ok:true,status:'declined'});
  }
  const validPaid=request.booking_status==='paid' && request.refund_cents===0 && !request.dispute_status;
  if(!validPaid||!request.payment_intent_id){
   await client.query('ROLLBACK');
   return forbidden(res,'Refund requires manual support review: the original payment or booking is no longer eligible.',409);
  }
  await client.query("UPDATE cancellation_requests SET resolution='processing',status='reviewed',decided_by=$2,decided_at=now(),processing_started_at=now(),refund_amount_cents=$3 WHERE id=$1",[id,req.user.id,request.price_cents]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 try{
  // Destination charges: reverse the transfer to the business and refund the 8% application fee.
  const operation=refundOperation({...request,id});
  const refund=await stripe.refunds.create(operation.params,operation.options);
  const outcome=refundStatus(refund);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   await db.query("UPDATE cancellation_requests SET refund_id=$2,resolution=$3,status=CASE WHEN $3='refunded' THEN 'closed' ELSE 'reviewed' END WHERE id=$1 AND resolution='processing'",[id,refund.id,outcome]);
   if(outcome==='refunded'){
    await db.query("UPDATE bookings SET status='canceled',refund_cents=GREATEST(refund_cents,$2) WHERE id=$1 AND status='paid'",[request.booking_id,request.price_cents]);
   }
   await db.query('COMMIT');
  }catch(err){await db.query('ROLLBACK').catch(()=>{});throw err;}finally{db.release();}
  res.json({ok:true,status:outcome,message:outcome==='refunded'?'Full refund completed.':outcome==='processing'?'Refund initiated and processing.':'Refund requires manual review in Stripe.'});
 }catch(e){
  // A network timeout can mean Stripe received the refund. Do not automatically retry with a new key.
  console.error('RouteDrop refund requires reconciliation',id,e.type||'unknown');
  await pool.query("UPDATE cancellation_requests SET resolution='needs_review' WHERE id=$1 AND resolution='processing'",[id]).catch(()=>{});
  return forbidden(res,'Refund could not be confirmed. Check Stripe before trying anything else; no second refund will be created automatically.',503);
 }
}));
app.get('/api/my-listings',requireDb,requireUser('business'),safe(async(req,res)=>{
 const r=await pool.query('SELECT l.id,l.title,l.price_cents,l.neighborhood,l.slot_start,l.status FROM listings l JOIN businesses b ON b.id=l.business_id WHERE b.owner_id=$1 ORDER BY l.created_at DESC LIMIT 100',[req.user.id]);
 res.json({listings:r.rows});
}));
app.get('/api/business/subscription',requireDb,requireUser('business'),safe(async(req,res)=>{
 if(!paymentsReady)return forbidden(res,'Stripe unavailable.',503);
 const r=await pool.query('SELECT subscription_customer_id FROM businesses WHERE owner_id=$1',[req.user.id]);
 const customer=r.rows[0]?.subscription_customer_id;
 if(!customer)return res.json({status:'none'});
 const subs=await stripe.subscriptions.list({customer,limit:20});
 const sub=subs.data.find(x=>['active','trialing','past_due','unpaid','incomplete'].includes(x.status))||subs.data[0];
 res.json({status:sub?.status||'none',cancel_at_period_end:!!sub?.cancel_at_period_end,last_invoice_status:(await pool.query('SELECT last_invoice_status FROM businesses WHERE owner_id=$1',[req.user.id])).rows[0]?.last_invoice_status||null});
}));
app.post('/api/business/subscription/portal',requireDb,requireUser('business'),checkoutLimiter,safe(async(req,res)=>{
 if(!paymentsReady||!baseUrl)return forbidden(res,'Stripe unavailable.',503);
 const r=await pool.query('SELECT subscription_customer_id FROM businesses WHERE owner_id=$1',[req.user.id]);
 if(!r.rows[0]?.subscription_customer_id)return forbidden(res,'No billing account found.',404);
 const p=await stripe.billingPortal.sessions.create({customer:r.rows[0].subscription_customer_id,return_url:baseUrl+'/?subscription=return'});
 res.json({url:p.url});
}));
app.post('/api/business/subscribe',requireDb,requireUser('business'),checkoutLimiter,safe(async(req,res)=>{
 if(!paymentsReady||!baseUrl)return forbidden(res,'Stripe unavailable.',503);
 const r=await pool.query('SELECT id,subscription_customer_id FROM businesses WHERE owner_id=$1',[req.user.id]);
 const b=r.rows[0];if(!b)return forbidden(res,'Business not found.',404);
 let customer=b.subscription_customer_id;
 if(!customer){
  const c=await stripe.customers.create({email:req.user.email,metadata:{business_id:String(b.id)}},{idempotencyKey:'routedrop-sub-customer-'+b.id});
  await pool.query('UPDATE businesses SET subscription_customer_id=$1 WHERE id=$2 AND subscription_customer_id IS NULL',[c.id,b.id]);
  customer=(await pool.query('SELECT subscription_customer_id FROM businesses WHERE id=$1',[b.id])).rows[0].subscription_customer_id;
 }
 const subs=await stripe.subscriptions.list({customer,limit:20});
 if(subs.data.some(x=>['active','trialing','past_due','unpaid','incomplete'].includes(x.status)))return forbidden(res,'Subscription already exists.',409);
 const session=await stripe.checkout.sessions.create({mode:'subscription',customer,
  line_items:[{price_data:{currency:'usd',unit_amount:7900,recurring:{interval:'month'},product_data:{name:'RouteDrop Business Membership'}},quantity:1}],
  success_url:baseUrl+'/?subscription=return',cancel_url:baseUrl+'/?subscription=cancel'});
 res.json({url:session.url});
}));
app.post('/api/stripe/connect',requireDb,requireUser('business'),safe(async(req,res)=>{
 if(!paymentsReady||!baseUrl) return forbidden(res,'Stripe Connect is awaiting platform setup.',503);
 const r=await pool.query('SELECT id,stripe_account_id FROM businesses WHERE owner_id=$1',[req.user.id]);
 if(!r.rowCount)return forbidden(res,'Business not found.',404);
 let accountId=r.rows[0].stripe_account_id;
 if(!accountId){
  const account=await stripe.accounts.create({type:'express',country:'US',capabilities:{card_payments:{requested:true},transfers:{requested:true}},metadata:{routedrop_business_id:String(r.rows[0].id)}});
  accountId=account.id;
  await pool.query('UPDATE businesses SET stripe_account_id=$1 WHERE id=$2 AND stripe_account_id IS NULL',[accountId,r.rows[0].id]);
 }
 const url=await stripe.accountLinks.create({account:accountId,refresh_url:baseUrl+'/?stripe=retry',return_url:baseUrl+'/?stripe=return',type:'account_onboarding'});
 res.json({url:url.url});
}));
app.post('/api/checkout',requireDb,requireUser('customer'),checkoutLimiter,safe(async(req,res)=>{
 if(!paymentsReady||!baseUrl)return forbidden(res,'Checkout is disabled until Stripe is fully configured.',503);
 const id=Number(req.body.listingId);
 if(!Number.isSafeInteger(id)||id<1)return forbidden(res,'Invalid listing.');
 const client=await pool.connect();
 let booking,offer;
 try{
  await client.query('BEGIN');
  offer=(await client.query("SELECT l.id,l.title,l.price_cents,l.slot_start,b.stripe_account_id FROM listings l JOIN businesses b ON b.id=l.business_id WHERE l.id=$1 AND l.status='active' AND l.slot_start>now() FOR UPDATE OF l",[id])).rows[0];
  if(!offer){await client.query('ROLLBACK');return forbidden(res,'Route is not available.',404);}
  await client.query("UPDATE bookings SET status='canceled' WHERE listing_id=$1 AND status='awaiting_payment' AND hold_expires_at<now()",[id]);
  const fee=Math.max(1,Math.round(offer.price_cents*.08));
  const result=await client.query("INSERT INTO bookings(listing_id,customer_id,status,price_cents,fee_cents,hold_expires_at) VALUES($1,$2,'awaiting_payment',$3,$4,now()+interval '45 minutes') RETURNING id",[id,req.user.id,offer.price_cents,fee]);
  booking=result.rows[0];
  await client.query('COMMIT');
 } catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return forbidden(res,'This slot is reserved already.',409);throw e;} finally{client.release();}
 try{
  if(!offer.stripe_account_id)throw Error('This business has not connected payments.');
  const account=await stripe.accounts.retrieve(offer.stripe_account_id);
  if(!account.charges_enabled||!account.payouts_enabled)throw Error('This business has not completed payout onboarding.');
  const checkout=await stripe.checkout.sessions.create({
   mode:'payment',payment_method_types:['card'],customer_email:req.user.email,
   line_items:[{price_data:{currency:'usd',unit_amount:offer.price_cents,product_data:{name:offer.title}},quantity:1}],
   payment_intent_data:{application_fee_amount:Math.round(offer.price_cents*.08),transfer_data:{destination:offer.stripe_account_id}},
   client_reference_id:String(booking.id),metadata:{booking_id:String(booking.id),listing_id:String(offer.id)},
   success_url:baseUrl+'/?payment=return',cancel_url:baseUrl+'/?payment=cancel',
   expires_at:Math.floor(Date.now()/1000)+30*60
  },{idempotencyKey:'routedrop-checkout-'+booking.id});
  await pool.query('UPDATE bookings SET checkout_session_id=$1 WHERE id=$2',[checkout.id,booking.id]);
  res.json({url:checkout.url});
 }catch(e){
  await pool.query("UPDATE bookings SET status='canceled' WHERE id=$1 AND status='awaiting_payment'",[booking.id]).catch(()=>{});
  return forbidden(res,e.message.startsWith('This business')?e.message:'Checkout could not start. Please try again.',409);
 }
}));
app.post('/api/bookings/:id/retry-payment',requireDb,requireUser('customer'),checkoutLimiter,safe(async(req,res)=>{
 if(!paymentsReady)return forbidden(res,'Payments not configured.',503);
 const id=Number(req.params.id);
 if(!Number.isSafeInteger(id)||id<1)return forbidden(res,'Invalid booking.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query("SELECT k.*,l.title,l.slot_start,b.stripe_account_id FROM bookings k JOIN listings l ON l.id=k.listing_id JOIN businesses b ON b.id=l.business_id WHERE k.id=$1 AND k.customer_id=$2 FOR UPDATE OF k",[id,req.user.id]);
  const b=q.rows[0];
  if(!b||b.status!=='awaiting_payment'){await client.query('ROLLBACK');return forbidden(res,'No unpaid booking found.',404);}
  if(new Date(b.slot_start)<=new Date() || new Date(b.hold_expires_at)<=new Date()){
   await client.query("UPDATE bookings SET status='canceled' WHERE id=$1",[id]);
   await client.query('COMMIT');return forbidden(res,'Booking hold expired. Choose another opening.',409);
  }
  if(b.checkout_session_id){
   const old=await stripe.checkout.sessions.retrieve(b.checkout_session_id);
   if(old.payment_status==='paid'){await client.query('COMMIT');return forbidden(res,'Payment already received. Refresh bookings.',409);}
   if(old.status==='open'&&old.url&&old.expires_at*1000>Date.now()+15000){await client.query('COMMIT');return res.json({url:old.url});}
  }
  const account=await stripe.accounts.retrieve(b.stripe_account_id);
  if(!account.charges_enabled||!account.payouts_enabled){await client.query('ROLLBACK');return forbidden(res,'Business payouts unavailable.',409);}
  const checkout=await stripe.checkout.sessions.create({
   mode:'payment',payment_method_types:['card'],customer_email:req.user.email,
   line_items:[{price_data:{currency:'usd',unit_amount:b.price_cents,product_data:{name:b.title}},quantity:1}],
   payment_intent_data:{application_fee_amount:b.fee_cents,transfer_data:{destination:b.stripe_account_id}},
   client_reference_id:String(id),metadata:{booking_id:String(id)},
   success_url:baseUrl+'/?payment=return',cancel_url:baseUrl+'/?payment=cancel',
   expires_at:Math.floor(Date.now()/1000)+1800
  });
  await client.query("UPDATE bookings SET checkout_session_id=$1,hold_expires_at=now()+interval '45 minutes' WHERE id=$2",[checkout.id,id]);
  await client.query('COMMIT');res.json({url:checkout.url});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}));
app.post('/api/bookings/:id/complete',requireDb,requireUser('business'),safe(async(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isSafeInteger(id))return forbidden(res,'Invalid booking');
 const r=await pool.query("UPDATE bookings k SET status='completed' FROM listings l JOIN businesses b ON b.id=l.business_id WHERE k.listing_id=l.id AND b.owner_id=$1 AND k.id=$2 AND k.status='paid' AND NOT EXISTS (SELECT 1 FROM cancellation_requests cr WHERE cr.booking_id=k.id AND cr.resolution IN ('pending','processing','needs_review')) RETURNING k.id",[req.user.id,id]);
 if(!r.rowCount)return forbidden(res,'No eligible paid booking found.',409);
 res.json({ok:true});
}));
app.use(express.static('routedrop-platform/public',{fallthrough:false,maxAge:'15m'}));
app.use((err,req,res,next)=>{console.error('RouteDrop request error',err.message);res.status(500).json({error:'Unexpected server error.'});});
app.listen(port,'0.0.0.0',()=>console.log('RouteDrop beta listening on '+port));
startDatabase();
