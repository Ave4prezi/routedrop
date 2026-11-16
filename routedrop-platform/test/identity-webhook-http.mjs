// End-to-end signed HTTP webhook test using fictitious Stripe TEST credentials.
// No real Stripe account, no network calls to Stripe, no real provider identity.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import pg from 'pg';
import Stripe from 'stripe';
import identity from '../identity-pilot.js';

assert.ok(process.env.TEST_DATABASE_URL,'isolated CI PostgreSQL is required');
const db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
const nonce=String(Date.now());
const fakeApiKey='rk_test_fictional_ci_no_stripe_request';
const webhookSecret='whsec_fictional_ci_signed_events_0123456789';
const stripe=new Stripe(fakeApiKey);
const pass='private-fake-webhook-ci-only';
const socket=net.createServer();
socket.listen(0,'127.0.0.1');await once(socket,'listening');
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const base='http://127.0.0.1:'+port;
let stderr='',proc;
const testSession='vs_test_http_ci_'+nonce;
const event=(id,type,session,status,live=false)=>({
 id,type,livemode:live,data:{object:{
  object:'identity.verification_session',id:session,status,livemode:live
 }}
});
async function deliver(record,{signatureSecret=webhookSecret,payload}={}){
 const body=payload||JSON.stringify(record);
 const signature=stripe.webhooks.generateTestHeaderString({
  payload:JSON.stringify(record),secret:signatureSecret,
  timestamp:Math.floor(Date.now()/1000)
 });
 const response=await fetch(base+'/api/pilot/identity/webhook',{method:'POST',
  headers:{'content-type':'application/json','stripe-signature':signature},body});
 return {code:response.status,data:await response.json()};
}
try{
 proc=spawn(process.execPath,['routedrop-platform/server.js'],{
  env:{...process.env,PORT:String(port),DATABASE_URL:process.env.TEST_DATABASE_URL,
   NODE_ENV:'test',PUBLIC_URL:'',ROUTEDROP_WORKFLOW_PILOT:'true',
   ROUTEDROP_PREVIEW_ACCESS_PASSWORD:pass,ROUTEDROP_LIVE_APPROVED:'false',
   STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',
   ROUTEDROP_IDENTITY_TEST_ENABLED:'true',
   ROUTEDROP_STRIPE_IDENTITY_TEST_KEY:fakeApiKey,
   ROUTEDROP_STRIPE_IDENTITY_WEBHOOK_SECRET:webhookSecret,
   ROUTEDROP_MODERATOR_PASSKEYS_ENABLED:'false',
   ROUTEDROP_MODERATOR_ENROLLMENT_ENABLED:'false'},
  stdio:['ignore','pipe','pipe']
 });
 proc.stderr.on('data',e=>stderr+=String(e));
 const basic='Basic '+Buffer.from('routedrop-preview:'+pass).toString('base64');
 let ready=false;
 for(let i=0;i<150;i++){
  try{
   const r=await fetch(base+'/health',{headers:{authorization:basic}});
   if(r.ok&&(await r.json()).database==='ready'){ready=true;break;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'HTTP webhook test server failed to start: '+stderr);
 const u=await db.query(
  "INSERT INTO users(email,full_name,password_hash,role) VALUES($1,'Fictional CI Identity User','not-an-actual-login','business') RETURNING id",
  ['identity-ci-'+nonce+'@example.test']);
 const b=await db.query(
  "INSERT INTO businesses(owner_id,name,city,category) VALUES($1,'Fictional CI Provider','Decatur, AL','Cleaning') RETURNING id",
  [u.rows[0].id]);
 await db.query(
  "INSERT INTO pilot_identity_attempts(business_id,idempotency_key,stripe_session_id,status) VALUES($1,$2,$3,'requires_input')",
  [b.rows[0].id,'ci-only-identity-'+nonce,testSession]);
 const good=event('evt_ci_valid_'+nonce,'identity.verification_session.verified',testSession,'verified');
 const bad=await deliver(good,{signatureSecret:'whsec_some_other_forged_signer_098765'});
 assert.equal(bad.code,400,'forged signature must fail before any DB state change');
 const altered=await deliver(good,{payload:JSON.stringify({...good,id:'evt_modified_without_resigning'})});
 assert.equal(altered.code,400,'signed payload tampering must fail');
 assert.equal((await db.query('SELECT status FROM pilot_identity_attempts WHERE stripe_session_id=$1',[testSession])).rows[0].status,'requires_input');
 const mismatched=await deliver(event('evt_ci_unknown_'+nonce,
  'identity.verification_session.verified','vs_test_not_registered','verified'));
 assert.equal(mismatched.code,200);
 assert.equal(mismatched.data.processed,false,'unknown sessions must never affect a provider');
 const live=await deliver(event('evt_ci_live_'+nonce,
  'identity.verification_session.verified',testSession,'verified',true));
 assert.equal(live.code,200);
 assert.equal(live.data.processed,false,'LIVE Identity events must be ignored by this test-only pilot');
 const unrelated=await deliver(event('evt_ci_payment_'+nonce,'payment_intent.succeeded',testSession,'verified'));
 assert.equal(unrelated.code,200);
 assert.equal(unrelated.data.ignored,true,'payment events cannot change identity status');
 const accepted=await deliver(good);
 assert.equal(accepted.code,200);
 assert.equal(accepted.data.processed,true,'correctly signed, known TEST event must be accepted');
 const duplicate=await deliver(good);
 assert.equal(duplicate.code,200);
 assert.equal(duplicate.data.processed,false,'webhook replay must be idempotent');
 const stale=await deliver(event('evt_ci_stale_'+nonce,
  'identity.verification_session.requires_input',testSession,'requires_input'));
 assert.equal(stale.code,200);
 assert.equal(stale.data.processed,false,'later delivery of older state must not downgrade verification');
 const attempt=(await db.query('SELECT status FROM pilot_identity_attempts WHERE stripe_session_id=$1',[testSession])).rows[0];
 const business=(await db.query('SELECT pilot_identity_status FROM businesses WHERE id=$1',[b.rows[0].id])).rows[0];
 assert.equal(attempt.status,'verified_test');
 assert.equal(business.pilot_identity_status,'verified_test');
 assert.equal((await db.query('SELECT count(*)::int n FROM pilot_identity_webhook_events WHERE event_id=$1',[good.id])).rows[0].n,1);
 const publicResult=identity.identityPublicStatus(attempt.status);
 assert.equal(publicResult.identity_verified,false,'a Stripe TEST success never approves a real person');
 assert.equal(publicResult.real_provider_approved,false,'no real provider badge');
 assert.equal(publicResult.documents_stored,false,'only opaque session and state are recorded');
 console.log('PASS Stripe test-only signed HTTP webhook: forged/tampered rejected, unknown/LIVE/payment ignored, success, replay, stale protection and zero real approval');
}finally{
 if(proc){proc.kill('SIGTERM');await once(proc,'exit').catch(()=>{});}
 await db.end();
}
