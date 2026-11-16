'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/premium.css'),'utf8');

test('premium beta clearly discloses fictional data and disabled payments in both journeys',()=>{
 assert.match(html,/Fictional test accounts only|fictional accounts and listings/i);
 assert.match(html,/No real customer bookings, charges or payouts/i);
 assert.match(html,/test listings only/i);
 assert.match(html,/no required monthly membership/i);
 assert.match(html,/8% of successfully collected payments/i);
 assert.match(html,/customer confirms work before payment/i);
 assert.match(js,/Payments disabled in preview/);
 assert.match(js,/Stripe onboarding unavailable in this paymentless preview/);
 assert.match(js,/This beta uses fictional service openings/);
 assert.match(js,/this private beta does not accept real jobs/i);
 assert.doesNotMatch(html,/<script[^>]+src=["']https?:/i);
});

test('customer filters have a visible results announcement, reset path and useful empty states',()=>{
 assert.match(html,/id="filter-summary" role="status" aria-live="polite"/);
 assert.match(html,/id="clear-filters"/);
 assert.match(js,/function clearFilters\(\)/);
 assert.match(js,/\$\('search'\)\.value=''/);
 assert.match(js,/\$\('category'\)\.value=''/);
 assert.match(js,/No matching test openings/);
 assert.match(js,/data-action="clear-filters"/);
 assert.match(js,/Showing all fictional test openings/);
 assert.match(css,/\.filter-tools/);
 assert.match(css,/\.text-action:focus-visible/);
});

test('business visitor sees a business-specific next step and never a live payout button when disabled',()=>{
 assert.match(js,/data-action="register-business">Preview business signup/);
 assert.match(js,/data-action="demo-onboarding">View onboarding steps/);
 assert.match(js,/state\.config\.payments\?'<button class="btn secondary" data-action="connect-stripe"/);
 assert.match(js,/Fictional business signup is unavailable until the isolated test database is ready/);
 assert.match(js,/No live bookings are available/);
 assert.match(js,/Draft cancellation terms are not approved for real customers/);
});

test('payment execution remains guarded by existing server-supplied configuration',()=>{
 assert.match(js,/if\(!state\.config\.payments\)/);
 assert.match(js,/if\(!state\.me\?\.user\)/);
 assert.match(js,/state\.config\.deferred_booking/);
});
