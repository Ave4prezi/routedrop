// FIDO2/WebAuthn end-to-end regression: actual browser cryptography and signed
// server verification, using ONLY an ephemeral CI PostgreSQL and virtual device.
// No mock of navigator.credentials, no live Stripe keys, no persistent passkeys.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import pg from 'pg';
import {chromium} from 'playwright';

assert.ok(process.env.TEST_DATABASE_URL,'isolated CI PostgreSQL required');
const unique=String(Date.now());
const userEmail='passkey-moderator-'+unique+'@example.test';
const outsiderEmail='passkey-outsider-'+unique+'@example.test';
const key='CI-only-moderator-key-32-chars-minimum-2026';
const preview='ci-passkey-private-preview';
const db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
const files=mkdtempSync(path.join(tmpdir(),'routedrop-fido2-'));
let app,proxy,browser;
async function freePort(){
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;
}
const appPort=await freePort(),tlsPort=await freePort();
const origin='https://moderator.localhost:'+tlsPort;
const auth='Basic '+Buffer.from('routedrop-preview:'+preview).toString('base64');
let stderr='';
async function getAs(page,endpoint,moderatorKey){
 return page.evaluate(async ({endpoint,moderatorKey})=>{
  const res=await fetch(endpoint,{headers:{'x-routedrop-moderator-key':moderatorKey}});
  return {code:res.status,data:await res.json()};
 },{endpoint,moderatorKey});
}
async function postAs(page,endpoint,moderatorKey,body={}){
 return page.evaluate(async ({endpoint,moderatorKey,body})=>{
  const csrf=(document.cookie.split('; ').find(s=>s.startsWith('routedrop_csrf='))||'').slice('routedrop_csrf='.length);
  const res=await fetch(endpoint,{method:'POST',credentials:'same-origin',
   headers:{'Content-Type':'application/json','x-routedrop-moderator-key':moderatorKey,'x-csrf-token':csrf},
   body:JSON.stringify(body)});
  return {code:res.status,data:await res.json()};
 },{endpoint,moderatorKey,body});
}
async function register(page,email){
 await page.goto(origin+'/',{waitUntil:'networkidle'});
 await page.locator('#nav-account [data-action="register"]').click();
 const form=page.locator('#register-form');
 await form.locator('[name=role]').selectOption('customer');
 await form.locator('[name=name]').fill('Fictional CI Moderator');
 await form.locator('[name=email]').fill(email);
 await form.locator('[name=password]').fill('not-a-real-person-test-password-99');
 await form.locator('[type=submit]').click();
 await page.locator('#modal').waitFor({state:'hidden'});
 const me=await page.evaluate(async ()=>await (await fetch('/api/me')).json());
 assert.equal(me.user.email,email);
}
async function authorizeWithBrowser(page){
 await page.locator('nav.tabs [data-tab="safety"]').click();
 await page.locator('#safety-body [data-action="moderator-connect"]').click();
 const form=page.locator('#safety-mod-login-form');
 await form.locator('[name=key]').fill(key);
 await form.locator('[type=submit]').click();
 await page.locator('#modal').waitFor({state:'hidden',timeout:30000});
 await page.getByRole('heading',{name:'Moderator review queue'}).waitFor();
}

try{
 // Generate a one-day local certificate solely for the CI HTTPS proxy.
 // The server remains an unmodified HTTP application behind a proxy so
 // its public URL, Origin/CSRF guards and secure cookies are tested realistically.
 const cert=path.join(files,'cert.pem'),privateKey=path.join(files,'key.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
  '-keyout',privateKey,'-out',cert,'-days','1','-subj','/CN=moderator.localhost'],{stdio:'ignore'});
 app=spawn(process.execPath,['routedrop-platform/server.js'],{
  env:{...process.env,PORT:String(appPort),DATABASE_URL:process.env.TEST_DATABASE_URL,
   NODE_ENV:'test',PUBLIC_URL:origin,ROUTEDROP_WORKFLOW_PILOT:'true',
   ROUTEDROP_PREVIEW_ACCESS_PASSWORD:preview,ROUTEDROP_LIVE_APPROVED:'false',
   STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',ROUTEDROP_IDENTITY_TEST_ENABLED:'false',
   ROUTEDROP_STRIPE_IDENTITY_TEST_KEY:'',ROUTEDROP_STRIPE_IDENTITY_WEBHOOK_SECRET:'',
   ROUTEDROP_MODERATOR_PASSKEYS_ENABLED:'true',ROUTEDROP_MODERATOR_ENROLLMENT_ENABLED:'true',
   ROUTEDROP_WEBAUTHN_ORIGIN:origin,ROUTEDROP_WEBAUTHN_RP_ID:'moderator.localhost',
   ROUTEDROP_MODERATION_TOKEN:key,ROUTEDROP_MODERATOR_EMAILS:userEmail},
  stdio:['ignore','pipe','pipe']
 });
 app.stderr.on('data',v=>stderr+=String(v));
 proxy=https.createServer({cert:readFileSync(cert),key:readFileSync(privateKey)},(req,res)=>{
  const upstream=http.request({host:'127.0.0.1',port:appPort,method:req.method,
   path:req.url,headers:{...req.headers,'x-forwarded-proto':'https'}},forwarded=>{
   res.writeHead(forwarded.statusCode,forwarded.headers);forwarded.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  req.pipe(upstream);
 });
 proxy.listen(tlsPort,'127.0.0.1');await once(proxy,'listening');
 let ready=false;
 for(let n=0;n<150;n++){
  try{
   const response=await fetch('http://127.0.0.1:'+appPort+'/health',{headers:{authorization:auth}});
   if(response.ok&&(await response.json()).database==='ready'){ready=true;break;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'ephemeral database/server startup failed: '+stderr);
 browser=await chromium.launch({headless:true,args:['--no-proxy-server',
  '--host-resolver-rules=MAP moderator.localhost 127.0.0.1']});
 const context=await browser.newContext({ignoreHTTPSErrors:true,
  httpCredentials:{username:'routedrop-preview',password:preview}});
 const page=await context.newPage();const pageErrors=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 const devtools=await context.newCDPSession(page);
 await devtools.send('WebAuthn.enable');
 const {authenticatorId}=await devtools.send('WebAuthn.addVirtualAuthenticator',{options:{
  protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,
  isUserVerified:true,automaticPresenceSimulation:true
 }});
 await register(page,userEmail);
 assert.equal((await getAs(page,'/api/pilot/safety/moderation',key)).code,403,
  'email verification and passkey are both required');
 // Privileged, isolated CI SQL fixture: equivalent to completed email proof.
 // No public HTTP endpoint may assert email verification or bypass passkey proof.
 await db.query('UPDATE users SET email_verified_at=now() WHERE email=$1',[userEmail]);
 await page.reload({waitUntil:'networkidle'});
 assert.equal((await getAs(page,'/api/pilot/safety/moderation',key)).code,403,
  'even an allowlisted, email-verified moderator without WebAuthn is rejected');
 assert.equal((await getAs(page,'/api/pilot/safety/moderation','wrong-key')).code,403);
 assert.equal((await postAs(page,'/api/pilot/moderator/passkeys/register/verify',key,{id:'fabricated'})).code,409,
  'registration proof without a challenge must fail closed');
 await authorizeWithBrowser(page);
 const credentials=await db.query('SELECT c.credential_id,c.counter FROM pilot_moderator_credentials c JOIN users u ON u.id=c.user_id WHERE u.email=$1',[userEmail]);
 assert.equal(credentials.rowCount,1,'real browser WebAuthn ceremony persisted a public-key credential');
 assert.equal((await devtools.send('WebAuthn.getCredentials',{authenticatorId})).credentials.length,1,
  'Chromium authenticator owns the private credential');
 const status=await getAs(page,'/api/pilot/moderator/passkeys/status',key);
 assert.equal(status.code,200);assert.equal(status.data.step_up_active,true);
 assert.equal((await getAs(page,'/api/pilot/safety/moderation',key)).code,200,
  'fresh signed passkey proof grants a time-limited moderator session');
 assert.equal((await postAs(page,'/api/pilot/moderator/passkeys/lock',key)).code,200);
 assert.equal((await getAs(page,'/api/pilot/safety/moderation',key)).code,403,
  'explicit moderator lock immediately revokes access');
 // Reauthenticate via the browser's real credential, not a synthetic DB authorization.
 await page.locator('nav.tabs [data-tab="explore"]').click();
 await authorizeWithBrowser(page);
 assert.equal((await getAs(page,'/api/pilot/safety/moderation',key)).code,200);
 await db.query("UPDATE pilot_moderator_stepup SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)",[userEmail]);
 assert.equal((await getAs(page,'/api/pilot/safety/moderation',key)).code,403,
  'expired step-up is rejected even when the browser retains its passkey');
 // A separate fictional signed-in user cannot use the moderator bootstrap key.
 const outsiderContext=await browser.newContext({ignoreHTTPSErrors:true,
  httpCredentials:{username:'routedrop-preview',password:preview}});
 const outsider=await outsiderContext.newPage();
 await register(outsider,outsiderEmail);
 await db.query('UPDATE users SET email_verified_at=now() WHERE email=$1',[outsiderEmail]);
 await outsider.reload({waitUntil:'networkidle'});
 assert.equal((await getAs(outsider,'/api/pilot/moderator/passkeys/status',key)).code,403);
 assert.equal((await getAs(outsider,'/api/pilot/safety/moderation',key)).code,403);
 assert.deepEqual(pageErrors,[],'no client-side errors during actual WebAuthn ceremonies');
 await context.close();await outsiderContext.close();
 console.log('PASS real WebAuthn virtual device: registration, signed login, lock, expiry, verified allowlist, cross-account deny; test-only and no Stripe');
}finally{
 if(browser)await browser.close().catch(()=>{});
 if(proxy)await new Promise(resolve=>proxy.close(resolve)).catch(()=>{});
 if(app){app.kill('SIGTERM');await once(app,'exit').catch(()=>{});}
 await db.end();
 rmSync(files,{recursive:true,force:true});
}
