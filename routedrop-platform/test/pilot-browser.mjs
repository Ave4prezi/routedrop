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
  await business.locator('[data-action="post-job"]').click();
  const jobForm=business.locator('#job-form');
  await jobForm.locator('[name="title"]').fill('Fictional Local Job '+variant.name);
  await jobForm.locator('[name="category"]').selectOption('Services');
  await jobForm.locator('[name="city"]').fill('Decatur, AL');
  await jobForm.locator('[name="employmentType"]').selectOption('Part-time');
  await jobForm.locator('[name="payDisplay"]').fill('Example $18/hr');
  await jobForm.locator('[name="summary"]').fill('Fictional test hiring opportunity with no real applicant collection.');
  await jobForm.locator('button[type="submit"]').click();
  await business.locator('#modal').waitFor({state:'hidden'});
  await business.locator('.opportunity-manage [data-job-status-id]').first().waitFor();
  await business.getByRole('button',{name:'Find Work & Jobs'}).click();
  await business.locator('.opportunity-card').filter({hasText:'Fictional Local Job '+variant.name}).waitFor();
  await business.locator('#job-search').fill('Fictional Local Job '+variant.name);
  assert.equal(await business.locator('.opportunity-card:visible').count(),1,'job search filters real test postings');
  await business.screenshot({path:'pilot-jobs-'+variant.name+'.png',fullPage:true});
  await business.getByRole('button',{name:'Business Studio'}).click();

  await register(customer,'customer',variant.name+'-customer');
  await customer.locator('nav.tabs [data-tab="explore"]').click();
  await customer.locator('.card').filter({hasText:'Private Pilot Cleaning '+variant.name}).locator('[data-pilot-request]').click();
  await customer.getByRole('heading',{name:'Request this opening'}).waitFor();
  assert.ok((await customer.locator('#modal-body').innerText()).includes('$0.00'));
  await customer.locator('[data-action="pilot-confirm-request"]').click();
  await customer.locator('.pilot-request-card').first().waitFor();
  const requestedText=await customer.locator('.pilot-request-card').first().innerText();
  assert.ok(requestedText.includes('Awaiting provider response'),'expected pending customer request; rendered='+JSON.stringify(requestedText)+'; status='+JSON.stringify(await customer.locator('#status').innerText()));
  await customer.screenshot({path:'pilot-customer-'+variant.name+'.png',fullPage:true});

  await business.getByRole('button',{name:'Business Studio'}).click();
  await business.locator('[data-pilot-action="accept"]').first().click();
  await business.locator('#studio-body .pilot-request-card .pilot-status').getByText('Accepted',{exact:true}).waitFor();
  await business.locator('[data-pilot-action="complete"]').first().click();
  await business.locator('#studio-body .pilot-request-card .pilot-status').getByText('Work marked complete',{exact:true}).waitFor();
  await customer.getByRole('button',{name:'My bookings'}).click();
  await customer.locator('[data-pilot-action="confirm"]').first().click();
  await customer.locator('#my-bookings .pilot-request-card .pilot-status').getByText('Customer confirmed',{exact:true}).waitFor();
  const individualContext=await browser.newContext(contextArgs);
  const individual=await individualContext.newPage();
  individual.on('pageerror',e=>errors.push(e.message));
  individual.on('request',r=>{if(/\/api\/(checkout|stripe)|stripe\.com/.test(r.url()))payments.push(r.url());});
  await register(individual,'individual',variant.name+'-independent');
  await individual.getByRole('button',{name:'Business Studio'}).click();
  await individual.getByText('Your independent service studio.').waitFor();
  assert.equal(await individual.locator('[data-action="post-job"]').count(),0,'individual providers cannot post employer job openings');
  await individual.locator('[data-action="create-listing"]').click();
  const independentForm=individual.locator('#listing-form');
  await independentForm.locator('[name="title"]').fill('Solo Mowing '+variant.name);
  await independentForm.locator('[name="category"]').selectOption('Lawn care');
  await independentForm.locator('[name="neighborhood"]').fill('Decatur testing area');
  await independentForm.locator('[name="price"]').fill('45');
  await independentForm.locator('[name="slotStart"]').fill(new Date(Date.now()+48*60*60*1000).toISOString().slice(0,16));
  await independentForm.locator('[name="durationMinutes"]').fill('60');
  await independentForm.locator('button[type="submit"]').click();
  await independent.locator('#modal').waitFor({state:'hidden'});
  await customer.getByRole('button',{name:'Explore services'}).click();
  await customer.locator('.card').filter({hasText:'Solo Mowing '+variant.name}).getByText('Individual provider · unverified').waitFor();
  await individual.screenshot({path:'pilot-individual-'+variant.name+'.png',fullPage:true});
  assert.deepEqual(payments,[],'no Stripe or checkout requests');
  assert.deepEqual(errors,[],'no browser errors');
  for(const p of [business,customer]){
   const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
   assert.ok(overflow<=2,'no horizontal overflow '+variant.name+': '+overflow);
  }
  console.log('PASS '+variant.name+' independent signup, job post/search, customer booking lifecycle, no payments');
  await businessContext.close();await customerContext.close();await individualContext.close();
 }
}finally{if(browser)await browser.close();app.kill('SIGTERM');}
