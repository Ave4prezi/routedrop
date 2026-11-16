'use strict';

// Fictional-data-only jobs and independent-provider classification.
// Registered only inside the isolated, payment-disabled booking pilot.
const CATEGORIES=Object.freeze(['Services','Warehousing','Retail','Food & Hospitality','Healthcare','Construction','Other']);
const TYPES=Object.freeze(['Full-time','Part-time','Contract','Seasonal']);
const ddl=Object.freeze([
 "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS provider_kind TEXT NOT NULL DEFAULT 'business' CHECK(provider_kind IN ('business','individual'))",
 "CREATE TABLE IF NOT EXISTS pilot_job_openings (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT NOT NULL, city TEXT NOT NULL, employment_type TEXT NOT NULL, pay_display TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS pilot_jobs_active_recent ON pilot_job_openings(status,created_at DESC)"
]);
const validJob=(body)=>{
 const x={title:String(body?.title||'').trim(),category:String(body?.category||'').trim(),city:String(body?.city||'').trim(),
  employmentType:String(body?.employmentType||'').trim(),payDisplay:String(body?.payDisplay||'').trim(),
  summary:String(body?.summary||'').trim()};
 return x.title.length>=4&&x.title.length<=120&&CATEGORIES.includes(x.category)&&x.city.length>=3&&x.city.length<=100
  &&TYPES.includes(x.employmentType)&&x.payDisplay.length>=2&&x.payDisplay.length<=80
  &&x.summary.length>=20&&x.summary.length<=1000?x:null;
};
const idOk=id=>Number.isSafeInteger(Number(id))&&Number(id)>0;

function registerOpportunityRoutes(app,{pool,safe,requireDb,requireUser,requireProvider,forbidden}){
 if(!pool)throw Error('Private job pilot requires a database');
 app.get('/api/pilot/jobs',requireDb,safe(async(req,res)=>{
  const q=await pool.query("SELECT j.id,j.title,j.category,j.city,j.employment_type,j.pay_display,j.summary,b.name AS employer_name FROM pilot_job_openings j JOIN businesses b ON b.id=j.business_id WHERE j.status='active' AND b.pilot_screening_status!='suspended' ORDER BY j.created_at DESC LIMIT 100");
  res.set('Cache-Control','no-store').json({jobs:q.rows,applications_enabled:false});
 }));
 app.get('/api/pilot/my-jobs',requireDb,requireProvider,safe(async(req,res)=>{
  const q=await pool.query("SELECT j.id,j.title,j.category,j.city,j.employment_type,j.pay_display,j.summary,j.status FROM pilot_job_openings j JOIN businesses b ON b.id=j.business_id WHERE b.owner_id=$1 ORDER BY j.created_at DESC LIMIT 100",[req.user.id]);
  res.set('Cache-Control','no-store').json({jobs:q.rows});
 }));
 app.post('/api/pilot/jobs',requireDb,requireProvider,safe(async(req,res)=>{
  const x=validJob(req.body);
  if(!x)return forbidden(res,'Enter a valid fictional job title, category, location, employment type, pay and description.',400);
  const q=await pool.query("INSERT INTO pilot_job_openings(business_id,title,category,city,employment_type,pay_display,summary) SELECT id,$2,$3,$4,$5,$6,$7 FROM businesses WHERE owner_id=$1 AND provider_kind='business' AND pilot_screening_status!='suspended' RETURNING id,title,status",[req.user.id,x.title,x.category,x.city,x.employmentType,x.payDisplay,x.summary]);
  if(!q.rowCount)return forbidden(res,'Only business/employer test accounts may post job openings.',403);
  res.status(201).json({job:q.rows[0],applications_enabled:false});
 }));
 app.patch('/api/pilot/jobs/:id/status',requireDb,requireProvider,safe(async(req,res)=>{
  const id=Number(req.params.id),status=req.body?.status;
  if(!idOk(id)||!['active','paused'].includes(status))return forbidden(res,'Invalid job or status.',400);
  const q=await pool.query("UPDATE pilot_job_openings j SET status=$1 FROM businesses b WHERE j.id=$2 AND j.business_id=b.id AND b.owner_id=$3 AND b.provider_kind='business' AND ($1='paused' OR b.pilot_screening_status!='suspended') RETURNING j.id,j.status",[status,id,req.user.id]);
  if(!q.rowCount)return forbidden(res,'Job unavailable or outside your permissions.',404);
  res.json({job:q.rows[0]});
 }));
}
module.exports={ddl,CATEGORIES,TYPES,validJob,registerOpportunityRoutes};
