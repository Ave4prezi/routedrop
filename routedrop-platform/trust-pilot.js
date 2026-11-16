'use strict';

// Isolated, test-account reviews. Only a customer whose unpaid request reached
// confirmed may review that provider. This is NOT enabled for real customers.
const ddl=Object.freeze([
 "CREATE TABLE IF NOT EXISTS pilot_service_reviews (id BIGSERIAL PRIMARY KEY, request_id BIGINT NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, rating SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5), headline TEXT NOT NULL, comment TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','flagged','hidden')), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS pilot_reviews_provider_recent ON pilot_service_reviews(business_id,created_at DESC) WHERE status='visible'",
 "CREATE TABLE IF NOT EXISTS pilot_review_reports (id BIGSERIAL PRIMARY KEY, review_id BIGINT NOT NULL REFERENCES pilot_service_reviews(id) ON DELETE CASCADE, reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(review_id,reporter_id))"
]);
const validId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
const clean=(v,max)=>typeof v==='string'?v.trim().slice(0,max+1):'';
function validReview(body){
 const rating=Number(body?.rating),headline=clean(body?.headline,90),comment=clean(body?.comment,500);
 const contact=/(\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b)|((?:https?:\/\/|www\.)\S+)|((?:\+?\d[\d\s().-]{7,}\d))/i;
 if(!Number.isInteger(rating)||rating<1||rating>5||headline.length<4||headline.length>90||comment.length<20||comment.length>500||contact.test(headline+' '+comment))return null;
 return {rating,headline,comment};
}
const reportReasons=Object.freeze(['Personal information','Harassment','Spam or promotion','Other']);
function ratingFields(alias='b'){
 return ",(SELECT round(avg(rv.rating)::numeric,1) FROM pilot_service_reviews rv WHERE rv.business_id="+alias+".id AND rv.status='visible') AS rating_avg"+
 ",(SELECT count(*)::int FROM pilot_service_reviews rv WHERE rv.business_id="+alias+".id AND rv.status='visible') AS review_count";
}
function registerTrustRoutes(app,{pool,safe,requireDb,requireUser,forbidden,safetyPilot}){
 if(!pool)throw Error('Trusted reviews require the isolated pilot database');
 app.get('/api/pilot/reviews',requireDb,safe(async(req,res)=>{
  const businessId=Number(req.query.businessId);
  if(!validId(businessId))return forbidden(res,'Select a valid test provider.',400);
  const provider=await pool.query("SELECT id,name,provider_kind FROM businesses WHERE id=$1",[businessId]);
  if(!provider.rowCount)return forbidden(res,'Provider not found.',404);
  const [scores,items]=await Promise.all([
   pool.query("SELECT count(*)::int AS review_count,round(avg(rating)::numeric,1) AS rating_avg FROM pilot_service_reviews WHERE business_id=$1 AND status='visible'",[businessId]),
   pool.query("SELECT id,rating,headline,comment,created_at FROM pilot_service_reviews WHERE business_id=$1 AND status='visible' ORDER BY created_at DESC LIMIT 30",[businessId])
  ]);
  res.set('Cache-Control','no-store').json({provider:provider.rows[0],rating:scores.rows[0],reviews:items.rows,disclosure:'All reviews are fictional private-test data from confirmed, unpaid test requests. No identity or licensing verification.'});
 }));
 app.post('/api/pilot/reviews',requireDb,requireUser(),safe(async(req,res)=>{
  const requestId=Number(req.body?.requestId),review=validReview(req.body);
  if(!validId(requestId)||!review)return forbidden(res,'Rate 1–5 stars and enter a fictional headline and review without contact information.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const risk=await safetyPilot.reviewRisk(client,req.user.id,review.comment);
   if(risk.deny){await client.query('ROLLBACK');return forbidden(res,risk.deny,429);}
   const q=await client.query("INSERT INTO pilot_service_reviews (request_id,business_id,customer_id,rating,headline,comment,status) SELECT r.id,b.id,$1,$3,$4,$5,$6 FROM service_requests r JOIN listings l ON l.id=r.listing_id JOIN businesses b ON b.id=l.business_id WHERE r.id=$2 AND r.customer_id=$1 AND r.status='confirmed' AND b.owner_id<>$1 ON CONFLICT(request_id) DO NOTHING RETURNING id,rating,status",[req.user.id,requestId,review.rating,review.headline,review.comment,risk.status]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'Only the customer of a confirmed test request may leave one review for that job.',409);}
   if(risk.rule)await client.query("INSERT INTO pilot_risk_events(actor_id,target_kind,target_id,rule) VALUES($1,'review',$2,$3)",[req.user.id,q.rows[0].id,risk.rule]);
   await client.query('COMMIT');
   res.status(201).json({review:q.rows[0],message:risk.rule?'Test review held for manual fraud review. No public score was changed.':'Private test review saved. No real business rating has been published.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }));
 app.post('/api/pilot/reviews/:id/report',requireDb,requireUser(),safe(async(req,res)=>{
  const id=Number(req.params.id),reason=req.body?.reason;
  if(!validId(id)||!reportReasons.includes(reason))return forbidden(res,'Select a review and a valid report reason.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const denied=await safetyPilot.reportRisk(client,req.user.id);
   if(denied){await client.query('ROLLBACK');return forbidden(res,denied,429);}
   const q=await client.query("INSERT INTO pilot_review_reports(review_id,reporter_id,reason) SELECT id,$2,$3 FROM pilot_service_reviews WHERE id=$1 AND status='visible' ON CONFLICT(review_id,reporter_id) DO NOTHING RETURNING id",[id,req.user.id,reason]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'Review unavailable or already reported.',409);}
   await client.query('COMMIT');
   res.status(201).json({message:'Test report recorded for moderation review. No automatic removal or live support escalation was initiated.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }));
}
module.exports={ddl,validReview,validId,ratingFields,reportReasons,registerTrustRoutes};
