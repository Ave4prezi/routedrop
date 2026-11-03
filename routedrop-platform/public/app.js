'use strict';
(function(){
const $=id=>document.getElementById(id);
const state={config:null,me:null,listings:[],bookings:[],mine:[],tab:'explore'};
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
function overlay(content){$('modal-body').innerHTML=content;$('modal').classList.remove('hidden');}
function dismiss(){$('modal').classList.add('hidden');$('modal-body').innerHTML='';}
function nav(){
 const u=state.me?.user;
 $('nav-account').innerHTML=u?'<span class="muted">'+esc(u.full_name)+'</span>'+(state.config?.email_enabled&&!u.email_verified?'<button data-action="verify-email">Verify email</button>':'')+'<button data-action="logout">Log out</button>':'<button data-action="login">Log in</button><button data-action="register">Sign up</button>';
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
   const r=await api('/api/bookings');state.bookings=r.bookings;renderBookings();
  }else if(state.tab==='business') await studio();
 }catch(e){message(e.message,true);}
}
function renderOffers(){
 const search=$('search').value.trim().toLowerCase(),cat=$('category').value;
 const items=state.listings.filter(x=>(!cat||x.category===cat)&&(!search||[x.title,x.neighborhood,x.business_name,x.city].join(' ').toLowerCase().includes(search)));
 $('offer-count').textContent=items.length+' open slots';
 $('offers').innerHTML=items.length?items.map(x=>
  '<article class="card"><div class="cardbanner"><span>'+esc(x.category)+'</span><span>Available window</span></div><div class="cardbody"><div class="muted">'+esc(x.business_name)+'</div><h3>'+esc(x.title)+'</h3><div class="detail">⌖ '+esc(x.neighborhood)+', '+esc(x.city)+'</div><div class="detail">◷ '+when(x.slot_start)+' · '+esc(x.duration_minutes)+' min</div><div class="cardfoot"><span class="price">'+money(x.price_cents)+'</span><button class="btn dark" data-book="'+x.id+'">Book this slot</button></div></div></article>').join(''):'<div class="empty"><h3>No openings are listed yet.</h3><p>Local businesses can publish available slots from Business Studio after registration is enabled.</p></div>';
}
function renderBookings(){
 const list=state.bookings||[];
 $('my-bookings').innerHTML=list.length?list.map(b=>
  '<div class="panel"><div class="row"><div><h3>'+esc(b.title)+'</h3><div class="muted">'+esc(b.business_name)+' · '+when(b.slot_start)+'</div></div><span class="pill">'+esc(b.status.replace('_',' '))+'</span></div><div class="record"><span>Service price</span><strong>'+money(b.price_cents)+'</strong></div>'+(b.refund_cents?'<p class="muted">Refunded: '+money(b.refund_cents)+'</p>':'')+(b.dispute_status?'<p class="muted">Payment dispute: '+esc(b.dispute_status)+'</p>':'')+(b.cancellation_request_status?'<p class="muted">Cancellation request: '+esc(b.cancellation_request_status)+'</p>':'')+(state.me.user.role==='customer'&&['paid','completed'].includes(b.status)&&!b.cancellation_request_status?'<button class="btn secondary" data-cancel-request="'+b.id+'">Request cancellation / refund review</button>':'')+(state.me.user.role==='customer'&&b.status==='awaiting_payment'?'<button class="btn" data-retry="'+b.id+'">Retry payment</button>':'')+(state.me.user.role==='business'&&b.status==='paid'&&!['pending','processing','needs_review'].includes(b.cancellation_request_status)?'<button class="btn" data-complete="'+b.id+'">Mark job complete</button>':'')+'</div>').join(''):'<div class="empty"><h3>No bookings yet</h3><p>Bookings will appear here after a customer checks out.</p></div>';
}
async function studio(){
 const u=state.me?.user;
 if(!u){$('studio-body').innerHTML='<div class="empty"><h3>Business account required</h3><p>Create a business account to list open route slots.</p><button class="btn" data-action="register">Register a business</button></div>';return;}
 if(u.role!=='business'){$('studio-body').innerHTML='<div class="empty">You are signed in as a customer. Use a separate business account to publish routes.</div>';return;}
 const b=state.me.business,r=await Promise.all([api('/api/my-listings'),api('/api/bookings')]);
 state.mine=r[0].listings;state.bookings=r[1].bookings;
 const subscription=await api('/api/business/subscription');
 const cancellations=await api('/api/business/cancellation-requests');
 const completed=state.bookings.filter(x=>x.status==='completed');
 const gross=completed.reduce((sum,x)=>sum+x.price_cents,0),fee=completed.reduce((sum,x)=>sum+x.fee_cents,0);
 $('studio-body').innerHTML=
 '<div class="panel"><div class="row"><div><h3>'+esc(b.name)+'</h3><div class="muted">'+esc(b.city)+' · '+esc(b.category)+'</div></div><span class="pill">'+(b.stripe_connected?'Stripe account started':'Payouts not connected')+'</span></div>'+
 '<div class="buttonrow"><button class="btn" data-action="create-listing">+ Post available slot</button><button class="btn secondary" data-action="connect-stripe">'+(b.stripe_connected?'Continue Stripe onboarding':'Connect payouts')+'</button></div><p class="muted">Payment availability requires your Stripe onboarding to be completed and the RouteDrop platform to activate payments.</p></div>'+
 '<div class="panel"><h3>Business membership · $79/month</h3><p class="muted">Subscription status: '+esc(subscription.status)+(subscription.last_invoice_status==='payment_failed'?' · Payment failed: update billing details':'')+(subscription.cancel_at_period_end?' (cancels at period end)':'')+'</p><div class="buttonrow"><button class="btn" data-action="subscribe">Subscribe · $79/month</button><button class="btn secondary" data-action="manage-subscription">Manage billing</button></div><p class="muted">Stripe sandbox only. Membership is not yet required to accept bookings.</p></div>'+
 '<div class="panel"><h3>Cancellation and refund requests</h3><p class="muted">Full refunds are guaranteed for eligible cancellations requested 24+ hours before service. Late requests are discretionary. Approvals issue a real Stripe refund in the configured payment mode.</p>'+(cancellations.requests.length?cancellations.requests.map(x=>'<div class="record"><div><strong>'+esc(x.title)+'</strong><p>'+when(x.slot_start)+' · '+esc(x.reason)+'</p><p class="muted">Booking #'+x.booking_id+' · '+esc(x.status)+' · '+(x.eligible_full_refund?'24-hour full-refund policy':'Late / discretionary')+'</p>'+(x.refund_amount_cents?'<p>Refund amount: '+money(x.refund_amount_cents)+'</p>':'')+'</div><div>'+(x.status==='pending'?'<button class="btn" data-request-id="'+x.id+'" data-decision="approve">Approve full refund</button>'+(x.eligible_full_refund?'':'<button class="btn secondary" data-request-id="'+x.id+'" data-decision="decline">Decline</button>'):'<strong>'+esc(x.status)+'</strong>')+'</div></div>').join(''):'<p class="muted">No cancellation requests.</p>')+'</div>'+
 '<div class="panel"><h3>Revenue snapshot</h3><div class="row"><div><small>Completed bookings</small><h2>'+completed.length+'</h2></div><div><small>Gross value</small><h2>'+money(gross)+'</h2></div><div><small>Platform fees (8%)</small><h2>'+money(fee)+'</h2></div></div></div>'+
 '<div class="panel"><h3>My route openings</h3>'+(state.mine.length?state.mine.map(x=>'<div class="record"><div><strong>'+esc(x.title)+'</strong><p>'+esc(x.neighborhood)+' · '+when(x.slot_start)+'</p></div><strong>'+money(x.price_cents)+'</strong></div>').join(''):'<p class="muted">No openings published yet.</p>')+'</div>'+
 '<div class="panel"><h3>Recent bookings</h3>'+(state.bookings.length?state.bookings.map(x=>'<div class="record"><div><strong>'+esc(x.title)+'</strong><p>'+when(x.slot_start)+' · '+esc(x.status)+'</p></div>'+(x.status==='paid'&&!['pending','processing','needs_review'].includes(x.cancellation_request_status)?'<button class="btn" data-complete="'+x.id+'">Complete</button>':'<strong>'+money(x.price_cents)+'</strong>')+'</div>').join(''):'<p class="muted">No bookings recorded.</p>')+'</div>';
}
function showRegistration(){
 overlay('<h2 id="modal-title">Create your account</h2><p>Join RouteDrop as a customer or service professional.</p><form id="register-form"><label>Account type</label><select name="role" id="register-role"><option value="customer">Customer</option><option value="business">Business owner</option></select><label>Your full name</label><input name="name" minlength="2" maxlength="90" required autocomplete="name"><label>Email address</label><input name="email" type="email" maxlength="254" required autocomplete="email"><label>Password (12+ characters)</label><input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"><div id="business-fields" class="hidden"><label>Business name</label><input name="businessName" maxlength="120"><label>City</label><input name="city" maxlength="100" value="Decatur, AL"><label>Service category</label><select name="category"><option>Washing</option><option>Lawn care</option><option>Car detailing</option><option>Cleaning</option><option>Other</option></select></div><p class="legal">Use a unique password. Verification will be required for payments when email delivery is enabled.</p><p id="form-error" class="error"></p><button type="submit" class="btn">Register</button></form>');
}
function showLogin(){
 overlay('<h2 id="modal-title">Welcome back</h2><p>Log in to your RouteDrop account.</p><form id="login-form"><label>Email</label><input type="email" name="email" maxlength="254" autocomplete="email" required><label>Password</label><input type="password" name="password" autocomplete="current-password" required><p id="form-error" class="error"></p><button class="btn" type="submit">Log in</button><button type="button" class="btn secondary" data-action="forgot-password">Forgot password?</button></form>');
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
 overlay('<h2 id="modal-title">Publish an available opening</h2><p>Publish one real service time window. Bookings are held until payment confirmation.</p><form id="listing-form"><label>Service title</label><input name="title" required maxlength="120" placeholder="Driveway cleaning"><label>Category</label><select name="category"><option>Washing</option><option>Lawn care</option><option>Car detailing</option><option>Cleaning</option><option>Other</option></select><label>Service neighborhood</label><input name="neighborhood" maxlength="100" required placeholder="Southeast Decatur"><label>Price in USD</label><input name="price" required type="number" step="0.01" min="5" max="5000"><label>Date & time</label><input name="slotStart" required type="datetime-local"><label>Duration (minutes)</label><input name="durationMinutes" required type="number" min="30" max="480" value="60" step="15"><p id="form-error" class="error"></p><button class="btn" type="submit">Publish route</button></form>');
}
async function act(e){
 const el=e.target.closest('button');if(!el)return;
 if(el.dataset.tab){switchTab(el.dataset.tab);return;}
 const action=el.dataset.action;
 if(action==='register'){showRegistration();return;}
 if(action==='login'){showLogin();return;}
 if(action==='create-listing'){showListing();return;}
 if(action==='forgot-password'){showForgotPassword();return;}
 if(action==='verify-email'){try{const r=await api('/api/auth/request-verification',{method:'POST'});message(r.message);}catch(e){message(e.message,true);}return;}
 if(action==='logout'){try{await api('/api/logout',{method:'POST'});state.me=null;message('Signed out.');refresh();}catch(err){message(err.message,true);}return;}
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
 if(!['register-form','login-form','listing-form','forgot-form','reset-form'].includes(e.target.id))return;
 e.preventDefault();
 const form=e.target,d=Object.fromEntries(new FormData(form).entries());
 const err=$('form-error');err.textContent='';
 const submit=form.querySelector('button[type=submit]');submit.disabled=true;
 try{
  if(form.id==='register-form'){const r=await api('/api/register',{method:'POST',body:JSON.stringify(d)});message(r.email_verification_required?'Account created. Check your email for a verification link.':'Account created. Email verification will be available when delivery is configured.');}
  if(form.id==='login-form'){await api('/api/login',{method:'POST',body:JSON.stringify(d)});message('Signed in successfully.');}
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
  if(new URLSearchParams(location.search).has('subscription'))message('Returned from subscription billing. Open Business Studio to check your subscription status.');
  if(new URLSearchParams(location.search).has('payment'))message('Returned from checkout. Payment status is confirmed only through the Stripe webhook; check My bookings.');
  if(new URLSearchParams(location.search).has('stripe'))message('Returned from Stripe onboarding. Payout readiness is checked when a checkout begins.');
  await refresh();
 }catch(ex){message('Could not connect to the RouteDrop server: '+ex.message,true);}
}
init();
})();
