'use strict';
(function(){
const $=id=>document.getElementById(id);
const state={config:null,me:null,listings:[],bookings:[],deferred:[],refunds:[],mine:[],tab:'explore'};
const esc=v=>String(v===null||v===undefined?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SERVICE_CATEGORIES=["Cleaning","Lawn care","Landscaping","Painting","Handyman","Pressure washing","Home repairs","Car detailing","Mobile car detailing","Car washing","Mobile mechanic","Tire service","Barber","Hair stylist","Nail technician","Makeup artist","Personal trainer","Massage therapist","Photography","Videography","DJ","Event decorating","Event planning","Catering","Moving","Junk removal","Delivery","Courier","Passenger transportation","IT support","Computer repair","Tutoring","Bookkeeping","Graphic design","Digital marketing","Pet grooming","Pet sitting","Dog walking","Childcare","Home health care","Washing","Other"];
const categoryOptions=()=>SERVICE_CATEGORIES.map(x=>'<option>'+esc(x)+'</option>').join('');
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(cents||0)/100);
const when=iso=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(iso));
function csrf(){const cookie=document.cookie.split('; ').find(s=>s.startsWith('routedrop_csrf='));return cookie?decodeURIComponent(cookie.slice(15)):'';}
async function api(url,options={}){
 const method=options.method||'GET';
 const response=await fetch(url,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'x-csrf-token':csrf()}:{}),...(options.headers||{})}});
 let data;
 try{data=await response.json();}catch(e){throw Error('Server returned an unexpected response.');}
 if(!response.ok)throw Error(data.error||'Request failed.');
 return data;
}
function message(txt,bad=false){const el=$('status');el.textContent=txt||'';el.classList.toggle('bad',!!bad);}
function noSetup(){return '<div class="empty"><h3>Private beta setup is not finished</h3><p>Registration and persistent bookings will be available once the isolated RouteDrop database is connected. We are not collecting customer details or accepting payments yet.</p></div>';}
function overlay(content){$('modal-body').innerHTML=content;$('modal').classList.remove('hidden');}
function dismiss(){$('modal').classList.add('hidden');$('modal-body').innerHTML='';}
function nav(){
 const u=state.me?.user;
 $('nav-account').innerHTML=u?'<span class="muted">'+esc(u.full_name)+'</span>'+(state.config?.email_enabled&&!u.email_verified?'<button data-action="verify-email">Verify email</button>':'')+(state.me?.support_agent?'<button data-action="support-reviews">Support reviews</button>':'')+(state.config?.provider_verification&&state.me?.support_agent?'<button data-action="verification-reviews">Provider reviews</button>':'')+'<button data-action="change-password">Change password</button><button data-action="logout">Log out</button>':'<button data-action="login">Log in</button><button data-action="register">Sign up</button>';
}
function switchTab(tab){
 state.tab=tab;
 document.querySelectorAll('.page').forEach(el=>el.classList.toggle('hidden',el.id!==tab));
 document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
 refresh();
}
async function refresh(){
 if(!state.config)return;
 if(!state.config.database){
  $('offers').innerHTML=noSetup();$('offer-count').textContent='0 live listings';
  $('my-bookings').innerHTML=noSetup();$('studio-body').innerHTML=noSetup();nav();return;
 }
 try{
  const who=await api('/api/me');state.me=who;nav();
  if(state.tab==='explore'){
   const r=await api('/api/listings');state.listings=r.listings;renderOffers();
  }else if(state.tab==='bookings'){
   if(!state.me.user){$('my-bookings').innerHTML='<div class="empty">Please log in to see your bookings.</div>';return;}
   const r=await api('/api/bookings');state.bookings=r.bookings;state.deferred=state.config.deferred_booking?(await api('/api/deferred-bookings')).bookings:[];state.refunds=state.config.deferred_booking?(await api('/api/deferred-refunds')).requests:[];renderBookings();
  }else if(state.tab==='business') await studio();
 }catch(e){message(e.message,true);}
}
function renderOffers(){
 const search=$('search').value.trim().toLowerCase(),cat=$('category').value;
 const items=state.listings.filter(x=>(!cat||x.category===cat)&&(!search||[x.title,x.neighborhood,x.business_name,x.city].join(' ').toLowerCase().includes(search)));
 $('offer-count').textContent=items.length+' open slots';
 $('offers').innerHTML=items.length?items.map(x=>
  '<article class="card"><div class="cardbanner"><span>'+esc(x.category)+'</span><span>Available window</span></div><div class="cardbody"><div class="muted">'+esc(x.business_name)+'</div><h3>'+esc(x.title)+'</h3><div class="detail">⌖ '+esc(x.neighborhood)+', '+esc(x.city)+'</div><div class="detail">◷ '+when(x.slot_start)+' · '+esc(x.duration_minutes)+' min</div><div class="cardfoot"><span class="price">'+money(x.price_cents)+'</span><button class="btn dark" data-book="'+x.id+'">'+(state.config.deferred_booking?'Book free · save card':'Book this slot')+'</button></div></div></article>').join(''):'<div class="empty"><h3>No openings are listed yet.</h3><p>Local businesses can publish available slots from Business Studio after registration is enabled.</p></div>';
}
function deferredMarkup(bookings,role){
 if(!bookings.length)return '<div class="panel"><h3>Pay-after-service bookings</h3><p class="muted">No deferred bookings yet.</p></div>';
 return '<div class="panel"><h3>Pay-after-service bookings</h3><p class="muted">No upfront charge. A card is saved securely with Stripe. RouteDrop earns 8% only when payment succeeds.</p>'+
 bookings.map(b=>{
  let controls='';
  if(role==='customer'){
   if(['requested','accepted'].includes(b.status))controls='<button class="btn secondary" data-deferred-action="cancel" data-deferred-id="'+b.id+'">Cancel booking</button>';
   if(b.status==='work_completed')controls='<button class="btn" data-deferred-action="confirm" data-deferred-id="'+b.id+'">Confirm completed job &amp; pay '+money(b.price_cents)+'</button><button class="btn secondary" data-deferred-action="dispute" data-deferred-id="'+b.id+'">Report a problem</button>';
   if(['payment_failed','recovery_pending'].includes(b.status))controls='<button class="btn" data-deferred-action="recover" data-deferred-id="'+b.id+'">'+(b.status==='recovery_pending'?'Continue secure payment':'Finish payment securely')+'</button>';
   if(b.status==='paid')controls='<button class="btn secondary" data-deferred-action="request-refund" data-deferred-id="'+b.id+'">Request refund review</button>';
   if(b.status==='disputed' && b.review_state==='awaiting_customer')controls='<button class="btn" data-deferred-action="accept-resolution" data-deferred-id="'+b.id+'">Accept support proposal (no charge yet)</button><button class="btn secondary" data-deferred-action="decline-resolution" data-deferred-id="'+b.id+'">Decline proposal</button>';
  }else{
   if(b.status==='requested')controls='<button class="btn" data-deferred-action="accept" data-deferred-id="'+b.id+'">Accept</button><button class="btn secondary" data-deferred-action="decline" data-deferred-id="'+b.id+'">Decline</button>';
   if(b.status==='accepted')controls='<button class="btn" data-deferred-action="complete" data-deferred-id="'+b.id+'">Mark service completed</button>';
  }
  const help=b.status==='payment_failed'?'<p class="muted">The original charge failed. Secure Stripe Checkout is available after the failed payment is verified and canceled.</p>':(b.status==='disputed'?'<p class="muted">'+(b.review_state==='awaiting_customer'?'Support has proposed a resolution. Accepting does not charge your card. Payment still requires a separate confirmation.':b.review_state==='customer_declined'?'You declined the proposal; no charge while support reviews again.':'Support review required; no automatic card retry.')+'</p>':(b.review_state==='closed_no_charge'?'<p class="muted">Support closed this complaint without charging your card.</p>':(b.status==='needs_review'?'<p class="muted">Support review required; no automatic card retry.</p>':'')));
  return '<div class="record"><div><strong>'+esc(b.title)+'</strong><p>'+esc(b.business_name)+' · '+when(b.slot_start)+'</p><p class="muted">Quoted service price '+money(b.price_cents)+' · '+esc(b.status.replace(/_/g,' '))+'</p>'+help+(b.review_note?'<p class="muted">Support resolution: '+esc(b.review_note)+'</p>':'')+'</div><div class="buttonrow">'+controls+'</div></div>';
 }).join('')+'</div>';
}

function deferredRefundMarkup(refunds,role){
 if(!refunds.length)return '';
 return '<div class="panel"><h3>Pay-after-service refund requests</h3><p class="muted">Requests require provider approval. Stripe confirms any refund and reversal of the provider transfer and RouteDrop fee.</p>'+
 refunds.map(r=>'<div class="record"><div><strong>'+esc(r.title)+'</strong><p>'+when(r.slot_start)+' · '+money(r.price_cents)+'</p><p class="muted">'+esc(r.reason)+' · '+esc(r.status)+'</p></div><div class="buttonrow">'+
 (role==='business' && r.status==='pending'?'<button class="btn" data-deferred-refund-id="'+r.id+'" data-deferred-refund-decision="approve">Approve full refund</button><button class="btn secondary" data-deferred-refund-id="'+r.id+'" data-deferred-refund-decision="decline">Decline</button>':'')+'</div></div>').join('')+'</div>';
}

function renderBookings(){
 const list=state.bookings||[];
 $('my-bookings').innerHTML=list.length?list.map(b=>
  '<div class="panel"><div class="row"><div><h3>'+esc(b.title)+'</h3><div class="muted">'+esc(b.business_name)+' · '+when(b.slot_start)+'</div></div><span class="pill">'+esc(b.status.replace('_',' '))+'</span></div><div class="record"><span>Service price</span><strong>'+money(b.price_cents)+'</strong></div>'+(b.refund_cents?'<p class="muted">Refunded: '+money(b.refund_cents)+'</p>':'')+(b.dispute_status?'<p class="muted">Payment dispute: '+esc(b.dispute_status)+'</p>':'')+(b.cancellation_request_status?'<p class="muted">Cancellation request: '+esc(b.cancellation_request_status)+'</p>':'')+(state.me.user.role==='customer'&&['paid','completed'].includes(b.status)&&!b.cancellation_request_status?'<button class="btn secondary" data-cancel-request="'+b.id+'">Request cancellation / refund review</button>':'')+(state.me.user.role==='customer'&&b.status==='awaiting_payment'?'<button class="btn" data-retry="'+b.id+'">Retry payment</button>':'')+(state.me.user.role==='business'&&b.status==='paid'&&!['pending','processing','needs_review'].includes(b.cancellation_request_status)?'<button class="btn" data-complete="'+b.id+'">Mark job complete</button>':'')+'</div>').join(''):'<div class="empty"><h3>No bookings yet</h3><p>Bookings will appear here after a customer books a service.</p></div>';
 if(state.config.deferred_booking)$('my-bookings').innerHTML+=deferredMarkup(state.deferred,'customer')+deferredRefundMarkup(state.refunds,'customer');
}
async function studio(){
 const u=state.me?.user;
 if(!u){$('studio-body').innerHTML='<div class="empty"><h3>Business account required</h3><p>Create a business account to list open route slots.</p><button class="btn" data-action="register">Register a business</button></div>';return;}
 if(u.role!=='business'){$('studio-body').innerHTML='<div class="empty">You are signed in as a customer. Use a separate business account to publish routes.</div>';return;}
 const b=state.me.business,r=await Promise.all([api('/api/my-listings'),api('/api/bookings')]);
 state.mine=r[0].listings;state.bookings=r[1].bookings;state.deferred=state.config.deferred_booking?(await api('/api/deferred-bookings')).bookings:[];state.refunds=state.config.deferred_booking?(await api('/api/deferred-refunds')).requests:[];
 const verificationData=state.config.provider_verification?(await api('/api/provider-verification/me')).verification:null;
 const subscription=await api('/api/business/subscription');
 const cancellations=await api('/api/business/cancellation-requests');
 const completed=state.bookings.filter(x=>x.status==='completed').concat(state.deferred.filter(x=>x.status==='paid'));
 const gross=completed.reduce((sum,x)=>sum+x.price_cents,0),fee=completed.reduce((sum,x)=>sum+x.fee_cents,0);
 $('studio-body').innerHTML=
 '<div class="panel"><div class="row"><div><h3>'+esc(b.name)+'</h3><div class="muted">'+esc(b.city)+' · '+esc(b.category)+'</div></div><span class="pill">'+(b.stripe_connected?'Stripe account started':'Payouts not connected')+'</span></div>'+
 '<div class="buttonrow"><button class="btn" data-action="create-listing">+ Post available slot</button><button class="btn secondary" data-action="connect-stripe">'+(b.stripe_connected?'Continue Stripe onboarding':'Connect payouts')+'</button></div><p class="muted">Payment availability requires your Stripe onboarding to be completed and the RouteDrop platform to activate payments.</p></div>'+
 '<div class="panel"><h3>Business membership · $79/month</h3><p class="muted">Subscription status: '+esc(subscription.status)+(subscription.current_period_end?' · Next period: '+new Date(subscription.current_period_end*1000).toLocaleDateString('en-US'):'')+(subscription.last_invoice_status==='payment_failed'?' · Payment failed: update billing details':'')+(subscription.cancel_at_period_end?' (cancels at period end)':'')+'</p><div class="buttonrow"><button class="btn" data-action="subscribe">Subscribe · $79/month</button><button class="btn secondary" data-action="manage-subscription">Manage billing</button></div><p class="muted">Stripe sandbox only. Membership is not yet required to accept bookings.</p></div>'+
 '<div class="panel"><h3>Cancellation and refund requests</h3><p class="muted">Full refunds are guaranteed for eligible cancellations requested 24+ hours before service. Late requests are discretionary. Approvals issue a real Stripe refund in the configured payment mode.</p>'+(cancellations.requests.length?cancellations.requests.map(x=>'<div class="record"><div><strong>'+esc(x.title)+'</strong><p>'+when(x.slot_start)+' · '+esc(x.reason)+'</p><p class="muted">Booking #'+x.booking_id+' · '+esc(x.status)+' · '+(x.eligible_full_refund?'24-hour full-refund policy':'Late / discretionary')+'</p>'+(x.refund_amount_cents?'<p>Refund amount: '+money(x.refund_amount_cents)+'</p>':'')+'</div><div>'+(x.status==='pending'?'<button class="btn" data-request-id="'+x.id+'" data-decision="approve">Approve full refund</button>'+(x.eligible_full_refund?'':'<button class="btn secondary" data-request-id="'+x.id+'" data-decision="decline">Decline</button>'):'<strong>'+esc(x.status)+'</strong>')+'</div></div>').join(''):'<p class="muted">No cancellation requests.</p>')+'</div>'+
 '<div class="panel"><h3>Revenue snapshot</h3><div class="row"><div><small>Completed bookings</small><h2>'+completed.length+'</h2></div><div><small>Gross value</small><h2>'+money(gross)+'</h2></div><div><small>Platform fees (8%)</small><h2>'+money(fee)+'</h2></div></div></div>'+
 '<div class="panel"><h3>My route openings</h3>'+(state.mine.length?state.mine.map(x=>'<div class="record"><div><strong>'+esc(x.title)+'</strong><p>'+esc(x.neighborhood)+' · '+when(x.slot_start)+'</p></div><strong>'+money(x.price_cents)+'</strong></div>').join(''):'<p class="muted">No openings published yet.</p>')+'</div>'+
 '<div class="panel"><h3>Recent bookings</h3>'+(state.bookings.length?state.bookings.map(x=>'<div class="record"><div><strong>'+esc(x.title)+'</strong><p>'+when(x.slot_start)+' · '+esc(x.status)+'</p></div>'+(x.status==='paid'&&!['pending','processing','needs_review'].includes(x.cancellation_request_status)?'<button class="btn" data-complete="'+x.id+'">Complete</button>':'<strong>'+money(x.price_cents)+'</strong>')+'</div>').join(''):'<p class="muted">No bookings recorded.</p>')+'</div>';
 if(state.config.deferred_booking)$('studio-body').innerHTML+=deferredMarkup(state.deferred,'business')+deferredRefundMarkup(state.refunds,'business');
 if(verificationData)$('studio-body').innerHTML+=verificationPanel(verificationData);
}

function verificationPanel(v){
 const existing=Object.fromEntries((v.documents||[]).map(x=>[x.kind,x]));
 return '<div class="panel"><h3>Provider compliance · '+(v.eligible?'Reviewed requirements complete':'Review needed')+'</h3>'+
 '<p class="muted">Required for your primary category: '+esc(v.requirements.join(', '))+'. Other listing categories may have additional requirements. Do not upload ID numbers in text fields.</p>'+
 v.requirements.map(kind=>{
  const d=existing[kind],status=d?.status||'missing',expiry=d?.expires_at?' · expires '+new Date(d.expires_at).toLocaleDateString():'';
  return '<div class="record"><div><strong>'+esc(kind.replaceAll('_',' '))+'</strong><p class="muted">'+esc(status)+esc(expiry)+(d?.has_document?' · encrypted document on file':'')+'</p></div>'+
   (d?.has_document?'<button class="btn secondary" data-delete-evidence="'+esc(kind)+'">Remove</button>':'')+'</div>';
 }).join('')+
 (v.manualReview?'<p class="muted">This service category also requires a separate policy review.</p>':'')+
 '<div class="buttonrow"><button class="btn" data-action="upload-credential">Submit document for review</button></div>'+
 '<p class="muted">Document upload does not mean approval. RouteDrop reviews submitted evidence before bookings are enabled.</p></div>';
}
async function showVerificationUpload(){
 const r=await api('/api/provider-verification/me');
 overlay('<h2 id="modal-title">Secure provider document submission</h2><p class="muted">Submit a PDF, PNG, or JPEG up to 2 MB. The document is encrypted and available only to authorized reviewers. Avoid uploading unrelated personal information.</p>'+
 '<form id="credential-upload-form"><label>Document type</label><select name="kind">'+r.credentialKinds.map(x=>'<option value="'+esc(x)+'">'+esc(x.replaceAll('_',' '))+(r.verification.requirements.includes(x)?' (primary category requirement)':'')+'</option>').join('')+'</select>'+
 '<label>Document file</label><input type="file" name="document" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required>'+
 '<p id="form-error" class="bad"></p><button type="submit" class="btn">Submit securely for review</button></form>');
}
async function showVerificationQueue(){
 const r=await api('/api/provider-verification/review-queue');
 overlay('<h2 id="modal-title">Provider document review queue</h2><p class="muted">Restricted operator access. Inspect evidence before approving. Do not accept documents that are expired, mismatched or unverifiable.</p>'+
 (r.queue.length?r.queue.map(d=>'<div class="record"><div><strong>'+esc(d.name)+'</strong><p class="muted">Business #'+esc(d.business_id)+' · '+esc(d.kind.replaceAll('_',' '))+'</p>'+
 (d.has_document?'<a href="/api/provider-verification/review-document/'+encodeURIComponent(d.business_id)+'/'+encodeURIComponent(d.kind)+'">Download evidence for review (private)</a>':'<p class="muted">No document uploaded'+(d.evidence_reference?' · business info reference: '+esc(d.evidence_reference):'')+'</p>')+'</div>'+
 '<div class="buttonrow"><button class="btn" data-verification-review="approved" data-review-kind="'+esc(d.kind)+'" data-review-business="'+esc(d.business_id)+'">Approve</button>'+
 '<button class="btn secondary" data-verification-review="rejected" data-review-kind="'+esc(d.kind)+'" data-review-business="'+esc(d.business_id)+'">Reject</button></div></div>').join(''):'<p class="muted">No pending document reviews.</p>'));
}

async function showSupportReviews(){
 const r=await api('/api/support/deferred-disputes');
 overlay('<h2 id="modal-title">Support dispute reviews</h2><p>Independent support-only decisions. No payment is made here. A customer must accept a proposed resolution and separately approve payment.</p>'+
  (r.disputes.length?r.disputes.map(d=>'<div class="record"><div><strong>Booking #'+esc(d.id)+' · '+esc(d.title)+'</strong><p>'+esc(d.business_name)+' · '+money(d.price_cents)+'</p><p class="muted">Customer report: '+esc(d.dispute_reason)+'</p><p class="muted">Review: '+esc(d.review_state)+(d.resolution_note?' · '+esc(d.resolution_note):'')+'</p></div><div class="buttonrow">'+
  (['open','customer_declined'].includes(d.review_state)?'<button class="btn secondary" data-support-decision="close_no_charge" data-support-booking="'+esc(d.id)+'">Close without charge</button><button class="btn" data-support-decision="request_customer_approval" data-support-booking="'+esc(d.id)+'">Request customer approval</button>':'<span class="muted">Awaiting customer response</span>')+
  '</div></div>').join(''):'<p class="muted">No pending unpaid disputes.</p>'));
}
function showRegistration(){
 overlay('<h2 id="modal-title">Create your account</h2><p>Join RouteDrop as a customer or service professional.</p><form id="register-form"><label>Account type</label><select name="role" id="register-role"><option value="customer">Customer</option><option value="business">Business owner</option></select><label>Your full name</label><input name="name" minlength="2" maxlength="90" required autocomplete="name"><label>Email address</label><input name="email" type="email" maxlength="254" required autocomplete="email"><label>Password (12+ characters)</label><input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"><div id="business-fields" class="hidden"><label>Business name</label><input name="businessName" maxlength="120"><label>City</label><input name="city" maxlength="100" value="Decatur, AL"><label>Service category</label><select name="category">'+categoryOptions()+'</select></div><p class="legal">Use a unique password. Verification will be required for payments when email delivery is enabled.</p><p id="form-error" class="error"></p><button type="submit" class="btn">Register</button></form>');
}
function showLogin(){
 overlay('<h2 id="modal-title">Welcome back</h2><p>Log in to your RouteDrop account.</p><form id="login-form"><label>Email</label><input type="email" name="email" maxlength="254" autocomplete="email" required><label>Password</label><input type="password" name="password" autocomplete="current-password" required><p id="form-error" class="error"></p><button class="btn" type="submit">Log in</button><button type="button" class="btn secondary" data-action="forgot-password">Forgot password?</button></form>');
}
function showChangePassword(){
 overlay('<h2 id="modal-title">Change password</h2><p>Use a unique password with at least 12 characters. Updating it will sign you out of all sessions.</p><form id="change-password-form"><label>Current password</label><input name="currentPassword" type="password" autocomplete="current-password" required><label>New password</label><input name="newPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><p id="form-error" class="error"></p><button class="btn" type="submit">Update password</button></form>');
}
function showForgotPassword(){
 overlay('<h2 id="modal-title">Reset password</h2><p>We will send a one-time reset link if this email has an account.</p><form id="forgot-form"><label>Email</label><input name="email" type="email" maxlength="254" required><p id="form-error" class="error"></p><button type="submit" class="btn">Email reset link</button></form>');
}
function showResetPassword(token){
 overlay('<h2 id="modal-title">Choose a new password</h2><form id="reset-form"><input type="hidden" name="token" value="'+esc(token)+'"><label>New password (12+ characters)</label><input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><p id="form-error" class="error"></p><button type="submit" class="btn">Change password</button></form>');
}
async function verifyEmailToken(token){
 try{const r=await api('/api/auth/verify',{method:'POST',body:JSON.stringify({token})});message(r.message);await refresh();}
 catch(e){message('Email verification failed: '+e.message,true);}
}
function showListing(){
 overlay('<h2 id="modal-title">Publish an available opening</h2><p>Publish one real service time window. New deferred bookings save a card with $0 charged today; payment requires customer confirmation after completed work.</p><form id="listing-form"><label>Service title</label><input name="title" required maxlength="120" placeholder="Driveway cleaning"><label>Category</label><select name="category">'+categoryOptions()+'</select><label>Service neighborhood</label><input name="neighborhood" maxlength="100" required placeholder="Southeast Decatur"><label>Price in USD</label><input name="price" required type="number" step="0.01" min="5" max="5000"><label>Date & time</label><input name="slotStart" required type="datetime-local"><label>Duration (minutes)</label><input name="durationMinutes" required type="number" min="30" max="480" value="60" step="15"><p id="form-error" class="error"></p><button class="btn" type="submit">Publish route</button></form>');
}
async function act(e){
 const el=e.target.closest('button');if(!el)return;
 if(el.dataset.tab){switchTab(el.dataset.tab);return;}
 const action=el.dataset.action;
 if(action==='register'){showRegistration();return;}
 if(action==='login'){showLogin();return;}
 if(action==='create-listing'){showListing();return;}
 if(action==='support-reviews'){try{await showSupportReviews();}catch(err){message(err.message,true);}return;}
 if(action==='verification-reviews'){try{await showVerificationQueue();}catch(err){message(err.message,true);}return;}
 if(action==='upload-credential'){try{await showVerificationUpload();}catch(err){message(err.message,true);}return;}
 if(action==='change-password'){showChangePassword();return;}
 if(action==='forgot-password'){showForgotPassword();return;}
 if(action==='verify-email'){try{const r=await api('/api/auth/request-verification',{method:'POST'});message(r.message);}catch(e){message(e.message,true);}return;}
 if(action==='logout'){try{await api('/api/logout',{method:'POST'});state.me=null;message('Signed out.');refresh();}catch(err){message(err.message,true);}return;}
 if(action==='subscribe'||action==='manage-subscription'){try{const url=action==='subscribe'?'/api/business/subscribe':'/api/business/subscription/portal';const r=await api(url,{method:'POST'});location.assign(r.url);}catch(err){message(err.message,true);}return;}
 if(action==='connect-stripe'){try{const r=await api('/api/stripe/connect',{method:'POST'});location.assign(r.url);}catch(err){message(err.message,true);}return;}
 if(el.dataset.deleteEvidence){
  const kind=el.dataset.deleteEvidence;
  if(!confirm('Remove your encrypted '+kind.replaceAll('_',' ')+' document? Any existing approval for it will be revoked.'))return;
  el.disabled=true;
  try{await api('/api/provider-verification/document/'+encodeURIComponent(kind),{method:'DELETE'});message('Credential removed; review is now pending.');await studio();}
  catch(err){message(err.message,true);el.disabled=false;}return;
 }
 if(el.dataset.verificationReview&&el.dataset.reviewBusiness&&el.dataset.reviewKind){
  const decision=el.dataset.verificationReview,kind=el.dataset.reviewKind,businessId=Number(el.dataset.reviewBusiness);
  const note=prompt('Review decision note (at least 12 characters; no private document details):');if(note===null)return;
  if(note.trim().length<12)return message('A review note of 12 or more characters is required.',true);
  let expiresAt=null;
  if(decision==='approved'&&!['identity','business_info'].includes(kind)){
   expiresAt=prompt('Credential expiration date (YYYY-MM-DD; must be within one year):');
   if(expiresAt===null)return;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt))return message('Enter a valid YYYY-MM-DD date.',true);
   expiresAt+='T23:59:59.000Z';
  }
  if(!confirm('Record the '+decision+' decision for '+kind.replaceAll('_',' ')+'?'))return;
  el.disabled=true;
  try{await api('/api/provider-verification/review',{method:'POST',body:JSON.stringify({businessId,kind,decision,note,expiresAt})});message('Review decision recorded.');await showVerificationQueue();}
  catch(err){message(err.message,true);}finally{el.disabled=false;}return;
 }
 if(el.dataset.book){
  if(!state.me?.user){showLogin();message('Please log in to book a service.');return;}
  if(state.me.user.role!=='customer'){message('Only customer accounts can book services.',true);return;}
  if(!state.config.payments){message('Stripe payment setup is not activated yet.',true);return;}
  const quote=state.listings.find(x=>String(x.id)===String(el.dataset.book));
  if(state.config.deferred_booking && !confirm('Book '+(quote?.title||'this service')+' for $0 today? You authorize RouteDrop to securely save your card for the quoted price of '+money(quote?.price_cents)+'. Your card is charged only after the provider finishes and you confirm completion. RouteDrop takes 8% from the provider share.'))return;
  el.disabled=true;
  try{
   const url=state.config.deferred_booking?'/api/deferred-bookings':'/api/checkout';
   const body=state.config.deferred_booking?{listingId:Number(el.dataset.book),consent:true,termsVersion:'deferred-v1'}:{listingId:Number(el.dataset.book)};
   const result=await api(url,{method:'POST',body:JSON.stringify(body)});location.assign(result.url);
  }catch(err){message(err.message,true);el.disabled=false;}
  return;
 }
 if(el.dataset.supportDecision && el.dataset.supportBooking){
  const id=Number(el.dataset.supportBooking),decision=el.dataset.supportDecision;
  const note=prompt('Enter a resolution note (at least 12 characters) shown to the customer and provider. Do not include private information:');
  if(note===null)return;
  if(note.trim().length<12)return message('Enter at least 12 characters.',true);
  if(!confirm(decision==='close_no_charge'?'Close this dispute without collecting payment?':'Ask the customer to review the proposal? Payment remains blocked unless they later approve it.'))return;
  el.disabled=true;
  try{const r=await api('/api/support/deferred-disputes/'+id+'/decision',{method:'POST',body:JSON.stringify({decision,note})});message(r.message);await showSupportReviews();}
  catch(err){message(err.message,true);}finally{el.disabled=false;}return;
 }
 if(el.dataset.deferredId && el.dataset.deferredAction){
  const id=Number(el.dataset.deferredId),action=el.dataset.deferredAction,booking=state.deferred.find(b=>Number(b.id)===id);
  if(!booking)return message('Refresh bookings and retry.',true);
  let body={};
  if(action==='confirm'){
   if(!confirm('The service is complete and you approve charging '+money(booking.price_cents)+' to your saved card now. Confirm?'))return;
   body={confirmCompletion:true};
  }
  if(action==='complete' && !confirm('Mark this service complete and request customer approval? No charge is made yet.'))return;
   if(action==='accept-resolution'){
    if(!confirm('Accept the support proposal and reopen the booking? NO charge occurs now. You would separately confirm the work and authorize payment of '+money(booking.price_cents)+'.'))return;
    body={acceptResolution:true};
   }
   if(action==='decline-resolution' && !confirm('Decline the support proposal? The booking remains disputed and uncharged.'))return;
  if(action==='cancel' && !confirm('Cancel this booking without a charge?'))return;
  if(action==='dispute' || action==='request-refund'){
   const reason=prompt(action==='request-refund'?'Explain why you request a refund (at least 10 characters):':'Describe the problem with the completed service (at least 10 characters).');
   if(reason===null)return;
   body={reason};
  }
  el.disabled=true;
  try{const result=await api('/api/deferred-bookings/'+id+'/'+action,{method:'POST',body:JSON.stringify(body)});if(action==='recover' && result.url){location.assign(result.url);return;}message(result.message||'Booking updated.');await refresh();}
  catch(err){message(err.message,true);}finally{el.disabled=false;}
  return;
 }
 if(el.dataset.deferredRefundId && el.dataset.deferredRefundDecision){
  const id=Number(el.dataset.deferredRefundId),decision=el.dataset.deferredRefundDecision;
  const refund=state.refunds.find(r=>Number(r.id)===id);
  if(!refund || refund.status!=='pending')return message('Refresh refund requests.',true);
  if(!confirm(decision==='approve'?'Approve a full Stripe refund of '+money(refund.price_cents)+'? This also reverses the provider transfer and RouteDrop 8% application fee.':'Decline this refund request?'))return;
  el.disabled=true;
  try{const r=await api('/api/deferred-refunds/'+id+'/decision',{method:'POST',body:JSON.stringify({decision})});message(r.message||('Refund request '+r.status+'.'));await refresh();}
  catch(err){message(err.message,true);}finally{el.disabled=false;}
  return;
 }
 if(el.dataset.requestId && el.dataset.decision){const decision=el.dataset.decision;const id=Number(el.dataset.requestId);if(!confirm(decision==='approve'?'Issue a full Stripe refund to this customer and reverse the provider transfer and platform fee?':'Decline this discretionary refund request?'))return;el.disabled=true;try{const r=await api('/api/business/cancellation-requests/'+id+'/decision',{method:'POST',body:JSON.stringify({decision})});message(r.message||('Cancellation request '+r.status+'.'));refresh();}catch(err){message(err.message,true);el.disabled=false;}return;}
 if(el.dataset.cancelRequest){const reason=prompt('Please describe why you are requesting cancellation (10 characters minimum):');if(reason===null)return;try{const r=await api('/api/bookings/'+Number(el.dataset.cancelRequest)+'/request-cancellation',{method:'POST',body:JSON.stringify({reason})});message(r.message);refresh();}catch(err){message(err.message,true);}return;}
 if(el.dataset.retry){el.disabled=true;try{const r=await api('/api/bookings/'+Number(el.dataset.retry)+'/retry-payment',{method:'POST'});location.assign(r.url);}catch(err){message(err.message,true);el.disabled=false;}return;}
 if(el.dataset.complete){try{await api('/api/bookings/'+Number(el.dataset.complete)+'/complete',{method:'POST'});message('Job marked completed.');refresh();}catch(err){message(err.message,true);}return;}
}
async function submit(e){
 if(!['register-form','login-form','listing-form','forgot-form','reset-form','change-password-form','credential-upload-form'].includes(e.target.id))return;
 e.preventDefault();
 const form=e.target,d=Object.fromEntries(new FormData(form).entries());
 const err=$('form-error');err.textContent='';
 const submit=form.querySelector('button[type=submit]');submit.disabled=true;
 try{
  if(form.id==='credential-upload-form'){
   const file=form.querySelector('[name=document]').files[0];
   if(!file||file.size>2*1024*1024||file.size<24)throw Error('Choose a PDF, PNG, or JPEG between 24 bytes and 2 MB.');
   const response=await api('/api/provider-verification/document',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-evidence-kind':String(d.kind)},body:await file.arrayBuffer()});
   message('Document received, encrypted, and awaiting manual review.');
  }
  if(form.id==='register-form'){const r=await api('/api/register',{method:'POST',body:JSON.stringify(d)});message(r.email_verification_required?'Account created. Check your email for a verification link.':'Account created. Email verification will be available when delivery is configured.');}
  if(form.id==='login-form'){await api('/api/login',{method:'POST',body:JSON.stringify(d)});message('Signed in successfully.');}
  if(form.id==='change-password-form'){const r=await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:d.currentPassword,newPassword:d.newPassword})});state.me=null;message(r.message);}
  if(form.id==='forgot-form'){const r=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:d.email})});message(r.message);}
  if(form.id==='reset-form'){const r=await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:d.token,password:d.password})});history.replaceState(null,'',location.pathname);message(r.message);}
  if(form.id==='listing-form'){
   const amount=Math.round(Number(d.price)*100),date=new Date(d.slotStart);
   if(!Number.isSafeInteger(amount)||!Number.isFinite(date.getTime()))throw Error('Invalid price or date.');
   await api('/api/listings',{method:'POST',body:JSON.stringify({title:d.title,category:d.category,neighborhood:d.neighborhood,priceCents:amount,slotStart:date.toISOString(),durationMinutes:Number(d.durationMinutes)})});
   message('Opening published.');}
  dismiss();refresh();
 }catch(ex){err.textContent=ex.message;}finally{submit.disabled=false;}
}
async function init(){
 document.addEventListener('click',act);
 document.addEventListener('submit',submit);
 $('register-role')?.addEventListener('change',()=>{});
 $('modal').addEventListener('change',e=>{if(e.target.id==='register-role')$('business-fields').classList.toggle('hidden',e.target.value!=='business');});
 $('close-modal').addEventListener('click',dismiss);
 $('modal').addEventListener('click',e=>{if(e.target.id==='modal')dismiss();});
 $('search').addEventListener('input',renderOffers);
 $('category').addEventListener('change',renderOffers);
 try {
  state.config=await api('/api/config');
  const actionParams=new URLSearchParams(location.search);
  if(actionParams.has('reset')){const token=actionParams.get('reset');history.replaceState(null,'',location.pathname);showResetPassword(token);}
  else if(actionParams.has('verify')){const token=actionParams.get('verify');history.replaceState(null,'',location.pathname);await verifyEmailToken(token);}
  if(!state.config.database)message('Private beta: an isolated database must be connected before registration and bookings can work.');
  else if(!state.config.payments)message('Accounts and listings enabled. Stripe payments and payouts are not yet configured.');
  if(new URLSearchParams(location.search).has('card'))message('Returned from secure card setup. Your free booking appears after Stripe confirms the saved card.');
  if(new URLSearchParams(location.search).has('recovery'))message('Returned from secure payment recovery. Your booking status updates only after Stripe confirms payment.');
  if(new URLSearchParams(location.search).has('subscription'))message('Returned from subscription billing. Open Business Studio to check your subscription status.');
  if(new URLSearchParams(location.search).has('payment'))message('Returned from checkout. Payment status is confirmed only through the Stripe webhook; check My bookings.');
  if(new URLSearchParams(location.search).has('stripe'))message('Returned from Stripe onboarding. Payout readiness is checked when a checkout begins.');
  await refresh();
 }catch(ex){message('Could not connect to the RouteDrop server: '+ex.message,true);}
}
init();
})();
