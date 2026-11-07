'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadPanel(){
 const js=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 const from=js.indexOf('function verificationPanel(v){');
 const to=js.indexOf('\nasync function showVerificationUpload',from);
 assert.ok(from>=0&&to>from,'provider panel implementation is present');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return vm.runInNewContext('('+js.slice(from,to).trim()+')',{esc});
}

test('Business Studio renders a rejection reason instead of throwing a TypeError',()=>{
 const html=loadPanel()({
  eligible:false,
  requirements:['identity','business_info','liability_insurance'],
  documents:[{kind:'identity',status:'rejected',rejection_reason:'Brand logo only. Not valid identity verification.',has_document:true}],
  manualReview:false
 });
 assert.match(html,/Provider compliance/);
 assert.match(html,/identity/);
 assert.match(html,/rejected/);
 assert.match(html,/Reason: Brand logo only\. Not valid identity verification\./);
 assert.match(html,/data-delete-evidence="identity"/);
 assert.match(html,/Submit document for review/);
});

test('Rejection notes are escaped before being displayed to providers',()=>{
 const html=loadPanel()({
  eligible:false,requirements:['identity'],
  documents:[{kind:'identity',status:'rejected',rejection_reason:'<script>unsafe</script>',has_document:false}],
  manualReview:false
 });
 assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
 assert.ok(!html.includes('<script>'));
});
