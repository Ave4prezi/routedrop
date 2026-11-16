'use strict';

// Pilot-only safeguarding. This does not establish government ID, background,
// license, insurance, employment or business identity verification.
const ddl=Object.freeze([
 "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pilot_screening_status TEXT NOT NULL DEFAULT 'not_started' CHECK(pilot_screening_status IN ('not_started','pending','test_reviewed','needs_changes','suspended'))",
 "CREATE TABLE IF NOT EXISTS pilot_screening_cases (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, service_category TEXT NOT NULL, service_description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','test_reviewed','needs_changes','suspended')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ)",
 "CREATE UNIQUE INDEX IF NOT EXISTS pilot_one_pending_screening ON pilot_screening_cases(business_id) WHERE status='pending'",
 "ALTER TABLE pilot_review_reports ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT 'open' CHECK(resolution IN ('open','resolved','dismissed'))",
 "ALTER TABLE pilot_review_reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ",
 "CREATE TABLE IF NOT EXISTS pilot_safety_audit (id BIGSERIAL PRIMARY KEY, actor_id BIGINT NOT NULL REFERENCES users(id), subject_kind TEXT NOT NULL CHECK(subject_kind IN ('review','provider','appeal')), subject_id BIGINT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS pilot_audit_subject ON pilot_safety_audit(subject_kind,subject_id,created_at DESC)",
 "CREATE TABLE IF NOT EXISTS pilot_safety_appeals (id BIGSERIAL PRIMARY KEY, actor_id BIGINT NOT NULL REFERENCES users(id), subject_kind TEXT NOT NULL CHECK(subject_kind IN ('review','provider')), subject_id BIGINT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','upheld','overturned')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ)",
 "CREATE UNIQUE INDEX IF NOT EXISTS pilot_one_open_appeal ON pilot_safety_appeals(actor_id,subject_kind,subject_id) WHERE status='open'",
 "CREATE INDEX IF NOT EXISTS pilot_appeal_open ON pilot_safety_appeals(status,created_at DESC)",
 "CREATE TABLE IF NOT EXISTS pilot_risk_events (id BIGSERIAL PRIMARY KEY, actor_id BIGINT NOT NULL REFERENCES users(id), target_kind TEXT NOT NULL CHECK(target_kind IN ('review','report')), target_id BIGINT, rule TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS pilot_risk_recent ON pilot_risk_events(actor_id,created_at DESC)"
]);
const isId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const normalized=v=>typeof v==='string'?v.trim():'';
const noSensitive=v=>!/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|https?:\/\/|www\.|(?:\+?\d[\d().\s-]{7,}\d)|\b\d{3}-\d{2}-\d{4}\b/i.test(v);
const screeningCategories=Object.freeze(['Lawn care','Cleaning','Car detailing','Washing','Other']);
function validScreening(input){
 const serviceCategory=normalized(input?.serviceCategory),serviceDescription=normalized(input?.serviceDescription);
 return input?.acknowledgeTestOnly===true&&screeningCategories.includes(serviceCategory)&&serviceDescription.length>=30&&serviceDescription.length<=350&&noSensitive(serviceDescription)
  ?{serviceCategory,serviceDescription}:null;
}
function validAppeal(input){
 const kind=normalized(input?.subjectKind),id=Number(input?.subjectId),reason=normalized(input?.reason);
 return ['review','provider'].includes(kind)&&isId(id)&&reason.length>=25&&reason.length<=500&&noSensitive(reason)?{kind,id,reason}:null;
}
const moderationActions=Object.freeze(['hide','restore','hold','dismiss_reports']);
const screeningActions=Object.freeze(['review_test_submission','request_changes','suspend','reinstate']);
const appealActions=Object.freeze(['upheld','overturned']);
function validNote(input){const note=normalized(input);return note.length>=12&&note.length<=500&&noSensitive(note)?note:null;}
function moderatorConfigured(env=process.env){
 const key=env.ROUTEDROP_MODERATION_TOKEN||'';
 const emails=(env.ROUTEDROP_MODERATOR_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 return key.length>=32&&emails.length>0;
}
async function reviewRisk(client,userId,comment){
 // Per-account row locking prevents concurrent submissions from bypassing the cap.
 await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
 const count=await client.query("SELECT count(*)::int AS n FROM pilot_service_reviews WHERE customer_id=$1 AND created_at>now()-interval '24 hours'",[userId]);
 if(count.rows[0].n>=3)return {deny:'Daily private-test review limit reached. Request manual review if necessary.'};
 const duplicate=await client.query("SELECT 1 FROM pilot_service_reviews WHERE customer_id=$1 AND lower(btrim(comment))=lower(btrim($2)) AND created_at>now()-interval '30 days' LIMIT 1",[userId,comment]);
 return {status:duplicate.rowCount?'flagged':'visible',rule:duplicate.rowCount?'reused_review_text':null};
}
async function reportRisk(client,userId){
 await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
 const count=await client.query("SELECT count(*)::int AS n FROM pilot_review_reports WHERE reporter_id=$1 AND created_at>now()-interval '24 hours'",[userId]);
 return count.rows[0].n>=5?'Daily report limit reached. Try again later.':null;
}
function registerSafetyRoutes(app,{pool,safe,requireDb,requireUser,requireProvider,forbidden,requireModerator,moderationLimiter}){
 if(!pool)throw Error('Pilot safeguarding requires isolated PostgreSQL');
 app.get('/api/pilot/safety/provider',requireDb,requireProvider,safe(async(req,res)=>{
  const q=await pool.query("SELECT b.id,b.pilot_screening_status,(SELECT c.id FROM pilot_screening_cases c WHERE c.business_id=b.id AND c.status='pending' ORDER BY c.id DESC LIMIT 1) AS open_case_id FROM businesses b WHERE b.owner_id=$1",[req.user.id]);
  res.set('Cache-Control','no-store').json({screening:q.rows[0]||null,identity_verified:false,documents_collected:false,real_work_allowed:false});
 }));
 app.post('/api/pilot/safety/provider/request',requireDb,requireProvider,safe(async(req,res)=>{
  const v=validScreening(req.body);
  if(!v)return forbidden(res,'Acknowledge test-only use and describe fictional service scope, without personal documents or contact details.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const own=await client.query('SELECT id,pilot_screening_status FROM businesses WHERE owner_id=$1 FOR UPDATE',[req.user.id]);
   if(!own.rowCount||!['not_started','needs_changes'].includes(own.rows[0].pilot_screening_status)){
    await client.query('ROLLBACK');return forbidden(res,'Screening already pending, reviewed, or suspended.',409);
   }
   const q=await client.query("INSERT INTO pilot_screening_cases(business_id,service_category,service_description) VALUES($1,$2,$3) RETURNING id,status",[own.rows[0].id,v.serviceCategory,v.serviceDescription]);
   await client.query("UPDATE businesses SET pilot_screening_status='pending' WHERE id=$1",[own.rows[0].id]);
   await client.query('COMMIT');
   res.status(201).json({case:q.rows[0],identity_verified:false,message:'Private-test provider screening requested. This is NOT proof of identity, licensing or insurance.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }));
 app.get('/api/pilot/safety/my-reviews',requireDb,requireUser(),safe(async(req,res)=>{
  const q=await pool.query("SELECT rv.id,rv.headline,rv.status,rv.created_at,b.name AS provider_name FROM pilot_service_reviews rv JOIN businesses b ON b.id=rv.business_id WHERE rv.customer_id=$1 ORDER BY rv.created_at DESC LIMIT 50",[req.user.id]);
  res.set('Cache-Control','no-store').json({reviews:q.rows});
 }));
 app.get('/api/pilot/safety/moderation',requireDb,requireUser(),moderationLimiter,requireModerator,safe(async(req,res)=>{
  const [cases,reviews,appeals,providers]=await Promise.all([
   pool.query("SELECT c.id,c.business_id,b.name AS provider_name,c.service_category,c.service_description,c.created_at FROM pilot_screening_cases c JOIN businesses b ON b.id=c.business_id WHERE c.status='pending' ORDER BY c.created_at LIMIT 50"),
   pool.query("SELECT rv.id,rv.business_id,b.name AS provider_name,rv.rating,rv.headline,rv.comment,rv.status,rv.created_at,COUNT(DISTINCT rr.id) FILTER(WHERE rr.resolution='open')::int AS open_reports,COALESCE(string_agg(DISTINCT rr.reason,', ') FILTER(WHERE rr.resolution='open'),'') AS report_reasons FROM pilot_service_reviews rv JOIN businesses b ON b.id=rv.business_id LEFT JOIN pilot_review_reports rr ON rr.review_id=rv.id WHERE rv.status='flagged' OR rr.resolution='open' GROUP BY rv.id,b.id ORDER BY rv.created_at DESC LIMIT 50"),
   pool.query("SELECT a.id,a.subject_kind,a.subject_id,a.reason,a.created_at FROM pilot_safety_appeals a WHERE a.status='open' ORDER BY a.created_at LIMIT 50"),
   pool.query("SELECT b.id,b.name,b.pilot_screening_status FROM businesses b WHERE b.pilot_screening_status IN ('suspended','needs_changes') ORDER BY b.id DESC LIMIT 50")
  ]);
  res.set('Cache-Control','no-store').json({cases:cases.rows,reviews:reviews.rows,appeals:appeals.rows,providers:providers.rows,not_identity_verified:true});
 }));
 app.get('/api/pilot/safety/moderation/audit',requireDb,requireUser(),moderationLimiter,requireModerator,safe(async(req,res)=>{
  const q=await pool.query("SELECT id,actor_id,subject_kind,subject_id,action,note,created_at FROM pilot_safety_audit ORDER BY id DESC LIMIT 100");
  res.set('Cache-Control','no-store').json({events:q.rows});
 }));
 app.post('/api/pilot/safety/moderation/reviews/:id',requireDb,requireUser(),moderationLimiter,requireModerator,safe(async(req,res)=>{
  const id=Number(req.params.id),action=req.body?.action,note=validNote(req.body?.note);
  if(!isId(id)||!moderationActions.includes(action)||!note)return forbidden(res,'Choose a permitted review decision and a documented rationale (12–500 characters).',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query('SELECT id,status FROM pilot_service_reviews WHERE id=$1 FOR UPDATE',[id]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'Review not found.',404);}
   const status=action==='hide'?'hidden':action==='hold'?'flagged':action==='restore'?'visible':q.rows[0].status;
   await client.query('UPDATE pilot_service_reviews SET status=$1 WHERE id=$2',[status,id]);
   if(action==='hide'||action==='restore'||action==='dismiss_reports'){
    await client.query("UPDATE pilot_review_reports SET resolution=$1,resolved_at=now() WHERE review_id=$2 AND resolution='open'",[action==='hide'?'resolved':'dismissed',id]);
   }
   await client.query("INSERT INTO pilot_safety_audit(actor_id,subject_kind,subject_id,action,note) VALUES($1,'review',$2,$3,$4)",[req.user.id,id,action,note]);
   await client.query('COMMIT');
   res.json({id,status,action,message:'Pilot moderation decision recorded with an audit event.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }));
 app.post('/api/pilot/safety/moderation/providers/:id',requireDb,requireUser(),moderationLimiter,requireModerator,safe(async(req,res)=>{
  const id=Number(req.params.id),action=req.body?.action,note=validNote(req.body?.note);
  if(!isId(id)||!screeningActions.includes(action)||!note)return forbidden(res,'Choose a provider screening decision and a documented rationale.',400);
  const state={review_test_submission:'test_reviewed',request_changes:'needs_changes',suspend:'suspended',reinstate:'needs_changes'}[action];
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query('SELECT id,pilot_screening_status FROM businesses WHERE id=$1 FOR UPDATE',[id]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'Provider not found.',404);}
   if(['review_test_submission','request_changes'].includes(action)&&q.rows[0].pilot_screening_status!=='pending'){
    await client.query('ROLLBACK');return forbidden(res,'A pending test screening case is required.',409);
   }
   if(action==='reinstate'&&q.rows[0].pilot_screening_status!=='suspended'){
    await client.query('ROLLBACK');return forbidden(res,'Provider is not suspended.',409);
   }
   await client.query('UPDATE businesses SET pilot_screening_status=$1 WHERE id=$2',[state,id]);
   if(['review_test_submission','request_changes','suspend'].includes(action))
    await client.query("UPDATE pilot_screening_cases SET status=$1,reviewed_at=now() WHERE business_id=$2 AND status='pending'",[state,id]);
   await client.query("INSERT INTO pilot_safety_audit(actor_id,subject_kind,subject_id,action,note) VALUES($1,'provider',$2,$3,$4)",[req.user.id,id,action,note]);
   await client.query('COMMIT');
   res.json({id,screening_status:state,identity_verified:false,message:'Test screening status recorded. No official identity check was performed.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }));
 app.post('/api/pilot/safety/appeals',requireDb,requireUser(),safe(async(req,res)=>{
  const v=validAppeal(req.body);
  if(!v)return forbidden(res,'Provide an eligible review or provider appeal with fictional details (25–500 characters).',400);
  const q= v.kind==='provider'
   ?await pool.query("SELECT 1 FROM businesses WHERE id=$1 AND owner_id=$2 AND pilot_screening_status IN ('suspended','needs_changes')",[v.id,req.user.id])
   :await pool.query("SELECT 1 FROM pilot_service_reviews WHERE id=$1 AND customer_id=$2 AND status IN ('hidden','flagged')",[v.id,req.user.id]);
  if(!q.rowCount)return forbidden(res,'You cannot appeal this item.',403);
  const result=await pool.query("INSERT INTO pilot_safety_appeals(actor_id,subject_kind,subject_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(actor_id,subject_kind,subject_id) WHERE status='open' DO NOTHING RETURNING id",[req.user.id,v.kind,v.id,v.reason]);
  if(!result.rowCount)return forbidden(res,'An appeal is already open.',409);
  res.status(201).json({appeal:result.rows[0],message:'Appeal saved for manual review. No automated reversal.'});
 }));
 app.post('/api/pilot/safety/moderation/appeals/:id',requireDb,requireUser(),moderationLimiter,requireModerator,safe(async(req,res)=>{
  const id=Number(req.params.id),action=req.body?.action,note=validNote(req.body?.note);
  if(!isId(id)||!appealActions.includes(action)||!note)return forbidden(res,'Provide an appeal decision and a rationale.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("UPDATE pilot_safety_appeals SET status=$1,decided_at=now() WHERE id=$2 AND status='open' RETURNING id,subject_kind,subject_id",[action,id]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'Appeal not found or already resolved.',409);}
   await client.query("INSERT INTO pilot_safety_audit(actor_id,subject_kind,subject_id,action,note) VALUES($1,'appeal',$2,$3,$4)",[req.user.id,id,action,note]);
   await client.query('COMMIT');
   res.json({appeal:q.rows[0],status:action,message:'Appeal decision recorded. Any content/status change requires a separate audited moderation decision.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }));
}
module.exports={ddl,validScreening,validAppeal,validNote,reviewRisk,reportRisk,moderatorConfigured,registerSafetyRoutes};
