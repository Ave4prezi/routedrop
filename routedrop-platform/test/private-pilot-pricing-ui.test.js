'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const startMarker = '(state.config.deferred_booking?\'<div class="panel"><h3>Founding business early access';
const endMarker = ')+\n \'<div class="panel"><h3>Cancellation and refund requests';
const start = script.indexOf(startMarker);
const end = script.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start, 'Pilot membership presentation is present');
const membershipMarkup = script.slice(start, end + 1);

function render(deferred) {
 const state = {config:{deferred_booking:deferred}};
 const subscription = {status:'inactive',current_period_end:null,last_invoice_status:null,cancel_at_period_end:false};
 return vm.runInNewContext(membershipMarkup,{state,subscription,esc:String});
}

test('Stripe TEST deferred-booking pilot does not offer paid membership', () => {
 const markup = render(true);
 assert.match(markup,/Founding business early access/);
 assert.match(markup,/No monthly membership is required/);
 assert.match(markup,/8% fee/);
 assert.match(markup,/No real customer payments are enabled/);
 assert.doesNotMatch(markup,/Subscribe · \$79\/month/);
 assert.doesNotMatch(markup,/data-action="subscribe"/);
});

test('non-pilot business studio keeps existing subscription controls unchanged', () => {
 const markup = render(false);
 assert.match(markup,/Business membership · \$79\/month/);
 assert.match(markup,/data-action="subscribe"/);
 assert.match(markup,/data-action="manage-subscription"/);
 assert.doesNotMatch(markup,/Founding business early access/);
});
