import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
async function randomPort(){
 const server=net.createServer();
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=server.address().port;await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));return port;
}
const port=await randomPort(),base='http://127.0.0.1:'+port;
const app=spawn(process.execPath,['routedrop-platform/server.js'],{
 cwd:root,
 env:{...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',ROUTEDROP_STAGING_LOCK:'false',ROUTEDROP_PRIVATE_PREVIEW_ONLY:'false',ROUTEDROP_PROVIDER_DOCS_MODE:'',ROUTEDROP_LIVE_APPROVED:'false',ROUTEDROP_DEFERRED_BETA_ENABLED:'false'},
 stdio:['ignore','pipe','pipe']
});
let logs='';app.stdout.on('data',b=>{logs=(logs+b.toString()).slice(-1500)});
app.stderr.on('data',b=>{logs=(logs+b.toString()).slice(-1500)});
async function waitReady(){
 for(let i=0;i<100;i++){
  if(app.exitCode!==null)throw Error('App exited before ready: '+logs);
  try{const r=await fetch(base+'/health');if(r.ok){const data=await r.json();assert.equal(data.database,'not configured');assert.equal(data.payments,'not configured');return;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 throw Error('App never became ready: '+logs);
}
let browser;
try{
 await waitReady();
 browser=await chromium.launch({headless:true});
 for(const layout of [{name:'desktop',width:1365,height:900},{name:'mobile',width:390,height:844}]){
  const page=await browser.newPage({viewport:{width:layout.width,height:layout.height},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:/Start guided tour/}).first().click();
  await page.getByText('Standard house cleaning').waitFor();
  assert.equal(await page.locator('[data-book]').count(),0,'tour must not expose payment booking controls');
  assert.equal(await page.locator('.card').count(),3);
  assert.equal(await page.locator('.tour-photo svg[role=img]').count(),3,'three distinct fictional owner illustrations expected');
  await page.locator('#search').fill('no-such-place');
  await page.getByRole('heading',{name:'No matching test openings'}).waitFor();
  await page.getByRole('button',{name:'Clear filters'}).first().click();
  assert.equal(await page.locator('.card').count(),3);
  await page.getByRole('button',{name:'My bookings'}).click();
  await page.getByRole('heading',{name:'Example customer journey'}).waitFor();
  await page.getByText('The customer separately approves the quoted amount').waitFor();
  await page.getByRole('button',{name:'Business Studio'}).click();
  await page.locator('#studio-body').getByText('BrightNest Cleaning Co.').waitFor();
  await page.locator('#studio-body').getByText('No required monthly membership').waitFor();
  assert.equal(await page.getByRole('button',{name:/Connect payouts/}).count(),0);
  await page.screenshot({path:'tour-'+layout.name+'-business.png',fullPage:true});
  await page.getByRole('button',{name:'See customer view'}).click();
  await page.getByText('Lawn refresh & edging').waitFor();
  await page.screenshot({path:'tour-'+layout.name+'-customer.png',fullPage:true});
  await page.getByRole('button',{name:'Exit tour'}).click();
  await page.getByRole('heading',{name:'Private preview setup is still underway'}).waitFor();
  assert.equal(await page.getByText('Standard house cleaning').count(),0);
  assert.deepEqual(errors,[],'no browser runtime errors in '+layout.name);
  console.log('PASS '+layout.name+' customer search, empty state, bookings walkthrough, business model, exit, no payments');
  await page.close();
 }
}finally{
 if(browser)await browser.close();
 app.kill('SIGTERM');
 await new Promise(resolve=>{if(app.exitCode!==null||app.signalCode!==null)return resolve();app.once('exit',resolve);setTimeout(resolve,1200).unref();});
}
