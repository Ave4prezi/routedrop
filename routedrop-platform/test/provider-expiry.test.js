'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {windowFor,describe}=require('../provider-expiry');
const now=Date.parse('2026-11-15T12:00:00Z');
const days=n=>new Date(now+n*86400000).toISOString();
test('credential reminder windows are deterministic and urgency changes as deadlines approach',()=>{
 for(const [d,w] of [[31,null],[29,30],[15,30],[14,14],[8,14],[7,7],[2,7],[1,1],[0,0],[-1,0],[-31,null]]){
  assert.equal(windowFor(days(d),now),w,'day offset '+d);
 }
 assert.deepEqual(describe({kind:'auto_insurance',expires_at:days(7)},now),{
  kind:'auto_insurance',expiresAt:days(7),daysRemaining:7,severity:'urgent',windowDays:7
 });
 assert.equal(describe({kind:'professional_license',expires_at:days(-1)},now).severity,'expired');
});
