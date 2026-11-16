import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {chromium} from 'playwright';
const srv=net.createServer();srv.listen(0,'127.0.0.1');await once(srv,'listening');const port=srv.address().port;await new Promise(r=>srv.close(r));
const url='http://127.0.0.1:'+port;
const app=spawn(process.execPath,['routedrop-platform/server.js'],{env:{...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',ROUTEDROP_PREVIEW_ACCESS_PASSWORD:'',ROUTEDROP_LIVE_APPROVED:'false'},stdio:['ignore','pipe','pipe']});
let err='';app.stderr.on('data',x=>{err+=x.toString()});let browser;
try{
 let ready=false;
 for(let i=0;i<110;i++){try{const r=await fetch(url+'/health');if(r.ok){const j=await r.json();assert.equal(j.payments,'not configured');assert.equal(j.database,'not configured');ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,'server failed: '+err);
 browser=await chromium.launch({headless:true});
 for(const v of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
  const page=await browser.newPage({viewport:{width:v.width,height:v.height}});
  const problems=[];page.on('pageerror',e=>problems.push(e.message));
  await page.goto(url,{waitUntil:'networkidle'});
  assert.equal((await page.locator('header .brand').textContent()).replace(/\s+/g,''),'RouteDrop');
  await page.getByRole('heading',{name:/Local help/}).waitFor();
  await page.getByText('BrightNest Cleaning Co.').waitFor();
  assert.equal(await page.locator('.provider-photo').count(),3);
  assert.equal(await page.locator('.card [data-book]').count(),0,'demo must not book');
  assert.equal(await page.locator('.card .btn.dark:disabled').count(),3,'demo CTA disabled');
  await page.locator('[data-category-choice="Cleaning"]').click();
  assert.equal(await page.locator('.card').count(),1);
  await page.locator('#clear-filters').click();
  assert.equal(await page.locator('.card').count(),3);
  await page.locator('[data-profile-listing="-101"]').click();
  await page.getByRole('heading',{name:'BrightNest Cleaning Co.'}).waitFor();
  assert.match(await page.locator('.modal-content').innerText(),/FICTIONAL BUSINESS SHOWCASE/);
  assert.match(await page.locator('.modal-content .coverage-map').getAttribute('aria-label'),/20-mile radius/);
  await page.locator('#close-modal').click();
  await page.locator('[data-coverage-listing="-102"]').click();
  assert.match(await page.locator('.modal-content .coverage-map').getAttribute('aria-label'),/35-mile radius/);
  await page.locator('#close-modal').click();
  await page.getByRole('button',{name:'My bookings'}).click();
  await page.getByText('Every detail, thoughtfully handled.').waitFor();
  await page.getByRole('button',{name:'Business Studio'}).click();
  await page.getByText('A more beautiful way to run your day.').waitFor();
  assert.equal(await page.locator('#area-city').inputValue(),'decatur');
  await page.locator('#area-radius').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.match(await page.locator('#business-area-map svg').getAttribute('aria-label'),/40-mile radius/);
  await page.locator('#area-city').selectOption('madison');
  assert.match(await page.locator('#business-area-map svg').getAttribute('aria-label'),/40-mile radius around Madison/);
  assert.equal(await page.locator('[data-action="save-coverage"]').count(),0,'demo must not save');
  assert.deepEqual(problems,[],'no browser page errors');
  await page.screenshot({path:'premium-2-'+v.name+'.png',fullPage:true});
  console.log('PASS '+v.name+' premium home, discovery, profile, coverage, booking tour, business studio, no payments');
  await page.close();
 }
}finally{if(browser)await browser.close();app.kill('SIGTERM');}
