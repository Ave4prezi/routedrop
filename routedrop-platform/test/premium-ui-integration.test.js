'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'..','public');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const css=fs.readFileSync(path.join(base,'premium.css'),'utf8');
const app=fs.readFileSync(path.join(base,'app.js'),'utf8');
test('premium UI keeps application mounting points',()=>{
 for(const id of ['nav-account','status','offers','offer-count','search','category','my-bookings','studio-body','modal','modal-body','close-modal'])assert.match(html,new RegExp('id="'+id+'"'));
 for(const tab of ['explore','bookings','business']){assert.match(html,new RegExp('id="'+tab+'"'));assert.match(html,new RegExp('data-tab="'+tab+'"'));}
});
test('sandbox and real API wiring preserved',()=>{
 assert.match(html,/ISOLATED STRIPE TEST SANDBOX/);
 assert.match(html,/no real charges/);
 assert.match(html,/<script src="\/app\.js" defer>/);
 assert.match(app,/\/api\/deferred-bookings/);
 assert.match(app,/\/api\/stripe\/connect/);
 assert.match(app,/x-csrf-token/);
 assert.doesNotMatch(html,/onclick=/);
});
test('premium layouts support mobile and reduced motion',()=>{
 assert.match(html,/premium\.css/);
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/focus-visible/);
});
test('only one instance of each app mount',()=>{
 for(const id of ['explore','bookings','business','modal','status','offers','studio-body']){
   const hits=html.match(new RegExp('id="'+id+'"','g'))||[];
   assert.equal(hits.length,1,'duplicate mount '+id);
 }
});
