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
   '<div class="cardfoot"><span class="price">'+money(x.price_cents)+'</span><button class="btn dark" '+(!demo&&config?.payments?'data-book="'+Number(x.id)+'"':'disabled aria-label="Bookings not available in this preview"')+'>'+(demo?'Preview only':config?.payments?'Book this slot':'Not yet available')+'</button></div></div></article>';
  }).join('');
 }
 function bookings(){
  return '<div class="studio-demo-top"><div class="eyebrow">A PRIVATE TOUR OF THE EXPERIENCE</div><h2>Every detail, thoughtfully handled.</h2><p>See how customers could move from discovery to completion. No actual appointment or payment exists.</p></div>'+
  '<div class="sample-booking-steps"><article><span>STEP 01</span><strong>Find the right fit</strong><p>Explore services and see approximate provider coverage.</p></article><article><span>STEP 02</span><strong>Set the date</strong><p>In a future approved flow, request an opening with clear expectations.</p></article><article><span>STEP 03</span><strong>Approve the completed work</strong><p>Customer confirmation would be required before charging.</p></article></div>'+
  '<div class="panel"><h3>Your future bookings, all in one place.</h3><p class="muted">This private preview uses invented examples only. No booking history or payment information exists.</p><button class="btn" type="button" data-tab="explore">Explore example services</button></div>';
 }
 function studio(radiusMarkup){
  return '<div class="studio-demo-top"><div class="eyebrow">THE PROVIDER EXPERIENCE</div><h2>A more beautiful way to run your day.</h2><p>Preview future provider tools and your coverage planning workflow. All figures are illustrations, not actual revenue or performance.</p></div>'+
  '<div class="studio-highlights"><div><span>Example service radius</span><strong>20 mi</strong><p>Centered on Decatur · adjustable</p></div><div><span>Example service price</span><strong>$75</strong><p>Fictional house cleaning service</p></div><div><span>Proposed platform fee</span><strong>8%</strong><p>On successfully collected service payments</p></div></div>'+radiusMarkup+
  '<div class="panel"><h3>Your business, moving forward</h3><div class="record"><div><strong>Set your territory</strong><p>Choose your approximate city center and the miles you travel.</p></div><span class="pill">Try it now</span></div><div class="record"><div><strong>Publish openings</strong><p>In the approved version, list times, prices and service durations.</p></div><span class="pill">Planned</span></div><div class="record"><div><strong>Complete work and get paid</strong><p>Customer-authorized payment after completed work is the proposed model.</p></div><span class="pill">Not active</span></div></div>';
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
 root.RouteDropPremium2=Object.freeze({DEMO,cards,bookings,studio,profile});
})(window);
