'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createStagingGate}=require('../staging-access');
function run({enabled,password,path='/',authorization=''}) {
 const output={statusCode:200,called:false,header:null,body:null};
 const req={path,get(key){return key==='authorization'?authorization:null;}};
 const res={status(code){output.statusCode=code;return this;},send(body){output.body=body;return this;},set(key,value){if(key==='WWW-Authenticate')output.header=value;return this;}};
 createStagingGate({enabled,password})(req,res,()=>{output.called=true;});
 return output;
}
const password='a-very-long-staging-only-secret-value';
const auth='Basic '+Buffer.from('routedrop-staging:'+password).toString('base64');
test('staging access is inert when disabled on live service',()=>{
 assert.equal(run({enabled:false,password:''}).called,true);
});
test('staging access fails closed without strong configured password',()=>{
 assert.equal(run({enabled:true,password:''}).statusCode,503);
 assert.equal(run({enabled:true,password:'short'}).statusCode,503);
});
test('staging is password protected, and accepts only the correct credential',()=>{
 assert.equal(run({enabled:true,password}).statusCode,401);
 assert.equal(run({enabled:true,password,authorization:'Basic '+Buffer.from('routedrop-staging:incorrect').toString('base64')}).statusCode,401);
 assert.equal(run({enabled:true,password,authorization:auth}).called,true);
});
test('health endpoint and signed Stripe webhook remain reachable by Render and Stripe',()=>{
 assert.equal(run({enabled:true,password,path:'/health'}).called,true);
 assert.equal(run({enabled:true,password,path:'/api/stripe/webhook'}).called,true);
 assert.equal(run({enabled:true,password,path:'/api/checkout'}).statusCode,401);
});

test('browser sign-in protects the preview and leaves health and raw webhooks reachable',async(t)=>{
 const app=require('express')();
 app.use(require('cookie-parser')());
 require('../staging-access').mountStagingSignIn(app,{enabled:true,password});
 app.get('/',(_req,res)=>res.send('authenticated preview'));
 app.get('/health',(_req,res)=>res.send('ready'));
 app.post('/api/stripe/webhook',require('express').raw({type:'application/json'}),(req,res)=>res.send(req.body));
 const server=app.listen(0);
 t.after(()=>server.close());
 const url='http://localhost:'+server.address().port;
 const request=(path,options)=>fetch(url+path,{redirect:'manual',...options});

 assert.equal((await request('/')).headers.get('location'),'/preview-sign-in');
 const page=await request('/preview-sign-in');
 const formCookie=page.headers.get('set-cookie');
 assert.ok(formCookie.split('; ').includes('SameSite=Strict'));
 const cookie=formCookie.split(';')[0];
 const token=(await page.text()).match(/name="formToken" value="([^"]+)/)[1];
 const login=(site,secret=password)=>request('/preview-sign-in',{
  method:'POST',headers:{cookie,'sec-fetch-site':site},
  body:new URLSearchParams({username:'routedrop-staging',password:secret,formToken:token})
 });
 assert.equal((await login('cross-site')).status,403);
 assert.equal((await login('same-origin','incorrect')).status,401);
 const accepted=await login('same-origin');
 assert.equal(accepted.status,303);
 const session=accepted.headers.getSetCookie().find(value=>value.startsWith('__Host-rd_preview='));
 for(const flag of ['Secure','HttpOnly','SameSite=Lax'])assert.ok(session.split('; ').includes(flag));
 assert.equal(await (await request('/',{headers:{cookie:session.split(';')[0]}})).text(),'authenticated preview');
 assert.equal(await (await request('/health')).text(),'ready');
 const payload='{"test":true}';
 const webhook=await request('/api/stripe/webhook',{method:'POST',headers:{'content-type':'application/json'},body:payload});
 assert.equal(await webhook.text(),payload);
});
