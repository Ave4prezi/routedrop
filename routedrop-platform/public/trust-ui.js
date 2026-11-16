'use strict';
(function(root){
 const h=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(x||0)/100);
 const categories=['Lawn care','Cleaning','Car detailing','Washing','Other'];
 const demoProfiles=Object.freeze([
  {id:-501,provider_id:-501,provider_name:'Weekend Yard Helper',provider_kind:'individual',city:'Decatur, AL',title:'Weekend Lawn Refresh',category:'Lawn care',neighborhood:'Southeast Decatur',description:'Fictional example of lawn mowing, edging and light yard cleanup. The price is an illustrative service quote.',price_cents:4500,duration_minutes:60,review_count:0,rating_avg:null,next_listing_id:null},
  {id:-502,provider_id:-502,provider_name:'Greenline Yard Services',provider_kind:'business',city:'Decatur, AL',title:'Standard Lawn & Edge',category:'Lawn care',neighborhood:'Decatur and nearby areas',description:'Fictional example of residential mowing, driveway edging and clipping cleanup for a standard-size lawn.',price_cents:5500,duration_minutes:75,review_count:0,rating_avg:null,next_listing_id:null},
  {id:-503,provider_id:-503,provider_name:'Neighborhood Lawn Care',provider_kind:'individual',city:'Hartselle, AL',title:'Basic Grass Cutting',category:'Lawn care',neighborhood:'Hartselle area',description:'Fictional basic lawn cutting service. Additional trimming or yard work would require a separate quote.',price_cents:4000,duration_minutes:45,review_count:0,rating_avg:null,next_listing_id:null}
 ]);
 const count=x=>Math.max(0,Number(x?.review_count||0));
 const rating=x=>count(x)>0 && Number(x?.rating_avg)>=1 && Number(x?.rating_avg)<=5?Number(x.rating_avg).toFixed(1):null;
 function ratingBadge(x,preview=false){
  const value=rating(x);
  return value?'<span class="trust-rating" aria-label="Average '+value+' out of 5 stars from '+count(x)+' confirmed test reviews"><span aria-hidden="true">★</span> '+value+' <small>('+count(x)+' test review'+(count(x)===1?'':'s')+')</small></span>':
   '<span class="trust-unrated">No reviews yet'+(preview?' · sample only':'')+'</span>';
 }
 function catalog(rows,config,options={}){
  const preview=!config?.unified_pilot;
  const all=preview?demoProfiles:rows;
  const category=categories.includes(options.category)?options.category:'';
  const sort=['price_asc','price_desc','rating_desc'].includes(options.sort)?options.sort:'default';
  const selected=Array.isArray(options.selected)?options.selected:[];
  const visible=all.filter(p=>!category||p.category===category).slice();
  if(sort==='price_asc')visible.sort((a,b)=>Number(a.price_cents)-Number(b.price_cents)||Number(a.id)-Number(b.id));
  if(sort==='price_desc')visible.sort((a,b)=>Number(b.price_cents)-Number(a.price_cents)||Number(a.id)-Number(b.id));
  if(sort==='rating_desc')visible.sort((a,b)=>Number(b.rating_avg||0)-Number(a.rating_avg||0)||count(b)-count(a)||Number(a.price_cents)-Number(b.price_cents));
  return '<div class="unified-preview-intro"><span class="pilot-eyebrow">PRICE COMPARISON · '+(preview?'FICTIONAL EXAMPLES':'PRIVATE TEST DATA')+'</span>'+
   '<h2>Compare the service, price and reviews.</h2><p>Check what each provider offers before requesting an opening. Prices are listed by providers, not guaranteed final quotes. Ratings only come from confirmed test requests; new providers start unrated.</p></div>'+
   '<div class="trust-toolbar"><label>Category<select id="profiles-category"><option value="">All services</option>'+categories.map(c=>'<option'+(category===c?' selected':'')+'>'+h(c)+'</option>').join('')+'</select></label>'+
   '<label>Sort providers<select id="profiles-sort"><option value="default">Recently added</option><option value="price_asc"'+(sort==='price_asc'?' selected':'')+'>Price: low to high</option><option value="price_desc"'+(sort==='price_desc'?' selected':'')+'>Price: high to low</option><option value="rating_desc"'+(sort==='rating_desc'?' selected':'')+'>Top rated test providers</option></select></label>'+
   '<div class="trust-compare-action"><span id="compare-count">'+selected.length+' of 3 selected</span><button class="btn" type="button" data-action="compare-profiles"'+(selected.length<2?' disabled':'')+'>Compare selected</button></div></div>'+
   '<p class="trust-disclaimer">All profiles, prices and reviews here are fictional or private-test data. There are no independently verified qualifications, real client reviews or accepted payments.</p>'+
   '<div class="unified-profiles-grid trust-catalog">'+(visible.length?visible.map(x=>'<article class="unified-profile trust-service-card"><div class="trust-card-overline"><span class="pilot-eyebrow">'+(x.provider_kind==='individual'?'INDIVIDUAL PROVIDER':'SERVICE BUSINESS')+' · UNVERIFIED</span>'+
    '<label class="trust-compare-toggle"><input type="checkbox" data-compare-id="'+Number(x.id)+'"'+(selected.includes(Number(x.id))?' checked':'')+'> Compare</label></div>'+
    '<h3>'+h(x.title)+'</h3><p>'+h(x.provider_name)+' · '+h(x.city)+'</p>'+
    ratingBadge(x,preview)+
    '<p class="unified-profile-about">'+h(x.description)+'</p>'+
    '<div class="unified-profile-facts"><span>'+h(x.category)+'</span><span>'+h(x.neighborhood)+'</span><strong>'+money(x.price_cents)+'</strong></div>'+
    '<div class="trust-card-specs"><span>'+h(x.duration_minutes)+' min estimated</span><span>Listed service price · not a final quote</span></div>'+
    '<button class="trust-reviews-link" data-view-reviews="'+Number(x.provider_id)+'" type="button">'+(count(x)>0?'Read '+count(x)+' test review'+(count(x)===1?'':'s'):'View review status')+'</button>'+
    (x.next_listing_id&&!preview?'<button class="btn" type="button" data-pilot-request="'+Number(x.next_listing_id)+'">Request next opening</button>':'<span class="unified-no-times">'+(preview?'Sample profile · no real bookings':'No available openings yet')+'</span>')+
    '</article>').join(''):'<div class="panel"><h3>No matching services</h3><p class="muted">Choose another category to see more providers.</p></div>')+'</div>';
 }
 function compareModal(rows,selected,config){
  const preview=!config?.unified_pilot,items=selected.map(id=>(preview?demoProfiles:rows).find(x=>Number(x.id)===Number(id))).filter(Boolean).slice(0,3);
  if(items.length<2)return '<h2 id="modal-title">Select two services to compare</h2><p>Choose 2–3 providers in the same service category.</p>';
  const rowsToShow=[
   ['Provider',p=>h(p.provider_name)],
   ['Listed service',p=>h(p.title)],
   ['Listed price',p=>money(p.price_cents)],
   ['Estimated duration',p=>Number(p.duration_minutes)+' minutes'],
   ['Service area',p=>h(p.neighborhood)],
   ['Ratings',p=>rating(p)?rating(p)+' / 5 ('+count(p)+' test reviews)':'No reviews yet'],
   ['Availability',p=>p.next_listing_id&&!preview?'Next opening listed':'Ask for availability']
  ];
  return '<div class="pilot-eyebrow">SIDE-BY-SIDE · '+(preview?'ILLUSTRATIVE PRICES':'TEST ONLY')+'</div><h2 id="modal-title">Compare '+items.length+' '+h(items[0].category)+' services</h2>'+
   '<p>The lowest listed price is not always the best value. Check what is included, the time required and review count. Quotes and travel charges may vary.</p>'+
   '<div class="trust-compare-table"><table><caption>Provider service comparison</caption><thead><tr><th scope="col">Detail</th>'+items.map(p=>'<th scope="col">'+h(p.provider_name)+'</th>').join('')+'</tr></thead><tbody>'+
   rowsToShow.map(([label,format])=>'<tr><th scope="row">'+h(label)+'</th>'+items.map(x=>'<td>'+format(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
   '<p class="legal">These are '+(preview?'fictional examples':'unverified private-test listings')+'. Reviews are not public reputation evidence. No payment or real booking can be made here.</p>';
 }
 function reviewsModal(data,preview=false){
  if(preview)return '<div class="pilot-eyebrow">DESIGN PREVIEW · NO REAL REVIEWS</div><h2 id="modal-title">Customer reviews</h2><p>This fictional provider has no customer reviews. When a real customer confirms completed work, RouteDrop can offer the opportunity to leave a rating. Sample ratings are deliberately not invented.</p>';
  return '<div class="pilot-eyebrow">PRIVATE TEST REVIEWS · UNVERIFIED IDENTITIES</div><h2 id="modal-title">'+h(data.provider.name)+'</h2>'+
   '<div class="trust-review-summary">'+ratingBadge(data.rating,false)+'</div>'+
   '<p class="legal">'+h(data.disclosure)+'</p>'+
   (data.reviews.length?data.reviews.map(r=>'<article class="trust-review"><div class="trust-review-top"><strong>'+h(r.rating)+' / 5 <span aria-hidden="true">★</span></strong><span>Test customer · '+new Date(r.created_at).toLocaleDateString('en-US',{dateStyle:'medium'})+'</span></div><h3>'+h(r.headline)+'</h3><p>'+h(r.comment)+'</p><button class="trust-report" type="button" data-report-review-id="'+Number(r.id)+'">Report inappropriate review</button></article>').join(''):'<p>No reviews yet. New providers do not receive a default star rating.</p>');
 }
 function reviewForm(request){
  return '<div class="pilot-eyebrow">CONFIRMED TEST REQUEST · FEEDBACK</div><h2 id="modal-title">Rate your service experience</h2><p>For <strong>'+h(request.title)+'</strong> by '+h(request.business_name)+'. You can leave one review only after confirming completion of this test request. Use fictional details, not real names or contact information.</p>'+
   '<form id="service-review-form"><input type="hidden" name="requestId" value="'+Number(request.id)+'"><label>Rating</label><select name="rating" required><option value="">Choose a rating</option><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Average</option><option value="2">2 · Below expectations</option><option value="1">1 · Poor</option></select>'+
   '<label>Review headline</label><input name="headline" required minlength="4" maxlength="90" placeholder="Clear communication and on time">'+
   '<label>Written test review (20–500 characters)</label><textarea name="comment" minlength="20" maxlength="500" rows="4" required placeholder="Describe the fictional service experience, what went well and what could improve."></textarea>'+
   '<p class="legal">This appears to other authorized private-test participants only. No real customer identity, phone number, email or address is allowed.</p><p id="form-error" class="error"></p><button class="btn" type="submit">Submit test review</button></form>';
 }
 function reportForm(id){
  return '<div class="pilot-eyebrow">REVIEW SAFETY · PRIVATE TEST</div><h2 id="modal-title">Report a review</h2><p>Reporting records a concern for moderation but does not automatically hide a review. The private test does not have an active support team. Do not include personal information.</p><form id="review-report-form"><input type="hidden" name="reviewId" value="'+Number(id)+'"><label>Reason</label><select name="reason"><option>Personal information</option><option>Harassment</option><option>Spam or promotion</option><option>Other</option></select><p id="form-error" class="error"></p><button type="submit" class="btn">Flag test review</button></form>';
 }
 root.RouteDropTrustUI=Object.freeze({demoProfiles,catalog,compareModal,reviewsModal,reviewForm,reportForm,ratingBadge});
})(window);
