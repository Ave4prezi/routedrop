'use strict';
// PRIVATE SYNTHETIC PREVIEW ONLY. No HTTP grant, bootstrap, or privilege endpoint.
const ROLES=Object.freeze(['credential_reviewer','launch_approver','support_reviewer']);
const schema=[
 "CREATE TABLE IF NOT EXISTS provider_operator_admins (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, appointed_at TIMESTAMPTZ NOT NULL DEFAULT now(), appointment_reason TEXT NOT NULL CHECK(length(appointment_reason)>=20))",
 "CREATE TABLE IF NOT EXISTS provider_operator_grants (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('credential_reviewer','launch_approver','support_reviewer')), granted_by BIGINT NOT NULL REFERENCES users(id), granted_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, revoked_by BIGINT REFERENCES users(id), PRIMARY KEY(user_id,role))",
 "CREATE INDEX IF NOT EXISTS provider_operator_grants_active ON provider_operator_grants(role,expires_at) WHERE revoked_at IS NULL",
 "CREATE TABLE IF NOT EXISTS provider_operator_audit (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('credential_reviewer','launch_approver','support_reviewer')), action TEXT NOT NULL CHECK(action IN ('grant','revoke')), actor_id BIGINT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
];
const fictionalEmail=v=>typeof v==='string'&&/^[^\s@]+@(?:example\.test|example\.invalid|ci\.invalid)$/i.test(v);
async function allowed(db,id,role){
 if(!ROLES.includes(role)||!Number.isSafeInteger(Number(id))||Number(id)<1)return false;
 const r=await db.query('SELECT 1 FROM provider_operator_grants WHERE user_id=$1 AND role=$2 AND revoked_at IS NULL AND expires_at>now()',[id,role]);
 return r.rowCount>0;
}
function validated(change){
 const action=change?.action,role=change?.role,reason=String(change?.reason||'').trim();
 if(!['grant','revoke'].includes(action)||!ROLES.includes(role)||reason.length<20||reason.length>500||/[\r\n]/.test(reason))
  throw Error('Invalid operator change or reason (20–500 characters)');
 if(!fictionalEmail(change.actorEmail)||!fictionalEmail(change.targetEmail)||change.actorEmail.toLowerCase()===change.targetEmail.toLowerCase())
  throw Error('A distinct fictional administrator and user are required');
 let expiresAt=null;
 if(action==='grant'){
  const date=new Date(change.expiresAt||'');
  if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now()||date.getTime()>Date.now()+90*86400000)
   throw Error('Operator permission must expire within 90 days');
  expiresAt=date.toISOString();
 }
 return {action,role,reason,expiresAt,actorEmail:change.actorEmail.toLowerCase(),targetEmail:change.targetEmail.toLowerCase()};
}
async function change(pool,input){
 const args=validated(input),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const result=await client.query(
   'SELECT u.id,u.email,EXISTS(SELECT 1 FROM provider_operator_admins a WHERE a.user_id=u.id) AS is_admin FROM users u WHERE u.email=ANY($1) FOR UPDATE',
   [[args.actorEmail,args.targetEmail]]
  );
  const map=Object.fromEntries(result.rows.map(r=>[r.email,{id:r.id,admin:r.is_admin}]));
  const actor=map[args.actorEmail],target=map[args.targetEmail];
  if(!actor?.admin||!target)throw Error('Operator admin or target fictional account not found');
  // Prevent conflating credential review and independent launch approval.
  if(args.action==='grant'&&['credential_reviewer','launch_approver'].includes(args.role)){
   const other=args.role==='credential_reviewer'?'launch_approver':'credential_reviewer';
   if(await allowed(client,target.id,other))throw Error('Credential and launch reviewer roles must be assigned to different accounts');
  }
  if(args.action==='grant'){
   await client.query(
    "INSERT INTO provider_operator_grants(user_id,role,granted_by,expires_at) VALUES($1,$2,$3,$4)"+
    " ON CONFLICT(user_id,role) DO UPDATE SET granted_by=EXCLUDED.granted_by,granted_at=now(),expires_at=EXCLUDED.expires_at,revoked_at=NULL,revoked_by=NULL",
    [target.id,args.role,actor.id,args.expiresAt]
   );
  } else {
   const q=await client.query(
    'UPDATE provider_operator_grants SET revoked_at=now(),revoked_by=$3 WHERE user_id=$1 AND role=$2 AND revoked_at IS NULL RETURNING user_id',
    [target.id,args.role,actor.id]
   );
   if(!q.rowCount)throw Error('No active operator grant to revoke');
  }
  await client.query(
   'INSERT INTO provider_operator_audit(user_id,role,action,actor_id,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
   [target.id,args.role,args.action,actor.id,args.reason,args.expiresAt]
  );
  await client.query('COMMIT');
  return {targetEmail:args.targetEmail,role:args.role,action:args.action,expiresAt:args.expiresAt};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
module.exports={ROLES,schema,fictionalEmail,allowed,validated,change};
