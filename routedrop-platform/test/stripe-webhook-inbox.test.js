'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {Pool} = require('pg');
const {schema,validEvent,createWebhookInbox} = require('../stripe-webhook-inbox');

const event = (id, type='payment_intent.succeeded') => ({
  id,type,livemode:false,created:1794779710,
  data:{object:{id:'pi_ci_only',metadata:{routedrop_failure_ci_run:'fictional-ci-only'}}}
});
test('durable inbox: acknowledge storage, dedupe, rollback, retry, restart and concurrent workers', {
  skip:!process.env.ROUTEDROP_TEST_DATABASE_URL && 'requires disposable PostgreSQL',
  timeout:90000
},async()=>{
  const namespace='routedrop_webhook_inbox_ci';
  const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
  let pool;
  const attempts=new Map(),warnings=[];
  try{
    await admin.query('CREATE SCHEMA '+namespace);
    pool=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false,
      options:'-c search_path='+namespace+',public',max:8});
    for(const statement of schema)await pool.query(statement);
    for(const statement of schema)await pool.query(statement); // repeated migration safe
    await pool.query('CREATE TABLE ci_effects (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now())');
    assert.equal(validEvent(event('evt_Test001')),true);
    assert.equal(validEvent({type:'payment_intent.succeeded',data:{object:{}}}),false);
    assert.equal(validEvent({id:'evt_Test001',type:'payment_intent.succeeded'}),false);
    const logger={error:(...args)=>warnings.push(args)};
    const applyEvent=async(e,client)=>{
      attempts.set(e.id,(attempts.get(e.id)||0)+1);
      await client.query('INSERT INTO ci_effects(id) VALUES ($1)',[e.id]);
      if(e.id==='evt_Transient001' && attempts.get(e.id)===1)
        throw Object.assign(new Error('fictional temporary upstream failure'),{code:'ETIMEDOUT'});
      if(e.id==='evt_Concurrent001') await new Promise(resolve=>setTimeout(resolve,50));
    };
    const inbox=createWebhookInbox({pool,applyEvent,logger});
    // HTTP handler can acknowledge only after INSERT commits. No effect yet.
    assert.deepEqual(await inbox.enqueue(event('evt_Test001')),{inserted:true});
    assert.deepEqual(await inbox.enqueue(event('evt_Test001')),{inserted:false});
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM ci_effects')).rows[0].n,0);
    assert.deepEqual(await inbox.drainAvailable(),{processed:1,deferred:0});
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM ci_effects')).rows[0].n,1);
    assert.deepEqual(await inbox.drainAvailable(),{processed:0,deferred:0});
    assert.equal(attempts.get('evt_Test001'),1,'duplicate deliveries must not replay effects');

    // Failure rolls back every business effect; the durable inbox remains for retry.
    await inbox.enqueue(event('evt_Transient001'));
    assert.deepEqual(await inbox.drainAvailable(),{processed:0,deferred:1});
    let pending=(await pool.query('SELECT attempts,processed_at,next_attempt_at,last_error FROM stripe_webhook_inbox WHERE id=$1',
      ['evt_Transient001'])).rows[0];
    assert.equal(pending.attempts,1);
    assert.equal(pending.processed_at,null);
    assert.equal(pending.last_error,'ETIMEDOUT');
    assert.ok(new Date(pending.next_attempt_at)>new Date());
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM ci_effects WHERE id=$1',['evt_Transient001'])).rows[0].n,0);
    assert.equal(warnings.length,1);
    assert.deepEqual(await inbox.drainAvailable(),{processed:0,deferred:0},'must honor backoff');
    // Simulate restart: reconstruct the worker, not the original HTTP request.
    await pool.query("UPDATE stripe_webhook_inbox SET next_attempt_at=now()-INTERVAL '1 second' WHERE id=$1",['evt_Transient001']);
    const restarted=createWebhookInbox({pool,applyEvent,logger});
    assert.deepEqual(await restarted.drainAvailable(),{processed:1,deferred:0});
    pending=(await pool.query('SELECT processed_at FROM stripe_webhook_inbox WHERE id=$1',['evt_Transient001'])).rows[0];
    assert.ok(pending.processed_at);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM ci_effects WHERE id=$1',['evt_Transient001'])).rows[0].n,1);
    assert.equal(attempts.get('evt_Transient001'),2);

    // FOR UPDATE SKIP LOCKED prevents duplicate state changes across workers.
    await inbox.enqueue(event('evt_Concurrent001'));
    const second=createWebhookInbox({pool,applyEvent,logger});
    await Promise.all([inbox.drainAvailable(),second.drainAvailable()]);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM ci_effects WHERE id=$1',['evt_Concurrent001'])).rows[0].n,1);
    assert.equal(attempts.get('evt_Concurrent001'),1);
    await inbox.enqueue(event('evt_Concurrent001'));
    await second.drainAvailable();
    assert.equal(attempts.get('evt_Concurrent001'),1);

    // Purge only older processed payloads; retain pending events indefinitely for review.
    await pool.query("UPDATE stripe_webhook_inbox SET processed_at=now()-INTERVAL '8 days' WHERE id=$1",['evt_Test001']);
    await inbox.enqueue(event('evt_Pending001'));
    await inbox.pruneProcessed();
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM stripe_webhook_inbox WHERE id=$1',['evt_Test001'])).rows[0].n,0);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM stripe_webhook_inbox WHERE id=$1',['evt_Pending001'])).rows[0].n,1);
  } finally {
    if(pool)await pool.end().catch(()=>{});
    await admin.query('DROP SCHEMA IF EXISTS '+namespace+' CASCADE').catch(()=>{});
    await admin.end();
  }
});
