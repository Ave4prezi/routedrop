'use strict';
(function(root){
 const h=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const states={not_started:'Not started',pending:'Under test review',test_reviewed:'Test screening reviewed · NOT identity verified',needs_changes:'Additional test information requested',suspended:'Suspended from new postings'};
 function overview(me,safety,config,ownReviews=[]){
  const demo=!config?.safety_pilot;
  const status=safety?.screening?.pilot_screening_status||'not_started';
  return '<div class="safety-hero"><span class="pilot-eyebrow">ROUTEDROP TRUST & SAFETY</span><h2>Confidence must be earned.</h2><p>Provider identity checks, verified booking reviews, fraud detection and independent moderation protect customers and honest workers. These controls are being built in a private pilot, not used to verify real people today.</p></div>'+
   '<div class="safety-grid">'+
    '<article class="safety-panel"><span>01 · PROVIDER SCREENING</span><h3>Know who offers a service</h3><p>Clear screening states, manual review, and account suspension for unsafe conduct. Official ID, insurance and license verification require a licensed provider and documented consent.</p><strong>No real identity checks yet</strong></article>'+
    '<article class="safety-panel"><span>02 · REVIEW INTEGRITY</span><h3>Earn your reputation</h3><p>One review per confirmed test booking, daily review limits, and duplicate-content holds. No paid placements or invented five-star ratings.</p><strong>Unrated until feedback is earned</strong></article>'+
    '<article class="safety-panel"><span>03 · MODERATION & APPEALS</span><h3>Decisions with accountability</h3><p>Reports are recorded without automatically deleting criticism. Reviewers can investigate, log reasons, hide harmful content and record appeals.</p><strong>Human review required</strong></article>'+
   '</div>'+
   (demo?'<div class="panel safety-note"><h3>Visual preview only</h3><p>These controls have no active identity vendor or moderator account in this design tour. Do not submit documents, ID numbers, photos or real personal information.</p></div>':
    !me?.user?'<div class="panel"><h3>Test account required</h3><p>Register a fictional test account to see your provider screening status and review history.</p><button class="btn" data-action="register">Create test account</button></div>':
    (me.business?'<div class="panel safety-note"><div class="row"><div><h3>Your provider screening</h3><p>'+h(me.business.name)+' · <strong>'+h(states[status]||status)+'</strong></p><p class="muted">No verification badge or permission to work with actual customers is granted here.</p></div>'+
      (['not_started','needs_changes'].includes(status)?'<button class="btn" data-action="safety-start-screening">Request test screening</button>':'')+
      (['suspended','needs_changes'].includes(status)?'<button class="btn secondary" data-safety-appeal-kind="provider" data-safety-appeal-id="'+Number(me.business.id)+'">Appeal decision</button>':'')+
      '</div></div>':'<div class="panel"><h3>Offer services with the same account</h3><p>Activate a fictional individual-provider profile first. Identity verification will be a separate, consent-based step before real customer access.</p><button class="btn" data-action="start-provider">Become a test provider</button></div>')+
    '<div class="panel"><h3>My submitted test reviews</h3>'+
    (ownReviews.length?ownReviews.map(x=>'<div class="safety-review-row"><div><strong>'+h(x.headline)+'</strong><p>'+h(x.provider_name)+' · '+h(x.status)+'</p></div>'+
       (['hidden','flagged'].includes(x.status)?'<button class="btn secondary" data-safety-appeal-kind="review" data-safety-appeal-id="'+Number(x.id)+'">Appeal</button>':'')+'</div>').join(''):'<p class="muted">No customer reviews submitted yet.</p>')+'</div>'+
    (config?.moderation_available?'<div class="panel"><h3>Restricted moderator tools</h3><p>Only allowlisted, email-verified test accounts with a separate moderator key may access the moderation queue. Keys remain in browser memory and are not saved.</p><button class="btn secondary" data-action="moderator-connect">Open restricted moderator queue</button></div>':
     '<div class="panel safety-note"><p>Moderator access is not configured on this service. Reports are saved, but no active review team is available.</p></div>'));
 }
 function screeningForm(){
  return '<div class="pilot-eyebrow">PRIVATE TEST · NOT AN ID VERIFICATION</div><h2 id="modal-title">Request provider screening</h2><p>Tell us the fictional type of service you plan to offer. Do not enter legal name, ID number, address, license documents, DOB, or insurance records here.</p>'+
   '<form id="safety-screening-form"><label>Service category</label><select name="serviceCategory"><option>Lawn care</option><option>Cleaning</option><option>Car detailing</option><option>Washing</option><option>Other</option></select>'+
   '<label>Scope of fictional service (30–350 characters)</label><textarea name="serviceDescription" minlength="30" maxlength="350" required placeholder="Example: I provide yard mowing, edging and general lawn maintenance in the Decatur area."></textarea>'+
   '<label class="safety-checkbox"><input type="checkbox" name="acknowledgeTestOnly" value="yes" required> I understand this is test screening only. No real identity or credentials are being verified.</label>'+
   '<p id="form-error" class="error"></p><button class="btn" type="submit">Submit fictional screening request</button></form>';
 }
 function appealForm(kind,id){
  return '<div class="pilot-eyebrow">FAIR REVIEW · PRIVATE TEST</div><h2 id="modal-title">Appeal a safety decision</h2><p>Describe why this fictional decision should be reconsidered. Submitting an appeal does not automatically restore an account or review.</p>'+
   '<form id="safety-appeal-form"><input type="hidden" name="subjectKind" value="'+h(kind)+'"><input type="hidden" name="subjectId" value="'+Number(id)+'">'+
   '<label>Reason (25–500 characters)</label><textarea name="reason" minlength="25" maxlength="500" required></textarea><p id="form-error" class="error"></p><button class="btn" type="submit">Submit appeal</button></form>';
 }
 function moderatorForm(){
  return '<div class="pilot-eyebrow">RESTRICTED INTERNAL PILOT</div><h2 id="modal-title">Moderator access</h2><p>Use an allowlisted, email-verified pilot account and a separate key configured privately on the server. The key is not stored or sent to third parties.</p>'+
   '<form id="safety-mod-login-form"><label>One-time moderator key</label><input type="password" name="key" required autocomplete="off" minlength="32"><p id="form-error" class="error"></p><button class="btn" type="submit">Access moderation queue</button></form>';
 }
 function decisionForm(kind,id,action){
  return '<div class="pilot-eyebrow">AUDITED MODERATOR DECISION</div><h2 id="modal-title">'+h(action.replace(/_/g,' '))+'</h2><p>Actions are recorded with the moderator account and the stated rationale. Do not submit real customer data or documents.</p>'+
   '<form id="safety-moderation-form"><input name="kind" type="hidden" value="'+h(kind)+'"><input name="id" type="hidden" value="'+Number(id)+'"><input name="action" type="hidden" value="'+h(action)+'">'+
   '<label>Decision reason (12–500 characters)</label><textarea name="note" minlength="12" maxlength="500" required></textarea><p id="form-error" class="error"></p><button class="btn" type="submit">Record decision</button></form>';
 }
 const btn=(kind,id,action,label)=>'<button class="btn secondary" data-safety-decision-kind="'+h(kind)+'" data-safety-decision-id="'+Number(id)+'" data-safety-decision-action="'+h(action)+'">'+h(label)+'</button>';
 function queue(data){
  return '<div class="panel safety-queue"><div class="row"><div><span class="pilot-eyebrow">RESTRICTED & AUDITED</span><h3>Moderator review queue</h3></div><button class="btn secondary" data-action="moderator-disconnect">Disconnect moderator key</button></div>'+
    '<p class="muted">These are private-test records. Test screening review does not prove actual identity or licenses.</p>'+
    '<h4>Provider screening requests ('+data.cases.length+')</h4>'+
    (data.cases.length?data.cases.map(x=>'<div class="safety-case"><strong>'+h(x.provider_name)+' · '+h(x.service_category)+'</strong><p>'+h(x.service_description)+'</p><div class="buttonrow">'+btn('provider',x.business_id,'review_test_submission','Review test submission')+btn('provider',x.business_id,'request_changes','Request changes')+btn('provider',x.business_id,'suspend','Suspend')+'</div></div>').join(''):'<p>No pending screenings.</p>')+
    '<h4>Reviews needing moderation ('+data.reviews.length+')</h4>'+
    (data.reviews.length?data.reviews.map(x=>'<div class="safety-case"><strong>'+h(x.provider_name)+' · '+Number(x.rating)+'/5 · '+h(x.status)+'</strong><p>'+h(x.headline)+' — '+h(x.comment)+'</p><p>Open reports: '+Number(x.open_reports)+' · '+h(x.report_reasons)+'</p><div class="buttonrow">'+btn('review',x.id,'hide','Hide')+btn('review',x.id,'restore','Restore')+btn('review',x.id,'dismiss_reports','Dismiss reports')+'</div></div>').join(''):'<p>No pending review reports or suspicious reviews.</p>')+
    '<h4>Appeals ('+data.appeals.length+')</h4>'+
    (data.appeals.length?data.appeals.map(x=>'<div class="safety-case"><strong>'+h(x.subject_kind)+' #'+Number(x.subject_id)+'</strong><p>'+h(x.reason)+'</p><div class="buttonrow">'+btn('appeal',x.id,'upheld','Uphold decision')+btn('appeal',x.id,'overturned','Overturn on appeal')+'</div></div>').join(''):'<p>No open appeals.</p>')+'</div>';
 }
 root.RouteDropSafetyUI=Object.freeze({overview,screeningForm,appealForm,moderatorForm,decisionForm,queue});
})(window);
