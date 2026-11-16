'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const identity=require('../identity-pilot');
const passkeys=require('../moderator-passkeys');
const {generateRegistrationOptions,generateAuthenticationOptions}=require('@simplewebauthn/server');
const Stripe=require('stripe');

test('identity tests require dedicated Stripe TEST key, signed webhook and explicit opt-in',()=>{
 const good={ROUTEDROP_IDENTITY_TEST_ENABLED:'true',ROUTEDROP_STRIPE_IDENTITY_TEST_KEY:'rk_test_only-for-unit-tests',ROUTEDROP_STRIPE_IDENTITY_WEBHOOK_SECRET:'whsec_unit_only_test_webhook_secret_012345'};
 assert.equal(identity.identityConfigured(good),true);
 assert.equal(identity.identityConfigured({...good,ROUTEDROP_STRIPE_IDENTITY_TEST_KEY:'sk_live_x'}),false);
 assert.equal(identity.identityConfigured({...good,ROUTEDROP_IDENTITY_TEST_ENABLED:'false'}),false);
 assert.equal(identity.identityConfigured({...good,ROUTEDROP_STRIPE_IDENTITY_WEBHOOK_SECRET:''}),false);
 const opts=identity.identitySessionParams(123,'https://pilot.example.test/');
 assert.equal(opts.type,'document');
 assert.equal(opts.options.document.require_matching_selfie,true);
 assert.deepEqual(Object.keys(opts.metadata),['routedrop_pilot_provider_id']);
 assert.ok(!JSON.stringify(opts).match(/dob|ssn|address|id_number|phone|email/i),'request never includes personal identity details');
 assert.equal(identity.identityPublicStatus('verified_test').identity_verified,false,'Stripe test event cannot make public verified badge');
 assert.equal(identity.identityPublicStatus('verified_test').real_provider_approved,false);
 assert.ok(identity.ddl.some(x=>x.includes('pilot_identity_webhook_events')));
 assert.ok(identity.ddl.every(x=>!x.includes('ALTER TABLE bookings')));
});
test('only matching non-live Stripe identity status events can change a provider outcome',()=>{
 const attempt={stripe_session_id:'vs_test_123',status:'requires_input'};
 const event={id:'evt_test_a',type:'identity.verification_session.verified',livemode:false,data:{object:{id:'vs_test_123',status:'verified',livemode:false}}};
 assert.equal(identity.eventOutcome(event,attempt),'verified_test');
 assert.equal(identity.eventOutcome({...event,livemode:true},attempt),null);
 assert.equal(identity.eventOutcome({...event,data:{object:{...event.data.object,livemode:true}}},attempt),null);
 assert.equal(identity.eventOutcome({...event,data:{object:{...event.data.object,id:'vs_different'}}},attempt),null);
 assert.equal(identity.eventOutcome({...event,data:{object:{...event.data.object,status:'processing'}}},attempt),null);
 assert.equal(identity.eventOutcome({...event,type:'payment_intent.succeeded'},attempt),null);
 assert.equal(identity.eventOutcome({...event,type:'identity.verification_session.requires_input',data:{object:{...event.data.object,status:'requires_input'}}},{...attempt,status:'verified_test'}),null,'no regression after successful verification');
});
test('moderator passkey configuration is HTTPS+strict same host and disabled unless activated',()=>{
 const base={ROUTEDROP_MODERATOR_PASSKEYS_ENABLED:'true',ROUTEDROP_WEBAUTHN_ORIGIN:'https://moderator.example.test',ROUTEDROP_WEBAUTHN_RP_ID:'moderator.example.test'};
 assert.ok(passkeys.config(base));
 assert.equal(passkeys.config({...base,ROUTEDROP_MODERATOR_PASSKEYS_ENABLED:'false'}),null);
 assert.equal(passkeys.config({...base,ROUTEDROP_WEBAUTHN_ORIGIN:'http://moderator.example.test'}),null);
 assert.equal(passkeys.config({...base,ROUTEDROP_WEBAUTHN_ORIGIN:'https://evil.example.test'}),null);
 assert.equal(passkeys.config({...base,ROUTEDROP_WEBAUTHN_ORIGIN:'https://moderator.example.test/path'}),null);
 assert.equal(passkeys.config({...base,ROUTEDROP_WEBAUTHN_RP_ID:'example.test'}),null);
 assert.ok(passkeys.ddl.some(x=>x.includes('pilot_moderator_stepup')));
 assert.ok(passkeys.ddl.some(x=>x.includes('REFERENCES sessions(token_hash)')));
});
test('fresh moderator status requires an actual signed-in session and short-lived DB authorization',async()=>{
 assert.equal(await passkeys.isFresh({query:()=>{throw Error('must not query');}},{cookies:{},user:{id:3}}),false);
 let seen;const fake={query:async(s,a)=>{seen={s,a};return {rowCount:1};}};
 const req={user:{id:9},cookies:{'__Host-rd_session':'a'.repeat(64)}};
 assert.equal(await passkeys.isFresh(fake,req),true);
 assert.match(seen.s,/expires_at>now\(\)/);
 assert.equal(seen.a[1],9);
 assert.equal(seen.a[0].length,64);
});
test('WebAuthn library generates signed proof challenges with required user verification',async()=>{
 const options=await generateRegistrationOptions({rpName:'RouteDrop Pilot',rpID:'moderator.example.test',userName:'mod@example.test',userID:new Uint8Array(32),authenticatorSelection:{userVerification:'required'},supportedAlgorithmIDs:[-7,-257]});
 assert.ok(options.challenge.length>20);
 assert.equal(options.rp.id,'moderator.example.test');
 assert.equal(options.authenticatorSelection.userVerification,'required');
 const auth=await generateAuthenticationOptions({rpID:'moderator.example.test',userVerification:'required'});
 assert.ok(auth.challenge.length>20);
 assert.equal(auth.userVerification,'required');
 assert.notEqual(options.challenge,auth.challenge);
});

test('Stripe Identity webhooks reject a forged signature and accept a valid test signature',()=>{
 const stripe=new Stripe('sk_test_fictional_unit_only');
 const secret='whsec_fictional_for_unit_signature_12345678';
 const payload=JSON.stringify({id:'evt_test_unit',type:'identity.verification_session.verified',livemode:false,data:{object:{id:'vs_test_unit',livemode:false,status:'verified'}}});
 const signature=stripe.webhooks.generateTestHeaderString({payload,secret,timestamp:Math.floor(Date.now()/1000)});
 const event=stripe.webhooks.constructEvent(payload,signature,secret);
 assert.equal(event.type,'identity.verification_session.verified');
 assert.equal(identity.eventOutcome(event,{stripe_session_id:'vs_test_unit',status:'processing'}),'verified_test');
 assert.throws(()=>stripe.webhooks.constructEvent(payload,signature,'whsec_wrong_key_1234567890'),/signature/i);
 assert.throws(()=>stripe.webhooks.constructEvent(payload.replace('verified','requires_input'),signature,secret),/signature/i);
});
