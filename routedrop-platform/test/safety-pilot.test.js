'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const safety=require('../safety-pilot');

test('test screening is bounded, test-only and refuses sensitive identity documents',()=>{
 const good={serviceCategory:'Lawn care',serviceDescription:'Fictional neighborhood lawn mowing and edging for private testing.',acknowledgeTestOnly:true};
 assert.deepEqual(safety.validScreening(good),{serviceCategory:good.serviceCategory,serviceDescription:good.serviceDescription});
 for(const bad of [
  {...good,acknowledgeTestOnly:false},
  {...good,serviceCategory:'Electrical contracting'},
  {...good,serviceDescription:'Short'},
  {...good,serviceDescription:'Email jane@example.com for verification and business details.'},
  {...good,serviceDescription:'My ID is 123-45-6789. This text is otherwise long enough.'},
  {...good,serviceDescription:'Contact me at +1 (256) 555-2345 for details.'}
 ])assert.equal(safety.validScreening(bad),null,JSON.stringify(bad));
 assert.ok(safety.ddl.some(x=>x.includes('pilot_screening_cases')));
 assert.ok(safety.ddl.some(x=>x.includes('pilot_safety_audit')));
 assert.ok(safety.ddl.some(x=>x.includes('pilot_safety_appeals')));
 assert.ok(safety.ddl.every(x=>!x.includes('ALTER TABLE bookings')));
});
test('appeals and human moderation require sufficient reason, valid ownership and no PII',()=>{
 assert.ok(safety.validAppeal({subjectKind:'review',subjectId:2,reason:'I disagree with this test review hold and request a fair reconsideration.'}));
 assert.equal(safety.validAppeal({subjectKind:'provider',subjectId:0,reason:'This is otherwise a valid and long enough test appeal.'}),null);
 assert.equal(safety.validAppeal({subjectKind:'review',subjectId:1,reason:'brief'}),null);
 assert.ok(safety.validNote('Manual context reviewed; appropriate safety action taken.'));
 assert.equal(safety.validNote('too short'),null);
 assert.equal(safety.validNote('Contact team@example.com about this'),null);
});
test('moderator authority is off until separate 32+ character key and email allowlist exist',()=>{
 assert.equal(safety.moderatorConfigured({}),false);
 assert.equal(safety.moderatorConfigured({ROUTEDROP_MODERATION_TOKEN:'short',ROUTEDROP_MODERATOR_EMAILS:'reviewer@example.test'}),false);
 assert.equal(safety.moderatorConfigured({ROUTEDROP_MODERATION_TOKEN:'a'.repeat(36),ROUTEDROP_MODERATOR_EMAILS:''}),false);
 assert.equal(safety.moderatorConfigured({ROUTEDROP_MODERATION_TOKEN:'a'.repeat(36),ROUTEDROP_MODERATOR_EMAILS:'reviewer@example.test'}),true);
});
test('fraud risk flags reused review text without treating low ratings as fraudulent',async()=>{
 const calls=[];
 const db={query:async(sql,args=[])=>{
  calls.push([sql,args]);
  if(sql.includes('count(*)::int'))return {rows:[{n:0}],rowCount:1};
  if(sql.includes('lower(btrim(comment))'))return {rowCount:1,rows:[{id:12}]};
  return {rowCount:1,rows:[{id:2}]};
 }};
 const reused=await safety.reviewRisk(db,3,'Sample review content');
 assert.deepEqual(reused,{status:'flagged',rule:'reused_review_text'});
 assert.ok(calls.some(([sql])=>sql.includes('FOR UPDATE')));
 assert.ok(calls.some(([sql])=>sql.includes("interval '24 hours'")));
 const cap={query:async(sql)=>sql.includes('count(*)::int')?{rows:[{n:3}]}:{rowCount:1}};
 assert.match((await safety.reviewRisk(cap,3,'Sample review content')).deny,/Daily/);
 const reportCap={query:async(sql)=>sql.includes('count(*)::int')?{rows:[{n:5}]}:{rowCount:1}};
 assert.match(await safety.reportRisk(reportCap,3),/Daily report limit/);
});
