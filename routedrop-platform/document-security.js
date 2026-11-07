'use strict';
// Fail-closed malware scanning for REAL provider documents. Requires private ClamAV
// daemon access. Synthetic-only private previews can skip scanning, but are NOT
// approved for collecting actual identity or insurance documents.
const net=require('node:net');
const EICAR='X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
function syntheticOnly(env=process.env){
 return env.ROUTEDROP_PRIVATE_PREVIEW_ONLY==='true' &&
        env.ROUTEDROP_STAGING_LOCK==='true' &&
        env.ROUTEDROP_PROVIDER_DOCS_MODE==='synthetic' &&
        !env.STRIPE_SECRET_KEY;
}
function inspect(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>2*1024*1024)
  throw Error('Invalid document length');
 // These checks are defense in depth, NOT a replacement for antivirus scanning.
 if(bytes.includes(Buffer.from(EICAR)))throw Error('Malware test signature rejected');
 const sample=bytes.toString('latin1');
 if(sample.startsWith('%PDF-')&&/\/(?:JavaScript|JS|OpenAction|Launch|EmbeddedFile|RichMedia|AA)\b/i.test(sample))
  throw Error('Active PDF content is not supported');
}
function scanWithClamAV(bytes,{host,port,timeoutMs=5000}={}){
 if(!host||!Number.isInteger(port)||port<1||port>65535)throw Error('Malware scanner unavailable');
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection({host,port});
  let reply='',settled=false;
  function complete(err){
   if(settled)return; settled=true;socket.destroy();
   err?reject(err):resolve(true);
  }
  socket.setTimeout(timeoutMs,()=>complete(Error('Malware scanner timed out')));
  socket.on('error',()=>complete(Error('Malware scanner unavailable')));
  socket.on('data',chunk=>{
   reply+=chunk.toString('utf8');
   if(reply.length>1024)return complete(Error('Invalid malware scanner response'));
   if(reply.includes('\0')||reply.includes('\n')){
    if(/^stream: OK[\r\n\0]*$/.test(reply))complete();
    else complete(Error('Malware scanner rejected the document'));
   }
  });
  socket.on('end',()=>complete(Error('Malware scanner ended without a valid OK')));
  socket.on('connect',()=>{
   const header=Buffer.alloc(4);
   header.writeUInt32BE(bytes.length,0);
   socket.write(Buffer.from('zINSTREAM\0'));
   socket.write(header);socket.write(bytes);
   socket.end(Buffer.alloc(4));
  });
 });
}
async function verifyUpload(bytes,env=process.env){
 inspect(bytes);
 if(syntheticOnly(env))return {synthetic:true,scanned:false};
 if(env.ROUTEDROP_PROVIDER_DOC_SCAN_REQUIRED!=='true')
  throw Error('Real document intake disabled until malware scanner is required');
 await scanWithClamAV(bytes,{host:env.ROUTEDROP_DOC_SCAN_HOST,port:Number(env.ROUTEDROP_DOC_SCAN_PORT||3310)});
 return {synthetic:false,scanned:true};
}
module.exports={EICAR,syntheticOnly,inspect,scanWithClamAV,verifyUpload};
