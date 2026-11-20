'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prospectDemoConfig}=require('../prospect-demo');
const demo=()=>({ROUTEDROP_PROSPECT_DEMO:'true',ROUTEDROP_WORKFLOW_PILOT:'true',ROUTEDROP_PREVIEW_USERNAME:'sam-demo',ROUTEDROP_PREVIEW_ACCESS_PASSWORD:'isolated-test-fixture-not-a-real-credential'});
test('prospect demo is opt-in and preserves existing preview usernames',()=>{
 assert.deepEqual(prospectDemoConfig({}),{enabled:false,username:'routedrop-preview'});
 assert.deepEqual(prospectDemoConfig(demo()),{enabled:true,username:'sam-demo'});
 assert.throws(()=>prospectDemoConfig({...demo(),ROUTEDROP_PREVIEW_USERNAME:'<script>'}));
});
test('prospect demo refuses persistence, payments, notifications and privileged integrations',()=>{
 for(const key of ['DATABASE_URL','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','ROUTEDROP_STRIPE_IDENTITY_TEST_KEY','ROUTEDROP_STRIPE_IDENTITY_WEBHOOK_SECRET','ROUTEDROP_MODERATION_TOKEN','RESEND_API_KEY'])assert.throws(()=>prospectDemoConfig({...demo(),[key]:'test'}),key);
 for(const key of ['ROUTEDROP_LIVE_APPROVED','ROUTEDROP_IDENTITY_TEST_ENABLED','ROUTEDROP_MODERATOR_PASSKEYS_ENABLED','ROUTEDROP_MODERATOR_ENROLLMENT_ENABLED'])assert.throws(()=>prospectDemoConfig({...demo(),[key]:'true'}),key);
 assert.throws(()=>prospectDemoConfig({...demo(),ROUTEDROP_WORKFLOW_PILOT:'false'}));
 assert.throws(()=>prospectDemoConfig({...demo(),ROUTEDROP_PREVIEW_ACCESS_PASSWORD:''}));
});
