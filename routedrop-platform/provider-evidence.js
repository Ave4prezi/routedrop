'use strict';
// Staging-only encrypted evidence store. Never persist plaintext ID or policy documents.
const crypto=require('node:crypto');
const express=require('express');
const MAX_BYTES=2*1024*1024;
const MIN_BYTES=24;
const TYPES=new Set(['identity','business_info','driver_license','auto_insurance','liability_insurance','professional_license']);
const schema=[
 "CREATE TABLE IF NOT EXISTS provider_verification_documents (business_id BIGINT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL CHECK(mime IN ('application/pdf','image/jpeg','image/png')), nonce BYTEA NOT NULL CHECK(octet_length(nonce)=12), tag BYTEA NOT NULL CHECK(octet_length(tag)=16), ciphertext BYTEA NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 24 AND 2097152), uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(business_id,kind), FOREIGN KEY(business_id,kind) REFERENCES provider_verifications(business_id,kind) ON DELETE CASCADE)",
 "CREATE TABLE IF NOT EXISTS provider_verification_audit (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, kind TEXT NOT NULL, actor_user_id BIGINT NOT NULL REFERENCES users(id), action TEXT NOT NULL CHECK(action IN ('upload','review_approved','review_rejected','download','removed','category_approved','revoked')), created_at TIMESTAMPTZ NOT NULL DEFAULT now())",
 "CREATE INDEX IF NOT EXISTS provider_verification_audit_recent ON provider_verification_audit(business_id,created_at DESC)"
];
function getKey(value=process.env.ROUTEDROP_PROVIDER_DOC_KEY_B64){
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))
  throw Error('Provider document encryption key unavailable');
 const key=Buffer.from(value,'base64');
 if(key.length!==32||key.toString('base64')!==value)
  throw Error('Provider document encryption key invalid');
 return key;
}
function sniff(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<MIN_BYTES||buffer.length>MAX_BYTES)throw Error('File must be between 24 bytes and 2 MB');
 if(buffer.subarray(0,5).toString('ascii')==='%PDF-' && buffer.subarray(Math.max(0,buffer.length-2048)).includes(Buffer.from('%%EOF')))
  return 'application/pdf';
 if(buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))&&buffer.subarray(-2).equals(Buffer.from([0xff,0xd9])))
  return 'image/jpeg';
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&buffer.subarray(-8,-4).equals(Buffer.from('IEND')))
  return 'image/png';
 throw Error('Only valid PDF, PNG, or JPEG documents are accepted');
}
function aad(businessId,kind){return Buffer.from('routedrop-provider-evidence-v1:'+businessId+':'+kind);}
function seal(bytes,key,businessId,kind){
 const mime=sniff(bytes);
 const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
 cipher.setAAD(aad(businessId,kind));
 const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
 return {mime,nonce,ciphertext,tag:cipher.getAuthTag(),size_bytes:bytes.length};
}
function open(doc,key,businessId,kind){
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,doc.nonce);
 decipher.setAAD(aad(businessId,kind));
 decipher.setAuthTag(doc.tag);
 const plaintext=Buffer.concat([decipher.update(doc.ciphertext),decipher.final()]);
 if(sniff(plaintext)!==doc.mime||plaintext.length!==doc.size_bytes)throw Error('Evidence integrity verification failed');
 return plaintext;
}
async function upload(pool,{ownerId,kind,bytes,key}){
 if(!TYPES.has(kind))throw Error('Unknown credential type');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const b=await client.query('SELECT id FROM businesses WHERE owner_id=$1 FOR UPDATE',[ownerId]);
  if(!b.rowCount){await client.query('ROLLBACK');return false;}
  const businessId=b.rows[0].id;
  const doc=seal(bytes,key,businessId,kind);
  await client.query("INSERT INTO provider_verifications(business_id,kind,status,updated_at) VALUES($1,$2,'pending',now()) ON CONFLICT (business_id,kind) DO UPDATE SET status='pending',evidence_reference=NULL,review_note=NULL,reviewed_by=NULL,reviewed_at=NULL,expires_at=NULL,updated_at=now()",[businessId,kind]);
  await client.query("INSERT INTO provider_verification_documents(business_id,kind,mime,nonce,tag,ciphertext,size_bytes,uploaded_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (business_id,kind) DO UPDATE SET mime=EXCLUDED.mime,nonce=EXCLUDED.nonce,tag=EXCLUDED.tag,ciphertext=EXCLUDED.ciphertext,size_bytes=EXCLUDED.size_bytes,uploaded_at=now()",[businessId,kind,doc.mime,doc.nonce,doc.tag,doc.ciphertext,doc.size_bytes]);
  await client.query("INSERT INTO provider_verification_audit(business_id,kind,actor_user_id,action) VALUES($1,$2,$3,'upload')",[businessId,kind,ownerId]);
  await client.query('COMMIT');
  return {kind,status:'pending',mime:doc.mime,size_bytes:doc.size_bytes};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
function install(app,{pool,business,reviewer,safe,forbidden}){
 app.post('/api/provider-verification/document',...business,express.raw({type:'application/octet-stream',limit:'2mb'}),safe(async(req,res)=>{
  let key;
  try{key=getKey();}catch(e){return forbidden(res,'Secure document storage is not configured.',503);}
  const kind=String(req.get('x-evidence-kind')||'');
  if(!TYPES.has(kind)||!Buffer.isBuffer(req.body))return forbidden(res,'Submit PDF, PNG or JPEG bytes with a valid evidence kind.',400);
  let result;
  try{result=await upload(pool,{ownerId:req.user.id,kind,bytes:req.body,key});}
  catch(e){if(/^(File must|Only valid)/.test(e.message))return forbidden(res,e.message,400);throw e;}
  if(!result)return forbidden(res,'Business not found.',404);
  res.status(202).json({submission:result,note:'Encrypted evidence received for manual review, not verified.'});
 }));
 app.get('/api/provider-verification/review-document/:businessId/:kind',...reviewer,safe(async(req,res)=>{
  let key;
  try{key=getKey();}catch(e){return forbidden(res,'Secure document storage is not configured.',503);}
  const id=Number(req.params.businessId),kind=req.params.kind;
  if(!Number.isSafeInteger(id)||id<1||!TYPES.has(kind))return forbidden(res,'Invalid evidence request.',400);
  // Never serve files belonging to the current operator's business through the reviewer endpoint.
  const q=await pool.query("SELECT d.*,b.owner_id FROM provider_verification_documents d JOIN businesses b ON b.id=d.business_id WHERE d.business_id=$1 AND d.kind=$2 AND b.owner_id<>$3",[id,kind,req.user.id]);
  if(!q.rowCount)return forbidden(res,'Evidence unavailable.',404);
  const doc=q.rows[0];
  const bytes=open(doc,key,id,kind);
  await pool.query("INSERT INTO provider_verification_audit(business_id,kind,actor_user_id,action) VALUES($1,$2,$3,'download')",[id,kind,req.user.id]);
  const ext={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg'}[doc.mime];
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  res.set('Content-Security-Policy','sandbox');
  res.set('Content-Disposition','attachment; filename="routedrop-evidence-'+kind+'.'+ext+'"');
  res.type(doc.mime).send(bytes);
 }));
 app.delete('/api/provider-verification/document/:kind',...business,safe(async(req,res)=>{
  const kind=req.params.kind;
  if(!TYPES.has(kind))return forbidden(res,'Invalid credential type.',400);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const b=await client.query('SELECT id FROM businesses WHERE owner_id=$1 FOR UPDATE',[req.user.id]);
   if(!b.rowCount){await client.query('ROLLBACK');return forbidden(res,'Business not found.',404);}
   const id=b.rows[0].id;
   await client.query('DELETE FROM provider_verification_documents WHERE business_id=$1 AND kind=$2',[id,kind]);
   await client.query("UPDATE provider_verifications SET status='pending',evidence_reference=NULL,review_note=NULL,reviewed_by=NULL,reviewed_at=NULL,expires_at=NULL,updated_at=now() WHERE business_id=$1 AND kind=$2",[id,kind]);
   await client.query("INSERT INTO provider_verification_audit(business_id,kind,actor_user_id,action) VALUES($1,$2,$3,'removed')",[id,kind,req.user.id]);
   await client.query('COMMIT');
   res.json({ok:true,kind,status:'pending',note:'Evidence removed; any previous approval is no longer valid.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }));
}
module.exports={MAX_BYTES,getKey,sniff,seal,open,schema,upload,install};
