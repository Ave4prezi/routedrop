'use strict';
(function(root){
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(c||0)/100);
 const date=iso=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(iso));
 const STATUS=Object.freeze({requested:'Awaiting provider response',accepted:'Accepted',completed:'Work marked complete',confirmed:'Customer confirmed',declined:'Declined',canceled:'Canceled',issue_reported:'Issue reported'});
 const DANGER=new Set(['declined','canceled','issue_reported']);
 const MILESTONES=Object.freeze(['Requested','Accepted','Work complete','Confirmed']);
 const PROGRESS=Object.freeze({
  requested:{index:0},
  accepted:{index:1},
  completed:{index:2},
  confirmed:{index:3},
  declined:{index:0,terminal:'Provider declined'},
  canceled:{index:0,terminal:'Canceled'},
  issue_reported:{index:2,terminal:'Issue reported'}
 });
 const NEXT=Object.freeze({
  customer:Object.freeze({
   requested:'Waiting for the test provider to accept or decline. You can cancel while waiting.',
   accepted:'Provider accepted. Wait for the provider to mark the fictional work complete; you can cancel before that.',
   completed:'Your turn: confirm the fictional work or report an issue. No payment is due.',
   confirmed:'Test request complete. You can leave a test review, but no payment was collected.',
   declined:'Provider declined this test request. No payment was collected.',
   canceled:'This test request was canceled. No payment was collected.',
   issue_reported:'Your issue was recorded for test review. No refund or support escalation was started.'
  }),
  business:Object.freeze({
   requested:'Your turn: accept or decline this fictional service request.',
   accepted:'Your turn: mark work complete only after the fictional service is finished.',
   completed:'Waiting for the customer to confirm the fictional work or report an issue.',
   confirmed:'Customer confirmed the test request. No payment was collected.',
   declined:'You declined this test request. No payment was collected.',
   canceled:'The customer canceled this test request. No payment was collected.',
   issue_reported:'Customer reported an issue. This test record is not a real support or refund case.'
  })
 });
 function progress(status){
  const item=PROGRESS[status]||{index:0};
  const stage=item.terminal?MILESTONES.slice(0,item.index+1):MILESTONES;
  const steps=stage.map((label,i)=>{
   const phase=item.terminal||i<item.index?'done':i===item.index?'current':'upcoming';
   return '<li class="pilot-progress-step '+phase+'"'+(!item.terminal&&i===item.index?' aria-current="step"':'')+'><span class="pilot-progress-dot" aria-hidden="true">'+(phase==='done'?'✓':String(i+1))+'</span><span>'+esc(label)+'</span></li>';
  });
  if(item.terminal)steps.push('<li class="pilot-progress-step terminal"><span class="pilot-progress-dot" aria-hidden="true">!</span><span>'+esc(item.terminal)+'</span></li>');
  return '<ol class="pilot-progress" aria-label="Test request progress">'+steps.join('')+'</ol>';
 }
 function nextAction(status,role){
  return '<p class="pilot-next-action"><strong>What happens next:</strong> '+esc(NEXT[role]?.[status]||'This request cannot be updated in the private test.')+'</p>';
 }
 function requestModal(x){
  return '<div class="pilot-eyebrow">PRIVATE ACCOUNT TEST · NO PAYMENTS</div><h2 id="modal-title">Request this opening</h2>'+
  '<p>This is a test request with a registered account. It will be saved in the isolated RouteDrop test database and shared with the test business account. Do not use real personal information.</p>'+
  '<div class="pilot-summary"><strong>'+esc(x.title)+'</strong><span>'+esc(x.business_name)+' · '+esc(x.neighborhood)+'</span>'+
  '<span>'+esc(date(x.slot_start))+' · '+esc(x.duration_minutes)+' minutes</span>'+
  '<div><small>Advertised service price (not charged)</small><strong>'+money(x.price_cents)+'</strong></div><div><small>Amount charged or authorized</small><strong>$0.00</strong></div></div>'+
  '<p class="legal">This action reserves a test listing while the business reviews it. It is not a contract to pay and does not trigger Stripe, email or SMS. No address or card is collected.</p>'+
  '<button class="btn pilot-primary" type="button" data-action="pilot-confirm-request">Submit test request</button>';
 }
 function action(id,key,label,secondary=false){
  return '<button type="button" class="btn'+(secondary?' secondary':'')+'" data-pilot-id="'+esc(id)+'" data-pilot-action="'+key+'">'+label+'</button>';
 }
 function requests(rows,role){
  if(!rows.length)return '<div class="panel pilot-empty"><h3>No requests yet</h3><p class="muted">'+(role==='business'?'Publish a service opening. When a test customer requests it, you can review and accept it here.':'Browse available openings, then submit a request from a service card. No payment method is required.')+'</p><button type="button" class="btn" data-tab="explore">Explore available services</button></div>';
  return '<div class="pilot-requests">'+rows.map(x=>{
   const status=STATUS[x.status]||'Unknown';
   let actions='';
   if(role==='customer'){
    if(['requested','accepted'].includes(x.status))actions=action(x.id,'cancel','Cancel request',true);
    if(x.status==='completed')actions=action(x.id,'confirm','Confirm work')+action(x.id,'report','Report an issue',true);
    if(x.status==='confirmed')actions=x.review_id?'<span class="trust-unrated">Test review submitted</span>':'<button type="button" class="trust-review-cta" data-review-request-id="'+Number(x.id)+'">Rate &amp; review this service</button>';
   } else {
    if(x.status==='requested')actions=action(x.id,'accept','Accept request')+action(x.id,'decline','Decline',true);
    if(x.status==='accepted')actions=action(x.id,'complete','Mark work complete');
   }
   return '<article class="pilot-request-card"><div class="pilot-card-heading"><div><div class="pilot-eyebrow">REQUEST #'+esc(x.id)+' · TEST ACCOUNT</div><h3>'+esc(x.title)+'</h3><p>'+esc(x.business_name)+' · '+esc(x.neighborhood)+'</p></div><span class="pilot-status'+(DANGER.has(x.status)?' muted-status':'')+'">'+esc(status)+'</span></div>'+
   '<div class="pilot-request-meta"><div><small>SCHEDULED OPENING</small><strong>'+esc(date(x.slot_start))+'</strong></div><div><small>LISTED PRICE</small><strong>'+money(x.price_cents)+'</strong></div><div><small>PAYMENT STATUS</small><strong>Not collected</strong></div></div>'+
   progress(x.status)+nextAction(x.status,role)+
   (role==='business'&&x.customer_name?'<p class="pilot-safe-note">Test customer: '+esc(x.customer_name)+'</p>':'')+
   '<p class="pilot-safe-note">'+(x.status==='confirmed'?'Customer confirmed completion. No payment was collected.':x.status==='issue_reported'?'Issue noted in the test database. No support escalation or refund was initiated.':'This is an unpaid test request. No customer address, payment method or identity check is included.')+'</p>'+
   (actions?'<div class="buttonrow pilot-actions">'+actions+'</div>':'')+'</article>';
  }).join('')+'</div>';
 }
 function customer(rows){
  return '<div class="pilot-banner"><div class="eyebrow">REAL DATABASE · ISOLATED TEST ONLY</div><h2>Track your service requests.</h2><p>Submit and manage test requests with your account. No payment is accepted or scheduled during this pilot.</p></div>'+
  '<div class="pilot-heading"><h2>My requests</h2><span>'+rows.length+' test request'+(rows.length===1?'':'s')+'</span></div>'+requests(rows,'customer');
 }
 function studio(b,listings,rows,radiusMarkup){
  const individual=b.provider_kind==='individual';
  const active=rows.filter(x=>['requested','accepted','completed'].includes(x.status)).length;
  const done=rows.filter(x=>x.status==='confirmed').length;
  return '<div class="pilot-banner"><div class="eyebrow">'+(individual?'INDEPENDENT PROVIDER':'BUSINESS ACCOUNT')+' · ISOLATED TEST</div><h2>'+(individual?'Your independent service studio.':'Your service headquarters.')+'</h2><p>Manage database-backed fictional service openings and requests without collecting or moving money.</p></div>'+
  '<div class="studio-highlights"><div><span>Open test requests</span><strong>'+active+'</strong><p>Pending/accepted/completed</p></div><div><span>Requests confirmed</span><strong>'+done+'</strong><p>Customer acknowledged · unpaid</p></div><div><span>Payments</span><strong>OFF</strong><p>No charges, subscriptions or payouts</p></div></div>'+
  '<div class="panel pilot-provider-bar"><div class="row"><div><h3>'+esc(b.name)+'</h3><p class="muted">'+esc(b.city)+' · '+esc(b.category)+'</p></div><span class="pill">'+(individual?'Individual test provider':'Test business')+'</span></div><div class="buttonrow"><button type="button" class="btn" data-action="create-listing">+ Publish an opening</button></div><p class="muted">Enter fictional opening information for testing. Every new opening appears in the Explore tab until requested, expired or paused.</p></div>'+
  '<div class="pilot-heading"><h2>Incoming requests</h2><span>'+rows.length+' total</span></div>'+requests(rows,'business')+
  '<div class="panel"><div class="row"><div><h3>Manage availability</h3><p class="muted">Pause an opening to hide it from discovery. Pausing does not cancel previously accepted requests.</p></div><span class="pill">'+listings.length+' opening'+(listings.length===1?'':'s')+'</span></div>'+
  (listings.length?listings.map(l=>'<div class="pilot-listing-row"><div><strong>'+esc(l.title)+'</strong><p>'+esc(l.neighborhood)+' · '+date(l.slot_start)+' · '+money(l.price_cents)+'</p></div><div><span class="pilot-status">'+esc(l.status)+'</span><button type="button" class="btn secondary" data-pilot-listing-id="'+esc(l.id)+'" data-pilot-listing-status="'+(l.status==='active'?'paused':'active')+'">'+(l.status==='active'?'Pause':'Resume')+'</button></div></div>').join(''):'<p class="muted">No service openings published yet.</p>')+'</div>'+radiusMarkup;
 }
 root.RouteDropPilotUI=Object.freeze({STATUS,date,requestModal,customer,studio,progress,nextAction});
})(window);
