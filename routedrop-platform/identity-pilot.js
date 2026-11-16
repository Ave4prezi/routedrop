'use strict';

/**
 * RouteDrop Stripe Identity adapter: Stripe-hosted document + selfie proofing.
 * Only Stripe TEST credentials are permitted in the private, unpaid pilot.
 * RouteDrop never stores the documents, face images, names, DOB or ID numbers.
 */
const crypto=require('crypto');
const Stripe=require('stripe');

const ddl=Object.freeze([
 "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pilot_identity_status TEXT NOT NULL DEFAULT 'not_started' CHECK(pilot_identity_status IN ('not_started','initializing','requires_input','processing','verified_test','failed','canceled'))",
 "CREATE TABLE IF NOT EXISTS pilot_identity_attempts (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, idempotency_key TEXT NOT NULL UNIQUE, stripe_session_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'initializing' CHECK(status IN ('initializing','requires_input','processing','verified_test','failed','canceled')), consent_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE UNIQUE INDEX IF NOT EXISTS pilot_identity_one_open_attempt ON pilot_identity_attempts(business_id) WHERE status IN ('initializing','requires_input','processing')",
 "CREATE INDEX IF NOT EXISTS pilot_identity_by_provider ON pilot_identity_attempts(business_id,created_at DESC)",
 "CREATE TABLE IF NOT EXISTS pilot_identity_webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TIMESTAMPTZ NOT NULL DEFAULT now())"
]);
const allowedEvents=Object.freeze({
 'identity.verification_session.verified':'verified_test',
 'identity.verification_session.requires_input':'requires_input',
 'identity.verification_session.processing':'processing',
 'identity.verification_session.canceled':'canceled'
});
function identityConfigured(env=process.env){
 const key=env.ROUTEDROP_STRIPE_IDENTITY_TEST_KEY||'',webhook=env.ROUTEDROP_STRIPE_IDENTITY_WEBHOOK_SECRET||'';
 return env.ROUTEDROP_IDENTITY_TEST_ENABLED==='true'&&/^(sk|rk)_test_/.test(key)&&webhook.startsWith('whsec_')&&webhook.length>20;
}
function identityPublicStatus(status){
 return {status:status||'not_started',identity_verified:false,documents_stored:false,real_provider_approved:false,mode:'stripe_test_only'};
}
function identitySessionParams(businessId,returnUrl){
 return {type:'document',client_reference_id:'routedrop_pilot_provider_'+String(businessId),
  options:{document:{require_matching_selfie:true}},
  metadata:{routedrop_pilot_provider_id:String(businessId)},return_url:returnUrl};
}
function stripeIdentityClient(env=process.env){
 if(!identityConfigured(env))return null;
 return new Stripe(env.ROUTEDROP_STRIPE_IDENTITY_TEST_KEY);
}
function eventOutcome(event,attempt){
 if(!event||!allowedEvents[event.type]||event.livemode!==false)return null;
 const obj=event.data?.object;
 if(!obj||!/^vs_/.test(obj.id||'')||obj.id!==attempt.stripe_session_id||obj.livemode!==false)return null;
 const newStatus=allowedEvents[event.type];
 const validStatus={verified_test:'verified',requires_input:'requires_input',processing:'processing',canceled:'canceled'}[newStatus];
 if(obj.status!==validStatus)return null;
 if(attempt.status==='verified_test'&&newStatus!=='verified_test')return null;
 if(['canceled','failed'].includes(attempt.status)&&newStatus==='processing')return null;
 return newStatus;
}
async function applyIdentityEvent(pool,event){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query("SELECT id,business_id,stripe_session_id,status FROM pilot_identity_attempts WHERE stripe_session_id=$1 FOR UPDATE",[event.data?.object?.id||'']);
  if(!q.rowCount){await client.query('ROLLBACK');return {ignored:true,reason:'unknown_session'};}
  const attempt=q.rows[0],next=eventOutcome(event,attempt);
  if(!next){await client.query('ROLLBACK');return {ignored:true,reason:'status_mismatch'};}
  const ev=await client.query("INSERT INTO pilot_identity_webhook_events(event_id,event_type) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING RETURNING event_id",[event.id,event.type]);
  if(!ev.rowCount){await client.query('ROLLBACK');return {ignored:true,reason:'duplicate'};}
  await client.query("UPDATE pilot_identity_attempts SET status=$1,updated_at=now() WHERE id=$2",[next,attempt.id]);
  await client.query("UPDATE businesses SET pilot_identity_status=$1 WHERE id=$2 AND EXISTS(SELECT 1 FROM pilot_identity_attempts latest WHERE latest.business_id=$2 AND latest.id=$3 AND NOT EXISTS(SELECT 1 FROM pilot_identity_attempts newer WHERE newer.business_id=$2 AND newer.id>latest.id))",[next,attempt.business_id,attempt.id]);
  await client.query('COMMIT');
  return {processed:true,status:next};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
function registerIdentityRoutes(app,{pool,safe,requireDb,requireProvider,forbidden,identityClient,identityLimiter,baseUrl,enabled}){
 if(!pool)return;
 app.get('/api/pilot/identity/status',requireDb,requireProvider,safe(async(req,res)=>{
  const q=await pool.query("SELECT pilot_identity_status FROM businesses WHERE owner_id=$1",[req.user.id]);
  res.set('Cache-Control','no-store').json({...identityPublicStatus(q.rows[0]?.pilot_identity_status),available:enabled});
 }));
 app.post('/api/pilot/identity/start',requireDb,requireProvider,identityLimiter,safe(async(req,res)=>{
  if(!enabled||!identityClient||!baseUrl.startsWith('https://'))return forbidden(res,'Hosted Stripe Identity test mode is not configured on this private service.',503);
  if(!req.user.email_verified)return forbidden(res,'Verify your RouteDrop email before starting identity proofing.',403);
  if(req.body?.explicitConsent!==true)return forbidden(res,'Explicit consent for Stripe-hosted test verification is required.',400);
  const client=await pool.connect();
  let attempt;
  try{
   await client.query('BEGIN');
   const q=await client.query("SELECT id,pilot_identity_status,pilot_screening_status FROM businesses WHERE owner_id=$1 FOR UPDATE",[req.user.id]);
   if(!q.rowCount||q.rows[0].pilot_screening_status==='suspended'||q.rows[0].pilot_identity_status==='verified_test'){await client.query('ROLLBACK');return forbidden(res,'Provider unavailable or test identity check already completed.',409);}
   const businessId=q.rows[0].id;
   await client.query("UPDATE pilot_identity_attempts SET status='failed' WHERE business_id=$1 AND status='initializing' AND created_at<now()-interval '15 minutes'",[businessId]);
   const c=await client.query("SELECT count(*)::int AS n FROM pilot_identity_attempts WHERE business_id=$1 AND created_at>now()-interval '24 hours'",[businessId]);
   if(c.rows[0].n>=3){await client.query('ROLLBACK');return forbidden(res,'Too many identity test attempts today. Contact support before retrying.',429);}
   const key=crypto.randomUUID();
   const inserted=await client.query("INSERT INTO pilot_identity_attempts (business_id,idempotency_key) VALUES($1,$2) ON CONFLICT (business_id) WHERE status IN ('initializing','requires_input','processing') DO NOTHING RETURNING id,business_id,idempotency_key",[businessId,key]);
   if(!inserted.rowCount){await client.query('ROLLBACK');return forbidden(res,'An identity verification is already open. Do not start a duplicate.',409);}
   attempt=inserted.rows[0];
   await client.query("UPDATE businesses SET pilot_identity_status='initializing' WHERE id=$1",[businessId]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  try{
   const session=await identityClient.identity.verificationSessions.create(
    identitySessionParams(attempt.business_id,baseUrl+'/'),
    {idempotencyKey:attempt.idempotency_key}
   );
   if(!session?.id||session.livemode!==false||!/^https:\/\//.test(session.url||''))throw Error('Hosted test verification was not returned.');
   await pool.query("UPDATE pilot_identity_attempts SET stripe_session_id=$1,status='requires_input',updated_at=now() WHERE id=$2 AND status='initializing'",[session.id,attempt.id]);
   await pool.query("UPDATE businesses SET pilot_identity_status='requires_input' WHERE id=$1",[attempt.business_id]);
   res.status(201).json({url:session.url,message:'Stripe-hosted verification test only. Government documents stay with Stripe; no verified provider badge is issued.'});
  }catch(e){
   await pool.query("UPDATE pilot_identity_attempts SET status='failed',updated_at=now() WHERE id=$1 AND status='initializing'",[attempt.id]);
   await pool.query("UPDATE businesses SET pilot_identity_status='failed' WHERE id=$1 AND pilot_identity_status='initializing'",[attempt.business_id]);
   return forbidden(res,'Identity test session could not start. Review restricted Stripe Identity configuration.',503);
  }
 }));
}
module.exports={ddl,identityConfigured,identityPublicStatus,identitySessionParams,stripeIdentityClient,eventOutcome,applyIdentityEvent,registerIdentityRoutes};
