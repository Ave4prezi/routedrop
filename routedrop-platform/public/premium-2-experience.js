'use strict';
(function(root){
 const h=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0)/100);
 const DEMO=Object.freeze([
  {id:-101,title:'The Signature Home Refresh',category:'Cleaning',business_name:'BrightNest Cleaning Co.',neighborhood:'Southeast Decatur',city:'Decatur, AL',slot_start:'2027-01-08T16:00:00Z',duration_minutes:120,price_cents:7500,service_center_code:'decatur',service_radius_miles:20,demoKind:'cleaning',demoOwner:'Jordan',demoAbout:'A thoughtful, detail-focused cleaning experience designed for busy days and comfortable spaces.'},
  {id:-102,title:'The Complete Interior Detail',category:'Car detailing',business_name:'Northside Detail Co.',neighborhood:'Downtown Decatur',city:'Decatur, AL',slot_start:'2027-01-10T18:00:00Z',duration_minutes:90,price_cents:12000,service_center_code:'decatur',service_radius_miles:35,demoKind:'detail',demoOwner:'Taylor',demoAbout:'Careful interior care, with an eye for the details that make your vehicle feel new again.'},
  {id:-103,title:'Lawn Refresh & Edging',category:'Lawn care',business_name:'Greenline Outdoor Co.',neighborhood:'Hartselle area',city:'Hartselle, AL',slot_start:'2027-01-12T17:00:00Z',duration_minutes:60,price_cents:6500,service_center_code:'hartselle',service_radius_miles:25,demoKind:'lawn',demoOwner:'Morgan',demoAbout:'Thoughtful maintenance and finishing touches for outdoor spaces, with predictable service windows.'}
 ]);
 function kind(x){if(x.demoKind)return x.demoKind;const c=String(x.category||'').toLowerCase();return c.includes('detail')||c.includes('car')?'detail':c.includes('lawn')||c.includes('landscape')?'lawn':'cleaning'}
 function cards(items,config,area){
  return items.map(x=>{
   const demo=Boolean(x.demoKind),valid=area.validate(x.service_center_code,x.service_radius_miles);
   return '<article class="card">'+(demo?'<div class="provider-photo provider-photo--'+h(kind(x))+'" role="img" aria-label="AI-generated illustrative professional image for a fictional '+h(x.category)+' provider"><span class="provider-photo-label">FICTIONAL DEMO</span></div>':'')+
   '<div class="cardbanner"><span>'+h(x.category)+'</span><span>'+(demo?'Concept preview':'Service listing')+'</span></div><div class="cardbody"><div class="muted">'+h(x.business_name)+'</div><h3>'+h(x.title)+'</h3>'+
   '<div class="detail">⌖ '+h(x.neighborhood)+', '+h(x.city)+'</div><div class="detail">'+(demo?'Example duration: ':'Duration: ')+h(x.duration_minutes)+' min</div>'+
   '<button class="profile-open" type="button" data-profile-listing="'+Number(x.id)+'">Explore business profile ↗</button>'+
   (valid?'<button class="coverage-open" type="button" data-coverage-listing="'+Number(x.id)+'">⌖ '+h(area.summary(valid.center,valid.radiusMiles))+' · View map</button>':'<p class="muted">Service area not listed</p>')+
   '<div class="cardfoot"><span class="price">'+money(x.price_cents)+'</span><button class="btn dark" '+(demo?'data-demo-book="'+Number(x.id)+'"':config?.payments?'data-book="'+Number(x.id)+'"':'disabled aria-label="Bookings not available"')+'>'+(demo?'Try booking preview ↗':config?.payments?'Book this slot':'Not yet available')+'</button></div></div></article>';
  }).join('');
 }
 const WINDOWS=Object.freeze({morning:'9:00 AM',afternoon:'1:00 PM',evening:'5:00 PM'});
 const STATUSES=Object.freeze({requested:'Awaiting provider response',accepted:'Accepted by provider',completed:'Work marked complete',confirmed:'Customer confirmed · no charge',declined:'Declined by provider',canceled:'Canceled by customer',review:'Problem reported · no charge'});
 function demoBookingModal(x,slot='afternoon'){
  if(!x?.demoKind||!Object.hasOwn(WINDOWS,slot))return '';
  return '<div class="demo-modal-banner"><span class="demo-status-kicker">INTERACTIVE · FICTIONAL SCENARIO</span><h2 id="modal-title">Preview a booking</h2><p>Walk through the customer experience without entering an address, creating an account or providing a payment method.</p></div>'+
  '<div class="demo-selected-service"><div class="demo-mini-photo provider-photo--'+h(kind(x))+'" aria-hidden="true"></div><div><small>YOUR EXAMPLE SERVICE</small><strong>'+h(x.title)+'</strong><span>'+h(x.business_name)+' · '+h(x.city)+'</span></div></div>'+
  '<div class="demo-step-heading"><span>01 / 02</span><h3>Select a sample arrival window</h3><p>These are illustrative options, not actual provider availability or a confirmed appointment.</p></div>'+
  '<div class="demo-time-options" role="group" aria-label="Sample time window">'+Object.entries(WINDOWS).map(([key,label])=>'<button type="button" class="demo-time-option" data-demo-slot="'+key+'" aria-pressed="'+(key===slot)+'"><strong>'+h(label)+'</strong><small>'+h(key[0].toUpperCase()+key.slice(1))+'</small></button>').join('')+'</div>'+
  '<div class="demo-cost-box"><div><span>Example service price</span><strong>'+money(x.price_cents)+'</strong></div><div><span>Charged today</span><strong>$0.00</strong></div><p>The proposed customer-confirmation payment process has not been activated. No charge will occur in this demonstration.</p></div>'+
  '<div class="demo-book-actions"><button type="button" class="btn" data-action="demo-confirm-request">Create fictional request <span aria-hidden="true">↗</span></button><button type="button" class="btn secondary" data-action="demo-back-to-profile">Return to profile</button></div>';
 }
 function requestMarkup(requests,mode){
  if(!requests.length)return '<div class="panel demo-empty"><div class="demo-empty-symbol" aria-hidden="true">✦</div><h3>'+ (mode==='provider'?'No example requests yet':'Your preview starts with a service')+'</h3><p class="muted">'+(mode==='provider'?'Go to Explore services, choose a fictional listing and try its booking preview. The example will appear here.':'Explore a fictional provider and select “Try booking preview.” You can follow the example from request to completion without any personal information.')+'</p><button class="btn" type="button" data-tab="explore">Explore services <span aria-hidden="true">↗</span></button></div>';
  return requests.map(req=>{
   const item=DEMO.find(x=>x.id===req.listingId);if(!item)return '';
   const status=STATUSES[req.status]||'Unknown demo state';
   let controls='';
   if(mode==='customer'){
    if(req.status==='requested'||req.status==='accepted')controls='<button class="btn secondary" type="button" data-demo-action="cancel" data-demo-id="'+req.id+'">Cancel fictional request</button>';
    if(req.status==='accepted')controls+='<button class="btn" type="button" data-tab="business">View provider actions</button>';
    if(req.status==='completed')controls='<button class="btn" type="button" data-demo-action="approve" data-demo-id="'+req.id+'">Confirm work · no charge</button><button class="btn secondary" type="button" data-demo-action="report" data-demo-id="'+req.id+'">Report a problem (demo)</button>';
   }else{
    if(req.status==='requested')controls='<button class="btn" type="button" data-demo-action="accept" data-demo-id="'+req.id+'">Accept fictional job</button><button class="btn secondary" type="button" data-demo-action="decline" data-demo-id="'+req.id+'">Decline</button>';
    if(req.status==='accepted')controls='<button class="btn" type="button" data-demo-action="finish" data-demo-id="'+req.id+'">Mark example work complete</button>';
   }
   const stages=['requested','accepted','completed','confirmed'],order=stages.indexOf(req.status),last=order===-1?0:order;
   return '<article class="demo-request" aria-label="Fictional request for '+h(item.title)+'"><div class="demo-request-header"><div><span class="demo-status-kicker">SAMPLE REQUEST · '+h(req.id.toUpperCase())+'</span><h3>'+h(item.title)+'</h3><p>'+h(item.business_name)+' · '+h(item.neighborhood)+'</p></div><span class="demo-stage '+(req.status==='confirmed'?'complete':req.status==='review'?'needs-review':'')+'">'+h(status)+'</span></div>'+
   '<div class="demo-request-info"><div><small>ILLUSTRATIVE TIME</small><strong>'+h(WINDOWS[req.slot])+'</strong></div><div><small>EXAMPLE PRICE</small><strong>'+money(item.price_cents)+'</strong></div><div><small>ACTUAL AMOUNT CHARGED</small><strong>$0.00</strong></div></div>'+
   '<div class="demo-progress" aria-label="Simulated booking stages">'+stages.map((name,i)=>'<div class="'+(i<=last?'done':'')+'"><span>'+(i<=last?'✓':String(i+1))+'</span><small>'+h(name==='requested'?'Requested':name==='accepted'?'Accepted':name==='completed'?'Work done':'Confirmed')+'</small></div>').join('')+'</div>'+
   '<p class="demo-safety-caption">'+(req.status==='confirmed'?'The customer confirmed the fictional work. No charge or provider payout was made.':req.status==='review'?'A simulated problem was reported. The preview has not contacted support or created a real dispute.':req.status==='declined'||req.status==='canceled'?'The fictional request is closed. Nothing was canceled or changed outside this page.':'Demo statuses are stored only in this open page; no real appointment exists.')+'</p>'+
   (controls?'<div class="demo-request-actions">'+controls+'</div>':'')+'</article>';
  }).join('');
 }
 function bookings(requests=[]){
  return '<div class="studio-demo-top"><div class="eyebrow">INTERACTIVE CUSTOMER PREVIEW</div><h2>Every detail, thoughtfully handled.</h2><p>Follow fictional requests from discovery to completion. No real appointments, personal data, or charges are created.</p></div>'+
  '<div class="sample-booking-steps"><article><span>STEP 01</span><strong>Choose a professional</strong><p>Browse fictional providers, sample prices and coverage maps.</p></article><article><span>STEP 02</span><strong>Preview a time</strong><p>Choose a fictional arrival window and follow a provider response.</p></article><article><span>STEP 03</span><strong>Confirm the work</strong><p>Practice the planned customer approval step. This preview never charges a card.</p></article></div>'+
  '<div class="demo-section-head"><div><span class="eyebrow">YOUR EXAMPLE APPOINTMENTS</span><h2>Booking walkthrough</h2></div><button class="demo-reset" type="button" data-action="demo-reset">Reset demo</button></div>'+
  '<div class="demo-request-list">'+requestMarkup(requests,'customer')+'</div>';
 }
 function studio(radiusMarkup,requests=[]){
  const active=requests.filter(x=>['requested','accepted','completed'].includes(x.status)).length;
  const done=requests.filter(x=>x.status==='confirmed').length;
  return '<div class="studio-demo-top"><div class="eyebrow">INTERACTIVE BUSINESS STUDIO</div><h2>A more beautiful way to run your day.</h2><p>Practice reviewing requests and managing your travel radius. Every appointment, provider and amount here is fictional and stored only in this page.</p></div>'+
  '<div class="studio-highlights"><div><span>Demo requests awaiting action</span><strong>'+active+'</strong><p>Not real leads or customers</p></div><div><span>Example requests completed</span><strong>'+done+'</strong><p>No actual services performed</p></div><div><span>Example platform fee</span><strong>8%</strong><p>Proposed for collected payments · none charged</p></div></div>'+
  '<div class="demo-section-head"><div><span class="eyebrow">YOUR DAY AT A GLANCE</span><h2>Sample job requests</h2></div><button class="demo-reset" type="button" data-action="demo-reset">Reset demo</button></div>'+
  '<div class="demo-request-list">'+requestMarkup(requests,'provider')+'</div>'+
  radiusMarkup+
  '<div class="panel"><h3>Designed for the way you work</h3><div class="record"><div><strong>Set your territory</strong><p>Experiment with city-center coverage and quick radius settings.</p></div><span class="pill">Interactive preview</span></div><div class="record"><div><strong>Manage your availability</strong><p>Future verified providers can publish service hours and accurate prices.</p></div><span class="pill">Planned</span></div><div class="record"><div><strong>Earn after completed work</strong><p>The proposed fee applies only to real, successfully collected payments after launch approval.</p></div><span class="pill">Not active</span></div></div>';
 }
 function profile(x,area){
  const demo=Boolean(x.demoKind),valid=area.validate(x.service_center_code,x.service_radius_miles);
  const details={
   cleaning:['General surface cleaning','Kitchen and bathroom touch-ups','Floor care and finishing details'],
   detail:['Interior surfaces and console care','Vacuuming and detailing','Window and mirror cleaning'],
   lawn:['Lawn mowing','Driveway and border edging','Clipping and presentation cleanup']
  };
  const sampleItems=demo?(details[kind(x)]||[]):[];
  const checklist=demo?'<section class="profile-inclusions"><div class="profile-overline">SAMPLE SERVICE SCOPE</div><h3>What this example could include</h3><ul>'+sampleItems.map(item=>'<li><span aria-hidden="true">✓</span>'+h(item)+'</li>').join('')+'</ul><p>Illustrative checklist only. Actual scope and exclusions would be agreed with the provider before booking.</p></section>':'';
  return '<div class="profile-overline">'+(demo?'FICTIONAL BUSINESS SHOWCASE':'SERVICE LISTING DETAILS')+'</div><h2 id="modal-title">'+h(x.business_name)+'</h2>'+
  (demo?'<div class="profile-cover '+h(kind(x))+'" role="img" aria-label="AI-generated illustrative professional image"></div>':'')+
  '<div class="profile-facts"><span>'+h(x.category)+'</span><span>'+h(x.city)+'</span><span>'+money(x.price_cents)+(demo?' sample price':' listed price')+'</span></div>'+
  '<p class="profile-description">'+(demo?h(x.demoAbout):'This listing has a price and opening, but additional provider credentials, independent reviews and service photos have not been verified for display.')+'</p>'+
  '<div class="profile-service-block"><div><span class="profile-overline">SERVICE OVERVIEW</span><h3>'+h(x.title)+'</h3><p>'+h(x.neighborhood)+' · '+h(x.duration_minutes)+' minutes</p></div><div class="profile-price"><small>'+(demo?'SAMPLE PRICE':'LISTED PRICE')+'</small><strong>'+money(x.price_cents)+'</strong></div></div>'+
  checklist+
  (valid?'<h3>Service-area preview</h3><p>'+h(area.summary(valid.center,valid.radiusMiles))+'. Straight-line estimate; road access and address-level coverage are not guaranteed.</p><div class="coverage-map-wrap">'+area.mapSvg(valid.center,valid.radiusMiles)+'</div>':'<p>No coverage radius is currently listed.</p>')+
  '<p class="legal">'+(demo?'Fictional demonstration. No real reviews, verified provider, availability or booking exists.':'No verified identity or customer rating claims are being made.')+'</p>';
 }
 root.RouteDropPremium2=Object.freeze({DEMO,WINDOWS,STATUSES,cards,bookings,studio,profile,demoBookingModal});
})(window);
