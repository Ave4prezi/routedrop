'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertSandboxConfig,allowsFictionalSignup}=require('../payment-sandbox');
const {syntheticOnly,verifyUpload}=require('../document-security');
const env={
 ROUTEDROP_PAYMENT_SANDBOX_ONLY:'true',
 ROUTEDROP_PRIVATE_PREVIEW_ONLY:'false',
 ROUTEDROP_STAGING_LOCK:'true',
 ROUTEDROP_PROVIDER_DOCS_MODE:'synthetic',
 ROUTEDROP_LIVE_APPROVED:'false',
 DATABASE_URL:'postgresql://fixture@localhost/routedrop_payment_sandbox?sslmode=require',
 STRIPE_SECRET_KEY:'sk_test_fixture_no_network'
};
test('locked test sandbox accepts only a dedicated database and Stripe test key',()=>{
 assert.equal(assertSandboxConfig(env),true);
 assert.throws(()=>assertSandboxConfig({...env,STRIPE_SECRET_KEY:'sk_live_incorrect'}),/rejects non-test/);
 assert.throws(()=>assertSandboxConfig({...env,STRIPE_SECRET_KEY:'rk_test_incorrect'}),/rejects non-test/);
 assert.throws(()=>assertSandboxConfig({...env,ROUTEDROP_STAGING_LOCK:'false'}),/requires staging lock/);
 assert.throws(()=>assertSandboxConfig({...env,ROUTEDROP_PRIVATE_PREVIEW_ONLY:'true'}),/requires staging lock/);
 assert.throws(()=>assertSandboxConfig({...env,ROUTEDROP_LIVE_APPROVED:'true'}),/requires staging lock/);
 assert.throws(()=>assertSandboxConfig({...env,DATABASE_URL:'postgresql://fixture@localhost/routedrop_preview'}),/requires isolated/);
 assert.equal(assertSandboxConfig({...env,STRIPE_SECRET_KEY:''}),true);
 assert.equal(assertSandboxConfig({...env,ROUTEDROP_PAYMENT_SANDBOX_ONLY:'false'}),false);
});
test('fictional-only account email filter blocks regular customer addresses',()=>{
 for(const email of ['customer89@example.test','reviewer@ci.invalid','sample@example.invalid'])
  assert.equal(allowsFictionalSignup(email),true);
 for(const email of ['realperson@gmail.com','name@outlook.com','partner@company.org'])
  assert.equal(allowsFictionalSignup(email),false);
});
test('test-mode locked sandbox permits synthetic fixtures but rejects live Stripe credentials',async()=>{
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(28),Buffer.from('IEND'),Buffer.alloc(4)]);
 assert.equal(syntheticOnly(env),true);
 assert.deepEqual(await verifyUpload(png,env),{synthetic:true,scanned:false});
 assert.equal(syntheticOnly({...env,STRIPE_SECRET_KEY:'sk_live_bad'}),false);
 assert.equal(syntheticOnly({...env,ROUTEDROP_LIVE_APPROVED:'true'}),false);
 assert.equal(syntheticOnly({...env,ROUTEDROP_STAGING_LOCK:'false'}),false);
});
