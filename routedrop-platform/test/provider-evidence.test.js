'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const express=require('express');
const evidence=require('../provider-evidence');
const verification=require('../provider-verification');

const keyB64=crypto.randomBytes(32).toString('base64');
const pdf=Buffer.from('%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24),Buffer.from('IEND'),Buffer.alloc(4)]);
const jpg=Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(25),Buffer.from([0xff,0xd9])]);
test('AES-256-GCM encrypted evidence integrity and business binding',()=>{
 const key=evidence.getKey(keyB64);
 for(const bytes of [pdf,png,jpg]){
  const sealed=evidence.seal(bytes,key,1,'identity');
  assert.notDeepEqual(sealed.ciphertext,bytes);
  assert.deepEqual(evidence.open(sealed,key,1,'identity'),bytes);
  assert.throws(()=>evidence.open(sealed,key,2,'identity'));
  assert.throws(()=>evidence.open(sealed,key,1,'auto_insurance'));
  assert.throws(()=>evidence.open(sealed,crypto.randomBytes(32),1,'identity'));
  assert.throws(()=>evidence.open({...sealed,ciphertext:Buffer.from(sealed.ciphertext).fill(0)},key,1,'identity'));
 }
 assert.throws(()=>evidence.getKey('weak-key'),/key unavailable/);
 assert.throws(()=>evidence.sniff(Buffer.alloc(100)),/Only valid/);
 assert.throws(()=>evidence.sniff(Buffer.alloc(evidence.MAX_BYTES+1)),/2 MB/);
 assert.throws(()=>evidence.sniff(Buffer.from('sensitive-data')),/24 bytes/);
});
test('upload, reviewer-only download, approval, replacement and deletion using disposable PostgreSQL', {
 skip:!process.env.ROUTEDROP_TEST_DATABASE_URL && 'requires disposable PostgreSQL'
},async()=>{
 const schema='routedrop_provider_evidence_ci';
 const admin=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 let db,server;
 process.env.ROUTEDROP_PROVIDER_DOC_KEY_B64=keyB64;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  db=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false,options:'-c search_path='+schema+',public',max:8});
  await db.query('CREATE TABLE users (id BIGINT PRIMARY KEY)');
  await db.query('CREATE TABLE businesses (id BIGINT PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES users(id),name TEXT,category TEXT)');
  await db.query('CREATE TABLE listings (id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL REFERENCES businesses(id),category TEXT)');
  await db.query('CREATE TABLE deferred_support_agents (user_id BIGINT PRIMARY KEY REFERENCES users(id))');
  for(const query of verification.schema)await db.query(query);
  await db.query('INSERT INTO users(id) VALUES(1),(2),(3)');
  await db.query("INSERT INTO businesses(id,owner_id,name,category) VALUES(1,1,'CI Example Cleaning','Cleaning'),(2,3,'CI Other','Photography')");
  await db.query("INSERT INTO listings(id,business_id,category) VALUES(20,1,'Cleaning')");
  await db.query('INSERT INTO deferred_support_agents(user_id) VALUES(2)');
  const app=express();
  app.use(express.json({limit:'16kb'}));
  const forbidden=(res,msg,code=400)=>res.status(code).json({error:msg});
  const requireUser=role=>(req,res,next)=>{
   const id=Number(req.get('x-ci-user'));
   req.user=id?{id,role:id===2?'customer':'business'}:null;
   if(!req.user||role&&req.user.role!==role)return forbidden(res,'Unauthorized.',403);
   next();
  };
  const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  verification.install(app,{pool:db,enabled:true,requireDb:(req,res,next)=>next(),requireUser,safe,forbidden});
  app.use((err,req,res,next)=>res.status(500).json({error:'test server error'}));
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function request(path,{user=1,method='GET',body,kind,contentType}={}){
   return fetch(base+path,{method,headers:{'x-ci-user':String(user),...(kind?{'x-evidence-kind':kind}:{}),...(contentType?{'content-type':contentType}:{})},body});
  }
  const upload=await request('/api/provider-verification/document',{user:1,method:'POST',body:pdf,kind:'identity',contentType:'application/octet-stream'});
  assert.equal(upload.status,202);assert.equal((await upload.json()).submission.status,'pending');
  const stored=(await db.query("SELECT ciphertext,nonce,tag FROM provider_verification_documents WHERE business_id=1 AND kind='identity'")).rows[0];
  assert.ok(stored);assert.equal(stored.ciphertext.includes(pdf),false);
  assert.equal((await request('/api/provider-verification/review-document/1/identity',{user:1})).status,403);
  assert.equal((await request('/api/provider-verification/review-document/1/identity',{user:3})).status,403);
  const download=await request('/api/provider-verification/review-document/1/identity',{user:2});
  assert.equal(download.status,200);
  assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.equal(download.headers.get('cache-control'),'no-store');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
  let r=await request('/api/provider-verification/review',{user:1,method:'POST',contentType:'application/json',body:JSON.stringify({businessId:1,kind:'identity',decision:'approved',note:'Identity matches submitted record'})});
  assert.equal(r.status,403);
  r=await request('/api/provider-verification/review',{user:2,method:'POST',contentType:'application/json',body:JSON.stringify({businessId:1,kind:'identity',decision:'approved',note:'Identity matches submitted record'})});
  assert.equal(r.status,200);
  assert.equal((await db.query("SELECT status FROM provider_verifications WHERE business_id=1 AND kind='identity'")).rows[0].status,'approved');
  // A new document must revoke the prior approval until reviewed again.
  r=await request('/api/provider-verification/document',{user:1,method:'POST',body:png,kind:'identity',contentType:'application/octet-stream'});
  assert.equal(r.status,202);
  assert.equal((await db.query("SELECT status FROM provider_verifications WHERE business_id=1 AND kind='identity'")).rows[0].status,'pending');
  r=await request('/api/provider-verification/document/identity',{user:1,method:'DELETE'});
  assert.equal(r.status,200);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM provider_verification_documents WHERE business_id=1 AND kind='identity'")).rows[0].count,0);
  r=await request('/api/provider-verification/review',{user:2,method:'POST',contentType:'application/json',body:JSON.stringify({businessId:1,kind:'identity',decision:'approved',note:'Attempt approval without evidence'})});
  assert.equal(r.status,403);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM provider_verification_audit WHERE business_id=1")).rows[0].count,5);
  assert.equal(await verification.eligibleListing(db,20),false);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)await db.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').catch(()=>{});
  await admin.end();
  delete process.env.ROUTEDROP_PROVIDER_DOC_KEY_B64;
 }
});
