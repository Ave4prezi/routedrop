'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const net=require('node:net');
const security=require('../document-security');
const evidence=require('../provider-evidence');
const pdf=Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
test('real documents fail closed without an authenticated malware scanner',async()=>{
 await assert.rejects(security.verifyUpload(pdf,{}),/Real document intake disabled/);
 await assert.rejects(security.verifyUpload(pdf,{ROUTEDROP_PROVIDER_DOC_SCAN_REQUIRED:'true'}),/Malware scanner unavailable/);
 assert.deepEqual(await security.verifyUpload(pdf,{
  ROUTEDROP_PRIVATE_PREVIEW_ONLY:'true',
  ROUTEDROP_STAGING_LOCK:'true',
  ROUTEDROP_PROVIDER_DOCS_MODE:'synthetic'
 }),{synthetic:true,scanned:false});
 await assert.rejects(security.verifyUpload(pdf,{
  ROUTEDROP_PRIVATE_PREVIEW_ONLY:'true',
  ROUTEDROP_STAGING_LOCK:'false',
  ROUTEDROP_PROVIDER_DOCS_MODE:'synthetic'
 }),/Real document intake disabled/);
});
test('reject EICAR signature, active PDF actions, and invalid file lengths',()=>{
 const virus=Buffer.concat([pdf,Buffer.from(security.EICAR)]);
 assert.throws(()=>security.inspect(virus),/Malware test signature rejected/);
 const active=Buffer.from('%PDF-1.6\n/JavaScript /OpenAction\n%%EOF\n');
 assert.throws(()=>security.inspect(active),/Active PDF/);
 assert.throws(()=>security.inspect(Buffer.alloc(2)),/Invalid document length/);
});
test('test ClamAV INSTREAM socket protocol and fail closed on detection',async()=>{
 let readLength=0;
 const sockets=new Set();
 const scanner=net.createServer({allowHalfOpen:true},socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
  const chunks=[];
  socket.on('data',part=>chunks.push(part));
  socket.on('end',()=>{
   const buffer=Buffer.concat(chunks);
   assert.equal(buffer.subarray(0,10).toString('latin1'),'zINSTREAM\0');
   assert.equal(buffer.readUInt32BE(10),pdf.length);
   assert.deepEqual(buffer.subarray(14,14+pdf.length),pdf);
   readLength=buffer.length;
   socket.end(Buffer.concat([Buffer.from('stream: OK'),Buffer.from([0])]));
  });
 });
 await new Promise(resolve=>scanner.listen(0,'127.0.0.1',resolve));
 try{
  assert.equal(await security.scanWithClamAV(pdf,{host:'127.0.0.1',port:scanner.address().port,timeoutMs:2500}),true);
  assert.equal(readLength,18+pdf.length);
  assert.deepEqual(await security.verifyUpload(pdf,{
   ROUTEDROP_PROVIDER_DOC_SCAN_REQUIRED:'true',
   ROUTEDROP_DOC_SCAN_HOST:'127.0.0.1',
   ROUTEDROP_DOC_SCAN_PORT:String(scanner.address().port)
  }),{synthetic:false,scanned:true});
 }finally{
  for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>scanner.close(resolve));
 }
 const rejectSockets=new Set();
 const rejector=net.createServer({allowHalfOpen:true},socket=>{rejectSockets.add(socket);socket.on('close',()=>rejectSockets.delete(socket));socket.on('end',()=>socket.end(Buffer.concat([Buffer.from('stream: Eicar-Test-Signature FOUND'),Buffer.from([10])])));});
 await new Promise(resolve=>rejector.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(security.scanWithClamAV(pdf,{host:'127.0.0.1',port:rejector.address().port}),/rejected/);}
 finally{for(const socket of rejectSockets)socket.destroy();await new Promise(resolve=>rejector.close(resolve));}
});
test('keyring keeps old encryption keys for decryption and chooses active new key',()=>{
 const old=crypto.randomBytes(32),next=crypto.randomBytes(32);
 const env={
  ROUTEDROP_PROVIDER_DOC_KEYS_JSON:JSON.stringify({v1:old.toString('base64'),v2:next.toString('base64')}),
  ROUTEDROP_PROVIDER_DOC_ACTIVE_KEY_ID:'v2'
 };
 const ring=evidence.loadKeyring(env);
 assert.equal(ring.active,'v2');
 const stored=evidence.seal(pdf,ring.keys.v1,'100','identity');
 assert.deepEqual(evidence.open(stored,ring.keys.v1,'100','identity'),pdf);
 assert.throws(()=>evidence.open(stored,ring.keys.v2,'100','identity'));
 const newer=evidence.seal(pdf,ring.keys.v2,'100','identity');
 assert.deepEqual(evidence.open(newer,ring.keys.v2,'100','identity'),pdf);
 assert.throws(()=>evidence.loadKeyring({...env,ROUTEDROP_PROVIDER_DOC_ACTIVE_KEY_ID:'unknown'}),/Active document key missing/);
});
