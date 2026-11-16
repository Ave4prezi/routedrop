'use strict';
(function(){
const $=id=>document.getElementById(id);
const coverage=window.RouteDropServiceArea;
const premium=window.RouteDropPremium2;
const pilot=window.RouteDropPilotUI;
 const opportunities=window.RouteDropOpportunities;
 const unified=window.RouteDropUnified;
 const trust=window.RouteDropTrustUI;
 const safetyUi=window.RouteDropSafetyUI;
 const readiness=window.RouteDropReadiness;
 const passkeys=window.RouteDropPasskeys;
const state={config:null,me:null,listings:[],bookings:[],mine:[],tab:'explore',demo:false,demoRequests:[],demoCounter:0,demoListingId:null,demoSlot:'afternoon',demoArea:{center:'decatur',radiusMiles:20},pilotRequests:[],pilotListingId:null,jobs:[],jobSearch:'',serviceProfiles:[],myServiceProfiles:{profiles:[],rules:[]},jobInterests:null,compareIds:[],profileSort:'default',profileCategory:'',moderatorKey:null,safetyStatus:null,myReviews:[],identityStatus:null};
const esc=v=>String(v===null||v===undefined?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
let dialogReturnFocus=null;
function overlay(content){
 dialogReturnFocus=document.activeElement;
 $('modal-body').innerHTML=content;
 $('modal').classList.remove('hidden');
 $('close-modal').focus();
}
function dismiss(){
 if($('modal').classList.contains('hidden'))return;
 $('modal').classList.add('hidden');$('modal-body').innerHTML='';
 if(dialogReturnFocus?.isConnected)dialogReturnFocus.focus();
 dialogReturnFocus=null;
}
function dialogKeys(event){
 if($('modal').classList.contains('hidden'))return;
 if(event.key==='Escape'){event.preventDefault();dismiss();return;}
 if(event.key!=='Tab')return;
 const controls=Array.from($('modal').querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])')).filter(el=>el.getClientRects().length);
 if(!controls.length)return;
 const first=controls[0],last=controls[controls.length-1];
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
function nav(){
 if(state.demo&&!state.config?.database){
  $('nav-account').innerHTML='<button type="button" data-tab="bookings" aria-label="Explore fictional customer experience">Customer tour</button><button type="button" data-tab="business" aria-label="Explore fictional provider experience">Provider tour</button>';
  return;
 }
 const u=state.me?.user;
 $('nav-account').innerHTML=u?'<span class="muted">'+esc(u.full_name)+'</span>'+(state.config?.email_enabled&&!u.email_verified?'<button data-action="verify-email">Verify email</button>':'')+'<button data-action="change-password">Change password</button><button data-action="logout">Log out</button>':'<button data-action="login">Log in</button><button data-action="register">Sign up</button>';
}
async function renderSafety(){
 const target=$('safety-body');if(!target)return;
 if(!state.config?.safety_pilot){target.innerHTML=safetyUi.overview(null,null,state.config)+safetyUi.identityPanel(null,{available:false,status:'not_started'});return;}
 const [screening,own,identity]=await Promise.all([
  state.me?.business?api('/api/pilot/safety/provider'):Promise.resolve({screening:null}),
  state.me?.user?api('/api/pilot/safety/my-reviews'):Promise.resolve({reviews:[]}),
  state.me?.business?api('/api/pilot/identity/status'):Promise.resolve({available:false,status:'not_started'})
 ]);
 state.safetyStatus=screening;state.myReviews=own.reviews;state.identityStatus=identity;
 target.innerHTML=safetyUi.overview(state.me,screening,state.config,own.reviews)+safetyUi.identityPanel(state.me,identity);
 if(state.moderatorKey){
  try{
   const data=await api('/api/pilot/safety/moderation',{headers:{'x-routedrop-moderator-key':state.moderatorKey}});
   target.innerHTML+=safetyUi.queue(data);
  }catch(e){state.moderatorKey=null;message('Moderator session no longer authorized: '+e.message,true);}
 }
}
function catalogItems(){return !state.config?.unified_pilot?trust.demoProfiles:state.serviceProfiles;}
 function renderCatalog(){const target=$('profile-cards');if(target)target.innerHTML=unified.profiles(state.serviceProfiles,state.config,{selected:state.compareIds,sort:state.profileSort,category:state.profileCategory});}
 function switchTab(tab){
 state.tab=tab;
 document.querySelectorAll('.page').forEach(el=>el.classList.toggle('hidden',el.id!==tab));
 document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
 document.querySelectorAll('nav.tabs [data-tab]').forEach(el=>{
  if(el.dataset.tab===tab)el.setAttribute('aria-current','page');
  else el.removeAttribute('aria-current');
 });
 refresh();
}
async function refresh(){
 if(!state.config)return;
 if(!state.config.database){
  state.demo=true;state.listings=premium.DEMO;renderOffers();
  $('my-bookings').innerHTML=premium.bookings(state.demoRequests);$('studio-body').innerHTML=unified.entry()+unified.previewStudio()+premium.studio(serviceCoveragePanel({service_center_code:state.demoArea.center,service_radius_miles:state.demoArea.radiusMiles},true),state.demoRequests);state.jobs=opportunities.sampleJobs;$('job-board').innerHTML=unified.entry()+unified.seekerPanel(null,null)+opportunities.jobs(state.jobs,true,state.jobSearch);renderCatalog();$('safety-body').innerHTML=safetyUi.overview(null,null,state.config);nav();return;
 }
 try{
  const who=await api('/api/me');state.me=who;nav();
  if(state.tab==='explore'){
   const [r,p]=await Promise.all([api('/api/listings'),state.config.unified_pilot?api('/api/pilot/service-profiles'):Promise.resolve({profiles:[]})]);state.listings=r.listings;state.serviceProfiles=p.profiles;renderOffers();renderCatalog();
  }else if(state.tab==='bookings'){
   if(state.config.workflow_pilot){
    if(!state.me.user){$('my-bookings').innerHTML='<div class="empty"><h3>Test account required</h3><p>Create a customer test account or sign in to see requests.</p><button type="button" class="btn" data-action="register">Create test account</button></div>';return;}
    state.pilotRequests=(await api('/api/pilot/requests?view=customer')).requests;
    $('my-bookings').innerHTML=pilot.customer(state.pilotRequests);return;
   }
   if(!state.me.user){$('my-bookings').innerHTML='<div class="empty">Please log in to see your bookings.</div>';return;}
   const r=await api('/api/bookings');state.bookings=r.bookings;renderBookings();
  }else if(state.tab==='business') await studio();
   else if(state.tab==='jobs') await loadJobs();
   else if(state.tab==='safety') await renderSafety();
 }catch(e){message(e.message,true);}
}
async function loadJobs(){
  if(!state.config?.opportunity_pilot){state.jobs=opportunities.sampleJobs;$('job-board').innerHTML=opportunities.jobs(state.jobs,true,state.jobSearch);return;}
  const [data,interests]=await Promise.all([api('/api/pilot/jobs'),state.me?.user&&state.config.unified_pilot?api('/api/pilot/job-interests'):Promise.resolve({interests:null})]);
  state.jobs=data.jobs;state.jobInterests=interests.interests;
  $('job-board').innerHTML=unified.entry()+unified.seekerPanel(state.me,state.jobInterests)+opportunities.jobs(state.jobs,false,state.jobSearch);
 }
 function serviceCoveragePanel(b,readonly=false){
 const v=coverage.validate(b?.service_center_code,b?.service_radius_miles);
 const city=Object.entries(coverage.CITIES).map(([key,p])=>'<option value="'+key+'"'+(v?.center===key?' selected':'')+'>'+esc(p.name)+', AL</option>').join('');
 const choices='<option value="">Choose your approximate city center</option>'+city;
 return '<div class="panel service-area-panel"><div class="row"><div><h3>'+(readonly?'Sample service radius — interactive preview':'Service coverage radius')+'</h3><p class="muted">Choose where your business works and how many miles you travel. This uses an approximate city-center point, never your home address or phone GPS.</p></div><span class="pill">'+(readonly?'Fictional demo':v?'Area configured':'Not configured')+'</span></div>'+
 '<label for="area-city">Service-area center</label><select id="area-city">'+choices+'</select>'+
 '<label for="area-radius">Travel radius: <strong id="area-radius-value">'+(v?v.radiusMiles:15)+' miles</strong></label><input id="area-radius" type="range" min="5" max="50" step="5" value="'+(v?v.radiusMiles:15)+'" aria-describedby="area-help area-live-summary" aria-valuetext="'+(v?v.radiusMiles:15)+' miles">'+
 '<div class="radius-presets" aria-label="Quick radius selections">'+[5,10,20,30,40,50].map(m=>'<button type="button" class="radius-preset" data-radius-preset="'+m+'" aria-pressed="'+(m===(v?v.radiusMiles:15))+'">'+m+' mi</button>').join('')+'</div>'+
 '<p id="area-live-summary" class="radius-summary" role="status" aria-live="polite">'+(v?esc(coverage.summary(v.center,v.radiusMiles)):'Choose a city to preview coverage.')+'</p>'+
 '<div class="coverage-map-wrap" id="business-area-map" aria-live="polite">'+(v?coverage.mapSvg(v.center,v.radiusMiles):'<p class="muted">Select a city to preview your coverage area.</p>')+'</div>'+
 '<p class="muted" id="area-help">The ring shows straight-line miles, not drive time, road access, or confirmed eligibility for a specific address. Routes and service eligibility must be confirmed before booking.</p>'+
 (readonly?'<p class="muted">Preview only: no service area is saved until the database is enabled and a verified business owner signs in.</p>':'<div class="buttonrow"><button type="button" class="btn" data-action="save-coverage">Save service radius</button></div>')+'</div>';
}
function updateCoveragePreview(){
 const city=$('area-city'),range=$('area-radius'),label=$('area-radius-value'),map=$('business-area-map');
 if(!city||!range||!map)return;
 label.textContent=range.value+' miles';range.setAttribute('aria-valuetext',range.value+' miles');
 const v=coverage.validate(city.value,range.value);
 if(state.demo&&!state.config?.database&&v)state.demoArea={center:v.center,radiusMiles:v.radiusMiles};
 map.innerHTML=v?coverage.mapSvg(v.center,v.radiusMiles):'<p class="muted">Select a city to preview your coverage area.</p>';
 const summary=$('area-live-summary');if(summary)summary.textContent=v?coverage.summary(v.center,v.radiusMiles):'Choose a city to preview coverage.';
 document.querySelectorAll('[data-radius-preset]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.radiusPreset)===Number(range.value))));
}
function showCoverageFor(x){
 const v=coverage.validate(x.service_center_code,x.service_radius_miles);
 if(!v)return message('This business has not selected a service coverage area.',true);
 overlay('<h2 id="modal-title">Coverage for '+esc(x.business_name)+'</h2><p>'+esc(coverage.summary(v.center,v.radiusMiles))+'. The circle is indicative, not a guarantee the business can service a given address.</p><div class="coverage-map-wrap">'+coverage.mapSvg(v.center,v.radiusMiles)+'</div><p class="legal">Approximate city-center range only. No device location or address information is collected by this map.</p>');
}

function renderOffers(){
 const search=$('search').value.trim().toLowerCase(),cat=$('category').value;
 const items=state.listings.filter(x=>(!cat||x.category===cat)&&(!search||[x.title,x.neighborhood,x.business_name,x.city].join(' ').toLowerCase().includes(search)));
 $('offer-count').textContent=items.length+' '+(state.demo?'example':'available')+' service'+(items.length===1?'':'s');
 $('filter-summary').textContent=items.length?(state.demo?'Fictional businesses for design review — booking is disabled.':'Explore available listings and their declared service areas.'):'No matching services. Reset filters or try another search.';
 document.querySelectorAll('[data-category-choice]').forEach(el=>{
  const chosen=el.dataset.categoryChoice===cat;
  el.classList.toggle('selected',chosen);
  el.setAttribute('aria-pressed',String(chosen));
 });
 $('offers').innerHTML=items.length?premium.cards(items,state.config,coverage):'<div class="empty"><h3>No matches in this category</h3><p>Try all services or another search term.</p><button type="button" class="btn" data-action="clear-filters">Reset filters</button></div>';
}

function renderBookings(){
 const list=state.bookings||[];
 $('my-bookings').innerHTML=list.length?list.map(b=>
  '<div class="panel"><div class="row"><div><h3>'+esc(b.title)+'</h3><div class="muted">'+esc(b.business_name)+' · '+when(b.slot_start)+'</div></div><span class="pill">'+esc(b.status.replace('_',' '))+'</span></div><div class="record"><span>Service price</span><strong>'+money(b.price_cents)+'</strong></div>'+(b.refund_cents?'<p class="muted">Refunded: '+money(b.refund_cents)+'</p>':'')+(b.dispute_status?'<p class="muted">Payment dispute: '+esc(b.dispute_status)+'</p>':'')+(b.cancellation_request_status?'<p class="muted">Cancellation request: '+esc(b.cancellation_request_status)+'</p>':'')+(state.me.user.role==='customer'&&['paid','completed'].includes(b.status)&&!b.cancellation_request_status?'<button class="btn secondary" data-cancel-request="'+b.id+'">Request cancellation / refund review</button>':'')+(state.me.user.role==='customer'&&b.status==='awaiting_payment'?'<button class="btn" data-retry="'+b.id+'">Retry payment</button>':'')+(state.me.user.role==='business'&&b.status==='paid'&&!['pending','processing','needs_review'].includes(b.cancellation_request_status)?'<button class="btn" data-complete="'+b.id+'">Mark job complete</button>':'')+'</div>').join(''):'<div class="empty"><h3>No bookings yet</h3><p>Bookings will appear here after a customer checks out.</p></div>';
}
async function studio(){
 const u=state.me?.user;
 if(!u){$('studio-body').innerHTML=unified.entry()+'<div class="panel"><h3>One account for every path</h3><p>Sign up with a fictional test identity. You can book services, find work and offer your own services with the same login.</p><button class="btn" data-action="register">Create one account</button></div>';return;}
 if(state.config.unified_pilot){
  if(!state.me.business){$('studio-body').innerHTML=unified.entry()+'<div class="panel"><h3>Activate your provider profile</h3><p>Start as an individual without registering a company. Your existing customer bookings and job interests remain on this account.</p><button class="btn" data-action="start-provider">Create provider profile</button></div>';return;}
  const [listings,requests,jobs,profiles,screening,identity]=await Promise.all([api('/api/my-listings'),api('/api/pilot/requests?view=provider'),api('/api/pilot/my-jobs'),api('/api/pilot/my-service-profiles'),api('/api/pilot/safety/provider'),api('/api/pilot/identity/status')]);
  state.mine=listings.listings;state.pilotRequests=requests.requests;state.myServiceProfiles=profiles;state.safetyStatus=screening;state.identityStatus=identity;
  $('studio-body').innerHTML=unified.entry()+readiness.providerChecklist(state.me,screening,identity,state.config)+pilot.studio(state.me.business,state.mine,state.pilotRequests,serviceCoveragePanel(state.me.business))+unified.studio(profiles,state.me.business.provider_kind)+opportunities.employerPanel(jobs.jobs,state.me.business.provider_kind);return;
 }
 if(u.role!=='business'){$('studio-body').innerHTML='<div class="empty">A business account is required to publish routes outside the private pilot.</div>';return;}
 const b=state.me.business,r=await Promise.all([api('/api/my-listings'),api('/api/bookings')]);
 state.mine=r[0].listings;state.bookings=r[1].bookings;
 const subscription=await api('/api/business/subscription');
 const cancellations=await api('/api/business/cancellation-requests');
 const completed=state.bookings.filter(x=>x.status==='completed');
 const gross=completed.reduce((sum,x)=>sum+x.price_cents,0),fee=completed.reduce((sum,x)=>sum+x.fee_cents,0);
 $('studio-body').innerHTML=
 '<div class="panel"><div class="row"><div><h3>'+esc(b.name)+'</h3><div class="muted">'+esc(b.city)+' · '+esc(b.category)+'</div></div><span class="pill">'+(b.stripe_connected?'Stripe account started':'Payouts not connected')+'</span></div>'+
 '<div class="buttonrow"><button class="btn" data-action="create-listing">+ Post available slot</button><button class="btn secondary" data-action="connect-stripe">'+(b.stripe_connected?'Continue Stripe onboarding':'Connect payouts')+'</button></div><p class="muted">Payment availability requires your Stripe onboarding to be completed and the RouteDrop platform to activate payments.</p></div>'+
 serviceCoveragePanel(b)+
 '<div class="panel"><h3>Business tools and payment readiness</h3><p class="muted">Founding early access proposes no mandatory monthly membership and an 8% fee on successfully collected service payments. No live payment permissions are enabled by this redesign.</p></div>'+
 '<div class="panel"><h3>Cancellation and refund requests</h3><p class="muted">Draft cancellation and refund terms require legal review before use with real customers. This private preview cannot process payments or refunds.</p>'+(cancellations.requests.length?cancellations.requests.map(x=>'<div class="record"><div><strong>'+esc(x.title)+'</strong><p>'+when(x.slot_start)+' · '+esc(x.reason)+'</p><p class="muted">Booking #'+x.booking_id+' · '+esc(x.status)+' · '+(x.eligible_full_refund?'24-hour full-refund policy':'Late / discretionary')+'</p>'+(x.refund_amount_cents?'<p>Refund amount: '+money(x.refund_amount_cents)+'</p>':'')+'</div><div>'+(x.status==='pending'?'<button class="btn" data-request-id="'+x.id+'" data-decision="approve">Approve full refund</button>'+(x.eligible_full_refund?'':'<button class="btn secondary" data-request-id="'+x.id+'" data-decision="decline">Decline</button>'):'<strong>'+esc(x.status)+'</strong>')+'</div></div>').join(''):'<p class="muted">No cancellation requests.</p>')+'</div>'+
 '<div class="panel"><h3>Revenue snapshot</h3><div class="row"><div><small>Completed bookings</small><h2>'+completed.length+'</h2></div><div><small>Gross value</small><h2>'+money(gross)+'</h2></div><div><small>Platform fees (8%)</small><h2>'+money(fee)+'</h2></div></div></div>'+
 '<div class="panel"><h3>My route openings</h3>'+(state.mine.length?state.mine.map(x=>'<div class="record"><div><strong>'+esc(x.title)+'</strong><p>'+esc(x.neighborhood)+' · '+when(x.slot_start)+'</p></div><strong>'+money(x.price_cents)+'</strong></div>').join(''):'<p class="muted">No openings published yet.</p>')+'</div>'+
 '<div class="panel"><h3>Recent bookings</h3>'+(state.bookings.length?state.bookings.map(x=>'<div class="record"><div><strong>'+esc(x.title)+'</strong><p>'+when(x.slot_start)+' · '+esc(x.status)+'</p></div>'+(x.status==='paid'&&!['pending','processing','needs_review'].includes(x.cancellation_request_status)?'<button class="btn" data-complete="'+x.id+'">Complete</button>':'<strong>'+money(x.price_cents)+'</strong>')+'</div>').join(''):'<p class="muted">No bookings recorded.</p>')+'</div>';
}
function showRegistration(preferredRole='customer'){
 overlay('<h2 id="modal-title">'+(state.config?.workflow_pilot?'One RouteDrop test account':'Create your account')+'</h2><p>'+(state.config?.workflow_pilot?'Use a fictional name and test email address. This isolated system saves account data for testing; never enter a real customer’s personal details.':'Join RouteDrop as a customer or service professional.')+'</p><form id="register-form"><label>Account type</label><select name="role" id="register-role"><option value="customer">Book, offer services &amp; find work (one account)</option><option value="business">Business / employer</option><option value="individual">Individual service provider</option></select><label>Your full name</label><input name="name" minlength="2" maxlength="90" required autocomplete="name"><label>Email address</label><input name="email" type="email" maxlength="254" required autocomplete="email"><label>Password (12+ characters)</label><input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"><div id="business-fields" class="hidden"><label id="signup-provider-name-label">Business / employer name</label><input name="businessName" maxlength="120"><label>City</label><input name="city" maxlength="100" value="Decatur, AL"><label>Service category</label><select name="category"><option>Washing</option><option>Lawn care</option><option>Car detailing</option><option>Cleaning</option><option>Other</option></select></div><p class="legal">Use fictional identities only in this pilot. Real applicant data and payments are disabled.</p><p id="form-error" class="error"></p><button type="submit" class="btn">Register</button></form>');
 $('register-role').value=preferredRole;
 syncSignupFields();
}
function syncSignupFields(){
 const selected=$('register-role')?.value,fields=$('business-fields');if(!fields)return;
 fields.classList.toggle('hidden',selected==='customer');
 const label=$('signup-provider-name-label');if(label)label.textContent=selected==='individual'?'Your public provider name uses your fictional account name':'Business / employer name';
 const nameInput=fields.querySelector('[name="businessName"]');if(nameInput)nameInput.disabled=selected==='individual';
}
function showLogin(){
 overlay('<h2 id="modal-title">Welcome back</h2><p>'+(state.config?.workflow_pilot?'Sign in with your RouteDrop pilot test credentials only. No real customer accounts or payments are supported.':'Log in to your RouteDrop account.')+'</p><form id="login-form"><label>Email</label><input type="email" name="email" maxlength="254" autocomplete="email" required><label>Password</label><input type="password" name="password" autocomplete="current-password" required><p id="form-error" class="error"></p><button class="btn" type="submit">Log in</button><button type="button" class="btn secondary" data-action="forgot-password">Forgot password?</button></form>');
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
 overlay('<h2 id="modal-title">Publish an available opening</h2><p>'+(state.config?.workflow_pilot?'Publish fictional service information for this isolated account test. Requests are unpaid and need provider approval.':'Publish one real service time window. Bookings are held until payment confirmation.')+'</p><form id="listing-form"><label>Service title</label><input name="title" required maxlength="120" placeholder="Driveway cleaning"><label>Category</label><select name="category"><option>Washing</option><option>Lawn care</option><option>Car detailing</option><option>Cleaning</option><option>Other</option></select><label>Service neighborhood</label><input name="neighborhood" maxlength="100" required placeholder="Southeast Decatur"><label>Price in USD</label><input name="price" required type="number" step="0.01" min="5" max="5000"><label>Date & time</label><input name="slotStart" required type="datetime-local"><label>Duration (minutes)</label><input name="durationMinutes" required type="number" min="30" max="480" value="60" step="15"><p id="form-error" class="error"></p><button class="btn" type="submit">Publish route</button></form>');
}
async function act(e){
 const el=e.target.closest('button');if(!el)return;
 if(el.dataset.tab){if(!$('modal').classList.contains('hidden'))dismiss();switchTab(el.dataset.tab);return;}
 if(el.dataset.profileListing){const x=state.listings.find(item=>Number(item.id)===Number(el.dataset.profileListing));if(x)overlay(premium.profile(x,coverage,state.config));return;}
 if(el.dataset.addWeekly&&state.config?.unified_pilot){const p=state.myServiceProfiles.profiles.find(x=>Number(x.id)===Number(el.dataset.addWeekly));if(p)overlay(unified.weeklyForm(p));return;}
 if(el.dataset.serviceProfileStatusId&&state.config?.unified_pilot){
  const id=Number(el.dataset.serviceProfileStatusId),active=el.dataset.serviceProfileActive==='true';
  el.disabled=true;try{await api('/api/pilot/service-profiles/'+id+'/status',{method:'PATCH',body:JSON.stringify({active})});message('Test service '+(active?'resumed':'paused')+'.');await studio();}catch(err){message(err.message,true);}finally{if(el.isConnected)el.disabled=false;}return;
 }
 if(el.dataset.weeklyStatusId&&state.config?.unified_pilot){
  const id=Number(el.dataset.weeklyStatusId),active=el.dataset.weeklyActive==='true';
  el.disabled=true;try{await api('/api/pilot/weekly-rules/'+id+'/status',{method:'PATCH',body:JSON.stringify({active})});message('Weekly schedule '+(active?'resumed':'paused')+'.');await studio();}catch(err){message(err.message,true);}finally{if(el.isConnected)el.disabled=false;}return;
 }
 if(el.dataset.reviewRequestId&&state.config?.unified_pilot){
  const request=state.pilotRequests.find(x=>Number(x.id)===Number(el.dataset.reviewRequestId));
  if(request&&request.status==='confirmed'&&!request.review_id)overlay(trust.reviewForm(request));
  return;
 }
 if(el.dataset.viewReviews){
  const id=Number(el.dataset.viewReviews);
  if(!state.config?.unified_pilot){overlay(trust.reviewsModal(null,true));return;}
  try{const result=await api('/api/pilot/reviews?businessId='+id);overlay(trust.reviewsModal(result));}
  catch(err){message(err.message,true);}return;
 }
 if(el.dataset.reportReviewId){
  if(!state.me?.user){showLogin();message('A private test account is required to report a review.');return;}
  if(state.config?.unified_pilot)overlay(trust.reportForm(Number(el.dataset.reportReviewId)));return;
 }
 if(el.dataset.safetyAppealKind&&state.config?.safety_pilot){
  overlay(safetyUi.appealForm(el.dataset.safetyAppealKind,Number(el.dataset.safetyAppealId)));return;
 }
 if(el.dataset.safetyDecisionKind&&state.moderatorKey){
  overlay(safetyUi.decisionForm(el.dataset.safetyDecisionKind,Number(el.dataset.safetyDecisionId),el.dataset.safetyDecisionAction));return;
 }
 if(el.dataset.jobDetail){const x=state.jobs.find(j=>Number(j.id)===Number(el.dataset.jobDetail));if(x)overlay(opportunities.details(x));return;}
 if(el.dataset.jobStatusId&&state.config?.opportunity_pilot){
  const id=Number(el.dataset.jobStatusId),status=el.dataset.jobStatus;
  if(!Number.isSafeInteger(id)||!['active','paused'].includes(status))return;
  el.disabled=true;
  try{await api('/api/pilot/jobs/'+id+'/status',{method:'PATCH',body:JSON.stringify({status})});message('Test employment post '+status+'.');await studio();}catch(err){message(err.message,true);}finally{if(el.isConnected)el.disabled=false;}
  return;
 }
 if(el.dataset.pilotRequest&&state.config?.workflow_pilot){
  const x=state.listings.find(item=>Number(item.id)===Number(el.dataset.pilotRequest));
  if(!x)return;
  if(!state.me?.user){showLogin();message('Sign in with a customer test account first.');return;}
  if(!state.config.unified_pilot&&state.me.user.role!=='customer'){message('Only customer accounts can request a service.',true);return;}
  state.pilotListingId=x.id;overlay(pilot.requestModal(x));return;
 }
 if(el.dataset.pilotAction&&state.config?.workflow_pilot){
  const id=Number(el.dataset.pilotId),action=el.dataset.pilotAction;
  if(!Number.isSafeInteger(id)||id<1)return;
  el.disabled=true;
  try{await api('/api/pilot/requests/'+id+'/action',{method:'POST',body:JSON.stringify({action})});message('Test request updated. No payment was made.');await refresh();}
  catch(err){message(err.message,true);}finally{if(el.isConnected)el.disabled=false;}
  return;
 }
 if(el.dataset.pilotListingId&&state.config?.workflow_pilot){
  const id=Number(el.dataset.pilotListingId),status=el.dataset.pilotListingStatus;
  if(!Number.isSafeInteger(id)||!['active','paused'].includes(status))return;
  el.disabled=true;
  try{await api('/api/pilot/listings/'+id+'/status',{method:'PATCH',body:JSON.stringify({status})});message('Test listing '+status+'.');await refresh();}
  catch(err){message(err.message,true);}finally{if(el.isConnected)el.disabled=false;}
  return;
 }
 if(el.dataset.demoBook&&state.demo&&!state.config?.database){
  const x=premium.DEMO.find(item=>item.id===Number(el.dataset.demoBook));
  if(!x)return;
  state.demoListingId=x.id;state.demoSlot='afternoon';
  overlay(premium.demoBookingModal(x,state.demoSlot));
  return;
 }
 if(el.dataset.demoSlot&&state.demo&&!state.config?.database){
  const slot=el.dataset.demoSlot;
  if(!Object.hasOwn(premium.WINDOWS,slot))return;
  state.demoSlot=slot;
  document.querySelectorAll('[data-demo-slot]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.demoSlot===slot)));
  return;
 }
 if(el.dataset.demoAction&&state.demo&&!state.config?.database){
  const action=el.dataset.demoAction;
  const req=state.demoRequests.find(x=>x.id===el.dataset.demoId);
  if(!req)return;
  const next={
   requested:{accept:'accepted',decline:'declined',cancel:'canceled'},
   accepted:{finish:'completed',cancel:'canceled'},
   completed:{approve:'confirmed',report:'review'}
  }[req.status]?.[action];
  if(!next)return;
  req.status=next;
  await refresh();
  message('Fictional workflow updated: '+premium.STATUSES[next]+'. No booking, charge, dispute, or provider action occurred.');
  return;
 }
 if(el.dataset.coverageListing){
   const x=state.listings.find(item=>Number(item.id)===Number(el.dataset.coverageListing));
   if(x)showCoverageFor(x);
   return;
 }
 const action=el.dataset.action;
 if(action==='pilot-confirm-request'&&state.config?.workflow_pilot){
  if(!Number.isSafeInteger(Number(state.pilotListingId)))return;
  el.disabled=true;
  try{
   await api('/api/pilot/requests',{method:'POST',body:JSON.stringify({listingId:Number(state.pilotListingId)})});
   dismiss();message('Request saved in the isolated test database. No payment was collected.');switchTab('bookings');
  }catch(err){message(err.message,true);}finally{if(el.isConnected)el.disabled=false;}
  return;
 }
 if(action==='search-services'){document.getElementById('available-openings')?.scrollIntoView({behavior:'smooth'});renderOffers();return;}
 if(action==='demo-back-to-profile'&&state.demo&&!state.config?.database){
  const x=premium.DEMO.find(item=>item.id===state.demoListingId);
  if(x)overlay(premium.profile(x,coverage,state.config));
  return;
 }
 if(action==='demo-confirm-request'&&state.demo&&!state.config?.database){
  const x=premium.DEMO.find(item=>item.id===state.demoListingId);
  if(!x||!Object.hasOwn(premium.WINDOWS,state.demoSlot))return;
  if(state.demoRequests.some(req=>req.listingId===x.id&&['requested','accepted','completed'].includes(req.status))){
   message('You already have an active fictional request for this service. See My bookings.',true);
   dismiss();switchTab('bookings');return;
  }
  if(state.demoRequests.length>=8){message('Reset the demo before adding more examples.',true);return;}
  state.demoRequests.unshift({id:'sample-'+(++state.demoCounter),listingId:x.id,slot:state.demoSlot,status:'requested'});
  dismiss();switchTab('bookings');
  message('Example request created in this page only. No actual appointment, account or charge was made.');
  return;
 }
 if(action==='demo-reset'&&state.demo&&!state.config?.database){
  state.demoRequests=[];state.demoCounter=0;await refresh();
  message('Fictional requests cleared from this page. Nothing was stored or changed in RouteDrop.');
  return;
 }
 if(action==='clear-filters'){$('search').value='';$('category').value='';renderOffers();return;}
 if(el.dataset.radiusPreset){
  const range=$('area-radius');
  if(range){range.value=el.dataset.radiusPreset;updateCoveragePreview();}
  return;
 }
 if(action==='save-coverage'){
  const city=$('area-city')?.value,radius=Number($('area-radius')?.value);
  if(!coverage.validate(city,radius))return message('Choose a listed city and a radius between 5 and 50 miles.',true);
  el.disabled=true;
  try{
   await api('/api/business/service-area',{method:'PUT',body:JSON.stringify({center:city,radiusMiles:radius})});
   message('Service radius saved. Future listing cards can show your selected coverage area.');
   await studio();
  }catch(err){message(err.message,true);}finally{el.disabled=false;}
  return;
 }
 if(action==='register'||action==='login'){
  if(state.demo&&!state.config?.database){
   overlay('<h2 id="modal-title">Explore RouteDrop safely</h2><p>This is an isolated design preview. Account registration and sign-in are intentionally unavailable; please do not submit personal information.</p><div class="buttonrow"><button type="button" class="btn" data-tab="explore">Explore services</button><button type="button" class="btn secondary" data-tab="business">Tour Business Studio</button></div>');
   return;
  }
  if(action==='register')showRegistration();else showLogin();
  return;
 }
 if(action==='safety-start-screening'&&state.config?.safety_pilot){overlay(safetyUi.screeningForm());return;}
 if(action==='identity-start'&&state.config?.identity_test_available){overlay(safetyUi.identityConsentForm());return;}
 if(action==='moderator-connect'&&state.config?.moderation_available){overlay(safetyUi.moderatorForm());return;}
 if(action==='moderator-disconnect'){
   const key=state.moderatorKey;state.moderatorKey=null;
   if(key)await api('/api/pilot/moderator/passkeys/lock',{method:'POST',headers:{'x-routedrop-moderator-key':key},body:'{}'}).catch(()=>{});
   message('Moderator key cleared and step-up session locked.');await renderSafety();return;
  }
 if(action==='start-provider'){
  if(state.demo&&!state.config?.database){overlay('<h2 id="modal-title">One-account service preview</h2><p>This password-protected visual tour uses fictional data and does not register accounts. In the functional test branch, the same account can set up a provider profile, manage weekly openings and explore jobs.</p>');return;}
  if(!state.me?.user){showRegistration();return;}
  if(state.me.business){switchTab('business');return;}
  if(state.config?.unified_pilot)overlay(unified.providerForm());else message('Provider setup requires the private unified pilot.',true);
  return;
 }
 if(action==='compare-profiles'){
   const selected=state.compareIds;
   if(selected.length>=2)overlay(trust.compareModal(state.serviceProfiles,selected,state.config));
   else message('Select two or three services from the same category to compare.',true);
   return;
 }
 if(action==='new-service-profile'&&state.config?.unified_pilot){overlay(unified.profileForm());return;}
 if(action==='job-interests'&&state.config?.unified_pilot){overlay(unified.interestsForm(state.jobInterests));return;}
 if(action==='register-individual'){
  if(state.me?.user){message('A separate test account is currently required to switch between customer and provider. Multi-role profiles are planned.',true);return;}
  if(state.demo&&!state.config?.database){overlay('<h2 id="modal-title">Independent-provider preview</h2><p>This database-free design preview does not accept accounts. Try individual-provider registration in the isolated test pilot.</p>');return;}
  showRegistration('individual');return;
 }
 if(action==='post-job'){if(state.config?.opportunity_pilot)overlay(opportunities.form());else message('Real job posting is disabled in this preview.',true);return;}
 if(action==='create-listing'){showListing();return;}
 if(action==='change-password'){showChangePassword();return;}
 if(action==='forgot-password'){showForgotPassword();return;}
 if(action==='verify-email'){try{const r=await api('/api/auth/request-verification',{method:'POST'});message(r.message);}catch(e){message(e.message,true);}return;}
 if(action==='logout'){try{await api('/api/logout',{method:'POST'});state.moderatorKey=null;state.me=null;message('Signed out.');refresh();}catch(err){message(err.message,true);}return;}
 if(action==='subscribe'||action==='manage-subscription'){try{const url=action==='subscribe'?'/api/business/subscribe':'/api/business/subscription/portal';const r=await api(url,{method:'POST'});location.assign(r.url);}catch(err){message(err.message,true);}return;}
 if(action==='connect-stripe'){try{const r=await api('/api/stripe/connect',{method:'POST'});location.assign(r.url);}catch(err){message(err.message,true);}return;}
 if(el.dataset.book){
  if(!state.me?.user){showLogin();message('Please log in to book a service.');return;}
  if(state.me.user.role!=='customer'){message('Only customer accounts can book services.',true);return;}
  if(!state.config.payments){message('Checkout is not activated yet. No payment can be collected.',true);return;}
  el.disabled=true;
  try{const result=await api('/api/checkout',{method:'POST',body:JSON.stringify({listingId:Number(el.dataset.book)})});location.assign(result.url);}catch(err){message(err.message,true);el.disabled=false;}
  return;
 }
 if(el.dataset.requestId && el.dataset.decision){const decision=el.dataset.decision;const id=Number(el.dataset.requestId);if(!confirm(decision==='approve'?'Issue a full Stripe refund to this customer and reverse the provider transfer and platform fee?':'Decline this discretionary refund request?'))return;el.disabled=true;try{const r=await api('/api/business/cancellation-requests/'+id+'/decision',{method:'POST',body:JSON.stringify({decision})});message(r.message||('Cancellation request '+r.status+'.'));refresh();}catch(err){message(err.message,true);el.disabled=false;}return;}
 if(el.dataset.cancelRequest){const reason=prompt('Please describe why you are requesting cancellation (10 characters minimum):');if(reason===null)return;try{const r=await api('/api/bookings/'+Number(el.dataset.cancelRequest)+'/request-cancellation',{method:'POST',body:JSON.stringify({reason})});message(r.message);refresh();}catch(err){message(err.message,true);}return;}
 if(el.dataset.retry){el.disabled=true;try{const r=await api('/api/bookings/'+Number(el.dataset.retry)+'/retry-payment',{method:'POST'});location.assign(r.url);}catch(err){message(err.message,true);el.disabled=false;}return;}
 if(el.dataset.complete){try{await api('/api/bookings/'+Number(el.dataset.complete)+'/complete',{method:'POST'});message('Job marked completed.');refresh();}catch(err){message(err.message,true);}return;}
}
async function submit(e){
 if(!['register-form','login-form','listing-form','forgot-form','reset-form','change-password-form','job-form','provider-setup-form','service-profile-form','weekly-form','job-interests-form','service-review-form','review-report-form','safety-screening-form','safety-appeal-form','safety-mod-login-form','safety-moderation-form','safety-identity-form'].includes(e.target.id))return;
 e.preventDefault();
 const form=e.target,d=Object.fromEntries(new FormData(form).entries());
 const err=$('form-error');err.textContent='';
 const submit=form.querySelector('button[type=submit]');submit.disabled=true;
 try{
  if(form.id==='register-form'){const r=await api('/api/register',{method:'POST',body:JSON.stringify(d)});message(r.email_verification_required?'Account created. Check your email for a verification link.':'Account created. Email verification will be available when delivery is configured.');}
  if(form.id==='login-form'){await api('/api/login',{method:'POST',body:JSON.stringify(d)});message('Signed in successfully.');}
  if(form.id==='change-password-form'){const r=await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:d.currentPassword,newPassword:d.newPassword})});state.me=null;message(r.message);}
  if(form.id==='forgot-form'){const r=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:d.email})});message(r.message);}
  if(form.id==='reset-form'){const r=await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:d.token,password:d.password})});history.replaceState(null,'',location.pathname);message(r.message);}
  if(form.id==='safety-identity-form'){
   const result=await api('/api/pilot/identity/start',{method:'POST',body:JSON.stringify({explicitConsent:d.explicitConsent==='yes'})});
   if(!/^https:\/\//.test(result.url||''))throw Error('Verification provider did not return an HTTPS destination.');
   location.assign(result.url);
   return;
  }
  if(form.id==='safety-screening-form'){
   const result=await api('/api/pilot/safety/provider/request',{method:'POST',body:JSON.stringify({serviceCategory:d.serviceCategory,serviceDescription:d.serviceDescription,acknowledgeTestOnly:d.acknowledgeTestOnly==='yes'})});
   message(result.message);
  }
  if(form.id==='safety-appeal-form'){
   const result=await api('/api/pilot/safety/appeals',{method:'POST',body:JSON.stringify({subjectKind:d.subjectKind,subjectId:Number(d.subjectId),reason:d.reason})});
   message(result.message);
  }
  if(form.id==='safety-mod-login-form'){
   const headers={'x-routedrop-moderator-key':d.key};
   const status=await api('/api/pilot/moderator/passkeys/status',{headers});
   if(!status.registered){
    if(!status.enrollment_enabled)throw Error('No moderator passkey is enrolled. Administrator enrollment must first be enabled securely.');
    await passkeys.enroll(api,d.key);
   }
   await passkeys.authenticate(api,d.key);
   await api('/api/pilot/safety/moderation',{headers});
   state.moderatorKey=d.key;
   message('Passkey verified. Restricted moderation access is valid for ten minutes.');
  }
  if(form.id==='safety-moderation-form'){
   if(!state.moderatorKey)throw Error('Connect an authorized moderator account first.');
   const kind=d.kind,url=kind==='review'?'reviews':kind==='provider'?'providers':'appeals';
   const result=await api('/api/pilot/safety/moderation/'+url+'/'+Number(d.id),{method:'POST',headers:{'x-routedrop-moderator-key':state.moderatorKey},body:JSON.stringify({action:d.action,note:d.note})});
   message(result.message);
  }
  if(form.id==='service-review-form'){
   await api('/api/pilot/reviews',{method:'POST',body:JSON.stringify({requestId:Number(d.requestId),rating:Number(d.rating),headline:d.headline,comment:d.comment})});
   message('Test review submitted. This is not a real customer reputation score.');
  }
  if(form.id==='review-report-form'){
   await api('/api/pilot/reviews/'+Number(d.reviewId)+'/report',{method:'POST',body:JSON.stringify({reason:d.reason})});
   message('Test review report saved. The review remains visible pending an appropriate moderation decision.');
  }
  if(form.id==='provider-setup-form'){
   await api('/api/pilot/provider-profile',{method:'POST',body:JSON.stringify(d)});
   message('Provider tools activated for your existing test account. You can still book and find jobs.');
  }
  if(form.id==='service-profile-form'){
   const amount=Math.round(Number(d.price)*100);
   if(!Number.isSafeInteger(amount))throw Error('Enter a valid dollar amount.');
   await api('/api/pilot/service-profiles',{method:'POST',body:JSON.stringify({title:d.title,category:d.category,neighborhood:d.neighborhood,description:d.description,priceCents:amount,durationMinutes:Number(d.durationMinutes)})});
   message('Persistent service profile created. Add a weekly opening next.');
  }
  if(form.id==='weekly-form'){
   await api('/api/pilot/weekly-rules',{method:'POST',body:JSON.stringify({profileId:Number(d.profileId),dayOfWeek:Number(d.dayOfWeek),localTime:d.localTime})});
   message('Recurring weekly opening saved in Central time. No payment was collected.');
  }
  if(form.id==='job-interests-form'){
   await api('/api/pilot/job-interests',{method:'PUT',body:JSON.stringify({city:d.city,category:d.category})});
   message('Job interests saved to this same test account. No application was submitted.');
  }
  if(form.id==='job-form'){
   await api('/api/pilot/jobs',{method:'POST',body:JSON.stringify(d)});
   message('Fictional job posting saved. No applications are enabled.');
  }
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
 document.addEventListener('keydown',dialogKeys);
 $('search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('available-openings')?.scrollIntoView({behavior:'smooth'});}});

 $('register-role')?.addEventListener('change',()=>{});
 $('modal').addEventListener('change',e=>{if(e.target.id==='register-role')syncSignupFields();});
 document.addEventListener('change',e=>{
  const target=e.target;
  if(target.id==='profiles-category'){state.profileCategory=target.value;state.compareIds=[];renderCatalog();return;}
  if(target.id==='profiles-sort'){state.profileSort=target.value;renderCatalog();return;}
  if(target.matches('[data-compare-id]')){
   const id=Number(target.dataset.compareId);
   const item=catalogItems().find(p=>Number(p.id)===id);
   if(!item)return;
   const selected=state.compareIds.slice();
   if(target.checked){
    const first=catalogItems().find(p=>Number(p.id)===selected[0]);
    if(first&&first.category!==item.category){target.checked=false;message('Compare services in the same category for meaningful prices.',true);return;}
    if(selected.length>=3){target.checked=false;message('Select up to three providers.',true);return;}
    if(!selected.includes(id))selected.push(id);
   }else{
    const idx=selected.indexOf(id);if(idx>=0)selected.splice(idx,1);
   }
   state.compareIds=selected;renderCatalog();
  }
 });
 $('close-modal').addEventListener('click',dismiss);
 $('modal').addEventListener('click',e=>{if(e.target.id==='modal')dismiss();});
 $('search').addEventListener('input',renderOffers);
 document.addEventListener('input',e=>{
  if(e.target.id!=='job-search')return;
  state.jobSearch=e.target.value;
  const q=state.jobSearch.trim().toLowerCase();let shown=0;
  document.querySelectorAll('.opportunity-card').forEach(card=>{const match=!q||card.textContent.toLowerCase().includes(q);card.hidden=!match;if(match)shown++;});
  const count=$('job-visible-count');if(count)count.textContent=shown+' matching '+(state.demo?'fictional examples':'test postings');
 });
 $('category').addEventListener('change',renderOffers);
 document.querySelectorAll('[data-category-choice]').forEach(el=>el.addEventListener('click',()=>{$('category').value=el.dataset.categoryChoice;renderOffers();}));
 document.addEventListener('input',e=>{if(e.target.id==='area-radius')updateCoveragePreview();});
 document.addEventListener('change',e=>{if(e.target.id==='area-city')updateCoveragePreview();});
 try {
  state.config=await api('/api/config');
  const actionParams=new URLSearchParams(location.search);
  if(actionParams.has('reset')){const token=actionParams.get('reset');history.replaceState(null,'',location.pathname);showResetPassword(token);}
  else if(actionParams.has('verify')){const token=actionParams.get('verify');history.replaceState(null,'',location.pathname);await verifyEmailToken(token);}
  if(state.config.workflow_pilot){
   const notice=document.querySelector('.announce');if(notice)notice.innerHTML='<strong>ISOLATED ACCOUNT TEST</strong><span>Test accounts and unpaid requests only · No payments or production customers</span>';
   const customerIntro=document.querySelector('#bookings .interior-heading p');if(customerIntro)customerIntro.textContent='Track database-backed test requests. This is a private staging environment—not live bookings or real payments.';
   const providerIntro=document.querySelector('#business .interior-heading p');if(providerIntro)providerIntro.textContent='Manage private test listings, unpaid requests and coverage radius with a separate staging database.';
   const footerNote=document.querySelector('footer div:last-child p:last-child');if(footerNote)footerNote.textContent='Private staging only · Test accounts and service requests · No Stripe or production customer data';
   message('RouteDrop unified private pilot: book, offer services and find work using one test account. Payments and real applications are disabled.');
  }else if(!state.config.database)message('Private beta: an isolated database must be connected before registration and bookings can work.');
  else if(!state.config.payments)message('Accounts and listings enabled. Stripe payments and payouts are not yet configured.');
  if(new URLSearchParams(location.search).has('subscription'))message('Returned from subscription billing. Open Business Studio to check your subscription status.');
  if(new URLSearchParams(location.search).has('payment'))message('Returned from checkout. Payment status is confirmed only through the Stripe webhook; check My bookings.');
  if(new URLSearchParams(location.search).has('stripe'))message('Returned from Stripe onboarding. Payout readiness is checked when a checkout begins.');
  await refresh();
 }catch(ex){message('Could not connect to the RouteDrop server: '+ex.message,true);}
}
init();
})();
