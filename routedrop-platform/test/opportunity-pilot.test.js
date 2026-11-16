'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ddl,CATEGORIES,TYPES,validJob}=require('../opportunity-pilot');

test('opportunity schema is isolated from bookings and provider type is explicit',()=>{
 assert.ok(ddl.some(s=>s.includes('pilot_job_openings')));
 assert.ok(ddl.some(s=>s.includes('provider_kind')));
 assert.ok(ddl.every(s=>!s.includes('ALTER TABLE bookings')));
});
test('test job details require complete bounded fields and supported values',()=>{
 const good={title:'Landscape crew member',category:'Services',city:'Decatur, AL',employmentType:'Part-time',payDisplay:'$18–$22/hr',summary:'Fictional weekend lawn-care crew opening for the private test.'};
 assert.ok(validJob(good));
 assert.equal(validJob({...good,summary:'short'}),null);
 assert.equal(validJob({...good,employmentType:'Permanent'}),null);
 assert.equal(validJob({...good,category:'Unlisted'}),null);
 assert.equal(validJob({...good,payDisplay:''}),null);
 assert.equal(validJob({...good,title:'x'.repeat(121)}),null);
 assert.ok(CATEGORIES.includes('Warehousing'));
 assert.ok(TYPES.includes('Contract'));
});
