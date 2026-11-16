'use strict';
(function(root){
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const row=(title,detail,tone)=>'<li class="readiness-step"><span class="readiness-step-label">'+esc(title)+'</span><span class="readiness-step-detail '+esc(tone)+'">'+esc(detail)+'</span></li>';
 const screeningLabels=Object.freeze({
  not_started:'Not started · test only',
  pending:'Awaiting test review',
  test_reviewed:'Reviewed for fictional pilot only',
  needs_changes:'Test changes requested',
  suspended:'Suspended from pilot'
 });
 function providerChecklist(me,screening,identity,config){
  if(!me?.business||!config?.unified_pilot)return '';
  const emailReady=me.user?.email_verified===true;
  const screeningStatus=screening?.screening?.pilot_screening_status||'not_started';
  const identityStatus=identity?.status||'not_started';
  const identityEnabled=!!identity?.available&&!!config?.identity_test_available;
  let identityLabel='Awaiting secure Stripe TEST connection';
  if(identityEnabled){
   identityLabel={not_started:'Test flow available · not started',initializing:'Creating Stripe TEST session',requires_input:'Test session awaiting input',processing:'Stripe TEST session processing',verified_test:'Stripe TEST simulation complete · not a real ID check',failed:'Test session failed',canceled:'Test session canceled'}[identityStatus]||'Test flow not started';
  }else if(identityStatus==='verified_test'){
   identityLabel='Prior Stripe TEST simulation recorded · no live approval';
  }
  return '<section class="panel readiness-panel" aria-labelledby="readiness-heading">'+
   '<div class="row"><div><span class="pilot-eyebrow">PRIVATE STAGING · PROVIDER ONBOARDING</span><h3 id="readiness-heading">Your provider setup checklist</h3><p class="muted">Track fictional pilot setup while external identity access is pending. Steps below never authorize live work.</p></div><span class="pill">TEST ONLY</span></div>'+
   '<ul class="readiness-steps">'+
    row('Provider profile','Created for private testing','readiness-done')+
    row('Account email',emailReady?'Verified in RouteDrop':'Not verified · required for Stripe test flow',emailReady?'readiness-done':'readiness-pending')+
    row('Provider screening',screeningLabels[screeningStatus]||'Unknown pilot status',screeningStatus==='test_reviewed'?'readiness-done':'readiness-pending')+
    row('Stripe identity',identityLabel,identityEnabled&&identityStatus==='verified_test'?'readiness-done':'readiness-pending')+
    row('Customer payments','Disabled · no charges or payouts','readiness-blocked')+
   '</ul><div class="buttonrow"><button type="button" class="btn secondary" data-tab="safety">Review setup requirements</button></div>'+
   '<p class="legal"><strong>Important:</strong> A completed TEST verification, screening review, or published listing does not create a verified badge, real provider approval, or permission to accept real customers.</p></section>';
 }
 root.RouteDropReadiness=Object.freeze({providerChecklist});
})(window);
