'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const verification=require('../provider-verification');
const evidence=require('../provider-evidence');
const maintenance=require('../provider-document-maintenance');
const pdf=Buffer.from('%PDF-1.6\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
test('isolated PostgreSQL evidence key rotation, retention and audit counts', {
 skip:!process.env.ROUTEDROP_TEST_DATABASE_URL&&'requires disposable PostgreSQL'
},async()=>{
 const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 const schema='routedrop_evidence_maintenance_ci';let db;
 const oldKey=crypto.randomBytes(32),newKey=crypto.randomBytes(32);
 try{
  await admin.query('CREATE SCHEMA '+schema);
  db=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false,options:'-c search_path='+schema+',public'});
  await db.query('CREATE TABLE users (id BIGINT PRIMARY KEY)');
  await db.query('CREATE TABLE businesses (id BIGINT PRIMARY KEY,owner_id BIGINT REFERENCES users(id))');
  await db.query('CREATE TABLE listings (id BIGINT PRIMARY KEY,business_id BIGINT REFERENCES businesses(id))');
  for(const statement of verification.schema)await db.query(statement);
  await db.query('INSERT INTO users(id) VALUES(1),(2)');
  await db.query('INSERT INTO businesses(id,owner_id) VALUES(1,1)');
  assert.equal((await evidence.upload(db,{ownerId:1,kind:'identity',bytes:pdf,key:oldKey,keyId:'v1'})).status,'pending');
  const ring={active:'v2',keys:{v1:oldKey,v2:newKey}};
  assert.deepEqual(await maintenance.rotateEvidence(db,ring),{rotated:1});
  assert.deepEqual(await maintenance.rotateEvidence(db,ring),{rotated:0});
  const doc=(await db.query('SELECT * FROM provider_verification_documents')).rows[0];
  assert.equal(doc.key_id,'v2');
  assert.deepEqual(evidence.open(doc,newKey,1,'identity'),pdf);
  assert.throws(()=>evidence.open(doc,oldKey,1,'identity'));
  await db.query("UPDATE provider_verification_documents SET uploaded_at=now()-interval '45 days'");
  assert.deepEqual(await maintenance.pruneEvidence(db,{days:30}),{pruned:1});
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM provider_verification_documents')).rows[0].n,0);
  assert.equal((await db.query('SELECT status FROM provider_verifications')).rows[0].status,'rejected');
  const events=(await db.query('SELECT operation,items_affected FROM provider_document_maintenance_log ORDER BY id')).rows;
  assert.deepEqual(events.map(x=>x.operation),['key_rotation','retention_cleanup']);
  assert.deepEqual(await maintenance.pruneEvidence(db,{days:30}),{pruned:0});
  await assert.rejects(maintenance.pruneEvidence(db,{days:1}),/Unsafe retention window/);
 }finally{
  if(db)await db.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  await admin.end();
 }
});
