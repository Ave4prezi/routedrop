'use strict';
// Real HTTP + disposable PostgreSQL; invented data, no payment keys or external services.
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {spawn}=require('node:child_process');
const {createServer}=require('node:net');
const path=require('node:path');
const crypto=require('node:crypto');
const terms=require('../preview-acknowledgement');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function freePort(){
 const server=createServer();
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}

test('synthetic preview enforces exact version, stores immutable-version audit and denies real emails', {
 skip:!process.env.ROUTEDROP_TEST_DATABASE_URL && 'requires disposable PostgreSQL',
 timeout:90000
},async()=>{
 const schema='routedrop_preview_terms_'+crypto.randomBytes(4).toString('hex');
 const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 let app=null,stderr='';
 try {
  await admin.query('CREATE SCHEMA '+schema);
  const dbUrl=new URL(process.env.ROUTEDROP_TEST_DATABASE_URL);
  dbUrl.searchParams.set('options','-c search_path='+schema+',public');
  const port=await freePort(),base='http://127.0.0.1:'+port;
  const password='FictionalOnlyTestingPassword_2026!';
  const env={...process.env,DATABASE_URL:dbUrl.toString(),PORT:String(port),PUBLIC_URL:base,
   NODE_ENV:'test',ROUTEDROP_STAGING_LOCK:'true',ROUTEDROP_STAGING_PASSWORD:password,
   ROUTEDROP_PRIVATE_PREVIEW_ONLY:'true',ROUTEDROP_PROVIDER_DOCS_MODE:'synthetic',
   ROUTEDROP_PROVIDER_VERIFICATION_ENABLED:'true',ROUTEDROP_DEFERRED_BETA_ENABLED:'false',
   ROUTEDROP_LIVE_APPROVED:'false',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',
   ROUTEDROP_PROVIDER_DOC_KEY_B64:crypto.randomBytes(32).toString('base64')};
  app=spawn(process.execPath,[path.resolve(__dirname,'../server.js')],{
   cwd:path.resolve(__dirname,'../..'),env,stdio:['ignore','pipe','pipe']
  });
  app.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-1500)});
  app.stdout.resume();
  let ready=false;
  for(let i=0;i<120;i++){
   try{const r=await fetch(base+'/health');if(r.ok&&(await r.json()).database==='ready'){ready=true;break;}}catch(_e){}
   await delay(100);
  }
  assert.equal(ready,true,'private synthetic preview should boot '+stderr);
  const authorization='Basic '+Buffer.from('routedrop-staging:'+password).toString('base64');
  const configRes=await fetch(base+'/api/config',{headers:{authorization}});
  assert.equal(configRes.status,200);
  const cfg=await configRes.json();
  assert.equal(cfg.private_preview,true);
  assert.equal(cfg.provider_verification,true);
  assert.equal(cfg.deferred_booking,false);
  assert.deepEqual(cfg.preview_agreement,terms.publicTerms());
  const csrfCookie=configRes.headers.get('set-cookie').split(';')[0];
  const csrf=csrfCookie.split('=').slice(1).join('=');
  const request=async body=>{
   const r=await fetch(base+'/api/register',{method:'POST',
    headers:{authorization,cookie:csrfCookie,origin:base,'x-csrf-token':csrf,'content-type':'application/json'},
    body:JSON.stringify(body)});
   return r.status;
  };
  const sample={name:'Synthetic Test Person',email:'fictional-sample@ci.invalid',
   password:'OnlyFakePassword123!',role:'business',businessName:'Example Fictional Services',
   city:'Decatur, AL',category:'Cleaning'};
  assert.equal(await request({...sample,pilotConsent:true}),400,'version missing must fail');
  assert.equal(await request({...sample,pilotConsent:true,pilotAgreementVersion:'synthetic-preview-OLD'}),400,'old version must fail');
  assert.equal(await request({...sample,pilotConsent:false,pilotAgreementVersion:terms.VERSION}),400,'consent missing must fail');
  assert.equal(await request({...sample,email:'real-business@example.com',pilotConsent:true,pilotAgreementVersion:terms.VERSION}),400,'real email must be blocked');
  let absent=await admin.query('SELECT COUNT(*)::int AS count FROM '+schema+'.users');
  assert.equal(absent.rows[0].count,0,'denied attempts create no accounts');
  assert.equal(await request({...sample,pilotConsent:true,pilotAgreementVersion:terms.VERSION}),201,'exact consent registers invented business');
  const audit=await admin.query('SELECT u.email,a.version,a.terms_sha256,a.accepted_at,b.name FROM '+schema+'.provider_preview_acknowledgements a JOIN '+schema+'.users u ON u.id=a.user_id JOIN '+schema+'.businesses b ON b.id=a.business_id');
  assert.equal(audit.rowCount,1);
  assert.equal(audit.rows[0].email,sample.email);
  assert.equal(audit.rows[0].version,terms.VERSION);
  assert.equal(audit.rows[0].terms_sha256,terms.SHA256);
  assert.equal(audit.rows[0].name,sample.businessName);
  assert.ok(audit.rows[0].accepted_at);
  assert.equal(await request({...sample,pilotConsent:true,pilotAgreementVersion:terms.VERSION}),409,'duplicate registration cannot duplicate audit');
  const total=await admin.query('SELECT COUNT(*)::int AS count FROM '+schema+'.provider_preview_acknowledgements');
  assert.equal(total.rows[0].count,1);

  // Launch decisions remain separate from credential approvals in the
  // private fictional-data preview; no real Stripe/payment keys exist.
  const sharedHeaders={authorization,cookie:csrfCookie,origin:base,'x-csrf-token':csrf,'content-type':'application/json'};
  const register=async body=>fetch(base+'/api/register',{method:'POST',headers:sharedHeaders,body:JSON.stringify(body)});
  const reviewAccount={name:'Synthetic Document Reviewer',email:'synthetic-reviewer@ci.invalid',
   password:'OnlyFakeReviewer123!',role:'customer'};
  const launchAccount={name:'Synthetic Launch Operator',email:'synthetic-operator@ci.invalid',
   password:'OnlyFakeOperator123!',role:'customer'};
  assert.equal((await register(reviewAccount)).status,201);
  assert.equal((await register(launchAccount)).status,201);
  const login=async(email,password)=>{
   const r=await fetch(base+'/api/login',{method:'POST',headers:sharedHeaders,body:JSON.stringify({email,password})});
   assert.equal(r.status,200,'fictional account can login');
   const session=r.headers.get('set-cookie')?.split(';')[0];
   assert.ok(session?.startsWith('__Host-rd_session='));
   return session;
  };
  const ownerSession=await login(sample.email,sample.password);
  const reviewerSession=await login(reviewAccount.email,reviewAccount.password);
  const operatorSession=await login(launchAccount.email,launchAccount.password);
  const http=(session,endpoint,method='GET',body=null,kind=null)=>{
   const binary=Buffer.isBuffer(body);
   const headers={...sharedHeaders,cookie:csrfCookie+'; '+session,'content-type':binary?'application/octet-stream':'application/json'};
   if(kind)headers['x-evidence-kind']=kind;
   return fetch(base+endpoint,{method,headers,body:body===null?undefined:binary?body:JSON.stringify(body)});
  };
  const ids=await admin.query(
   'SELECT id,email FROM '+schema+'.users WHERE email=ANY($1)',[[sample.email,reviewAccount.email,launchAccount.email]]
  );
  const byEmail=Object.fromEntries(ids.rows.map(r=>[r.email,r.id]));
  await admin.query('INSERT INTO '+schema+'.provider_document_reviewers(user_id) VALUES($1)',[byEmail[reviewAccount.email]]);
  await admin.query('INSERT INTO '+schema+'.provider_launch_approvers(user_id) VALUES($1),($2)',
   [byEmail[launchAccount.email],byEmail[sample.email]]);
  const b=(await admin.query('SELECT id FROM '+schema+'.businesses WHERE owner_id=$1',
   [byEmail[sample.email]])).rows[0];
  const businessId=Number(b.id);
  const slotStart=new Date(Date.now()+3*86400000).toISOString();
  let response=await http(ownerSession,'/api/listings','POST',{
   title:'Fictional test cleaning',category:'Cleaning',neighborhood:'North Decatur',
   priceCents:7500,slotStart,durationMinutes:90
  });
  assert.equal(response.status,201,'business can create draft listing');
  const listingId=Number((await response.json()).listing.id);
  const visible=async()=>((await (await http(ownerSession,'/api/listings')).json()).listings).map(x=>Number(x.id));
  assert.deepEqual(await visible(),[],'unverified preview listing is hidden');
  response=await http(reviewerSession,'/api/provider-launch/decision','POST',{
   businessId,category:'Cleaning',decision:'approved',note:'Credentials have not been reviewed'
  });
  assert.equal(response.status,403,'document reviewer without separate launch permission cannot approve');
  response=await http(operatorSession,'/api/provider-launch/decision','POST',{
   businessId,category:'Cleaning',decision:'approved',note:'Premature fictional launch signoff'
  });
  assert.equal(response.status,409,'even authorized approver cannot approve unreviewed provider');
  const pdf=Buffer.from('%PDF-1.6\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
  for(const kind of ['identity','business_info','liability_insurance']){
   response=await http(ownerSession,'/api/provider-verification/document','POST',pdf,kind);
   assert.equal(response.status,202,'fictional evidence submitted for '+kind);
  }
  const expiry=new Date(Date.now()+60*86400000).toISOString();
  for(const kind of ['identity','business_info','liability_insurance']){
   response=await http(reviewerSession,'/api/provider-verification/review','POST',{
    businessId,kind,decision:'approved',note:'Synthetic sample evidence reviewed for test only',
    expiresAt:kind==='liability_insurance'?expiry:null
   });
   assert.equal(response.status,200,'independent fictional reviewer approved '+kind);
  }
  const verified=(await (await http(ownerSession,'/api/provider-verification/me')).json()).verification;
  assert.equal(verified.eligible,false,'credential approval alone cannot release listings');
  assert.ok(verified.missing.includes('launch_approval'),'missing approval must be visible');
  assert.equal(verified.launch?.state,'pending');
  assert.deepEqual(await visible(),[],'completed credential reviews do not publish the listing');
  response=await http(ownerSession,'/api/provider-launch/decision','POST',{
   businessId,category:'Cleaning',decision:'approved',note:'I approve my own business for testing'
  });
  assert.equal(response.status,403,'business owner cannot approve own launch even with operator role');
  response=await http(operatorSession,'/api/provider-launch/decision','POST',{
   businessId,category:'Cleaning',decision:'approved',note:'Independent fictional launch signoff for preview only'
  });
  assert.equal(response.status,200,'authorized independent launch approval');
  assert.deepEqual(await visible(),[listingId],'approved fictional listing is discoverable in private preview');
  const launchQueue=await http(operatorSession,'/api/provider-launch/queue');
  assert.equal(launchQueue.status,200);
  const queue=(await launchQueue.json()).businesses;
  assert.equal(queue.find(x=>Number(x.businessId)===businessId).launch.active,true);
  assert.equal((await http(reviewerSession,'/api/provider-launch/queue')).status,403,'reviewer cannot read launch queue');
  response=await http(operatorSession,'/api/provider-launch/decision','POST',{
   businessId,category:'Cleaning',decision:'revoked',note:'Fictional approval revoked before launch'
  });
  assert.equal(response.status,200);
  assert.deepEqual(await visible(),[],'revoked launch hides listing immediately');
  response=await http(operatorSession,'/api/provider-launch/decision','POST',{
   businessId,category:'Cleaning',decision:'approved',note:'Fresh synthetic launch approval after review'
  });
  assert.equal(response.status,200);
  assert.deepEqual(await visible(),[listingId]);
  response=await http(ownerSession,'/api/provider-verification/document','POST',pdf,'business_info');
  assert.equal(response.status,202,'credential change invalidates approval');
  assert.deepEqual(await visible(),[],'changed evidence hides listing');
  response=await http(reviewerSession,'/api/provider-verification/review','POST',{
   businessId,kind:'business_info',decision:'approved',note:'Synthetic replacement independently reviewed'
  });
  assert.equal(response.status,200);
  const stale=(await (await http(ownerSession,'/api/provider-verification/me')).json()).verification;
  assert.equal(stale.eligible,false,'re-reviewed credentials do not resurrect old launch approval');
  assert.equal(stale.launch.reason,'credentials_changed');
  response=await http(operatorSession,'/api/provider-launch/decision','POST',{
   businessId,category:'Cleaning',decision:'approved',note:'New independent launch approval after replacement evidence'
  });
  assert.equal(response.status,200);
  assert.deepEqual(await visible(),[listingId],'new approval restores synthetic preview discovery');
  assert.equal((await http(reviewerSession,'/api/checkout','POST',{listingId})).status,503,
   'synthetic private preview cannot charge customers even after launch approval');
  const audits=await admin.query('SELECT action FROM '+schema+'.provider_launch_audit WHERE business_id=$1 ORDER BY id',
   [businessId]);
  assert.deepEqual(audits.rows.map(x=>x.action),['approved','revoked','approved','approved']);
  assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM '+schema+'.bookings')).rows[0].n,0,
   'fictional release never makes a payment booking');
 } finally {
  if(app){app.kill('SIGTERM');await delay(100);}
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
  await admin.end();
 }
});
