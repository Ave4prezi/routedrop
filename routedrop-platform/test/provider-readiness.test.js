'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/provider-readiness.js'),'utf8'),scope,{filename:'provider-readiness.js'});
const view=scope.window.RouteDropReadiness.providerChecklist;
const me={user:{email_verified:false},business:{id:9,name:'Fictional Test Provider'}};
const config={unified_pilot:true,identity_test_available:false};

test('private provider checklist never appears for visitors or non-providers',()=>{
 assert.equal(view(null,null,null,config),'');
 assert.equal(view({user:{email_verified:true}},null,null,config),'');
 assert.equal(view(me,null,null,{unified_pilot:false}),'');
});

test('provider onboarding proceeds safely while Stripe Identity API access is pending',()=>{
 const html=view(me,{screening:{pilot_screening_status:'pending'}},{available:false,status:'not_started'},config);
 assert.match(html,/Your provider setup checklist/);
 assert.match(html,/Not verified · required for Stripe test flow/);
 assert.match(html,/Awaiting test review/);
 assert.match(html,/Awaiting secure Stripe TEST connection/);
 assert.match(html,/Disabled · no charges or payouts/);
 assert.match(html,/data-tab="safety"/);
 assert.doesNotMatch(html,/data-action="identity-start"/);
 assert.doesNotMatch(html,/identity_verified.*true|Verified provider badge/i);
});

test('simulated Stripe test completion is never shown as real provider approval',()=>{
 const html=view({user:{email_verified:true},business:{id:9}},
  {screening:{pilot_screening_status:'test_reviewed'}},
  {available:true,status:'verified_test'},
  {...config,identity_test_available:true});
 assert.match(html,/Stripe TEST simulation complete · not a real ID check/);
 assert.match(html,/Reviewed for fictional pilot only/);
 assert.match(html,/not create a verified badge, real provider approval/);
 assert.match(html,/Verified in RouteDrop/);
 assert.match(html,/no charges or payouts/);
});

test('status output fails closed and never injects untrusted server status text',()=>{
 const injected='<img src=x onerror=alert(1)>';
 const html=view(me,{screening:{pilot_screening_status:injected}},
  {available:true,status:injected},{...config,identity_test_available:true});
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/Unknown pilot status/);
 assert.match(html,/Test flow not started/);
});
