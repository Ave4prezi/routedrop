'use strict';

// Isolated, unpaid reservation requests. Deliberately separate from legacy paid bookings.
const ddl = Object.freeze([
 `CREATE TABLE IF NOT EXISTS service_requests (
  id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES listings(id),
  customer_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','accepted','completed','confirmed','declined','canceled','issue_reported')),
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 500 AND 500000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`,
 "CREATE UNIQUE INDEX IF NOT EXISTS one_open_pilot_request_per_slot ON service_requests(listing_id) WHERE status IN ('requested','accepted','completed','confirmed','issue_reported')",
 "CREATE INDEX IF NOT EXISTS service_requests_customer_time ON service_requests(customer_id,created_at DESC)",
 "CREATE INDEX IF NOT EXISTS service_requests_listing_time ON service_requests(listing_id,created_at DESC)"
]);

const transition = Object.freeze({
 customer:Object.freeze({
  requested:Object.freeze({cancel:'canceled'}),
  accepted:Object.freeze({cancel:'canceled'}),
  completed:Object.freeze({confirm:'confirmed',report:'issue_reported'})
 }),
 business:Object.freeze({
  requested:Object.freeze({accept:'accepted',decline:'declined'}),
  accepted:Object.freeze({complete:'completed'})
 })
});
function nextState(role,current,action){
 return Object.hasOwn(transition,role)&&Object.hasOwn(transition[role],current)
  &&Object.hasOwn(transition[role][current],action)?transition[role][current][action]:null;
}
const statuses=Object.freeze(['requested','accepted','completed','confirmed','declined','canceled','issue_reported']);
const isId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;

function registerPilotRoutes(app,{pool,safe,requireDb,requireUser,forbidden,supportAlerts,emailReady}){
 if(!pool)throw Error('Pilot routes require a distinct PostgreSQL database');
 app.get('/api/pilot/requests',requireDb,requireUser(),safe(async(req,res)=>{
  const where=req.user.role==='customer'?'r.customer_id=$1':'b.owner_id=$1';
  const result=await pool.query(
   `SELECT r.id,r.listing_id,r.status,r.price_cents,r.created_at,r.updated_at,
    (SELECT status FROM support_alert_outbox WHERE event_key='pilot-'||r.id::text) AS support_alert_status,
    l.title,l.slot_start,l.duration_minutes,l.neighborhood,l.category,
    b.name AS business_name,b.city,
    CASE WHEN r.status IN ('accepted','completed','confirmed','issue_reported')
      THEN cu.full_name ELSE NULL END AS customer_name
    FROM service_requests r
    JOIN listings l ON l.id=r.listing_id
    JOIN businesses b ON b.id=l.business_id
    JOIN users cu ON cu.id=r.customer_id
    WHERE ${where} ORDER BY r.created_at DESC LIMIT 100`,
   [req.user.id]
  );
  res.set('Cache-Control','no-store').json({requests:result.rows.map(r=>({...r,support_alert_status:r.support_alert_status==='sent'?'sent':!emailReady&&r.support_alert_status?'unconfigured':r.support_alert_status}))});
 }));

 app.post('/api/pilot/requests',requireDb,requireUser('customer'),safe(async(req,res)=>{
  const id=Number(req.body?.listingId);
  if(!isId(id))return forbidden(res,'Select a valid available service.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // Lock listing so simultaneous customers cannot both reserve a single published opening.
   const q=await client.query(`
    SELECT l.id,l.price_cents FROM listings l
    WHERE l.id=$1 AND l.status='active' AND l.slot_start>now()+interval '10 minutes'
    AND NOT EXISTS (
     SELECT 1 FROM bookings b
     WHERE b.listing_id=l.id AND b.status IN ('awaiting_payment','paid','completed')
     AND (b.status!='awaiting_payment' OR b.hold_expires_at>now())
    ) FOR UPDATE OF l`,[id]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'This service opening is no longer available.',409);}
   const r=await client.query(
    "INSERT INTO service_requests(listing_id,customer_id,price_cents) VALUES ($1,$2,$3) RETURNING id,status",
    [id,req.user.id,q.rows[0].price_cents]
   );
   await client.query('COMMIT');
   return res.status(201).json({ok:true,request:r.rows[0],message:'Request created. The provider must accept it. No payment was collected.'});
  }catch(e){
   await client.query('ROLLBACK').catch(()=>{});
   if(e.code==='23505')return forbidden(res,'This opening has already been requested.',409);
   throw e;
  }finally{client.release();}
 }));

 app.post('/api/pilot/requests/:id/action',requireDb,requireUser(),safe(async(req,res)=>{
  const id=Number(req.params.id),action=req.body?.action;
  if(!isId(id)||typeof action!=='string')return forbidden(res,'Invalid request or action.',400);
  const states=transition[req.user.role];
  if(!states)return forbidden(res,'This role cannot manage requests.',403);
  // Select the allowed FROM status from our fixed transition graph, never user-supplied SQL.
  const entry=Object.entries(states).find(([,actions])=>Object.hasOwn(actions,action));
  if(!entry)return forbidden(res,'This action is not allowed for your account.',403);
  const [from,allowed]=entry,to=allowed[action];
  const provider=req.user.role==='business';
  const query=provider?
   `UPDATE service_requests r SET status=$1,updated_at=now()
    FROM listings l JOIN businesses b ON b.id=l.business_id
    WHERE r.id=$2 AND r.status=$3 AND r.listing_id=l.id AND b.owner_id=$4
    ${action==='accept'?"AND l.slot_start>now()":''}
    RETURNING r.id,r.status`:
   `UPDATE service_requests r SET status=$1,updated_at=now()
    WHERE r.id=$2 AND r.status=$3 AND r.customer_id=$4
    RETURNING r.id,r.status`;
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const result=await client.query(query,[to,id,from,req.user.id]);
   if(!result.rowCount){await client.query('ROLLBACK');return forbidden(res,'Request unavailable, unchanged, or outside your permissions.',409);}
   if(to==='issue_reported')await supportAlerts.queue(client,'pilot',id);
   await client.query('COMMIT');
   if(to==='issue_reported')supportAlerts.process().catch(()=>{});
   res.json({ok:true,request:result.rows[0],message:to==='issue_reported'?'Issue recorded. '+(emailReady?'A support email is queued.':'Email delivery is not configured yet; please use Contact support / disputes.'):'Service request updated. No payment was collected.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }));

 app.patch('/api/pilot/listings/:id/status',requireDb,requireUser('business'),safe(async(req,res)=>{
  const id=Number(req.params.id),status=req.body?.status;
  if(!isId(id)||!['active','paused'].includes(status))return forbidden(res,'Select active or paused status for a valid listing.',400);
  const r=await pool.query(
   `UPDATE listings l SET status=$1 FROM businesses b
    WHERE l.id=$2 AND l.business_id=b.id AND b.owner_id=$3 RETURNING l.id,l.status`,
   [status,id,req.user.id]);
  if(!r.rowCount)return forbidden(res,'Listing not found in your business.',404);
  res.json({ok:true,listing:r.rows[0]});
 }));
}
module.exports={ddl,nextState,statuses,registerPilotRoutes};
