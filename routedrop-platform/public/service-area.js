'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.RouteDropServiceArea=api;
})(typeof window==='object'?window:null,function(){
 // Approximate city-center reference coordinates; no street addresses or device geolocation.
 const CITIES=Object.freeze({
  decatur:Object.freeze({name:'Decatur',state:'AL',lat:34.6059,lon:-86.9833}),
  hartselle:Object.freeze({name:'Hartselle',state:'AL',lat:34.4434,lon:-86.9353}),
  huntsville:Object.freeze({name:'Huntsville',state:'AL',lat:34.7304,lon:-86.5861}),
  madison:Object.freeze({name:'Madison',state:'AL',lat:34.6993,lon:-86.7483}),
  athens:Object.freeze({name:'Athens',state:'AL',lat:34.8029,lon:-86.9717})
 });
 const RADII=Object.freeze([5,10,15,20,25,30,35,40,45,50]);
 function validate(center,radius){
  const miles=Number(radius);
  return Object.hasOwn(CITIES,center)&&RADII.includes(miles)?{center,radiusMiles:miles}:null;
 }
 function distanceMiles(a,b){
  const lat1=a.lat*Math.PI/180,lat2=b.lat*Math.PI/180;
  const dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lon-a.lon)*Math.PI/180;
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 3958.7613*2*Math.asin(Math.min(1,Math.sqrt(h)));
 }
 function summary(center,radius){
  const valid=validate(center,radius);
  return valid?RADII.includes(valid.radiusMiles)?valid.radiusMiles+'-mile radius around '+CITIES[center].name+', Alabama':'':'Service area not set';
 }
 // Schematic but directionally and radially scaled by geographical miles; no street map is claimed.
 function mapSvg(center,radius){
  const v=validate(center,radius);if(!v)return '';
  const base=CITIES[center],scale=3.1,midX=300,midY=185,rad=v.radiusMiles*scale;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
  const locations=Object.entries(CITIES).map(([code,city])=>{
   if(code===center)return '';
   const x=midX+(city.lon-base.lon)*Math.cos(base.lat*Math.PI/180)*69.17*scale;
   const y=midY-(city.lat-base.lat)*69.0*scale;
   if(x<15||x>585||y<20||y>355)return '';
   const inside=distanceMiles(base,city)<=v.radiusMiles;
   return '<g class="area-city '+(inside?'within':'outside')+'"><circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="4"/><text x="'+(x+9).toFixed(1)+'" y="'+(y-7).toFixed(1)+'">'+esc(city.name)+'</text></g>';
  }).join('');
  const lines=Array.from({length:9},(_,i)=>'<path d="M'+(i*75)+' 0V370 M0 '+(i*48)+'H600"/>').join('');
  return '<svg class="coverage-map" viewBox="0 0 600 370" role="img" aria-label="Approximate geographic radius diagram showing '+esc(summary(center,radius))+'; not a street map"><rect width="600" height="370" rx="16" fill="#eef5ff"/><g class="area-grid">'+lines+'</g><circle class="area-outer" cx="300" cy="185" r="'+rad+'"/><circle class="area-inner" cx="300" cy="185" r="'+(rad/2)+'"/><circle class="area-center" cx="300" cy="185" r="7"/><text class="area-label" x="312" y="178">'+esc(base.name)+'</text><text class="area-distance" x="300" y="'+(185-rad+19)+'" text-anchor="middle">'+v.radiusMiles+' miles</text>'+locations+'<text class="area-caption" x="18" y="351">Approximate center-to-center coverage · no address-level guarantee</text></svg>';
 }
 return Object.freeze({CITIES,RADII,validate,distanceMiles,summary,mapSvg});
});
