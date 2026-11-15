'use strict';
// Full HTTP test against a disposable local server and PostgreSQL schema.
// Only fictional signed events are used; no Stripe network calls or real bookings.
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const Stripe=require('stripe');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');

async function freePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const port=server.address().port;
      server.close(()=>resolve(port));
    });
  });
}
async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
test('signed HTTP webhooks durably enter test-only inbox, dedupe and reject invalid signatures',{
  skip:!process.env.ROUTEDROP_TEST_DATABASE_URL && 'requires disposable PostgreSQL',
  timeout:35000
},async()=>{
  const schema='routedrop_http_inbox_ci';
  const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
  const port=await freePort();
  let child=null,db=null;
  let output='';
  try{
    await admin.query('CREATE SCHEMA '+schema);
    const dbUrl=new URL(process.env.ROUTEDROP_TEST_DATABASE_URL);
    dbUrl.searchParams.set('options','-c search_path='+schema+',public');
    db=new Pool({connectionString:dbUrl.toString(),ssl:false});
    const fakeSecret='whsec_fake_signed_webhook_ci_only';
    const childEnv={
      ...process.env,
      DATABASE_URL:dbUrl.toString(),
      PORT:String(port),
      NODE_ENV:'test',
      ROUTEDROP_STAGING_LOCK:'true',
      ROUTEDROP_STAGING_PASSWORD:'ci-only-very-long-test-password',
      ROUTEDROP_DEFERRED_BETA_ENABLED:'true',
      ROUTEDROP_WEBHOOK_INBOX_ENABLED:'true',
      ROUTEDROP_PAYMENT_SANDBOX_ONLY:'false',
      ROUTEDROP_PRIVATE_PREVIEW_ONLY:'false',
      ROUTEDROP_LIVE_APPROVED:'false',
      ROUTEDROP_PROVIDER_VERIFICATION_ENABLED:'false',
      STRIPE_SECRET_KEY:'sk_test_ci_fake_no_stripe_calls',
      STRIPE_WEBHOOK_SECRET:fakeSecret,
      ROUTEDROP_TEST_DATABASE_URL:''
    };
    child=spawn(process.execPath,['routedrop-platform/server.js'],{
      cwd:path.join(__dirname,'../..'),env:childEnv,stdio:['ignore','pipe','pipe']
    });
    const capture=chunk=>{output=(output+chunk.toString()).slice(-2500);};
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    const base='http://127.0.0.1:'+port;
    let ready=false;
    for(let n=0;n<100;n++){
      if(child.exitCode!==null)throw Error('isolated server stopped unexpectedly: '+output);
      try {
        const response=await fetch(base+'/health',{signal:AbortSignal.timeout(700)});
        const body=await response.json();
        if(body.database==='ready' && body.payments==='configured'){ready=true;break;}
      }catch{}
      await sleep(100);
    }
    assert.ok(ready,'isolated server and inbox migrations must initialize: '+output);
    const stripe=new Stripe('sk_test_fake_local_only');
    const evt={id:'evt_HttpSigned000001',object:'event',type:'charge.updated',livemode:false,created:1794779710,
      data:{object:{id:'ch_fictional_ci',object:'charge',metadata:{routedrop_failure_ci_run:'http-signed-ci'}}}};
    const payload=JSON.stringify(evt);
    const signature=stripe.webhooks.generateTestHeaderString({payload,secret:fakeSecret});
    const post=(header)=>fetch(base+'/api/stripe/webhook',{
      method:'POST',headers:{'content-type':'application/json','stripe-signature':header},body:payload
    });
    let response=await post('t=123,v1=wrong');
    assert.equal(response.status,400,'invalid Stripe signature must fail closed');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM stripe_webhook_inbox')).rows[0].count,0);

    response=await post(signature);
    assert.equal(response.status,200,await response.text());
    response=await post(signature);
    assert.equal(response.status,200,'same signed event may be retried safely');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM stripe_webhook_inbox')).rows[0].count,1);

    let processed=false;
    for(let n=0;n<45;n++){
      const row=(await db.query('SELECT processed_at,attempts FROM stripe_webhook_inbox WHERE id=$1',[evt.id])).rows[0];
      if(row?.processed_at){processed=true;assert.equal(row.attempts,0);break;}
      await sleep(100);
    }
    assert.ok(processed,'worker should eventually commit the verified event');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM stripe_events WHERE id=$1',[evt.id])).rows[0].count,1);
  }finally{
    if(child){
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(1500)]);
      if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');
    }
    if(db)await db.end().catch(()=>{});
    await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
    await admin.end();
  }
});
