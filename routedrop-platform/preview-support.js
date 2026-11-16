'use strict';
// Fictional-data-only support workflow. No real requests, payments, data rights
// fulfillment, breach response, attachments, or open-ended personal details.
const rateLimit=require('express-rate-limit');
const operatorAccess=require('./operator-access');
const KINDS=Object.freeze(['account_access','provider_eligibility','listing_issue','privacy_access','privacy_correction','privacy_deletion','security_concern','booking_question']);
const PRIORITIES=Object.freeze({security_concern:'P0',privacy_access:'P1',privacy_correction:'P1',privacy_deletion:'P1',account_access:'P1',provider_eligibility:'P1',listing_issue:'P2',booking_question:'P2'});
const STATES=Object.freeze(['new','reviewing','escalated','closed_test']);
const DISPOSITIONS=Object.freeze(['review_started','referred_privacy','referred_security','simulated_resolution']);
const schema=[
 "CREATE TABLE IF NOT EXISTS preview_support_tickets (id BIGSERIAL PRIMARY KEY, requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('account_access','provider_eligibility','listing_issue','privacy_access','privacy_correction','privacy_deletion','security_concern','booking_question')), priority TEXT NOT NULL CHECK(priority IN ('P0','P1','P2')), state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','reviewing','escalated','closed_test')), opened_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), handled_by BIGINT REFERENCES users(id))",
 "CREATE UNIQUE INDEX IF NOT EXISTS preview_support_one_active_kind ON preview_support_tickets(requester_id,kind) WHERE state IN ('new','reviewing','escalated')",
 "CREATE INDEX IF NOT EXISTS preview_support_queue ON preview_support_tickets(priority,opened_at) WHERE state <> 'closed_test'",
 "CREATE TABLE IF NOT EXISTS preview_support_audit (id BIGSERIAL PRIMARY KEY, ticket_id BIGINT NOT NULL REFERENCES preview_support_tickets(id) ON DELETE CASCADE, actor_id BIGINT NOT NULL REFERENCES users(id), action TEXT NOT NULL CHECK(action IN ('opened','reviewing','escalated','closed_test')), disposition TEXT CHECK(disposition IN ('review_started','referred_privacy','referred_security','simulated_resolution')), occurred_at TIMESTAMPTZ NOT NULL DEFAULT now())"
];
const validKind=kind=>typeof kind==='string'&&KINDS.includes(kind);
function validateTransition(kind,from,to,disposition){
 if(!STATES.includes(from)||!STATES.includes(to)||!DISPOSITIONS.includes(disposition))return false;
 if(to==='reviewing')return (from==='new'||from==='escalated')&&disposition==='review_started';
 if(to==='escalated')return (from==='new'||from==='reviewing')&&
    (disposition===(kind==='security_concern'?'referred_security':'referred_privacy'));
 return to==='closed_test'&&from==='reviewing'&&disposition==='simulated_resolution';
}
function install(app,{enabled,pool,requireDb,requireUser,safe,forbidden}){
 const gate=(req,res,next)=>enabled?next():forbidden(res,'Fictional support preview is not active.',503);
 const user=[gate,requireDb,requireUser()];
 const operator=[...user,(req,res,next)=>{
  Promise.resolve().then(async()=>{
   if(!await operatorAccess.allowed(pool,req.user.id,'support_reviewer'))return forbidden(res,'Synthetic support operator permission required.',403);
   next();
  }).catch(next);
 }];
 const limiter=rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/preview-support/mine',...user,safe(async(req,res)=>{
  const q=await pool.query('SELECT id,kind,priority,state,opened_at,updated_at FROM preview_support_tickets WHERE requester_id=$1 ORDER BY opened_at DESC LIMIT 100',[req.user.id]);
  res.json({tickets:q.rows,notice:'Fictional test requests only; not a real customer support, privacy-rights, or emergency-response channel.'});
 }));
 app.post('/api/preview-support/mine',...user,limiter,safe(async(req,res)=>{
  // Reject extra fields explicitly: no contact details, free-text descriptions or documents.
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!validKind(body.kind))
   return forbidden(res,'Select one fictional test issue category. Do not submit personal data, documents or descriptions.',400);
  const q=await pool.query(
   "WITH opened AS (INSERT INTO preview_support_tickets(requester_id,kind,priority) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id,kind,priority,state), logged AS ("+
   "INSERT INTO preview_support_audit(ticket_id,actor_id,action) SELECT id,$1,'opened' FROM opened RETURNING ticket_id)"+
   " SELECT opened.* FROM opened JOIN logged ON logged.ticket_id=opened.id",
   [req.user.id,body.kind,PRIORITIES[body.kind]]
  );
  if(!q.rowCount)return forbidden(res,'There is already an active fictional issue of this type.',409);
  res.status(201).json({ticket:q.rows[0],notice:'Recorded as a fictional test only. No actual investigation or rights request has been initiated.'});
 }));
 app.get('/api/preview-support/queue',...operator,safe(async(req,res)=>{
  const q=await pool.query(
   "SELECT t.id,t.kind,t.priority,t.state,t.requester_id,t.opened_at,t.updated_at FROM preview_support_tickets t"+
   " WHERE t.requester_id<>$1 ORDER BY CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,t.opened_at ASC LIMIT 100",
   [req.user.id]
  );
  res.json({tickets:q.rows,notice:'Fictional-only triage. No real cases or response SLA.'});
 }));
 app.post('/api/preview-support/:id/decision',...operator,safe(async(req,res)=>{
  const id=Number(req.params.id),body=req.body;
  if(!Number.isSafeInteger(id)||id<1||!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).sort().join(',')!=='disposition,state'||!STATES.includes(body.state)||
    !DISPOSITIONS.includes(body.disposition))return forbidden(res,'Invalid fictional support decision.',400);
  const q=await pool.query(
   "WITH changed AS (UPDATE preview_support_tickets t SET state=$3,updated_at=now(),handled_by=$2"+
   " WHERE t.id=$1 AND t.requester_id<>$2 AND ("+
   " ($3='reviewing' AND t.state IN ('new','escalated') AND $4='review_started') OR"+
   " ($3='escalated' AND t.state IN ('new','reviewing') AND $4=CASE WHEN t.kind='security_concern' THEN 'referred_security' ELSE 'referred_privacy' END) OR"+
   " ($3='closed_test' AND t.state='reviewing' AND $4='simulated_resolution'))"+
   " RETURNING t.id,t.state,t.kind),"+
   " logged AS (INSERT INTO preview_support_audit(ticket_id,actor_id,action,disposition) SELECT id,$2,state,$4 FROM changed RETURNING ticket_id)"+
   " SELECT changed.* FROM changed JOIN logged ON logged.ticket_id=changed.id",
   [id,req.user.id,body.state,body.disposition]
  );
  if(!q.rowCount)return forbidden(res,'Ticket not found, self-review prohibited or state transition invalid.',409);
  res.json({ticket:q.rows[0],notice:'Simulation only: closure or escalation does not fulfill any real legal or customer request.'});
 }));
}
module.exports={KINDS,PRIORITIES,STATES,DISPOSITIONS,schema,validKind,validateTransition,install};
