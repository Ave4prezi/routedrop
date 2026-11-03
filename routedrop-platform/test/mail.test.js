'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {providerReady,emailLink,isActionToken,notification,deliverEmail}=require('../mail');
const env={RESEND_API_KEY:'test_123',ROUTEDROP_EMAIL_FROM:'RouteDrop <notifications@routedrop.example>',PUBLIC_URL:'https://routedrop.example'};
test('email sender requires a verified-format address, API key and HTTPS public URL',()=>{
 assert.equal(providerReady({RESEND_API_KEY:'',ROUTEDROP_EMAIL_FROM:'notify@routedrop.example',PUBLIC_URL:'https://routedrop.example'}),false);
 assert.equal(providerReady({...env,ROUTEDROP_EMAIL_FROM:'RouteDrop <notifications@routedrop.example>'}),false);
 assert.equal(providerReady({...env,ROUTEDROP_EMAIL_FROM:'notifications@routedrop.example'}),true);
 assert.equal(providerReady({...env,ROUTEDROP_EMAIL_FROM:'notifications@routedrop.example',PUBLIC_URL:'http://routedrop.example'}),false);
});
test('account links encode opaque tokens and validate strict token shape',()=>{
 const token='a'.repeat(64);
 assert.equal(isActionToken(token),true);
 assert.equal(isActionToken('not-a-token'),false);
 assert.equal(emailLink('https://routedrop.example/','verify',token),'https://routedrop.example/?verify='+token);
});
test('notification templates scrub unsafe characters and include useful details',()=>{
 const msg=notification('booking_business',{title:'Windows\nService',name:'Client<>',date:'Nov 4',amount:'$25'});
 assert.equal(msg.subject,'RouteDrop: new paid booking');
 assert.match(msg.body,/Windows Service/);
 assert.doesNotMatch(msg.body,/[<>]/);
 assert.equal(notification('unknown',{}),null);
});
test('sender formats provider request without sending real email',async()=>{
 const req=[];
 const from={...env,ROUTEDROP_EMAIL_FROM:'notifications@routedrop.example'};
 await deliverEmail({to:'customer@example.com',subject:'RouteDrop test',text:'This is a test'},from,async(url,opts)=>{
  req.push({url,opts});return {ok:true};
 });
 assert.equal(req.length,1);
 assert.equal(req[0].url,'https://api.resend.com/emails');
 assert.deepEqual(JSON.parse(req[0].opts.body).to,['customer@example.com']);
 assert.equal(req[0].opts.headers.Authorization,'Bearer test_123');
});
