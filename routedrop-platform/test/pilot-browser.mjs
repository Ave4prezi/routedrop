import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {chromium} from 'playwright';

const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const base='http://localhost:'+port,pass='local-private-pilot-only';
const auth='Basic '+Buffer.from('routedrop-preview:'+pass).toString('base64');
const app=spawn(process.execPath,['routedrop-platform/server.js'],{
 env:{...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:process.env.TEST_DATABASE_URL,STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',ROUTEDROP_LIVE_APPROVED:'false',ROUTEDROP_PREVIEW_ACCESS_PASSWORD:pass,ROUTEDROP_WORKFLOW_PILOT:'true',PUBLIC_URL:''},
 stdio:['ignore','pipe','pipe']
});
let stderr='';app.stderr.on('data',x=>stderr+=x.toString());
let browser;
const suffix=Date.now();
async function register(page,role,tag){
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('#nav-account [data-action="register"]').click();
 const f=page.locator('#register-form');
 await f.locator('select[name="role"]').selectOption(role);
 await f.locator('input[name="name"]').fill('Pilot Browser '+tag);
 await f.locator('input[name="email"]').fill('browser-'+tag+'-'+suffix+'@example.test');
 await f.locator('input[name="password"]').fill('test-browser-password-only-xyz');
 if(role==='business'){
  await f.locator('input[name="businessName"]').fill('Pilot Studio '+tag);
  await f.locator('input[name="city"]').fill('Decatur, AL');
  await f.locator('select[name="category"]').selectOption('Cleaning');
 }
 await f.locator('button[type=submit]').click();
 await page.locator('#modal').waitFor({state:'hidden'});
 const cookies=await page.context().cookies();
 assert.ok(cookies.some(c=>c.name==='__Host-rd_session'),'session cookie must be retained by Chromium on localhost: '+JSON.stringify(cookies.map(c=>c.name)));
 await page.locator('#nav-account [data-action="logout"]').waitFor();
}
try{
 let ready=false;
 for(let i=0;i<140;i++){
  try{const response=await fetch(base+'/health',{headers:{authorization:auth}});if(response.ok&&(await response.json()).database==='ready'){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'server ready with test database: '+stderr);
 browser=await chromium.launch({headless:true});
 for(const variant of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
  const contextArgs={viewport:{width:variant.width,height:variant.height},httpCredentials:{username:'routedrop-preview',password:pass}};
  const businessContext=await browser.newContext(contextArgs);
  const customerContext=await browser.newContext(contextArgs);
  const business=await businessContext.newPage(),customer=await customerContext.newPage();
  const errors=[],payments=[];
  for(const p of [business,customer]){
   p.on('pageerror',e=>errors.push(e.message));
   p.on('request',r=>{if(/\/api\/(checkout|stripe)|stripe\.com/.test(r.url()))payments.push(r.url());});
  }
  await register(business,'business',variant.name+'-provider');
  await business.getByRole('button',{name:'Business Studio'}).click();
  await business.getByText('Your service headquarters.').waitFor();
  await business.locator('[data-action="create-listing"]').click();
  const form=business.locator('#listing-form');
  await form.locator('input[name="title"]').fill('Private Pilot Cleaning '+variant.name);
  await form.locator('select[name="category"]').selectOption('Cleaning');
  await form.locator('input[name="neighborhood"]').fill('Decatur testing area');
  await form.locator('input[name="price"]').fill('75');
  await form.locator('input[name="slotStart"]').fill(new Date(Date.now()+36*60*60*1000).toISOString().slice(0,16));
  await form.locator('input[name="durationMinutes"]').fill('90');
  await form.locator('button[type="submit"]').click();
  await business.locator('#modal').waitFor({state:'hidden'});
  await business.locator('.pilot-listing-row').first().waitFor();
  await business.locator('#area-city').selectOption('decatur');
  await business.locator('[data-radius-preset="20"]').click();
  await business.locator('[data-action="save-coverage"]').click();
  await business.getByText('Service coverage radius').waitFor();
  await business.screenshot({path:'pilot-business-'+variant.name+'.png',fullPage:true});

  await register(customer,'customer',variant.name+'-customer');
  await customer.locator('nav.tabs [data-tab="explore"]').click();
  await customer.locator('[data-pilot-request]').first().click();
  await customer.getByRole('heading',{name:'Request this opening'}).waitFor();
  assert.ok((await customer.locator('#modal-body').innerText()).includes('$0.00'));
  await customer.locator('[data-action="pilot-confirm-request"]').click();
  await customer.locator('.pilot-request-card').first().waitFor();
  assert.ok((await customer.locator('.pilot-request-card').first().innerText()).includes('Awaiting provider response'));
  await customer.screenshot({path:'pilot-customer-'+variant.name+'.png',fullPage:true});

  await business.getByRole('button',{name:'Business Studio'}).click();
  await business.locator('[data-pilot-action="accept"]').first().click();
  assert.ok((await business.locator('.pilot-request-card').first().innerText()).includes('Accepted'));
  await business.locator('[data-pilot-action="complete"]').first().click();
  assert.ok((await business.locator('.pilot-request-card').first().innerText()).includes('Work marked complete'));
  await customer.getByRole('button',{name:'My bookings'}).click();
  await customer.locator('[data-pilot-action="confirm"]').first().click();
  assert.ok((await customer.locator('.pilot-request-card').first().innerText()).includes('Customer confirmed'));
  assert.deepEqual(payments,[],'no Stripe or checkout requests');
  assert.deepEqual(errors,[],'no browser errors');
  for(const p of [business,customer]){
   const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
   assert.ok(overflow<=2,'no horizontal overflow '+variant.name+': '+overflow);
  }
  console.log('PASS '+variant.name+' customer sign-up, provider sign-up, publish, coverage, real unpaid request, accept, complete, confirm');
  await businessContext.close();await customerContext.close();
 }
}finally{if(browser)await browser.close();app.kill('SIGTERM');}
