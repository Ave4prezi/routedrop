'use strict';
// Private fictional-data pilot only. No payment or identity integrations.
const ddl=[
 `CREATE TABLE IF NOT EXISTS pilot_day_tasks(id BIGSERIAL PRIMARY KEY,poster_id BIGINT NOT NULL REFERENCES users(id),title TEXT NOT NULL,city TEXT NOT NULL,summary TEXT NOT NULL,pay_display TEXT NOT NULL,starts_at TIMESTAMPTZ NOT NULL,ends_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','awaiting_confirmation','completed','cancelled')),worker_id BIGINT REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(ends_at>starts_at),CHECK(worker_id IS NULL OR worker_id<>poster_id))`,
 `CREATE TABLE IF NOT EXISTS pilot_day_interest(task_id BIGINT NOT NULL REFERENCES pilot_day_tasks(id) ON DELETE CASCADE,worker_id BIGINT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(task_id,worker_id))`
];
function validTask(b,now=Date.now()){
 const x=Object.fromEntries(['title','city','summary','payDisplay','startsAt','endsAt'].map(k=>[k,String(b?.[k]||'').trim()]));
 const start=Date.parse(x.startsAt),end=Date.parse(x.endsAt);
 return x.title.length>=4&&x.title.length<=120&&x.city.length>=3&&x.city.length<=100&&x.summary.length>=20&&x.summary.length<=1000&&x.payDisplay.length>=2&&x.payDisplay.length<=80&&Number.isFinite(start)&&Number.isFinite(end)&&start>now&&end>start&&end-start<=86400000?x:null;
}
function registerDayWorkRoutes(app,{pool,safe,requireDb,requireUser,forbidden}){
 const auth=[requireDb,requireUser()];
 const eligible=async (id,connection=pool)=>!(await connection.query("SELECT 1 FROM businesses WHERE owner_id=$1 AND pilot_screening_status='suspended'",[id])).rowCount;
 app.get('/api/pilot/day-work',...auth,safe(async(req,res)=>{
  const q=await pool.query(`SELECT t.*,t.poster_id=$1 AS is_poster,t.worker_id=$1 AS is_worker,EXISTS(SELECT 1 FROM pilot_day_interest i WHERE i.task_id=t.id AND i.worker_id=$1) AS interested FROM pilot_day_tasks t WHERE (t.status='open' AND t.starts_at>now() AND NOT EXISTS(SELECT 1 FROM businesses b WHERE b.owner_id=t.poster_id AND b.pilot_screening_status='suspended')) OR t.poster_id=$1 OR t.worker_id=$1 ORDER BY t.created_at DESC LIMIT 100`,[req.user.id]);
  // Never expose account IDs or user contact details in the public board.
  res.set('Cache-Control','no-store').json({tasks:q.rows.map(({poster_id,worker_id,...t})=>t),payments_enabled:false});
 }));
 app.post('/api/pilot/day-work',...auth,safe(async(req,res)=>{
  const x=validTask(req.body);if(!x)return forbidden(res,'Enter a fictional title, city, pay, description and a future window of up to 24 hours.',400);
  if(!await eligible(req.user.id))return forbidden(res,'Posting is unavailable for this account.',403);
  const q=await pool.query(`INSERT INTO pilot_day_tasks(poster_id,title,city,summary,pay_display,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,status`,[req.user.id,x.title,x.city,x.summary,x.payDisplay,x.startsAt,x.endsAt]);res.status(201).json({task:q.rows[0]});
 }));
 app.get('/api/pilot/day-work/:id/interests',...auth,safe(async(req,res)=>{
  if(!/^[1-9]\d{0,14}$/.test(String(req.params.id)))return forbidden(res,'Invalid task.',400);
  const task=await pool.query('SELECT id FROM pilot_day_tasks WHERE id=$1 AND poster_id=$2',[req.params.id,req.user.id]);
  if(!task.rowCount)return forbidden(res,'Task unavailable.',404);
  const q=await pool.query('SELECT worker_id FROM pilot_day_interest WHERE task_id=$1 ORDER BY created_at',[req.params.id]);
  res.set('Cache-Control','no-store').json({interests:q.rows.map((r,n)=>({workerId:r.worker_id,label:'Test worker '+(n+1)}))});
 }));
 app.post('/api/pilot/day-work/:id/:action',...auth,safe(async(req,res)=>{
  const id=String(req.params.id),action=req.params.action;
  if(!/^[1-9]\d{0,14}$/.test(id)||!['interest','withdraw','select','complete','confirm','cancel'].includes(action))return forbidden(res,'Invalid action.',400);
  if(['interest','select'].includes(action)&&!await eligible(req.user.id))return forbidden(res,'This action is unavailable for this account.',403);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const q=await db.query('SELECT * FROM pilot_day_tasks WHERE id=$1 FOR UPDATE',[id]);const t=q.rows[0];
   let ok=false;
   if(t){
    const owner=String(t.poster_id)===String(req.user.id),worker=String(t.worker_id)===String(req.user.id),open=t.status==='open'&&new Date(t.starts_at).getTime()>Date.now();
    if(action==='interest'&&open&&!owner&&await eligible(t.poster_id,db)){await db.query('INSERT INTO pilot_day_interest(task_id,worker_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,req.user.id]);ok=true;}
    if(action==='withdraw'&&t.status==='open'&&!owner){await db.query('DELETE FROM pilot_day_interest WHERE task_id=$1 AND worker_id=$2',[id,req.user.id]);ok=true;}
    if(action==='select'&&owner&&open&&/^[1-9]\d{0,14}$/.test(String(req.body?.workerId))&&await eligible(req.body.workerId,db)){
     const interest=await db.query('SELECT 1 FROM pilot_day_interest WHERE task_id=$1 AND worker_id=$2',[id,req.body.workerId]);
     if(interest.rowCount){await db.query("UPDATE pilot_day_tasks SET worker_id=$2,status='assigned' WHERE id=$1",[id,req.body.workerId]);ok=true;}
    }
    if(action==='complete'&&worker&&t.status==='assigned'){await db.query("UPDATE pilot_day_tasks SET status='awaiting_confirmation' WHERE id=$1",[id]);ok=true;}
    if(action==='confirm'&&owner&&t.status==='awaiting_confirmation'){await db.query("UPDATE pilot_day_tasks SET status='completed' WHERE id=$1",[id]);ok=true;}
    if(action==='cancel'&&owner&&['open','assigned'].includes(t.status)){await db.query("UPDATE pilot_day_tasks SET status='cancelled' WHERE id=$1",[id]);ok=true;}
   }
   if(!ok){await db.query('ROLLBACK');return forbidden(res,'Task changed or action outside your permissions. Refresh and try again.',409);}
   await db.query('COMMIT');res.json({ok:true,payments_enabled:false});
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }));
}
module.exports={ddl,validTask,registerDayWorkRoutes};
