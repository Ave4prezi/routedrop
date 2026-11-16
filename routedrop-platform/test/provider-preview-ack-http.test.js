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
 } finally {
  if(app){app.kill('SIGTERM');await delay(100);}
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
  await admin.end();
 }
});
