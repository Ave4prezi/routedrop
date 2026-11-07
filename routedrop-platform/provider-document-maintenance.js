'use strict';
// Explicit administrative maintenance only. Never runs on a schedule or via HTTP.
// The caller must supply a restricted DB pool and a complete encryption keyring.
const evidence=require('./provider-evidence');
async function rotateEvidence(pool,keyring,{limit=100}={}){
 if(!keyring?.active||!keyring.keys?.[keyring.active])throw Error('Active key missing');
 if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('Unsafe rotation batch size');
 let rotated=0;
 for(;;){
  const c=await pool.connect();
  let n=0;
  try{
   await c.query('BEGIN');
   const q=await c.query('SELECT business_id,kind,mime,nonce,tag,ciphertext,size_bytes,key_id FROM provider_verification_documents WHERE key_id<>$1 ORDER BY business_id,kind LIMIT $2 FOR UPDATE',[keyring.active,limit]);
   for(const row of q.rows){
    const previous=keyring.keys[row.key_id];
    if(!previous)throw Error('Missing previous document encryption key');
    const original=evidence.open(row,previous,row.business_id,row.kind);
    const next=evidence.seal(original,keyring.keys[keyring.active],row.business_id,row.kind);
    await c.query('UPDATE provider_verification_documents SET mime=$3,nonce=$4,tag=$5,ciphertext=$6,size_bytes=$7,key_id=$8 WHERE business_id=$1 AND kind=$2',
     [row.business_id,row.kind,next.mime,next.nonce,next.tag,next.ciphertext,next.size_bytes,keyring.active]);
    n++;
   }
   if(n)await c.query("INSERT INTO provider_document_maintenance_log(operation,items_affected) VALUES('key_rotation',$1)",[n]);
   await c.query('COMMIT');
  }catch(err){await c.query('ROLLBACK').catch(()=>{});throw err}finally{c.release()}
  rotated+=n;if(n<limit)break;
 }
 return {rotated};
}
async function pruneEvidence(pool,{days=30}={}){
 if(!Number.isInteger(days)||days<7||days>365)throw Error('Unsafe retention window');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const q=await c.query(
   "SELECT d.business_id,d.kind FROM provider_verification_documents d JOIN provider_verifications v ON v.business_id=d.business_id AND v.kind=d.kind WHERE ((v.status IN ('pending','rejected') AND d.uploaded_at<now()-($1::int * interval '1 day')) OR (v.status='approved' AND v.expires_at IS NOT NULL AND v.expires_at<now()-($1::int * interval '1 day'))) FOR UPDATE OF d,v",[days]);
  for(const r of q.rows){
   await c.query('DELETE FROM provider_verification_documents WHERE business_id=$1 AND kind=$2',[r.business_id,r.kind]);
   await c.query("UPDATE provider_verifications SET status='rejected',review_note='Evidence retention expired; resubmit for review',expires_at=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now() WHERE business_id=$1 AND kind=$2",[r.business_id,r.kind]);
  }
  if(q.rowCount)await c.query("INSERT INTO provider_document_maintenance_log(operation,items_affected) VALUES('retention_cleanup',$1)",[q.rowCount]);
  await c.query('COMMIT');
  return {pruned:q.rowCount};
 }catch(err){await c.query('ROLLBACK').catch(()=>{});throw err}finally{c.release()}
}
module.exports={rotateEvidence,pruneEvidence};
