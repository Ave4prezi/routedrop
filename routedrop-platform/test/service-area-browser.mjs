import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';
import {chromium} from 'playwright';
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
const port=listener.address().port;await new Promise(r=>listener.close(r));
const base='http://127.0.0.1:'+port;
const app=spawn(process.execPath,['routedrop-platform/server.js'],{env:{...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',ROUTEDROP_LIVE_APPROVED:'false'},stdio:['ignore','pipe','pipe']});
let log='';app.stderr.on('data',s=>{log+=s.toString()});
let browser;
try{
 let running=false;
 for(let i=0;i<80;i++){try{const x=await fetch(base+'/health');if(x.ok){running=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(running,'app must launch: '+log);
 browser=await chromium.launch({headless:true});
 for(const variant of [{name:'desktop',width:1280,height:840},{name:'mobile',width:390,height:844}]){
  const page=await browser.newPage({viewport:{width:variant.width,height:variant.height}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  const brand=await page.locator('header .brand').textContent();
  assert.equal(brand.replace(/\\s+/g,''),'RouteDrop');
  await page.getByRole('button',{name:'Business studio'}).click();
  await page.getByRole('heading',{name:/Sample service radius/}).waitFor();
  assert.equal(await page.locator('#area-city').inputValue(),'decatur');
  assert.match(await page.locator('#business-area-map svg').getAttribute('aria-label'),/20-mile radius around Decatur/);
  await page.locator('#area-radius').evaluate(el=>{el.value='35';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.match(await page.locator('#business-area-map svg').getAttribute('aria-label'),/35-mile radius around Decatur/);
  await page.locator('#area-city').selectOption('hartselle');
  assert.match(await page.locator('#business-area-map svg').getAttribute('aria-label'),/35-mile radius around Hartselle/);
  assert.equal(await page.locator('[data-action=save-coverage]').count(),0,'preview must not save');
  const buttons=await page.locator('button[data-action=save-coverage]').count();assert.equal(buttons,0);
  assert.deepEqual(errors,[],'browser errors in '+variant.name);
  await page.screenshot({path:'radius-'+variant.name+'.png',fullPage:true});
  console.log('PASS '+variant.name+' RouteDrop wordmark and interactive nonsaving service radius diagram');
  await page.close();
 }
}finally{
 if(browser)await browser.close();
 app.kill('SIGTERM');
}
