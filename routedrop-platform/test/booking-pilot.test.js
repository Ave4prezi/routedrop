'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ddl,nextState,statuses}=require('../booking-pilot');
test('isolated pilot schema is distinct from legacy paid bookings',()=>{
 assert.ok(ddl.some(x=>x.includes('CREATE TABLE IF NOT EXISTS service_requests')));
 assert.ok(ddl.some(x=>x.includes('one_open_pilot_request_per_slot')));
 assert.ok(!ddl.some(x=>x.includes('ALTER TABLE bookings')));
 assert.deepEqual(statuses,['requested','accepted','completed','confirmed','declined','canceled','issue_reported']);
});
test('customers can cancel and acknowledge work but cannot self-accept',()=>{
 assert.equal(nextState('customer','requested','cancel'),'canceled');
 assert.equal(nextState('customer','accepted','cancel'),'canceled');
 assert.equal(nextState('customer','completed','confirm'),'confirmed');
 assert.equal(nextState('customer','completed','report'),'issue_reported');
 assert.equal(nextState('customer','requested','accept'),null);
 assert.equal(nextState('customer','accepted','confirm'),null);
});
test('businesses can accept, decline and complete only in order',()=>{
 assert.equal(nextState('business','requested','accept'),'accepted');
 assert.equal(nextState('business','requested','decline'),'declined');
 assert.equal(nextState('business','accepted','complete'),'completed');
 for(const from of ['confirmed','declined','canceled','issue_reported'])for(const action of ['confirm','complete','cancel','accept'])assert.equal(nextState('business',from,action),null);
 assert.equal(nextState('business','completed','complete'),null);
 assert.equal(nextState('admin','requested','accept'),null);
});
