'use strict';
const crypto=require('node:crypto');
const {providerReady,deliverEmail}=require('./mail');
const recipient='routedropsupport@gmail.com';
const ddl=[`CREATE TABLE IF NOT EXISTS support_alert_outbox (
 id BIGSERIAL PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_until TIMESTAMPTZ,first_attempt_at TIMESTAMPTZ,sent_at TIMESTAMPTZ,last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 'CREATE INDEX IF NOT EXISTS support_alert_due ON support_alert_outbox(status,available_at)'];
function createSupportAlerts({pool,env=process.env,send=deliverEmail,log=console}){
 let busy=false;
 async function queue(db,kind,id){
  if(!['pilot','dispute','payment_dispute','setup'].includes(kind))throw Error('Unsupported support alert');
  if(kind!=='setup'&&!/^[1-9][0-9]*$/.test(String(id)))throw Error('Invalid support reference');
  const label=kind==='pilot'?'Private pilot issue':kind==='dispute'?'Staging booking dispute':kind==='payment_dispute'?'Staging payment dispute':'Support alert setup test';
  const subject=`RouteDrop: ${label}${kind==='setup'?'':' #'+id}`;
  // Keep complaint contents, contact details and payment information behind sign-in.
  let origin='';try{const u=new URL(env.PUBLIC_URL);if(u.protocol==='https:')origin=u.origin;}catch{}
  const body=`${label}${kind==='setup'?'':' for '+(kind==='pilot'?'request':'booking')+' #'+id}.\n\n${kind==='setup'?'This is a setup test for automatic support alerts.':'Review this report in RouteDrop. This alert does not resolve the issue, approve a refund or authorize a payment.'}\n\n${origin?'Sign in: '+origin+'/':'Sign in to your RouteDrop dashboard.'}\n\nSupport: ${recipient}`;
  await db.query('INSERT INTO support_alert_outbox(event_key,subject,body) VALUES($1,$2,$3) ON CONFLICT(event_key) DO NOTHING',[kind+'-'+id,subject,body]);
 }
 async function process(){
  if(busy||!providerReady(env))return;
  busy=true;
  try{
   // Stop uncertain sends after the provider\'s 24-hour idempotency window.
   await pool.query("UPDATE support_alert_outbox SET status='failed',last_error='Retry window expired; manual review required' WHERE status IN ('pending','sending') AND (lease_until IS NULL OR lease_until<now()) AND (attempts>=8 OR first_attempt_at<now()-interval '23 hours')");
   const q=await pool.query(`UPDATE support_alert_outbox SET status='sending',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,now()),lease_until=now()+interval '5 minutes'
    WHERE id IN (SELECT id FROM support_alert_outbox WHERE ((status='pending' AND available_at<=now()) OR (status='sending' AND lease_until<now())) AND attempts<8 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 5)
    RETURNING id,event_key,subject,body,attempts`);
   for(const m of q.rows){
    try{
     const key=crypto.createHash('sha256').update((env.PUBLIC_URL||'')+':'+m.event_key).digest('hex');
     await send({to:recipient,subject:m.subject,text:m.body,idempotencyKey:'rd-support-'+key},env);
     await pool.query("UPDATE support_alert_outbox SET status='sent',sent_at=now(),lease_until=NULL,last_error=NULL WHERE id=$1",[m.id]);
     log.info('RouteDrop support alert accepted by email provider',m.id);
    }catch(e){
     await pool.query("UPDATE support_alert_outbox SET status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,lease_until=NULL,available_at=now()+((LEAST(3600,attempts*attempts*60))::text||' seconds')::interval,last_error=$2 WHERE id=$1",[m.id,'Email delivery failed; check sender configuration or provider availability']);
     log.error('RouteDrop support alert delivery failed',m.id);
    }
   }
  }finally{busy=false;}
 }
 return {queue,process};
}
module.exports={ddl,recipient,createSupportAlerts};
