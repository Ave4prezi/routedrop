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
