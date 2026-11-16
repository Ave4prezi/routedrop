'use strict';
(function(root){
 const h=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(x||0)/100);
 const DAYS=Object.freeze(['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']);
 function entry(){
  return '<section class="unified-hero"><div><span class="pilot-eyebrow">ONE ACCOUNT · THREE WAYS TO PARTICIPATE</span><h2>Book help. Offer your skills. Find work.</h2><p>Use the same private test account to book services, create a local service profile, and explore job opportunities. No payments or real applications.</p></div><div class="unified-hero-actions"><button class="btn" type="button" data-action="start-provider">Set up my service profile</button><button class="btn secondary" type="button" data-tab="jobs">Explore jobs</button></div></section>';
 }
 function providerForm(){
  return '<div class="pilot-eyebrow">UNIFIED ACCOUNT · PRIVATE TEST ONLY</div><h2 id="modal-title">Offer your services</h2><p>Create a fictional provider identity on your current account. You can still request other people’s services and use Find Work.</p>'+
  '<form id="provider-setup-form"><label>Provider type</label><select name="kind"><option value="individual">Individual / independent</option><option value="business">Business / employer</option></select>'+
  '<label>Public fictional name</label><input name="displayName" maxlength="120" minlength="2" placeholder="Jordan’s Lawn Care" required>'+
  '<label>City (no address)</label><input name="city" maxlength="100" minlength="3" value="Decatur, AL" required>'+
  '<label>Primary service</label><select name="category"><option>Lawn care</option><option>Cleaning</option><option>Car detailing</option><option>Washing</option><option>Other</option></select>'+
  '<p class="legal">No verification or real customer work is authorized. Do not enter your legal identity, address or phone number.</p><p id="form-error" class="error"></p><button class="btn" type="submit">Create test provider profile</button></form>';
 }
 function profileForm(){
  return '<div class="pilot-eyebrow">PERMANENT SERVICE PROFILE · FICTIONAL DATA</div><h2 id="modal-title">Create a service profile</h2><p>This stays discoverable even if no times are available. Add weekly openings afterward.</p>'+
  '<form id="service-profile-form"><label>Service title</label><input name="title" minlength="4" maxlength="120" required placeholder="Weekend lawn mowing">'+
  '<label>Category</label><select name="category"><option>Lawn care</option><option>Cleaning</option><option>Car detailing</option><option>Washing</option><option>Other</option></select>'+
  '<label>Service area / neighborhood (not an address)</label><input name="neighborhood" minlength="3" maxlength="100" placeholder="Southeast Decatur" required>'+
  '<label>Description (30–600 characters)</label><textarea name="description" minlength="30" maxlength="600" rows="4" required placeholder="Describe the fictional service, what is included and any sample limitations."></textarea>'+
  '<label>Listed price ($)</label><input name="price" type="number" min="5" max="5000" step="0.01" required>'+
  '<label>Time per appointment (minutes)</label><input name="durationMinutes" type="number" min="30" max="480" step="15" value="60" required>'+
  '<p id="form-error" class="error"></p><button type="submit" class="btn">Save service profile</button></form>';
 }
 function weeklyForm(profile){
  return '<div class="pilot-eyebrow">RECURRING AVAILABILITY · CENTRAL TIME</div><h2 id="modal-title">Add a weekly opening</h2>'+
   '<p>For <strong>'+h(profile.title)+'</strong>. Each selected weekday and time creates one bookable slot per week, refreshed over the next five weeks. Dates adjust for daylight-saving time.</p>'+
   '<form id="weekly-form"><input type="hidden" name="profileId" value="'+Number(profile.id)+'">'+
   '<label>Every</label><select name="dayOfWeek">'+DAYS.map((d,i)=>'<option value="'+i+'">'+d+'</option>').join('')+'</select>'+
   '<label>Start time · America/Chicago</label><input type="time" name="localTime" value="09:00" required>'+
   '<p class="legal">Test openings must be accepted by the provider. No customer payments, addresses, or real schedules.</p><p id="form-error" class="error"></p><button type="submit" class="btn">Add weekly time</button></form>';
 }
 function profiles(rows,config){
  if(!config?.unified_pilot){
   return '<div class="unified-preview-intro"><span class="pilot-eyebrow">PERMANENT SERVICE PROFILES · DESIGN PREVIEW</span><h2>Local skills, ready when you need them.</h2><p>Browse illustrative provider concepts. Live profiles are disabled in this view.</p></div>'+
   '<div class="unified-profiles-grid"><article class="unified-profile"><span class="pilot-eyebrow">FICTIONAL INDIVIDUAL</span><h3>Weekend Lawn Refresh</h3><p>Example service in Decatur, AL</p><strong>$45.00 example</strong><p>Schedule: Saturday mornings · illustrative only</p><span class="unified-no-times">No real appointments</span></article></div>';
  }
  return '<div class="unified-preview-intro"><span class="pilot-eyebrow">PERMANENT SERVICE PROFILES · PRIVATE TEST</span><h2>Discover local skills.</h2><p>Profiles remain visible between available appointments. All providers shown are fictional and unverified.</p></div>'+
  '<div class="unified-profiles-grid">'+(rows.length?rows.map(x=>'<article class="unified-profile"><span class="pilot-eyebrow">'+(x.provider_kind==='individual'?'INDIVIDUAL PROVIDER · UNVERIFIED':'TEST BUSINESS · UNVERIFIED')+'</span>'+
   '<h3>'+h(x.title)+'</h3><p>'+h(x.provider_name)+' · '+h(x.city)+'</p>'+
   '<p class="unified-profile-about">'+h(x.description)+'</p><div class="unified-profile-facts"><span>'+h(x.category)+'</span><span>'+h(x.neighborhood)+'</span><strong>'+money(x.price_cents)+'</strong></div>'+
   (x.next_listing_id?'<button class="btn" type="button" data-pilot-request="'+Number(x.next_listing_id)+'">Request next opening</button>':'<span class="unified-no-times">No available times yet</span>')+'</article>').join(''):'<div class="panel"><h3>No test service profiles yet</h3><p class="muted">Create a fictional provider profile in Business Studio to populate this section.</p></div>')+'</div>';
 }
 function studio(my,kind){
  const profiles=my.profiles||[],rules=my.rules||[];
  return '<div class="panel unified-studio"><div class="row"><div><span class="pilot-eyebrow">YOUR PERMANENT SERVICE CATALOG</span><h3>Services & recurring availability</h3><p class="muted">Add fictional services once and publish repeating weekly openings. No real bookings or customer details.</p></div><button type="button" class="btn" data-action="new-service-profile">+ Add service</button></div>'+
   (profiles.length?profiles.map(p=>{
    const own=rules.filter(r=>Number(r.profile_id)===Number(p.id));
    return '<article class="unified-profile-row"><div class="unified-profile-row-header"><div><h4>'+h(p.title)+'</h4><p>'+h(p.category)+' · '+h(p.neighborhood)+' · '+money(p.price_cents)+'</p></div>'+
     '<div class="buttonrow"><button type="button" class="btn secondary" data-service-profile-status-id="'+Number(p.id)+'" data-service-profile-active="'+(!p.active)+'">'+(p.active?'Pause service':'Resume service')+'</button>'+
     '<button type="button" class="btn" data-add-weekly="'+Number(p.id)+'">+ Weekly opening</button></div></div>'+
     '<p class="unified-profile-desc">'+h(p.description)+'</p>'+
     '<div class="unified-rule-list">'+(own.length?own.map(r=>'<div><span>'+DAYS[Number(r.day_of_week)]+' · '+h(r.local_time)+' Central · '+(r.active?'Repeats weekly':'Paused')+'</span><button type="button" class="btn secondary" data-weekly-status-id="'+Number(r.id)+'" data-weekly-active="'+(!r.active)+'">'+(r.active?'Pause':'Resume')+'</button></div>').join(''):'<p class="muted">No recurring openings yet. Add a weekday/time to make this service bookable.</p>')+'</div></article>';
   }).join(''):'<p class="muted">No permanent service profiles yet. Your current single-time listings remain available.</p>')+'</div>';
 }
 function previewStudio(){
  const example={profiles:[{id:501,title:'Weekend Lawn Refresh',category:'Lawn care',neighborhood:'Decatur area',description:'Fictional example: residential mowing, edging and cleanup, with weekly availability.',price_cents:4500,active:true}],rules:[{id:601,profile_id:501,day_of_week:6,local_time:'09:00',active:true}]};
  return '<div class="panel"><span class="pilot-eyebrow">DESIGN WALKTHROUGH · NO DATABASE</span><h3>One account, a permanent service, weekly availability</h3><p class="muted">These are fictional examples for layout review. The controls below are disabled in this visual preview.</p></div>'+
   studio(example,'individual').replace(/<button\b/g,'<button disabled');
 }
 function seekerPanel(me,interests){
  return '<div class="panel unified-interests"><div class="row"><div><span class="pilot-eyebrow">YOUR JOB-SEEKER VIEW</span><h3>Find work with the same account</h3>'+
   '<p class="muted">Keep fictional job-search interests without submitting applications or résumés.</p></div>'+
   (me?.user?'<button class="btn secondary" data-action="job-interests">'+(interests?'Update interests':'Set job interests')+'</button>':'<button class="btn secondary" data-action="register">Create one account</button>')+'</div>'+
   (interests?'<p class="unified-saved-interest">Saved test interests: '+h(interests.category)+' · '+h(interests.city)+'</p>':'')+'</div>';
 }
 function interestsForm(interests){
  const choices=['All industries','Services','Warehousing','Retail','Food & Hospitality','Healthcare','Construction','Other'];
  return '<div class="pilot-eyebrow">SAME ACCOUNT · FIND WORK</div><h2 id="modal-title">Your job-search interests</h2><p>Save fictional interests only. This does not create an application or notify any employer.</p>'+
    '<form id="job-interests-form"><label>Preferred city</label><input name="city" minlength="3" maxlength="100" value="'+h(interests?.city||'Decatur, AL')+'" required>'+
    '<label>Industry</label><select name="category">'+choices.map(x=>'<option'+(interests?.category===x?' selected':'')+'>'+h(x)+'</option>').join('')+'</select>'+
    '<p id="form-error" class="error"></p><button class="btn" type="submit">Save fictional interests</button></form>';
 }
 root.RouteDropUnified=Object.freeze({entry,providerForm,profileForm,weeklyForm,profiles,studio,previewStudio,seekerPanel,interestsForm});
})(window);
