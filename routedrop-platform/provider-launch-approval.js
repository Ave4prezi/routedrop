'use strict';
// Private, fictional-data preview only. A launch decision does not authorize real
// onboarding, public listings, payment collection, or legal/regulatory claims.
// A different explicitly designated role makes the release decision.
const schema=[
 "CREATE TABLE IF NOT EXISTS provider_launch_approvers (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, granted_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE TABLE IF NOT EXISTS provider_launch_decisions (business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, category TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('approved','revoked')), note TEXT NOT NULL, decided_by BIGINT NOT NULL REFERENCES users(id), decided_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(business_id,category))",
 "CREATE TABLE IF NOT EXISTS provider_launch_audit (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, category TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('approved','revoked')), actor_user_id BIGINT NOT NULL REFERENCES users(id), note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS provider_launch_audit_recent ON provider_launch_audit(business_id,created_at DESC)"
];

async function status(db,businessId,category){
 const q=await db.query(
  "SELECT d.state,d.decided_at,d.decided_by,"+
  " NOT EXISTS(SELECT 1 FROM provider_verifications v WHERE v.business_id=d.business_id AND v.updated_at>d.decided_at)"+
  " AND NOT EXISTS(SELECT 1 FROM provider_category_reviews c WHERE c.business_id=d.business_id AND c.category=d.category AND c.reviewed_at>d.decided_at) AS credentials_unchanged"+
  " FROM provider_launch_decisions d WHERE d.business_id=$1 AND d.category=$2",
  [businessId,category]
 );
 const d=q.rows[0];
 const active=Boolean(d?.state==='approved' && d.credentials_unchanged===true);
 return {active,state:d?.state||'pending',reason:!d?'not_approved':d.state==='revoked'?'revoked':active?'approved':'credentials_changed'};
}

function install(app,{enabled,pool,requireDb,requireUser,safe,forbidden,credentialsStatus}){
 const gate=(req,res,next)=>enabled?next():forbidden(res,'Synthetic launch review unavailable.',503);
 const approver=[gate,requireDb,requireUser(),(req,res,next)=>{
  Promise.resolve().then(async()=>{
   const role=await pool.query('SELECT 1 FROM provider_launch_approvers WHERE user_id=$1',[req.user.id]);
   if(!role.rowCount)return forbidden(res,'Launch approver permission required.',403);
   next();
  }).catch(next);
 }];
 app.get('/api/provider-launch/queue',...approver,safe(async(req,res)=>{
  const r=await pool.query(
   "SELECT DISTINCT b.id AS business_id,b.name,l.category FROM businesses b JOIN listings l ON l.business_id=b.id WHERE b.owner_id<>$1 ORDER BY b.id LIMIT 100",
   [req.user.id]
  );
  const businesses=[];
  for(const row of r.rows){
   const credentials=await credentialsStatus(pool,row.business_id,row.category);
   const approval=await status(pool,row.business_id,row.category);
   businesses.push({businessId:row.business_id,businessName:row.name,category:row.category,credentialsEligible:credentials.eligible,launch:approval});
  }
  res.json({businesses,note:'Fictional test decisions only. No real service bookings or payments enabled.'});
 }));
 app.post('/api/provider-launch/decision',...approver,safe(async(req,res)=>{
  const businessId=Number(req.body.businessId),category=req.body.category,decision=req.body.decision,note=req.body.note;
  if(!Number.isSafeInteger(businessId)||businessId<1||typeof category!=='string'||!category.length||category.length>50||
    !['approved','revoked'].includes(decision)||typeof note!=='string'||note.trim().length<15||note.trim().length>500||/[\r\n]/.test(note))
   return forbidden(res,'Provide a valid category, decision and explanation (15–500 characters).',400);
  if(decision==='approved'){
   const credential=await credentialsStatus(pool,businessId,category);
   if(!credential.eligible)return forbidden(res,'Credential review is incomplete or expired. Cannot approve launch.',409);
  }
  // A restricted reviewer cannot approve their own business, and the category
  // must have a real draft listing. SQL and audit are one atomic statement.
  const r=await pool.query(
   "WITH eligible AS (SELECT b.id FROM businesses b WHERE b.id=$1 AND b.owner_id<>$4 AND EXISTS(SELECT 1 FROM listings l WHERE l.business_id=b.id AND l.category=$2)),"+
   " changed AS (INSERT INTO provider_launch_decisions(business_id,category,state,note,decided_by,decided_at) SELECT id,$2,$3,$5,$4,clock_timestamp() FROM eligible"+
   " ON CONFLICT(business_id,category) DO UPDATE SET state=EXCLUDED.state,note=EXCLUDED.note,decided_by=EXCLUDED.decided_by,decided_at=clock_timestamp()"+
   " RETURNING business_id,category,state),"+
   " logged AS (INSERT INTO provider_launch_audit(business_id,category,action,actor_user_id,note) SELECT business_id,category,state,$4,$5 FROM changed RETURNING id)"+
   " SELECT changed.* FROM changed JOIN logged ON true",
   [businessId,category,decision,req.user.id,note.trim()]
  );
  if(!r.rowCount)return forbidden(res,'Business not found, no draft listing, or self-approval prohibited.',403);
  res.json({decision:r.rows[0],launch:await status(pool,businessId,category)});
 }));
}
module.exports={schema,status,install};
