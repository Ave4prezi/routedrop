'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),net=require('node:net'),{once}=require('node:events'),path=require('node:path');
test('prospect credentials unlock only a no-database demo and cannot create accounts or charges',async()=>{
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const base='http://127.0.0.1:'+port,secret='isolated-http-test-fixture-not-real';
 const env={...process.env,PORT:String(port),NODE_ENV:'test',ROUTEDROP_PROSPECT_DEMO:'true',ROUTEDROP_WORKFLOW_PILOT:'true',ROUTEDROP_PREVIEW_USERNAME:'sam-demo',ROUTEDROP_PREVIEW_ACCESS_PASSWORD:secret,DATABASE_URL:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',ROUTEDROP_STRIPE_IDENTITY_TEST_KEY:'',ROUTEDROP_STRIPE_IDENTITY_WEBHOOK_SECRET:'',ROUTEDROP_MODERATION_TOKEN:'',RESEND_API_KEY:'',ROUTEDROP_LIVE_APPROVED:'false',ROUTEDROP_IDENTITY_TEST_ENABLED:'false',ROUTEDROP_MODERATOR_PASSKEYS_ENABLED:'false',ROUTEDROP_MODERATOR_ENROLLMENT_ENABLED:'false'};
 const app=spawn(process.execPath,[path.join(__dirname,'../server.js')],{env,stdio:['ignore','ignore','ignore']});
 try{
  let form;for(let n=0;n<100;n++){try{form=await fetch(base+'/preview-sign-in');if(form.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(form?.ok,'demo starts');
  const html=await form.text();assert.match(html,/RouteDrop Private Demo/);const token=html.match(/name="formToken" value="([a-f0-9]+)"/)[1];
  assert.equal((await fetch(base+'/',{redirect:'manual'})).status,303);
  assert.equal((await fetch(base+'/api/config')).status,401);
  const gateCookie='__Host-rd_preview_form='+token;
  const signIn=await fetch(base+'/preview-sign-in',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',cookie:gateCookie},body:new URLSearchParams({username:'sam-demo',password:secret,formToken:token})});
  assert.equal(signIn.status,303);const session=signIn.headers.getSetCookie().find(x=>x.startsWith('__Host-rd_preview=')).split(';')[0];assert.ok(session);
  const configResp=await fetch(base+'/api/config',{headers:{cookie:session}});assert.equal(configResp.status,200);const config=await configResp.json();
  assert.equal(config.prospect_demo,true);for(const field of ['database','payments','email_enabled','identity_test_available','moderation_available'])assert.equal(config[field],false,field);
  const csrfCookie=configResp.headers.getSetCookie().find(x=>x.startsWith('routedrop_csrf=')).split(';')[0];const csrf=csrfCookie.split('=')[1];
  for(const route of ['/api/register','/api/checkout','/api/stripe/connect']){const r=await fetch(base+route,{method:'POST',headers:{cookie:session+'; '+csrfCookie,origin:base,'content-type':'application/json','x-csrf-token':csrf},body:'{}'});assert.equal(r.status,503,route+' cannot persist or charge');}
  const wrongAuth='Basic '+Buffer.from('routedrop-preview:'+secret).toString('base64');assert.equal((await fetch(base+'/api/config',{headers:{authorization:wrongAuth}})).status,401,'other preview username rejected');
 }finally{app.kill('SIGTERM');await once(app,'exit');}
});
