'use strict';
(function(root){
 const bytes=x=>Uint8Array.from(atob(String(x).replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-String(x).length%4)%4)),c=>c.charCodeAt(0));
 const base64=x=>btoa(String.fromCharCode(...new Uint8Array(x))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 function ensureAvailable(){
  if(!root.isSecureContext||!root.PublicKeyCredential||!navigator.credentials)throw Error('Passkeys require a secure HTTPS browser with WebAuthn support.');
 }
 function toJSON(credential){
  if(typeof credential.toJSON==='function')return credential.toJSON();
  const response=credential.response,registration=!!response.attestationObject;
  return {id:credential.id,rawId:base64(credential.rawId),type:credential.type,authenticatorAttachment:credential.authenticatorAttachment||undefined,
   clientExtensionResults:credential.getClientExtensionResults(),response:registration?{
    clientDataJSON:base64(response.clientDataJSON),attestationObject:base64(response.attestationObject),
    transports:response.getTransports?.()||[]
   }:{
    clientDataJSON:base64(response.clientDataJSON),authenticatorData:base64(response.authenticatorData),
    signature:base64(response.signature),userHandle:response.userHandle?base64(response.userHandle):undefined
   }};
 }
 async function enroll(api,key){
  ensureAvailable();
  const headers={'x-routedrop-moderator-key':key};
  const data=await api('/api/pilot/moderator/passkeys/register/options',{method:'POST',headers,body:'{}'});
  const publicKey={...data,challenge:bytes(data.challenge),user:{...data.user,id:bytes(data.user.id)},
   excludeCredentials:(data.excludeCredentials||[]).map(x=>({...x,id:bytes(x.id)}))};
  const credential=await navigator.credentials.create({publicKey});
  if(!credential)throw Error('The authenticator did not create a passkey.');
  return api('/api/pilot/moderator/passkeys/register/verify',{method:'POST',headers,body:JSON.stringify(toJSON(credential))});
 }
 async function authenticate(api,key){
  ensureAvailable();
  const headers={'x-routedrop-moderator-key':key};
  const data=await api('/api/pilot/moderator/passkeys/authenticate/options',{method:'POST',headers,body:'{}'});
  const publicKey={...data,challenge:bytes(data.challenge),allowCredentials:(data.allowCredentials||[]).map(x=>({...x,id:bytes(x.id)}))};
  const credential=await navigator.credentials.get({publicKey});
  if(!credential)throw Error('Your authenticator did not authenticate.');
  return api('/api/pilot/moderator/passkeys/authenticate/verify',{method:'POST',headers,body:JSON.stringify(toJSON(credential))});
 }
 root.RouteDropPasskeys=Object.freeze({enroll,authenticate});
})(window);
