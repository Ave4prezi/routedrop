'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ddl,CATEGORIES,JOB_CATEGORIES,validProfile,validWeekly}=require('../unified-pilot');

test('unified profile and recurring schema remain payment-isolated',()=>{
 assert.ok(ddl.some(x=>x.includes('pilot_service_profiles')));
 assert.ok(ddl.some(x=>x.includes('pilot_weekly_rules')));
 assert.ok(ddl.some(x=>x.includes('pilot_job_seekers')));
 assert.ok(ddl.some(x=>x.includes('pilot_rule_slot_once')));
 assert.ok(ddl.every(x=>!x.includes('ALTER TABLE bookings')));
});
test('permanent profile requires bounded fictional service details',()=>{
 const value={title:'Weekend lawn mowing',category:'Lawn care',neighborhood:'Southeast Decatur',description:'Sample recurring mowing service that includes edging, with no real work.',priceCents:4500,durationMinutes:60};
 assert.ok(validProfile(value));
 for(const candidate of [{...value,description:'Short'},{...value,category:'Unverified licensed activity'},{...value,priceCents:100},{...value,neighborhood:'x'},{...value,durationMinutes:9},{...value,title:'a'.repeat(121)}]){
  assert.equal(validProfile(candidate),null);
 }
 assert.ok(CATEGORIES.includes('Other'));
});
test('weekly opening uses a strict Central-local HH:MM and weekday',()=>{
 assert.deepEqual(validWeekly({dayOfWeek:0,localTime:'09:30'}),{day:0,time:'09:30'});
 assert.deepEqual(validWeekly({dayOfWeek:'6',localTime:'23:59'}),{day:6,time:'23:59'});
 for(const v of [{dayOfWeek:-1,localTime:'09:30'},{dayOfWeek:7,localTime:'09:30'},{dayOfWeek:1,localTime:'24:00'},{dayOfWeek:3,localTime:'9:00'},{dayOfWeek:3,localTime:'09:00Z'}])assert.equal(validWeekly(v),null);
 assert.ok(JOB_CATEGORIES.includes('All industries'));
});
