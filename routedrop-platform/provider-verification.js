'use strict';
// Staging-only draft: policy checks are not a legal determination. No raw identity or
// insurance documents are stored by this module. Reviewer approval is mandatory.
const evidence=require('./provider-evidence');
const groups={
 'Home & property':['Cleaning','Lawn care','Landscaping','Painting','Handyman','Pressure washing','Home repairs'],
 'Automotive':['Car detailing','Mobile car detailing','Car washing','Mobile mechanic','Tire service'],
 'Beauty & wellness':['Barber','Hair stylist','Nail technician','Makeup artist','Personal trainer','Massage therapist'],
 'Events & creative':['Photography','Videography','DJ','Event decorating','Event planning','Catering'],
 'Moving & transportation':['Moving','Junk removal','Delivery','Courier','Passenger transportation'],
 'Professional & technology':['IT support','Computer repair','Tutoring','Bookkeeping','Graphic design','Digital marketing'],
 'Pets & care':['Pet grooming','Pet sitting','Dog walking','Childcare','Home health care'],
 'Other':['Washing','Other']
};
const TYPES=['identity','business_info','driver_license','auto_insurance','liability_insurance','professional_license'];
const DRIVING=new Set(['Mobile car detailing','Mobile mechanic','Tire service','Moving','Junk removal','Delivery','Courier','Passenger transportation']);
const LIABILITY=new Set(['Cleaning','Lawn care','Landscaping','Painting','Handyman','Pressure washing','Home repairs','Car detailing','Mobile car detailing','Mobile mechanic','Tire service','Moving','Junk removal','Delivery','Courier','Passenger transportation','Catering','Childcare','Home health care']);
const LICENSE=new Set(['Mobile mechanic','Massage therapist','Catering','Childcare','Home health care','Passenger transportation','Barber','Hair stylist','Nail technician','Handyman','Home repairs']);
const MANUAL=new Set(['Mobile mechanic','Massage therapist','Catering','Childcare','Home health care','Passenger transportation','Other']);
function policy(category){
 const known=Object.values(groups).some(categories=>categories.includes(category));
 const requirements=['identity','business_info'];
 if(DRIVING.has(category))requirements.push('driver_license','auto_insurance');
 if(LIABILITY.has(category))requirements.push('liability_insurance');
 if(LICENSE.has(category))requirements.push('professional_license');
 return {category,known,requirements,manualReview:!known||MANUAL.has(category)};
}
function assess(category,records,manualApproved=false,at=Date.now()){
 const p=policy(category);
 const missing=p.requirements.filter(kind=>!records.some(r=>r.kind===kind&&r.status==='approved'&&
   (!r.expires_at||Date.parse(r.expires_at)>at)));
 if(p.manualReview&&!manualApproved)missing.push('category_policy_review');
 return {eligible:!missing.length,requirements:p.requirements,missing,manualReview:p.manualReview};
}
const schema=[
 "CREATE TABLE IF NOT EXISTS provider_verifications (business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('identity','business_info','driver_license','auto_insurance','liability_insurance','professional_license')), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), evidence_reference TEXT, review_note TEXT, expires_at TIMESTAMPTZ, reviewed_by BIGINT REFERENCES users(id), reviewed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(business_id,kind))",
 "CREATE TABLE IF NOT EXISTS provider_category_reviews (business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, category TEXT NOT NULL, approved BOOLEAN NOT NULL DEFAULT false, review_note TEXT, reviewed_by BIGINT REFERENCES users(id), reviewed_at TIMESTAMPTZ, PRIMARY KEY(business_id,category))",
 "CREATE INDEX IF NOT EXISTS provider_verifications_expiry ON provider_verifications(status,expires_at)",
 ...evidence.schema
];
async function statusForBusiness(db,businessId,category){
 const [records,manual]=await Promise.all([
  db.query('SELECT v.kind,v.status,v.expires_at,v.reviewed_at,EXISTS(SELECT 1 FROM provider_verification_documents d WHERE d.business_id=v.business_id AND d.kind=v.kind) AS has_document FROM provider_verifications v WHERE v.business_id=$1',[businessId]),
  db.query('SELECT approved FROM provider_category_reviews WHERE business_id=$1 AND category=$2',[businessId,category])
 ]);
 return {...assess(category,records.rows,manual.rows[0]?.approved===true),documents:records.rows};
}
async function eligibleListing(db,id){
 const found=await db.query('SELECT business_id,category FROM listings WHERE id=$1',[id]);
 if(!found.rowCount)return false;
 return (await statusForBusiness(db,found.rows[0].business_id,found.rows[0].category)).eligible;
}
function validExpiry(kind,value){
 if(['identity','business_info'].includes(kind))return value==null||value==='';
 const t=Date.parse(value);
 return Number.isFinite(t)&&t>Date.now()&&t<Date.now()+366*86400000;
}
function install(app,{pool,enabled,requireDb,requireUser,safe,forbidden}){
 const gate=(req,res,next)=>enabled?next():forbidden(res,'Provider verification is not enabled.',503);
 const business=[gate,requireDb,requireUser('business')];
 const reviewer=[gate,requireDb,requireUser(),(req,res,next)=>{
  Promise.resolve().then(async()=>{
   const isReviewer=await pool.query('SELECT 1 FROM deferred_support_agents WHERE user_id=$1',[req.user.id]);
   if(!isReviewer.rowCount)return forbidden(res,'Reviewer permission required.',403);
   next();
  }).catch(next);
 }];
 app.get('/api/provider-verification/categories',gate,(req,res)=>res.json({groups,note:'Draft marketplace policy; regulated activities require separate legal review.'}));
 app.get('/api/provider-verification/me',...business,safe(async(req,res)=>{
  const q=await pool.query('SELECT id,category FROM businesses WHERE owner_id=$1',[req.user.id]);
  if(!q.rowCount)return forbidden(res,'Business not found.',404);
  res.json({businessId:q.rows[0].id,category:q.rows[0].category,verification:await statusForBusiness(pool,q.rows[0].id,q.rows[0].category)});
 }));
 app.post('/api/provider-verification/submit',...business,safe(async(req,res)=>{
  const kind=String(req.body.kind||'');
  const reference=String(req.body.reference||'').trim();
  if(kind!=='business_info'||reference.length<4||reference.length>120||/[\r\n]/.test(reference))
   return forbidden(res,'Only non-sensitive business information references are accepted here. Upload credential documents securely.',400);
  // A provider may request review but cannot set approved or reviewer fields.
  const q=await pool.query(
   "INSERT INTO provider_verifications(business_id,kind,status,evidence_reference,updated_at) SELECT id,$2,'pending',$3,now() FROM businesses WHERE owner_id=$1 ON CONFLICT(business_id,kind) DO UPDATE SET status='pending',evidence_reference=EXCLUDED.evidence_reference,reviewed_by=NULL,reviewed_at=NULL,review_note=NULL,expires_at=NULL,updated_at=now() RETURNING kind,status",
   [req.user.id,kind,reference]);
  if(!q.rowCount)return forbidden(res,'Business not found.',404);
  res.status(202).json({submission:q.rows[0],note:'Submitted for independent review; no verification has been granted.'});
 }));
 app.get('/api/provider-verification/review-queue',...reviewer,safe(async(req,res)=>{
  const q=await pool.query("SELECT v.business_id,b.name,v.kind,v.status,v.evidence_reference,v.updated_at,EXISTS(SELECT 1 FROM provider_verification_documents d WHERE d.business_id=v.business_id AND d.kind=v.kind) AS has_document FROM provider_verifications v JOIN businesses b ON b.id=v.business_id WHERE v.status='pending' AND b.owner_id<>$1 ORDER BY v.updated_at LIMIT 100",[req.user.id]);
  res.json({queue:q.rows});
 }));
 app.post('/api/provider-verification/review',...reviewer,safe(async(req,res)=>{
  const id=Number(req.body.businessId),kind=String(req.body.kind||''),decision=req.body.decision,note=String(req.body.note||'').trim(),expiresAt=req.body.expiresAt;
  if(!Number.isSafeInteger(id)||id<1||!TYPES.includes(kind)||!['approved','rejected'].includes(decision)||note.length<12||note.length>500)
   return forbidden(res,'Invalid review details.',400);
  if(decision==='approved'&&!validExpiry(kind,expiresAt))return forbidden(res,'A future expiry date (within one year) is required for insurance, driving and professional credentials.',400);
  const q=await pool.query(
   "WITH reviewed AS (UPDATE provider_verifications v SET status=$3,review_note=$4,expires_at=$5,reviewed_by=$6,reviewed_at=now(),updated_at=now() FROM businesses b WHERE v.business_id=b.id AND v.business_id=$1 AND v.kind=$2 AND v.status='pending' AND b.owner_id<>$6 AND ($3='rejected' OR ((v.kind='business_info' AND v.evidence_reference IS NOT NULL) OR EXISTS(SELECT 1 FROM provider_verification_documents d WHERE d.business_id=v.business_id AND d.kind=v.kind))) RETURNING v.business_id,v.kind,v.status), logged AS (INSERT INTO provider_verification_audit(business_id,kind,actor_user_id,action) SELECT business_id,kind,$6,CASE WHEN status='approved' THEN 'review_approved' ELSE 'review_rejected' END FROM reviewed RETURNING id) SELECT reviewed.* FROM reviewed JOIN logged ON true",
   [id,kind,decision,note,decision==='approved'&&expiresAt?new Date(expiresAt).toISOString():null,req.user.id]);
  if(!q.rowCount)return forbidden(res,'Submission not pending, evidence missing, or self-review is prohibited.',403);
  res.json({review:q.rows[0]});
 }));
 app.post('/api/provider-verification/category-decision',...reviewer,safe(async(req,res)=>{
  const id=Number(req.body.businessId),category=String(req.body.category||''),note=String(req.body.note||'').trim();
  if(!Number.isSafeInteger(id)||id<1||!policy(category).manualReview||req.body.approved!==true||note.length<12||note.length>500)
   return forbidden(res,'Invalid category review.',400);
  const q=await pool.query("INSERT INTO provider_category_reviews(business_id,category,approved,review_note,reviewed_by,reviewed_at) SELECT b.id,$2,true,$3,$4,now() FROM businesses b WHERE b.id=$1 AND b.owner_id<>$4 ON CONFLICT (business_id,category) DO UPDATE SET approved=true,review_note=EXCLUDED.review_note,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now() RETURNING business_id,category,approved",
   [id,category,note,req.user.id]);
  if(!q.rowCount)return forbidden(res,'Reviewer cannot approve their own business.',403);
  res.json({review:q.rows[0]});
 }));
 evidence.install(app,{pool,business,reviewer,safe,forbidden});
 app.post('/api/provider-verification/revoke',...reviewer,safe(async(req,res)=>{
  const id=Number(req.body.businessId),kind=String(req.body.kind||''),note=String(req.body.note||'').trim();
  if(!Number.isSafeInteger(id)||id<1||!TYPES.includes(kind)||note.length<12||note.length>500)
   return forbidden(res,'Invalid revocation details.',400);
  const q=await pool.query("WITH revoked AS (UPDATE provider_verifications v SET status='rejected',review_note=$3,expires_at=NULL,reviewed_by=$4,reviewed_at=now(),updated_at=now() FROM businesses b WHERE v.business_id=b.id AND v.business_id=$1 AND v.kind=$2 AND b.owner_id<>$4 RETURNING v.business_id,v.kind,v.status), logged AS (INSERT INTO provider_verification_audit(business_id,kind,actor_user_id,action) SELECT business_id,kind,$4,'revoked' FROM revoked RETURNING id) SELECT revoked.* FROM revoked JOIN logged ON true",[id,kind,note,req.user.id]);
  if(!q.rowCount)return forbidden(res,'Credential not found or self-review is prohibited.',403);
  res.json({review:q.rows[0]});
 }));
}
module.exports={groups,policy,assess,schema,statusForBusiness,eligibleListing,install};
