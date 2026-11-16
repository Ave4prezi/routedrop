'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const roles=require('../operator-access');
test('operator grants only accept fictional accounts, distinct admin, valid role and short lifetime',()=>{
 assert.equal(roles.fictionalEmail('synthetic-reviewer@ci.invalid'),true);
 assert.equal(roles.fictionalEmail('real-admin@gmail.com'),false);
 const base={action:'grant',actorEmail:'admin@ci.invalid',targetEmail:'reviewer@ci.invalid',
  role:'credential_reviewer',reason:'Approved fictional preview reviewer access',
  expiresAt:new Date(Date.now()+30*86400000).toISOString()};
 assert.equal(roles.validated(base).role,'credential_reviewer');
 for(const change of [
  {...base,targetEmail:base.actorEmail},
  {...base,targetEmail:'real@example.com'},
  {...base,actorEmail:'real@gmail.com'},
  {...base,role:'operator_admin'},
  {...base,reason:'too short'},
  {...base,expiresAt:new Date(Date.now()-86400000).toISOString()},
  {...base,expiresAt:new Date(Date.now()+91*86400000).toISOString()},
 ]){
  assert.throws(()=>roles.validated(change));
 }
 assert.equal(roles.validated({...base,action:'revoke',expiresAt:null}).expiresAt,null);
});
test('unknown or invalid operator roles fail closed without querying SQL',async()=>{
 const failQuery={query:async()=>{throw Error('query should not run')}};
 assert.equal(await roles.allowed(failQuery,3,'administrator'),false);
 assert.equal(await roles.allowed(failQuery,0,'launch_approver'),false);
});
