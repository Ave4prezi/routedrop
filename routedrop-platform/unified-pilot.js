'use strict';

// Only loaded behind the private, payment-free ROUTEDROP_WORKFLOW_PILOT gate.
const trustPilot=require('./trust-pilot');
// A single existing user session can book, operate a service profile and save job interests.
const ddl=Object.freeze([
 "CREATE TABLE IF NOT EXISTS pilot_service_profiles (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT NOT NULL, neighborhood TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 500 AND 500000), duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 30 AND 480), active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS pilot_profiles_business ON pilot_service_profiles(business_id,created_at DESC)",
 "CREATE TABLE IF NOT EXISTS pilot_weekly_rules (id BIGSERIAL PRIMARY KEY, profile_id BIGINT NOT NULL REFERENCES pilot_service_profiles(id) ON DELETE CASCADE, day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6), local_time TIME NOT NULL, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(profile_id,day_of_week,local_time))",
 "ALTER TABLE listings ADD COLUMN IF NOT EXISTS pilot_profile_id BIGINT REFERENCES pilot_service_profiles(id)",
 "ALTER TABLE listings ADD COLUMN IF NOT EXISTS pilot_weekly_rule_id BIGINT REFERENCES pilot_weekly_rules(id)",
 "CREATE UNIQUE INDEX IF NOT EXISTS pilot_rule_slot_once ON listings(pilot_weekly_rule_id,slot_start) WHERE pilot_weekly_rule_id IS NOT NULL",
 "CREATE TABLE IF NOT EXISTS pilot_job_seekers (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, city TEXT NOT NULL, category TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"
]);
const CATEGORIES=Object.freeze(['Washing','Lawn care','Car detailing','Cleaning','Other']);
const JOB_CATEGORIES=Object.freeze(['All industries','Services','Warehousing','Retail','Food & Hospitality','Healthcare','Construction','Other']);
const idOk=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const str=(v,max)=>typeof v==='string'?v.trim().slice(0,max+1):'';
const validProfile=body=>{
 const p={title:str(body?.title,120),category:str(body?.category,50),neighborhood:str(body?.neighborhood,100),
  description:str(body?.description,600),priceCents:Number(body?.priceCents),durationMinutes:Number(body?.durationMinutes)};
 return p.title.length>=4&&p.title.length<=120&&CATEGORIES.includes(p.category)
  &&p.neighborhood.length>=3&&p.neighborhood.length<=100
  &&p.description.length>=30&&p.description.length<=600
  &&Number.isSafeInteger(p.priceCents)&&p.priceCents>=500&&p.priceCents<=500000
  &&Number.isInteger(p.durationMinutes)&&p.durationMinutes>=30&&p.durationMinutes<=480?p:null;
};
const validWeekly=body=>{
 const day=Number(body?.dayOfWeek),time=String(body?.localTime||'');
 return Number.isInteger(day)&&day>=0&&day<=6&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time)?{day,time}:null;
};
async function syncOpenings(pool){
 // A rolling 35-day horizon in local Central time. PostgreSQL AT TIME ZONE applies DST per occurrence.
 // The partial unique index prevents duplicates on concurrent browser refreshes.
 const result=await pool.query("INSERT INTO listings (business_id,title,category,neighborhood,price_cents,slot_start,duration_minutes,pilot_profile_id,pilot_weekly_rule_id) SELECT p.business_id,p.title,p.category,p.neighborhood,p.price_cents,((z.local_day + r.local_time) AT TIME ZONE 'America/Chicago'),p.duration_minutes,p.id,r.id FROM pilot_weekly_rules r JOIN pilot_service_profiles p ON p.id=r.profile_id JOIN businesses b ON b.id=p.business_id CROSS JOIN LATERAL (SELECT ((now() AT TIME ZONE 'America/Chicago')::date + seq.n)::date AS local_day FROM generate_series(0,35) AS seq(n)) z WHERE r.active=true AND p.active=true AND b.pilot_screening_status!='suspended' AND EXTRACT(DOW FROM z.local_day)=r.day_of_week AND ((z.local_day + r.local_time) AT TIME ZONE 'America/Chicago')>now()+interval '10 minutes' ON CONFLICT (pilot_weekly_rule_id,slot_start) WHERE pilot_weekly_rule_id IS NOT NULL DO NOTHING");
 return result.rowCount;
}
function registerUnifiedRoutes(app,{pool,safe,requireDb,requireUser,requireProvider,forbidden}){
 if(!pool)throw Error('Unified pilot requires isolated PostgreSQL');
 app.post('/api/pilot/provider-profile',requireDb,requireUser(),safe(async(req,res)=>{
  const kind=req.body?.kind;
  const name=str(req.body?.displayName,120),city=str(req.body?.city,100),category=str(req.body?.category,50);
  if(!['individual','business'].includes(kind)||name.length<2||name.length>120||city.length<3||city.length>100||!CATEGORIES.includes(category))
   return forbidden(res,'Complete a fictional provider display name, city, category and provider type.',400);
  // One owner/profile identity per user; never replace a pre-existing employer record.
  const q=await pool.query("INSERT INTO businesses(owner_id,name,city,category,provider_kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id) DO NOTHING RETURNING id,provider_kind,name",[req.user.id,name,city,category,kind]);
  if(!q.rowCount)return forbidden(res,'This account already has a provider profile. Use that profile for your services.',409);
  res.status(201).json({provider:q.rows[0],message:'Fictional service provider profile enabled. Bookings and Find Work remain available on this same account.'});
 }));
 app.get('/api/pilot/service-profiles',requireDb,safe(async(req,res)=>{
  await syncOpenings(pool);
  const q=await pool.query("SELECT p.id,p.title,p.category,p.neighborhood,p.description,p.price_cents,p.duration_minutes,b.id AS provider_id,b.name AS provider_name,b.provider_kind,b.city,b.service_center_code,b.service_radius_miles"+trustPilot.ratingFields('b')+",(SELECT l.id FROM listings l WHERE l.pilot_profile_id=p.id AND l.status='active' AND l.slot_start>now() AND NOT EXISTS(SELECT 1 FROM service_requests sr WHERE sr.listing_id=l.id AND sr.status IN ('requested','accepted','completed','confirmed','issue_reported')) ORDER BY l.slot_start ASC LIMIT 1) AS next_listing_id FROM pilot_service_profiles p JOIN businesses b ON b.id=p.business_id WHERE p.active=true AND b.pilot_screening_status!='suspended' ORDER BY p.created_at DESC LIMIT 100");
  res.set('Cache-Control','no-store').json({profiles:q.rows});
 }));
 app.get('/api/pilot/my-service-profiles',requireDb,requireProvider,safe(async(req,res)=>{
  const [p,r]=await Promise.all([
   pool.query("SELECT p.id,p.title,p.category,p.neighborhood,p.description,p.price_cents,p.duration_minutes,p.active FROM pilot_service_profiles p JOIN businesses b ON b.id=p.business_id WHERE b.owner_id=$1 ORDER BY p.created_at DESC",[req.user.id]),
   pool.query("SELECT r.id,r.profile_id,r.day_of_week,to_char(r.local_time,'HH24:MI') AS local_time,r.active FROM pilot_weekly_rules r JOIN pilot_service_profiles p ON p.id=r.profile_id JOIN businesses b ON b.id=p.business_id WHERE b.owner_id=$1 ORDER BY r.day_of_week,r.local_time",[req.user.id])
  ]);
  res.set('Cache-Control','no-store').json({profiles:p.rows,rules:r.rows});
 }));
 app.post('/api/pilot/service-profiles',requireDb,requireProvider,safe(async(req,res)=>{
  const p=validProfile(req.body);
  if(!p)return forbidden(res,'Enter a complete fictional service profile, price, duration and description.',400);
  const result=await pool.query("INSERT INTO pilot_service_profiles(business_id,title,category,neighborhood,description,price_cents,duration_minutes) SELECT b.id,$2,$3,$4,$5,$6,$7 FROM businesses b WHERE b.owner_id=$1 AND b.pilot_screening_status!='suspended' AND (SELECT count(*) FROM pilot_service_profiles t WHERE t.business_id=b.id)<8 RETURNING id,title",[req.user.id,p.title,p.category,p.neighborhood,p.description,p.priceCents,p.durationMinutes]);
  if(!result.rowCount)return forbidden(res,'A provider account can have up to 8 test service profiles.',409);
  res.status(201).json({profile:result.rows[0],message:'Permanent fictional service profile created. Add weekly availability to publish bookable openings.'});
 }));
 app.patch('/api/pilot/service-profiles/:id/status',requireDb,requireProvider,safe(async(req,res)=>{
  const id=Number(req.params.id),active=req.body?.active;
  if(!idOk(id)||typeof active!=='boolean')return forbidden(res,'Invalid service profile or status.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("UPDATE pilot_service_profiles p SET active=$1 FROM businesses b WHERE p.id=$2 AND p.business_id=b.id AND b.owner_id=$3 AND ($1=false OR b.pilot_screening_status!='suspended') RETURNING p.id,p.active",[active,id,req.user.id]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'Service profile not found or outside your account.',404);}
   await client.query("UPDATE listings l SET status=$1 FROM pilot_weekly_rules r WHERE l.pilot_weekly_rule_id=r.id AND r.profile_id=$2 AND l.slot_start>now() AND NOT EXISTS (SELECT 1 FROM service_requests sr WHERE sr.listing_id=l.id AND sr.status IN ('requested','accepted','completed','confirmed','issue_reported'))",[active?'active':'paused',id]);
   await client.query('COMMIT');
   if(active)await syncOpenings(pool);
   res.json({profile:q.rows[0]});
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
 }));
 app.post('/api/pilot/weekly-rules',requireDb,requireProvider,safe(async(req,res)=>{
  const profileId=Number(req.body?.profileId),v=validWeekly(req.body);
  if(!idOk(profileId)||!v)return forbidden(res,'Select a service, weekday and valid local time.',400);
  const q=await pool.query("INSERT INTO pilot_weekly_rules(profile_id,day_of_week,local_time) SELECT p.id,$2,$3::time FROM pilot_service_profiles p JOIN businesses b ON b.id=p.business_id WHERE p.id=$1 AND b.owner_id=$4 AND b.pilot_screening_status!='suspended' AND (SELECT count(*) FROM pilot_weekly_rules x WHERE x.profile_id=p.id)<14 ON CONFLICT(profile_id,day_of_week,local_time) DO NOTHING RETURNING id",[profileId,v.day,v.time,req.user.id]);
  if(!q.rowCount)return forbidden(res,'Choose a different time, an owned service profile, or fewer weekly openings.',409);
  await syncOpenings(pool);
  res.status(201).json({rule:q.rows[0],message:'Weekly availability saved in Central time; next five weeks are generated without double-booking.'});
 }));
 app.patch('/api/pilot/weekly-rules/:id/status',requireDb,requireProvider,safe(async(req,res)=>{
  const id=Number(req.params.id),active=req.body?.active;
  if(!idOk(id)||typeof active!=='boolean')return forbidden(res,'Invalid recurring opening or status.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("UPDATE pilot_weekly_rules r SET active=$1 FROM pilot_service_profiles p JOIN businesses b ON b.id=p.business_id WHERE r.id=$2 AND r.profile_id=p.id AND b.owner_id=$3 AND ($1=false OR b.pilot_screening_status!='suspended') RETURNING r.id,r.active",[active,id,req.user.id]);
   if(!q.rowCount){await client.query('ROLLBACK');return forbidden(res,'Weekly rule is not owned by this account.',404);}
   await client.query("UPDATE listings l SET status=$1 WHERE l.pilot_weekly_rule_id=$2 AND l.slot_start>now() AND NOT EXISTS (SELECT 1 FROM service_requests sr WHERE sr.listing_id=l.id AND sr.status IN ('requested','accepted','completed','confirmed','issue_reported'))",[active?'active':'paused',id]);
   await client.query('COMMIT');
   if(active)await syncOpenings(pool);
   res.json({rule:q.rows[0]});
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
 }));
 app.get('/api/pilot/job-interests',requireDb,requireUser(),safe(async(req,res)=>{
  const q=await pool.query("SELECT city,category FROM pilot_job_seekers WHERE user_id=$1",[req.user.id]);
  res.set('Cache-Control','no-store').json({interests:q.rows[0]||null});
 }));
 app.put('/api/pilot/job-interests',requireDb,requireUser(),safe(async(req,res)=>{
  const city=str(req.body?.city,100),category=req.body?.category;
  if(city.length<3||city.length>100||!JOB_CATEGORIES.includes(category))return forbidden(res,'Enter a fictional city and choose a job category.',400);
  const q=await pool.query("INSERT INTO pilot_job_seekers(user_id,city,category) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET city=EXCLUDED.city,category=EXCLUDED.category,updated_at=now() RETURNING city,category",[req.user.id,city,category]);
  res.json({interests:q.rows[0],message:'Fictional job interests saved to this same account. No application was sent.'});
 }));
}
module.exports={ddl,CATEGORIES,JOB_CATEGORIES,validProfile,validWeekly,syncOpenings,registerUnifiedRoutes};
