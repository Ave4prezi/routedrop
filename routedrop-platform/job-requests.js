'use strict';
// Phase 2: separate customer-request/quote marketplace. No payments or booking authorizations here.
const categories=Object.freeze(['Washing','Lawn care','Car detailing','Cleaning','Other']);
const categorySet=new Set(categories);
const text=(v,max)=>typeof v==='string'?v.trim().slice(0,max+1):'';
const id=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const cents=v=>Number.isSafeInteger(v)&&v>=500&&v<=500000;
const contact=v=>/(?:[^\s@]+@[^\s@]+\.[^\s@]+)|(?:\+?\d[\d().\s-]{7,}\d)/.test(v);
const sql=[
 "CREATE TABLE IF NOT EXISTS customer_job_requests (id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL CHECK(char_length(title) BETWEEN 8 AND 120), category TEXT NOT NULL, neighborhood TEXT NOT NULL, description TEXT NOT NULL CHECK(char_length(description) BETWEEN 20 AND 2000), budget_cents INTEGER CHECK(budget_cents BETWEEN 500 AND 500000), desired_start TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS customer_jobs_owner ON customer_job_requests(customer_id,created_at DESC)",
 "CREATE INDEX IF NOT EXISTS customer_jobs_open ON customer_job_requests(status,created_at DESC)",
 "CREATE TABLE IF NOT EXISTS customer_job_quotes (id BIGSERIAL PRIMARY KEY, request_id BIGINT NOT NULL REFERENCES customer_job_requests(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 500 AND 500000), note TEXT NOT NULL CHECK(char_length(note) BETWEEN 10 AND 800), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(request_id,business_id))",
 "CREATE INDEX IF NOT EXISTS customer_job_quotes_request ON customer_job_quotes(request_id,created_at DESC)"
];
function validateRequest(body,now=Date.now()){
 const title=text(body?.title,120),category=text(body?.category,40),neighborhood=text(body?.neighborhood,100),description=text(body?.description,2000);
 const rawBudget=body?.budgetCents;const budget=rawBudget===null||rawBudget===undefined?null:Number(rawBudget);
 let desired=null;
 if(body?.desiredStart){desired=new Date(body.desiredStart);
  if(!Number.isFinite(desired.getTime())||desired.getTime()<now+60*60*1000||desired.getTime()>now+60*86400000)return {error:'Choose a preferred time at least one hour from now and within 60 days.'};}
 if(title.length<8||title.length>120||!categorySet.has(category)||neighborhood.length<2||neighborhood.length>100||description.length<20||description.length>2000||budget!==null&&!cents(budget))return {error:'Provide a job title, valid service category, neighborhood, 20–2000 character description, and optional $5–$5,000 budget.'};
 if(contact([title,description,neighborhood].join(' ')))return {error:'Do not put phone numbers or email addresses in public job requests.'};
 return {value:{title,category,neighborhood,description,budget,desired:desired?desired.toISOString():null}};
}
function validateQuote(body){
 const price=Number(body?.priceCents),note=text(body?.note,800);
 if(!cents(price)||note.length<10||note.length>800)return {error:'Enter a $5–$5,000 quote and a note between 10 and 800 characters.'};
 if(contact(note))return {error:'Do not share contact information in a public quote.'};
 return {value:{price,note}};
}
function install(app,{pool,enabled,requireDb,requireUser,safe,limiter,forbidden}){
 if(!enabled)return;
 const customer=[requireDb,requireUser('customer'),limiter];
 const business=[requireDb,requireUser('business'),limiter];
 app.get('/api/job-requests/mine',...customer,safe(async(req,res)=>{
  const q=await pool.query("SELECT j.id,j.title,j.category,j.neighborhood,j.description,j.budget_cents,j.desired_start,j.status,j.created_at,COALESCE((SELECT json_agg(json_build_object('id',q.id,'price_cents',q.price_cents,'note',q.note,'created_at',q.created_at,'business_name',b.name,'business_city',b.city) ORDER BY q.created_at) FROM customer_job_quotes q JOIN businesses b ON b.id=q.business_id WHERE q.request_id=j.id),'[]'::json) AS quotes FROM customer_job_requests j WHERE j.customer_id=$1 ORDER BY j.created_at DESC LIMIT 50",[req.user.id]);
  res.json({requests:q.rows});
 }));
 app.post('/api/job-requests',...customer,safe(async(req,res)=>{
  const parsed=validateRequest(req.body);
  if(parsed.error)return forbidden(res,parsed.error,400);
  const v=parsed.value;
  const conn=await pool.connect();
  try{
   await conn.query('BEGIN');
   const q=await conn.query("SELECT COUNT(*)::integer AS count FROM customer_job_requests WHERE customer_id=$1 AND status='open'",[req.user.id]);
   if(q.rows[0].count>=10){await conn.query('ROLLBACK');return forbidden(res,'Close an existing job before posting another. Maximum 10 open jobs.',429);}
   const created=await conn.query("INSERT INTO customer_job_requests(customer_id,title,category,neighborhood,description,budget_cents,desired_start) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,status",[req.user.id,v.title,v.category,v.neighborhood,v.description,v.budget,v.desired]);
   await conn.query('COMMIT');
   res.status(201).json({request:created.rows[0]});
  }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e;}finally{conn.release();}
 }));
 app.post('/api/job-requests/:requestId/close',...customer,safe(async(req,res)=>{
  const requestId=id(req.params.requestId);
  if(!requestId)return forbidden(res,'Invalid job request.',400);
  const q=await pool.query("UPDATE customer_job_requests SET status='closed' WHERE id=$1 AND customer_id=$2 AND status='open' RETURNING id",[requestId,req.user.id]);
  if(!q.rowCount)return forbidden(res,'Open job request not found.',404);
  res.json({ok:true});
 }));
 app.get('/api/job-requests/open',...business,safe(async(req,res)=>{
  const q=await pool.query("SELECT j.id,j.title,j.category,j.neighborhood,j.description,j.budget_cents,j.desired_start,j.created_at,quote.id AS my_quote_id,quote.price_cents AS my_quote_cents FROM customer_job_requests j LEFT JOIN businesses b ON b.owner_id=$1 LEFT JOIN customer_job_quotes quote ON quote.request_id=j.id AND quote.business_id=b.id WHERE j.status='open' ORDER BY j.created_at DESC LIMIT 50",[req.user.id]);
  res.json({requests:q.rows});
 }));
 app.post('/api/job-requests/:requestId/quotes',...business,safe(async(req,res)=>{
  const requestId=id(req.params.requestId);if(!requestId)return forbidden(res,'Invalid job request.',400);
  const parsed=validateQuote(req.body);if(parsed.error)return forbidden(res,parsed.error,400);
  const v=parsed.value;
  const q=await pool.query("INSERT INTO customer_job_quotes(request_id,business_id,price_cents,note) SELECT j.id,b.id,$3,$4 FROM customer_job_requests j CROSS JOIN businesses b WHERE j.id=$1 AND j.status='open' AND b.owner_id=$2 AND NOT EXISTS(SELECT 1 FROM customer_job_quotes old WHERE old.request_id=j.id AND old.business_id=b.id) RETURNING id",[requestId,req.user.id,v.price,v.note]);
  if(!q.rowCount)return forbidden(res,'This job is closed, unavailable, or your business has already quoted.',409);
  res.status(201).json({quote:{id:q.rows[0].id}});
 }));
}
module.exports={sql,install,validateRequest,validateQuote};
