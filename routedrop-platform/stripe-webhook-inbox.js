'use strict';

// Optional Stripe TEST-mode durable inbox. A verified webhook is acknowledged only
// after PostgreSQL commits its payload. Processing and retries happen separately.
// This does not prevent Render Free from sleeping or guarantee fast cold-start HTTP responses.
const schema = [
  "CREATE TABLE IF NOT EXISTS stripe_webhook_inbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload JSONB NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_error TEXT)",
  "CREATE INDEX IF NOT EXISTS stripe_webhook_inbox_due ON stripe_webhook_inbox(next_attempt_at,received_at) WHERE processed_at IS NULL",
  "CREATE INDEX IF NOT EXISTS stripe_webhook_inbox_processed ON stripe_webhook_inbox(processed_at) WHERE processed_at IS NOT NULL"
];

function validEvent(event) {
  return event && typeof event.id === 'string' && /^evt_[a-zA-Z0-9]{6,100}$/.test(event.id) &&
    typeof event.type === 'string' && event.type.length < 150 &&
    event.data && event.data.object && typeof event.data.object === 'object';
}

function createWebhookInbox({pool, applyEvent, logger=console}) {
  if (!pool || typeof applyEvent !== 'function') throw Error('Webhook inbox requires a database and processor');
  let draining = false;

  async function enqueue(event) {
    if (!validEvent(event)) throw Error('Verified Stripe webhook has invalid shape');
    // Stripe signature MUST be checked by the HTTP handler before calling enqueue.
    // No application state is changed here except the durable inbox record.
    const record = await pool.query(
      'INSERT INTO stripe_webhook_inbox(id,event_type,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id',
      [event.id,event.type,JSON.stringify(event)]
    );
    return {inserted:record.rowCount === 1};
  }

  async function processOne() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query(
        'SELECT id,payload FROM stripe_webhook_inbox WHERE processed_at IS NULL AND next_attempt_at<=now() ORDER BY received_at,id LIMIT 1 FOR UPDATE SKIP LOCKED'
      );
      if (!selected.rowCount) {
        await client.query('COMMIT');
        return 'empty';
      }
      const {id,payload} = selected.rows[0];
      // Savepoint allows rollback of ALL application changes while keeping the
      // inbox row lock, so another worker cannot process a partially failed event.
      await client.query('SAVEPOINT webhook_processing');
      try {
        await applyEvent(payload,client);
        await client.query(
          "UPDATE stripe_webhook_inbox SET processed_at=now(),last_error=NULL WHERE id=$1",
          [id]
        );
        await client.query('COMMIT');
        return 'processed';
      } catch(err) {
        await client.query('ROLLBACK TO SAVEPOINT webhook_processing');
        const safeCode = String(err?.code || err?.name || 'processing_error').slice(0,80);
        await client.query(
          "UPDATE stripe_webhook_inbox SET attempts=attempts+1, next_attempt_at=now() + LEAST(3600,15*(1 << LEAST(attempts,8))) * INTERVAL '1 second', last_error=$2 WHERE id=$1 AND processed_at IS NULL",
          [id,safeCode]
        );
        await client.query('COMMIT');
        logger.error('RouteDrop webhook inbox event deferred for retry',id,safeCode);
        return 'deferred';
      }
    } catch(err) {
      await client.query('ROLLBACK').catch(()=>{});
      throw err;
    } finally {
      client.release();
    }
  }

  async function drainAvailable({limit=10}={}) {
    if (draining) return {busy:true};
    draining=true;
    const result={processed:0,deferred:0};
    try {
      for(let n=0;n<Math.min(limit,25);n++) {
        const status=await processOne();
        if (status==='empty') break;
        result[status]++;
      }
      return result;
    } finally {
      draining=false;
    }
  }

  // Processed snapshots are retained briefly for audit/replay safety, but must
  // not be kept forever because webhook event payloads can include personal data.
  async function pruneProcessed() {
    await pool.query("DELETE FROM stripe_webhook_inbox WHERE processed_at < now()-INTERVAL '7 days'");
  }

  return {enqueue,drainAvailable,pruneProcessed};
}

module.exports={schema,validEvent,createWebhookInbox};
