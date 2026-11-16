'use strict';
/**
 * RouteDrop moderator passkeys using FIDO2/WebAuthn user verification.
 * An existing signed-in, verified, allowlisted moderator AND the privately
 * configured bootstrap key are required to enroll or authenticate.
 */
const crypto=require('crypto');
const {
 generateRegistrationOptions,verifyRegistrationResponse,
 generateAuthenticationOptions,verifyAuthenticationResponse
}=require('@simplewebauthn/server');
const ddl=Object.freeze([
 "CREATE TABLE IF NOT EXISTS pilot_moderator_credentials (credential_id TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, public_key BYTEA NOT NULL, counter BIGINT NOT NULL DEFAULT 0, transports JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS pilot_moderator_credentials_owner ON pilot_moderator_credentials(user_id)",
 "CREATE TABLE IF NOT EXISTS pilot_moderator_challenges (session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, challenge TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('register','authenticate')), expires_at TIMESTAMPTZ NOT NULL)",
 "CREATE TABLE IF NOT EXISTS pilot_moderator_stepup (session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL)",
 "CREATE INDEX IF NOT EXISTS pilot_moderator_stepup_expiry ON pilot_moderator_stepup(expires_at)"
]);
function config(env=process.env){
 const origin=String(env.ROUTEDROP_WEBAUTHN_ORIGIN||''),rpID=String(env.ROUTEDROP_WEBAUTHN_RP_ID||'');
 if(env.ROUTEDROP_MODERATOR_PASSKEYS_ENABLED!=='true')return null;
 try{
  const u=new URL(origin);
  if(u.protocol!=='https:'||u.hostname!==rpID||u.pathname!=='/'||u.search||u.hash||origin!==u.origin)return null;
  if(rpID.length<5||!rpID.includes('.'))return null;
  return {origin,rpID,enrollmentEnabled:env.ROUTEDROP_MODERATOR_ENROLLMENT_ENABLED==='true'};
 }catch{return null;}
}
function sessionHash(req){
 const token=req.cookies?.['__Host-rd_session']||'';
 return /^[0-9a-f]{64}$/.test(token)?crypto.createHash('sha256').update(token).digest('hex'):null;
}
async function isFresh(pool,req){
 const hash=sessionHash(req);if(!hash||!req.user)return false;
 const result=await pool.query("SELECT 1 FROM pilot_moderator_stepup WHERE session_hash=$1 AND user_id=$2 AND expires_at>now()",[hash,req.user.id]);
 return result.rowCount===1;
}
async function consumeChallenge(pool,req,purpose){
 const hash=sessionHash(req);if(!hash)return null;
 const result=await pool.query("DELETE FROM pilot_moderator_challenges WHERE session_hash=$1 AND user_id=$2 AND purpose=$3 AND expires_at>now() RETURNING challenge",[hash,req.user.id,purpose]);
 return result.rows[0]?.challenge||null;
}
async function rememberChallenge(pool,req,challenge,purpose){
 const hash=sessionHash(req);if(!hash)throw Error('Authenticated session required');
 await pool.query("INSERT INTO pilot_moderator_challenges(session_hash,user_id,challenge,purpose,expires_at) VALUES($1,$2,$3,$4,now()+interval '3 minutes') ON CONFLICT(session_hash) DO UPDATE SET challenge=EXCLUDED.challenge,purpose=EXCLUDED.purpose,expires_at=EXCLUDED.expires_at,user_id=EXCLUDED.user_id",[hash,req.user.id,challenge,purpose]);
}
function registerPasskeyRoutes(app,{pool,safe,requireDb,bootstrap,limiter,forbidden,options}){
 if(!pool)return;
 app.get('/api/pilot/moderator/passkeys/status',requireDb,bootstrap,limiter,safe(async(req,res)=>{
  const q=await pool.query('SELECT count(*)::int AS n FROM pilot_moderator_credentials WHERE user_id=$1',[req.user.id]);
  res.set('Cache-Control','no-store').json({configured:!!options,enrollment_enabled:!!options?.enrollmentEnabled,registered:q.rows[0].n,step_up_active:await isFresh(pool,req),phishing_resistant:true});
 }));
 app.post('/api/pilot/moderator/passkeys/register/options',requireDb,bootstrap,limiter,safe(async(req,res)=>{
  if(!options?.enrollmentEnabled)return forbidden(res,'Passkey enrollment is disabled; an administrator must authorize a short enrollment window.',403);
  const q=await pool.query('SELECT credential_id,transports FROM pilot_moderator_credentials WHERE user_id=$1',[req.user.id]);
  const json=await generateRegistrationOptions({rpName:'RouteDrop Moderator',rpID:options.rpID,userName:req.user.email,
    userID:new Uint8Array(crypto.createHash('sha256').update(String(req.user.id)).digest()),
    attestationType:'none',authenticatorSelection:{userVerification:'required',residentKey:'preferred'},
    excludeCredentials:q.rows.map(x=>({id:x.credential_id,transports:x.transports})),
    supportedAlgorithmIDs:[-7,-257]});
  await rememberChallenge(pool,req,json.challenge,'register');
  res.set('Cache-Control','no-store').json(json);
 }));
 app.post('/api/pilot/moderator/passkeys/register/verify',requireDb,bootstrap,limiter,safe(async(req,res)=>{
  if(!options?.enrollmentEnabled)return forbidden(res,'Passkey enrollment is closed.',403);
  const challenge=await consumeChallenge(pool,req,'register');
  if(!challenge)return forbidden(res,'Passkey challenge missing, expired or already used.',409);
  let checked;
  try{checked=await verifyRegistrationResponse({response:req.body,expectedChallenge:challenge,expectedOrigin:options.origin,expectedRPID:options.rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});}
  catch{return forbidden(res,'Passkey registration proof was not valid.',400);}
  if(!checked.verified||!checked.registrationInfo?.credential)return forbidden(res,'Verified passkey not provided.',400);
  const c=checked.registrationInfo.credential;
  await pool.query("INSERT INTO pilot_moderator_credentials(credential_id,user_id,public_key,counter,transports) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(credential_id) DO NOTHING",[c.id,req.user.id,Buffer.from(c.publicKey),c.counter,JSON.stringify(req.body.response?.transports||[])]);
  res.status(201).json({registered:true,message:'Moderator passkey registered. Authenticate with it to access moderation.'});
 }));
 app.post('/api/pilot/moderator/passkeys/authenticate/options',requireDb,bootstrap,limiter,safe(async(req,res)=>{
  if(!options)return forbidden(res,'Moderator passkeys are not configured.',403);
  const q=await pool.query('SELECT credential_id,transports FROM pilot_moderator_credentials WHERE user_id=$1',[req.user.id]);
  if(!q.rowCount)return forbidden(res,'A passkey must first be registered during a protected enrollment window.',409);
  const json=await generateAuthenticationOptions({rpID:options.rpID,userVerification:'required',allowCredentials:q.rows.map(x=>({id:x.credential_id,transports:x.transports}))});
  await rememberChallenge(pool,req,json.challenge,'authenticate');
  res.set('Cache-Control','no-store').json(json);
 }));
 app.post('/api/pilot/moderator/passkeys/authenticate/verify',requireDb,bootstrap,limiter,safe(async(req,res)=>{
  if(!options)return forbidden(res,'Moderator passkeys are not configured.',403);
  const challenge=await consumeChallenge(pool,req,'authenticate');
  if(!challenge)return forbidden(res,'Passkey challenge missing, expired or already used.',409);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const c=await client.query('SELECT credential_id,public_key,counter,transports FROM pilot_moderator_credentials WHERE credential_id=$1 AND user_id=$2 FOR UPDATE',[req.body?.id||'',req.user.id]);
   if(!c.rowCount){await client.query('ROLLBACK');return forbidden(res,'Passkey does not belong to this moderator.',403);}
   const credential={id:c.rows[0].credential_id,publicKey:new Uint8Array(c.rows[0].public_key),counter:Number(c.rows[0].counter),transports:c.rows[0].transports};
   let checked;
   try{checked=await verifyAuthenticationResponse({response:req.body,expectedChallenge:challenge,expectedOrigin:options.origin,expectedRPID:options.rpID,credential,requireUserVerification:true});}
   catch{await client.query('ROLLBACK');return forbidden(res,'Passkey authentication proof was not valid.',403);}
   if(!checked.verified||!checked.authenticationInfo?.userVerified){await client.query('ROLLBACK');return forbidden(res,'Passkey user verification required.',403);}
   await client.query('UPDATE pilot_moderator_credentials SET counter=$1 WHERE credential_id=$2',[checked.authenticationInfo.newCounter,c.rows[0].credential_id]);
   await client.query("INSERT INTO pilot_moderator_stepup(session_hash,user_id,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(session_hash) DO UPDATE SET user_id=EXCLUDED.user_id,expires_at=EXCLUDED.expires_at",[sessionHash(req),req.user.id]);
   await client.query('COMMIT');
   res.json({authenticated:true,expires_in_seconds:600,message:'Moderator passkey verified for a short, session-bound review window.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }));
 app.post('/api/pilot/moderator/passkeys/lock',requireDb,bootstrap,limiter,safe(async(req,res)=>{
  await pool.query('DELETE FROM pilot_moderator_stepup WHERE session_hash=$1 AND user_id=$2',[sessionHash(req),req.user.id]);
  res.json({locked:true});
 }));
}
module.exports={ddl,config,sessionHash,isFresh,registerPasskeyRoutes};
