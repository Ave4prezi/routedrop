'use strict';
/**
 * Founding-partner onboarding against the actual HTTP application and a disposable
 * PostgreSQL schema. All identities and evidence are invented; Stripe is configured
 * with a syntactically test-only key and is never called. The booking gate stops
 * before any Stripe request.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {spawn}=require('node:child_process');
const {createServer}=require('node:net');
const crypto=require('node:crypto');
const path=require('node:path');

const doc=Buffer.from('%PDF-1.6\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){
 const net=createServer();
 await new Promise((ok,fail)=>net.once('error',fail).listen(0,'127.0.0.1',ok));
 const port=net.address().port;
 await new Promise(resolve=>net.close(resolve));
 return port;
}
test('fictional partner: consent, signup, service listing, encrypted evidence, independent review, booking gate and revocation', {
 skip:!process.env.ROUTEDROP_TEST_DATABASE_URL&&'requires disposable PostgreSQL',
 timeout:90000
},async()=>{
 const schema='routedrop_founding_partner_ci';
 const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 let child,stderr='',exitCode=null;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  const port=await freePort(),base='http://127.0.0.1:'+port;
  const dbUrl=new URL(process.env.ROUTEDROP_TEST_DATABASE_URL);
  // Restrict server database connections to a disposable schema.
  dbUrl.searchParams.set('options','-c search_path='+schema+',public');
  const env={...process.env,
   DATABASE_URL:dbUrl.toString(),
   PORT:String(port),
   PUBLIC_URL:base,
   NODE_ENV:'test',
   ROUTEDROP_STAGING_LOCK:'false',
   ROUTEDROP_LIVE_APPROVED:'false',
   ROUTEDROP_DEFERRED_BETA_ENABLED:'true',
   ROUTEDROP_PROVIDER_VERIFICATION_ENABLED:'true',
   ROUTEDROP_PROVIDER_DOC_KEY_B64:crypto.randomBytes(32).toString('base64'),
   STRIPE_SECRET_KEY:'sk_test_ci_fixture_no_network',
   STRIPE_WEBHOOK_SECRET:'whsec_ci_fixture',
  };
  child=spawn(process.execPath,[path.resolve(__dirname,'../server.js')],{
   cwd:path.resolve(__dirname,'../..'),env,stdio:['ignore','pipe','pipe']
  });
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-1500)});
  child.stdout.resume();
  child.once('exit',code=>{exitCode=code});
  let ready=false;
  for(let i=0;i<100;i++){
   if(exitCode!==null)break;
   try{
    const res=await fetch(base+'/health');
    const data=await res.json();
    if(res.ok&&data.database==='ready'){ready=true;break}
   }catch(_e){}
   await delay(100);
  }
  assert.equal(ready,true,'isolated HTTP app must become ready; '+stderr.replace(/(sk|rk)_test_\S+/g,'[redacted]'));
  const cfg=await fetch(base+'/api/config'),config=await cfg.json();
  assert.equal(config.provider_verification,true);
  assert.equal(config.payments_mode,'test');
  assert.equal(config.deferred_booking,true);
  const csrfCookie=cfg.headers.get('set-cookie').split(';')[0];
  const csrf=csrfCookie.split('=').slice(1).join('=');
  function account(){let session='';return {
   async request(endpoint,{method='GET',body,kind}={}){
    const isBinary=Buffer.isBuffer(body);
    const headers={cookie:[csrfCookie,session].filter(Boolean).join('; ')};
    if(method!=='GET'){
     headers.origin=base;headers['x-csrf-token']=csrf;
     headers['content-type']=isBinary?'application/octet-stream':'application/json';
     if(kind)headers['x-evidence-kind']=kind;
    }
    const r=await fetch(base+endpoint,{method,headers,body:body===undefined?undefined:isBinary?body:JSON.stringify(body)});
    const cookie=r.headers.get('set-cookie');
    if(cookie?.startsWith('__Host-rd_session='))session=cookie.split(';')[0];
    return r;
   }
  }}
  const partner=account();
  const incomplete={
   name:'Morgan Sample',email:'morgan-sample@ci.invalid',password:'NotARealPassword123!',
   role:'business',businessName:'Fictional Pine Cleaning',city:'Decatur, AL',category:'Cleaning'
  };
  let res=await partner.request('/api/register',{method:'POST',body:incomplete});
  assert.equal(res.status,400,'early access acknowledgement is mandatory');
  res=await partner.request('/api/register',{method:'POST',body:{...incomplete,pilotConsent:true}});
  assert.equal(res.status,201,'fictional business account created');
  const who=await (await partner.request('/api/me')).json();
  assert.equal(who.business.name,incomplete.businessName);
  const businessId=Number(who.business.id);
  const reviewUser=account();
  res=await reviewUser.request('/api/register',{method:'POST',body:{
   name:'Taylor Reviewer',email:'taylor-reviewer@ci.invalid',password:'NotARealPassword456!',role:'customer'
  }});
  assert.equal(res.status,201);
  res=await reviewUser.request('/api/provider-verification/review-queue');
  assert.equal(res.status,403,'unauthorized users cannot see review queue');
  const user=await admin.query('SELECT 1');
  assert.equal(user.rowCount,1);
  // Role assignment is test-only and scoped to the disposable schema.
  const db=new Pool({connectionString:dbUrl.toString(),ssl:false});
  try{
   const reviewer=await db.query("SELECT id FROM users WHERE email='taylor-reviewer@ci.invalid'");
   assert.equal(reviewer.rowCount,1);
   await db.query('INSERT INTO deferred_support_agents(user_id) VALUES($1)',[reviewer.rows[0].id]);
   const owner=await db.query("SELECT id FROM users WHERE email='morgan-sample@ci.invalid'");
   await db.query('INSERT INTO deferred_support_agents(user_id) VALUES($1)',[owner.rows[0].id]);
   const listingDate=new Date(Date.now()+2*86400000).toISOString();
   res=await partner.request('/api/listings',{method:'POST',body:{
    title:'Fictional kitchen cleaning',category:'Cleaning',neighborhood:'East Decatur',
    priceCents:7500,slotStart:listingDate,durationMinutes:90
   }});
   assert.equal(res.status,201,'can draft a service listing');
   const listingId=Number((await res.json()).listing.id);
   assert.equal((await (await partner.request('/api/listings')).json()).listings.length,0,
    'unverified listing must not be discoverable');
   res=await partner.request('/api/deferred-bookings',{method:'POST',body:{
    listingId,consent:true,termsVersion:'deferred-v1'
   }});
   assert.equal(res.status,409,'unverified booking blocked before any Stripe request');
   for(const kind of ['identity','business_info','liability_insurance']){
    res=await partner.request('/api/provider-verification/document',{method:'POST',body:doc,kind});
    assert.equal(res.status,202,'fictional '+kind+' accepted as pending');
   }
   const stored=await db.query('SELECT kind,ciphertext FROM provider_verification_documents WHERE business_id=$1',[businessId]);
   assert.equal(stored.rows.length,3);
   assert.ok(stored.rows.every(r=>!r.ciphertext.includes(doc)),'never store plaintext PDF bytes');
   res=await partner.request('/api/provider-verification/review-document/'+businessId+'/identity');
   assert.equal(res.status,404,'cannot review own business even when support role is set');
   res=await reviewUser.request('/api/provider-verification/review-document/'+businessId+'/identity');
   assert.equal(res.status,200,'independent reviewer may download evidence');
   assert.deepEqual(Buffer.from(await res.arrayBuffer()),doc);
   res=await partner.request('/api/provider-verification/review',{method:'POST',body:{
    businessId,kind:'identity',decision:'approved',note:'Synthetic identity evidence reviewed'
   }});
   assert.equal(res.status,403,'self-approval must be rejected');
   const due=new Date(Date.now()+90*86400000).toISOString();
   for(const kind of ['identity','business_info','liability_insurance']){
    res=await reviewUser.request('/api/provider-verification/review',{method:'POST',body:{
     businessId,kind,decision:'approved',note:'Synthetic CI evidence checked, no live documents',
     expiresAt:kind==='liability_insurance'?due:null
    }});
    assert.equal(res.status,200,'independent review accepted '+kind);
   }
   const status=(await (await partner.request('/api/provider-verification/me')).json()).verification;
   assert.equal(status.eligible,true,'all required fictional credential checks approved');
   const listings=(await (await partner.request('/api/listings')).json()).listings;
   assert.equal(listings.length,1,'verified listing discoverable');
   assert.equal(Number(listings[0].price_cents),7500);
   res=await reviewUser.request('/api/provider-verification/revoke',{method:'POST',body:{
    businessId,kind:'liability_insurance',note:'Synthetic revocation test, coverage withdrawn'
   }});
   assert.equal(res.status,200);
   assert.equal((await (await partner.request('/api/listings')).json()).listings.length,0,
    'revoked required coverage immediately hides listing');
   res=await partner.request('/api/deferred-bookings',{method:'POST',body:{
    listingId,consent:true,termsVersion:'deferred-v1'
   }});
   assert.equal(res.status,409,'revoked credential blocks booking before Stripe');
   const audit=await db.query('SELECT action FROM provider_verification_audit WHERE business_id=$1',[businessId]);
   assert.ok(audit.rows.some(x=>x.action==='download'));
   assert.ok(audit.rows.some(x=>x.action==='review_approved'));
   assert.ok(audit.rows.some(x=>x.action==='revoked'));
   assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM deferred_bookings')).rows[0].count,0,
    'no payment-bearing booking created');
  }finally{await db.end()}
 }finally{
  if(child){
   child.kill('SIGTERM');
   await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);
   if(exitCode===null)child.kill('SIGKILL');
  }
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  await admin.end();
 }
});
