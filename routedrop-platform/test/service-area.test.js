'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const area=require('../public/service-area');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const premium=fs.readFileSync(path.join(__dirname,'../public/premium-2-experience.js'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');

test('only supported public city centers and exact radius increments are accepted',()=>{
 assert.deepEqual(area.validate('decatur',20),{center:'decatur',radiusMiles:20});
 assert.deepEqual(area.validate('hartselle','5'),{center:'hartselle',radiusMiles:5});
 for(const input of [{c:'',r:20},{c:'Decatur',r:20},{c:'decatur',r:0},{c:'decatur',r:55},{c:'decatur',r:10.3},{c:'__proto__',r:15},{c:'decatur',r:'bad'}]){
  assert.equal(area.validate(input.c,input.r),null);
 }
 assert.equal(Object.keys(area.CITIES).length,5);
});
test('distance is symmetric and useful for nearby towns',()=>{
 const {decatur,hartselle,huntsville}=area.CITIES;
 const d=area.distanceMiles(decatur,hartselle);
 assert.ok(d>10&&d<15,JSON.stringify(d));
 assert.ok(Math.abs(d-area.distanceMiles(hartselle,decatur))<0.001);
 assert.ok(area.distanceMiles(decatur,huntsville)>20);
 assert.equal(area.distanceMiles(decatur,decatur),0);
});
test('map SVG depicts radius explicitly and includes an approximate-coverage warning',()=>{
 const svg=area.mapSvg('decatur',20);
 assert.match(svg,/<svg/);
 assert.match(svg,/20-mile radius around Decatur/);
 assert.match(svg,/not a street map/i);
 assert.match(svg,/Approximate center-to-center coverage/);
 assert.match(svg,/r="62"/);
 assert.equal(area.mapSvg('nope',15),'');
});
test('business coverage is an owner-only write with strict validation, not a customer GPS lookup',()=>{
 assert.match(server,/app\.put\('\/api\/business\/service-area',requireDb,requireUser\('business'\)/);
 assert.match(server,/serviceArea\.validate\(req\.body\?\.center,req\.body\?\.radiusMiles\)/);
 assert.match(server,/WHERE owner_id=\$3 RETURNING service_center_code,service_radius_miles/);
 assert.match(server,/SELECT id,name,city,category,service_center_code,service_radius_miles/);
 assert.match(server,/b\.service_center_code,b\.service_radius_miles/);
 assert.doesNotMatch(app,/navigator\.geolocation/);
 assert.doesNotMatch(app,/getCurrentPosition/);
 assert.match(app,/data-action="save-coverage"/);
 assert.match(premium,/data-coverage-listing/);
 assert.match(html,/>Route<span>Drop<\/span>/);
 assert.match(html,/class="brand-pin"/);
 assert.match(html,/service-area\.js/);
});
