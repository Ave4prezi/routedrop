'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {assertSafePreviewStartup}=require('../preview-startup-policy');

const safe={
 ROUTEDROP_PRIVATE_PREVIEW_ONLY:'true',
 ROUTEDROP_STAGING_LOCK:'true',
 ROUTEDROP_STAGING_PASSWORD:'fictional-preview-password-long-enough',
 ROUTEDROP_PROVIDER_DOCS_MODE:'synthetic',
 ROUTEDROP_PROVIDER_VERIFICATION_ENABLED:'true',
 ROUTEDROP_LIVE_APPROVED:'false',
 ROUTEDROP_DEFERRED_BETA_ENABLED:'false',
 STRIPE_SECRET_KEY:'',
 STRIPE_WEBHOOK_SECRET:'',
 ROUTEDROP_PROVIDER_DOC_SCAN_REQUIRED:'false'
};

test('synthetic-preview startup accepts only an explicitly gated, paymentless configuration',()=>{
 assert.deepEqual(assertSafePreviewStartup(safe),{requested:true,enabled:true});
 assert.deepEqual(assertSafePreviewStartup({}),{requested:false,enabled:false});
 assert.deepEqual(assertSafePreviewStartup({ROUTEDROP_PRIVATE_PREVIEW_ONLY:'false'}),{requested:false,enabled:false});
 for(const [key,value] of [
  ['ROUTEDROP_PRIVATE_PREVIEW_ONLY','tru'],
  ['ROUTEDROP_PRIVATE_PREVIEW_ONLY','false'],
  ['ROUTEDROP_STAGING_LOCK','false'],
  ['ROUTEDROP_STAGING_PASSWORD','short'],
  ['ROUTEDROP_PROVIDER_DOCS_MODE','real'],
  ['ROUTEDROP_PROVIDER_VERIFICATION_ENABLED','false'],
  ['ROUTEDROP_LIVE_APPROVED','true'],
  ['ROUTEDROP_DEFERRED_BETA_ENABLED','true'],
  ['STRIPE_SECRET_KEY','sk_test_not_a_real_key'],
  ['STRIPE_WEBHOOK_SECRET','whsec_not_a_real_secret'],
  ['ROUTEDROP_PROVIDER_DOC_SCAN_REQUIRED','true']
 ]){
  assert.throws(()=>assertSafePreviewStartup({...safe,[key]:value}),
   /Refusing unsafe fictional-preview startup/,
   key+' must not silently activate another environment');
 }
 assert.throws(()=>assertSafePreviewStartup({ROUTEDROP_PROVIDER_DOCS_MODE:'synthetic'}),
  /Refusing unsafe fictional-preview startup/,'synthetic docs cannot be enabled without preview flag');
 assert.equal(assertSafePreviewStartup({ROUTEDROP_DEFERRED_BETA_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_nonreal'}).enabled,false,
  'existing isolated non-preview test environments are not blocked');
});

test('a partial fictional-preview configuration exits before HTTP listening or DB access',()=>{
 const env={
  ...process.env,
  NODE_ENV:'test',PORT:'0',DATABASE_URL:'',
  ...safe,ROUTEDROP_STAGING_LOCK:'false',STRIPE_SECRET_KEY:'',
  ROUTEDROP_STAGING_PASSWORD:'fictional-preview-password-long-enough'
 };
 const child=spawnSync(process.execPath,[path.resolve(__dirname,'../server.js')],{
  cwd:path.resolve(__dirname,'../..'),env,timeout:10000,encoding:'utf8'
 });
 assert.notEqual(child.status,0,'unsafe preview must refuse process startup');
 assert.match(child.stderr,/Refusing unsafe fictional-preview startup/);
 assert.doesNotMatch(child.stdout,/RouteDrop beta listening/);
 assert.doesNotMatch(child.stderr,/DATABASE_URL|sk_test_not_a_real_key|fictional-preview-password-long-enough/,
  'startup error must not print configured secret values');
});
