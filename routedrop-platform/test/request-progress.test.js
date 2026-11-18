'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/pilot-ui.js'),'utf8'),context);
const ui=context.window.RouteDropPilotUI;
function record(status){
 return {id:123,title:'Fictional lawn cleanup',business_name:'Decatur Test Lawn',
 neighborhood:'Test neighborhood',slot_start:'2026-11-26T16:00:00Z',price_cents:6500,
 duration_minutes:60,customer_name:'Fictional Customer',review_id:null,status};
}
test('booking progress uses four stages and marks all stages done after confirmation',()=>{
 for(const [status,step] of [['requested','Requested'],['accepted','Accepted'],['completed','Work complete'],['confirmed','Confirmed']]){
  const html=ui.progress(status);
  assert.equal((html.match(/<li /g)||[]).length,4);
  assert.equal((html.match(/aria-current="step"/g)||[]).length,status==='confirmed'?0:1);
  if(status==='confirmed')assert.equal((html.match(/pilot-progress-step done/g)||[]).length,4);
  else assert.match(html,new RegExp('aria-current="step"[^>]*><span[^>]*>'));
  assert.match(html,new RegExp(step));
 }
});
test('terminal states do not invent provider acceptance or successful customer confirmation',()=>{
 for(const status of ['declined','canceled']){
  const html=ui.progress(status);
  assert.match(html,/Requested/);
  assert.doesNotMatch(html,/Work complete|Confirmed|Accepted/);
  assert.equal((html.match(/aria-current="step"/g)||[]).length,0);
 }
 const issue=ui.progress('issue_reported');
 assert.match(issue,/Issue reported/);
 assert.match(issue,/Work complete/);
 assert.doesNotMatch(issue,/>Confirmed</);
});
test('customer instructions accurately explain the next unpaid action',()=>{
 assert.match(ui.nextAction('requested','customer'),/Waiting for the test provider/);
 assert.match(ui.nextAction('completed','customer'),/confirm the fictional work or report an issue/);
 assert.match(ui.nextAction('canceled','customer'),/No payment was collected/);
 assert.match(ui.nextAction('issue_reported','customer'),/No refund or support escalation/);
});
test('provider instructions remain limited to the allowed service-request transition',()=>{
 assert.match(ui.nextAction('requested','business'),/accept or decline/);
 assert.match(ui.nextAction('accepted','business'),/mark work complete/);
 assert.match(ui.nextAction('completed','business'),/Waiting for the customer/);
});
test('rendered private cards show progress and never claim charge or real identity proof',()=>{
 const requested=ui.customer([record('requested')]);
 assert.match(requested,/pilot-progress/);
 assert.match(requested,/What happens next:/);
 assert.match(requested,/Not collected/);
 assert.match(requested,/data-pilot-action="cancel"/);
 assert.doesNotMatch(requested,/Pay now|Card charged|Verified provider/);
 const provider=ui.studio({provider_kind:'business',name:'Decatur Test Lawn',city:'Decatur',category:'Lawn care'},
  [],[record('accepted')],'');
 assert.match(provider,/mark work complete/);
 assert.match(provider,/data-pilot-action="complete"/);
 assert.doesNotMatch(provider,/Pay now/);
});
test('untrusted request content is escaped inside card and progress status is not HTML',()=>{
 const x=record('requested');x.title='<svg onload=alert(1)>';x.customer_name='<img src=x onerror=alert(1)>';
 const html=ui.studio({provider_kind:'business',name:'Fictional business',city:'Decatur',category:'Lawn care'},[],[x],'');
 assert.doesNotMatch(html,/<svg onload|<img src=/);
 assert.match(html,/&lt;svg/);
});
