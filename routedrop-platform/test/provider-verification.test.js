'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {policy,assess,groups,schema,eligibleListing}=require('../provider-verification');
test('category catalog supports broad businesses and adds driving insurance checks',()=>{
 assert.ok(Object.values(groups).flat().length>=35);
 const moving=policy('Moving');
 assert.deepEqual(moving.requirements,['identity','business_info','driver_license','auto_insurance','liability_insurance']);
 assert.equal(moving.manualReview,false);
 const design=policy('Graphic design');
 assert.deepEqual(design.requirements,['identity','business_info']);
 assert.equal(policy('Home health care').manualReview,true);
});
test('unverified and expired documents block booking; approval requires each required kind',()=>{
 const at=Date.parse('2026-11-07T12:00:00Z');
 const records=['identity','business_info','driver_license','auto_insurance','liability_insurance'].map(kind=>({kind,status:'approved',expires_at:new Date(at+86400000).toISOString()}));
 assert.equal(assess('Moving',records,false,at).eligible,true);
 assert.deepEqual(assess('Moving',records.filter(r=>r.kind!=='driver_license'),false,at).missing,['driver_license']);
 const expired=records.map(r=>r.kind==='auto_insurance'?{...r,expires_at:new Date(at-1000).toISOString()}:r);
 assert.deepEqual(assess('Moving',expired,false,at).missing,['auto_insurance']);
 assert.equal(assess('Moving',records.map(r=>({...r,status:'pending'})),false,at).eligible,false);
});
test('unlisted or regulated categories remain blocked until manual review',()=>{
 const basics=[{kind:'identity',status:'approved'},{kind:'business_info',status:'approved'}];
 assert.deepEqual(assess('Other',basics,false).missing,['category_policy_review']);
 assert.equal(assess('Other',basics,true).eligible,true);
 assert.deepEqual(assess('Unknown service',basics,false).missing,['category_policy_review']);
 const health=[...basics,{kind:'liability_insurance',status:'approved'},{kind:'professional_license',status:'approved'}];
 assert.equal(assess('Home health care',health,false).eligible,false);
});
test('eligibility resolves provider listing and checks verification without modifying bookings',async()=>{
 const sql=[];
 const fakeDb={query:async(statement)=>{
  sql.push(statement);
  if(statement.includes('FROM listings'))return {rowCount:1,rows:[{business_id:3,category:'Photography'}]};
  if(statement.includes('FROM provider_verifications'))return {rows:[{kind:'identity',status:'approved'},{kind:'business_info',status:'approved'}]};
  if(statement.includes('FROM provider_category_reviews'))return {rows:[]};
  throw Error('unexpected query');
 }};
 assert.equal(await eligibleListing(fakeDb,42),true);
 assert.equal(sql.length,3);
 assert.ok(sql.every(s=>/^SELECT /.test(s)));
 assert.ok(schema.every(s=>/^(CREATE TABLE|CREATE INDEX)/.test(s)));
});
