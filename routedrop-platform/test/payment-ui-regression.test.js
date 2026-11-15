'use strict';
// Tests the actual browser markup functions without a live browser, DB, or Stripe credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function loadFunction(name, nextName) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('function ' + nextName + '(', start + 1);
  assert.ok(start !== -1 && end > start, 'Browser function boundaries must exist: ' + name);
  const body = source.slice(start, end).trim();
  return vm.runInNewContext('(' + body + ')', {
    money: cents => '$' + (Number(cents) / 100).toFixed(2),
    when: () => 'Test date',
    esc: value => String(value ?? '').replace(/[&<>"']/g, c =>
      ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]))
  }, {timeout: 1000});
}
const deferredMarkup = loadFunction('deferredMarkup', 'deferredRefundMarkup');
const refundMarkup = loadFunction('deferredRefundMarkup', 'renderBookings');
const booking = (status, extras = {}) => ({
  id: 42, status, title: 'Test service', business_name: 'Test provider',
  slot_start: '2026-11-15T12:00:00Z', price_cents: 1250,
  ...extras
});
const has = (html, action) => html.includes('data-deferred-action="' + action + '"');

test('customer can confirm/pay only after provider completes the job', () => {
  for (const status of ['requested', 'accepted', 'payment_processing', 'payment_failed',
    'recovery_pending', 'paid', 'refunded', 'disputed', 'needs_review']) {
    assert.equal(has(deferredMarkup([booking(status)], 'customer'), 'confirm'), false, status);
  }
  const html = deferredMarkup([booking('work_completed')], 'customer');
  assert.equal(has(html, 'confirm'), true);
  assert.equal(has(html, 'dispute'), true);
  assert.match(html, /Confirm completed job &amp; pay \$12\.50/);
});

test('failed customer payments offer recovery, not a second direct charge', () => {
  for (const status of ['payment_failed', 'recovery_pending']) {
    const html = deferredMarkup([booking(status)], 'customer');
    assert.equal(has(html, 'recover'), true);
    assert.equal(has(html, 'confirm'), false);
    assert.equal(has(html, 'request-refund'), false);
  }
  assert.match(deferredMarkup([booking('payment_failed')], 'customer'), /original charge failed/);
});

test('disputes require review and separate customer authorization', () => {
  let html = deferredMarkup([booking('disputed')], 'customer');
  for (const action of ['confirm', 'recover', 'request-refund', 'accept-resolution']) {
    assert.equal(has(html, action), false, action);
  }
  html = deferredMarkup([booking('disputed', {review_state: 'awaiting_customer'})], 'customer');
  assert.equal(has(html, 'accept-resolution'), true);
  assert.equal(has(html, 'decline-resolution'), true);
  assert.equal(has(html, 'confirm'), false);
  assert.match(html, /Accepting does not charge your card/);
});

test('paid customers can request refund review; refunded customers cannot repeat it', () => {
  assert.equal(has(deferredMarkup([booking('paid')], 'customer'), 'request-refund'), true);
  assert.equal(has(deferredMarkup([booking('refunded')], 'customer'), 'request-refund'), false);
});

test('provider sees operational controls, never customer payment authorization', () => {
  assert.equal(has(deferredMarkup([booking('requested')], 'business'), 'accept'), true);
  assert.equal(has(deferredMarkup([booking('accepted')], 'business'), 'complete'), true);
  for (const status of ['work_completed', 'payment_failed', 'recovery_pending', 'paid',
    'refunded', 'disputed', 'needs_review']) {
    const html = deferredMarkup([booking(status)], 'business');
    for (const action of ['confirm', 'recover', 'request-refund', 'accept-resolution', 'complete']) {
      assert.equal(has(html, action), false, status + '/' + action);
    }
  }
});

test('refund approval controls are limited to provider with pending request', () => {
  const request = status => ({
    id: 3, title: 'Test service', slot_start: '2026-11-15T12:00:00Z',
    price_cents: 1250, reason: 'Refund requested', status
  });
  const button = 'data-deferred-refund-decision="approve"';
  assert.ok(refundMarkup([request('pending')], 'business').includes(button));
  assert.ok(!refundMarkup([request('pending')], 'customer').includes(button));
  for (const status of ['refunded', 'declined', 'processing', 'needs_review']) {
    assert.ok(!refundMarkup([request(status)], 'business').includes(button), status);
  }
});

test('customer-provided booking and refund text is HTML-escaped', () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const html = deferredMarkup([booking('paid', {title: malicious, review_note: malicious})], 'customer');
  assert.ok(!html.includes(malicious));
  assert.ok(html.includes('&lt;img'));
  const refund = refundMarkup([{
    id: 1, title: malicious, slot_start: '2026-11-15T12:00:00Z',
    price_cents: 1250, reason: malicious, status: 'pending'
  }], 'customer');
  assert.ok(!refund.includes(malicious));
});
