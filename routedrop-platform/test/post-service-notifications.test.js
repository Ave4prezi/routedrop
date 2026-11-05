'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {notification}=require('../mail');
const details={title:'Lawn mowing',date:'Nov 7, 2026 12:00 PM CT',amount:'USD 100.00',name:'Test Customer'};
test('customer and provider notifications explain $0 booking and 8% postpaid fee accurately',()=>{
 const requestedCustomer=notification('deferred_requested_customer',details);
 assert.match(requestedCustomer.subject,/request submitted/i);
 assert.match(requestedCustomer.body,/\$0 was charged/);
 assert.match(requestedCustomer.body,/USD 100\.00/);
 const requestedBusiness=notification('deferred_requested_business',details);
 assert.match(requestedBusiness.body,/No payment has been collected/);
 const completed=notification('deferred_completed_customer',details);
 assert.match(completed.body,/confirm the service/);
 const paidBusiness=notification('deferred_paid_business',details);
 assert.match(paidBusiness.body,/8%/);
 assert.match(notification('deferred_failed_customer',details).body,/No automatic retry/);
 assert.match(notification('deferred_refund_customer',details).body,/refund update/);
});
test('notification text does not permit CRLF or HTML injection through provider titles',()=>{
 const msg=notification('deferred_requested_customer',{...details,title:'<script>malicious</script>\nInjected: text'});
 assert.doesNotMatch(msg.body,/[<>]/);
 assert.doesNotMatch(msg.body,/\r|\n/);
});
