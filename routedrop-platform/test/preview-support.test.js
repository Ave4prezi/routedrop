'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const support=require('../preview-support');
test('support tickets allow only known fictional categories and server-defined priority',()=>{
 assert.equal(support.validKind('security_concern'),true);
 assert.equal(support.validKind('privacy_deletion'),true);
 assert.equal(support.validKind('open_ended_text'),false);
 assert.equal(support.validKind({kind:'security_concern'}),false);
 assert.equal(support.PRIORITIES.security_concern,'P0');
 assert.equal(support.PRIORITIES.privacy_deletion,'P1');
 assert.equal(support.PRIORITIES.listing_issue,'P2');
});
test('support transitions keep simulated escalation and closure separate',()=>{
 assert.equal(support.referralForKind('security_concern'),'referred_security');
 assert.equal(support.referralForKind('privacy_access'),'referred_privacy');
 assert.equal(support.referralForKind('listing_issue'),'referred_operations');
 assert.equal(support.validateTransition('privacy_access','new','closed_test','simulated_resolution'),false);
 assert.equal(support.validateTransition('privacy_access','new','reviewing','review_started'),true);
 assert.equal(support.validateTransition('privacy_access','reviewing','escalated','referred_privacy'),true);
 assert.equal(support.validateTransition('security_concern','reviewing','escalated','referred_privacy'),false);
 assert.equal(support.validateTransition('listing_issue','reviewing','escalated','referred_operations'),true);
 assert.equal(support.validateTransition('privacy_deletion','escalated','reviewing','review_started'),true);
 assert.equal(support.validateTransition('privacy_deletion','reviewing','closed_test','simulated_resolution'),true);
 assert.equal(support.validateTransition('privacy_deletion','closed_test','reviewing','review_started'),false);
 assert.equal(support.validateTransition('security_concern','new','escalated','referred_security'),true);
});
test('only schema declarations are prepared; no live payment or email table changes',()=>{
 assert.ok(support.schema.length>=3);
 assert.ok(support.schema.every(q=>/^(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX)/.test(q)));
 assert.ok(support.schema.every(q=>!q.includes('payment_intent')&&!q.includes('stripe_')));
});
