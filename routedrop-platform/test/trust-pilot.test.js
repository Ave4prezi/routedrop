'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const trust=require('../trust-pilot');
test('test reviews require meaningful text, valid stars and no contact information',()=>{
 const good={rating:5,headline:'Very good care',comment:'A fictional test appointment was handled carefully and completed on time.'};
 assert.deepEqual(trust.validReview(good),good);
 for(const v of [
  {...good,rating:0},{...good,rating:6},{...good,rating:3.5},
  {...good,headline:'Hi'},{...good,comment:'Short text'},
  {...good,comment:'Reach me at john@example.test for service details.'},
  {...good,comment:'Visit https://example.test/my-profile for details.'},
  {...good,comment:'Call me at (256) 555-1234 to confirm details.'}
 ])assert.equal(trust.validReview(v),null,JSON.stringify(v));
 assert.equal(trust.validId('-1'),false);
 assert.ok(trust.ddl.some(s=>s.includes('request_id BIGINT NOT NULL UNIQUE')));
 assert.ok(trust.ddl.every(s=>!s.includes('ALTER TABLE bookings')));
});
test('ratings are grounded in visible review rows; unreviewed providers receive no fabricated stars',()=>{
 const fields=trust.ratingFields('b');
 assert.match(fields,/avg\(rv.rating\)/);
 assert.match(fields,/status='visible'/);
 const context={window:{},Intl,Date};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/trust-ui.js'),'utf8'),context);
 const ui=context.window.RouteDropTrustUI;
 assert.match(ui.ratingBadge({review_count:0,rating_avg:null}),/No reviews yet/);
 assert.doesNotMatch(ui.ratingBadge({review_count:0,rating_avg:5}),/★/);
 assert.match(ui.ratingBadge({review_count:2,rating_avg:4.5}),/4\.5/);
 const demo=ui.catalog([],null,{sort:'price_asc'});
 assert.match(demo,/Compare selected/);
 assert.match(demo,/FICTIONAL EXAMPLES/);
 assert.match(demo,/No reviews yet/);
 assert.ok(demo.indexOf('Basic Grass Cutting')<demo.indexOf('Weekend Lawn Refresh'));
 assert.ok(demo.indexOf('Weekend Lawn Refresh')<demo.indexOf('Standard Lawn'));
 assert.doesNotMatch(demo,/★/);
 assert.match(ui.compareModal([],[-501,-503],null),/Provider service comparison/);
});
