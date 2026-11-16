'use strict';
// Synthetic-only in-app alerts, not live email/SMS or legal compliance notices.
const MS_DAY=86400000;
const schema=[
 "CREATE TABLE IF NOT EXISTS provider_credential_reminder_events (business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, kind TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, window_days INTEGER NOT NULL CHECK(window_days IN (0,1,7,14,30)), observed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(business_id,kind,expires_at,window_days))",
 "CREATE INDEX IF NOT EXISTS provider_credential_reminders_due ON provider_credential_reminder_events(business_id,observed_at DESC)"
];
function windowFor(expiresAt,now=Date.now()){
 const days=(new Date(expiresAt).getTime()-new Date(now).getTime())/MS_DAY;
 if(!Number.isFinite(days)||days>30||days < -30)return null;
 return days<=0?0:days<=1?1:days<=7?7:days<=14?14:30;
}
function describe(record,now=Date.now()){
 const ms=new Date(record.expires_at).getTime()-new Date(now).getTime();
 const daysRemaining=Math.ceil(ms/MS_DAY);
 const windowDays=windowFor(record.expires_at,now);
 return {kind:record.kind,expiresAt:record.expires_at,daysRemaining,
  severity:daysRemaining<=0?'expired':daysRemaining<=7?'urgent':'upcoming',windowDays};
}
async function forBusiness(db,businessId,now=new Date()){
 const r=await db.query(
  "SELECT kind,expires_at FROM provider_verifications WHERE business_id=$1 AND status='approved'"+
  " AND expires_at IS NOT NULL AND expires_at <= $2::timestamptz + interval '30 days'"+
  " AND expires_at >= $2::timestamptz - interval '30 days' ORDER BY expires_at ASC",
  [businessId,now]
 );
 return r.rows.map(row=>describe(row,now));
}
async function reviewQueue(db,reviewerId,now=new Date()){
 const r=await db.query(
  "SELECT v.business_id,b.name AS business_name,v.kind,v.expires_at FROM provider_verifications v"+
  " JOIN businesses b ON b.id=v.business_id WHERE v.status='approved' AND v.expires_at IS NOT NULL"+
  " AND v.expires_at <= $1::timestamptz + interval '30 days'"+
  " AND v.expires_at >= $1::timestamptz - interval '30 days' AND b.owner_id<>$2"+
  " ORDER BY v.expires_at ASC LIMIT 100",
  [now,reviewerId]
 );
 return r.rows.map(row=>({businessId:row.business_id,businessName:row.business_name,...describe(row,now)}));
}
async function collect(db,now=new Date()){
 // Database uniqueness makes repeated runs idempotent. Alerts are in-app only.
 // When free hosting sleeps, dashboard queries still show live expiring credentials.
 const result=await db.query(
  "INSERT INTO provider_credential_reminder_events(business_id,kind,expires_at,window_days)"+
  " SELECT v.business_id,v.kind,v.expires_at,CASE"+
  " WHEN v.expires_at <= $1::timestamptz THEN 0"+
  " WHEN v.expires_at <= $1::timestamptz + interval '1 day' THEN 1"+
  " WHEN v.expires_at <= $1::timestamptz + interval '7 days' THEN 7"+
  " WHEN v.expires_at <= $1::timestamptz + interval '14 days' THEN 14 ELSE 30 END"+
  " FROM provider_verifications v WHERE v.status='approved' AND v.expires_at IS NOT NULL"+
  " AND v.expires_at <= $1::timestamptz + interval '30 days'"+
  " AND v.expires_at >= $1::timestamptz - interval '30 days'"+
  " ON CONFLICT DO NOTHING RETURNING business_id,kind,expires_at,window_days",
  [now]
 );
 return {newEvents:result.rowCount||0};
}
module.exports={schema,windowFor,describe,forBusiness,reviewQueue,collect};
