import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import pg from 'pg';

const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
const socket=net.createServer();
socket.listen(0,'127.0.0.1');await once(socket,'listening');
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const base='http://127.0.0.1:'+port,pass='local-ephemeral-test-only';
const auth='Basic '+Buffer.from('routedrop-preview:'+pass).toString('base64');
const server=spawn(process.execPath,['routedrop-platform/server.js'],{
 env:{...process.env,PORT:String(port),DATABASE_URL:process.env.TEST_DATABASE_URL,ROUTEDROP_WORKFLOW_PILOT:'true',ROUTEDROP_PREVIEW_ACCESS_PASSWORD:pass,ROUTEDROP_LIVE_APPROVED:'false',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',PUBLIC_URL:'',NODE_ENV:'test'},
 stdio:['ignore','pipe','pipe']
});
let errors='';server.stderr.on('data',x=>errors+=x.toString());
async function call(user,path,method='GET',body){
 const headers={authorization:auth};
 if(method!=='GET'){headers.origin=base;headers['content-type']='application/json';}
 if(user){headers.cookie=user.cookie;headers['x-csrf-token']=user.csrf;}
 const response=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
 let data;try{data=await response.json();}catch{data={};}
 return {code:response.status,data,response};
}
function sessionCookie(resp){
 const set=resp.headers.getSetCookie?.()||[resp.headers.get('set-cookie')||''];
 const line=set.find(x=>x.includes('__Host-rd_session='));
 const m=line?.match(/__Host-rd_session=([a-f0-9]{64})/);
 assert.ok(m,'authenticated session cookie');
 return '__Host-rd_session='+m[1];
}
const suffix=String(Date.now());
async function register(role,tag){
 const config=await call(null,'/api/config');
 assert.equal(config.code,200);
 const cookie=(config.response.headers.get('set-cookie')||'').match(/routedrop_csrf=([a-f0-9]{64})/);
 assert.ok(cookie,'CSRF cookie');
 const u={csrf:cookie[1],cookie:'routedrop_csrf='+cookie[1]};
 const payload={role,name:'Pilot '+tag,email:'pilot-'+tag+'-'+suffix+'@example.test',password:'test-only-better-password-12345',
 businessName:'Pilot '+tag+' Service',city:'Decatur, AL',category:'Cleaning'};
 const r=await call(u,'/api/register','POST',payload);
 assert.equal(r.code,201,'register '+role+': '+JSON.stringify(r.data));
 u.cookie+='; '+sessionCookie(r.response);
 const profile=await call(u,'/api/me');
 assert.equal(profile.data.user.role,role);
 return u;
}
async function listing(owner,tag){
 const start=new Date(Date.now()+36*60*60*1000).toISOString();
 const r=await call(owner,'/api/listings','POST',{title:tag+' Home Refresh',category:'Cleaning',neighborhood:'Decatur test neighborhood',priceCents:7500,slotStart:start,durationMinutes:90});
 assert.equal(r.code,201,'create listing '+JSON.stringify(r.data));
 return Number(r.data.listing.id);
}
try{
 let ready=false;
 for(let i=0;i<130;i++){
  try{const r=await call(null,'/health');if(r.data.database==='ready'){ready=true;assert.equal(r.data.payments,'not configured');break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'ephemeral Postgres and server should become ready: '+errors);
 const config=await call(null,'/api/config');
 assert.equal(config.data.workflow_pilot,true);
 assert.equal(config.data.payments,false);
 const business=await register('business','provider');
 const outsider=await register('business','other-provider');
 const customer=await register('customer','customer');
 const otherCustomer=await register('customer','other-customer');
 assert.equal((await call(customer,'/api/listings','POST',{title:'not allowed'})).code,403);
 assert.equal((await call(business,'/api/pilot/requests','POST',{listingId:1})).code,403);
 const first=await listing(business,'First');
 const listed=await call(customer,'/api/listings');
 assert.ok(listed.data.listings.some(x=>Number(x.id)===first),'published listing visible');
 const reservation=await call(customer,'/api/pilot/requests','POST',{listingId:first});
 assert.equal(reservation.code,201,JSON.stringify(reservation.data));
 const id=Number(reservation.data.request.id);
 assert.equal((await call(otherCustomer,'/api/pilot/requests','POST',{listingId:first})).code,409,'one active request per opening');
 assert.ok(!(await call(customer,'/api/listings')).data.listings.some(x=>Number(x.id)===first),'requested opening hidden');
 assert.equal((await call(outsider,'/api/pilot/requests')).data.requests.length,0,'other business sees nothing');
 assert.equal((await call(otherCustomer,'/api/pilot/requests')).data.requests.length,0,'other customer sees nothing');
 assert.equal((await call(outsider,'/api/pilot/requests/'+id+'/action','POST',{action:'accept'})).code,409,'other provider cannot take request');
 assert.equal((await call(otherCustomer,'/api/pilot/requests/'+id+'/action','POST',{action:'cancel'})).code,409,'other customer cannot cancel request');
 assert.equal((await call(customer,'/api/pilot/requests/'+id+'/action','POST',{action:'accept'})).code,403,'customer cannot self-accept');
 const accepted=await call(business,'/api/pilot/requests/'+id+'/action','POST',{action:'accept'});
 assert.equal(accepted.code,200);
 assert.equal(accepted.data.request.status,'accepted');
 assert.equal((await call(customer,'/api/pilot/requests/'+id+'/action','POST',{action:'confirm'})).code,409,'cannot confirm before completed');
 assert.equal((await call(business,'/api/pilot/requests/'+id+'/action','POST',{action:'complete'})).code,200);
 assert.equal((await call(customer,'/api/pilot/requests/'+id+'/action','POST',{action:'confirm'})).code,200);
 assert.equal((await call(customer,'/api/pilot/requests/'+id+'/action','POST',{action:'confirm'})).code,409,'terminal state immutable');
 const ownerHistory=await call(business,'/api/pilot/requests');
 assert.equal(ownerHistory.data.requests[0].status,'confirmed');
 assert.ok(ownerHistory.data.requests[0].customer_name,'provider sees name only after acceptance');
 const second=await listing(business,'Second');
 const req2=await call(otherCustomer,'/api/pilot/requests','POST',{listingId:second});
 assert.equal(req2.code,201);
 const rid2=Number(req2.data.request.id);
 assert.equal((await call(business,'/api/pilot/requests/'+rid2+'/action','POST',{action:'decline'})).code,200);
 const reopened=await call(customer,'/api/listings');
 assert.ok(reopened.data.listings.some(x=>Number(x.id)===second),'declined opening reappears');
 const req3=await call(customer,'/api/pilot/requests','POST',{listingId:second});
 assert.equal(req3.code,201);
 assert.equal((await call(customer,'/api/pilot/requests/'+req3.data.request.id+'/action','POST',{action:'cancel'})).code,200);
 assert.ok((await call(customer,'/api/listings')).data.listings.some(x=>Number(x.id)===second),'canceled opening reappears');
 assert.equal((await call(customer,'/api/pilot/listings/'+second+'/status','PATCH',{status:'paused'})).code,403);
 assert.equal((await call(outsider,'/api/pilot/listings/'+second+'/status','PATCH',{status:'paused'})).code,404);
 assert.equal((await call(business,'/api/pilot/listings/'+second+'/status','PATCH',{status:'paused'})).code,200);
 assert.ok(!(await call(customer,'/api/listings')).data.listings.some(x=>Number(x.id)===second),'paused opening hidden');
 assert.equal((await call(business,'/api/pilot/listings/'+second+'/status','PATCH',{status:'active'})).code,200);
 assert.equal((await call(customer,'/api/checkout','POST',{listingId:second})).code,503,'Stripe checkout unavailable');
 assert.equal((await call(business,'/api/stripe/connect','POST',{})).code,503,'Stripe payouts unavailable');
 assert.equal((await call(customer,'/api/bookings')).data.bookings.length,0,'no paid bookings');
 const q=await pool.query('SELECT (SELECT count(*) FROM bookings) AS paid_booking_count,(SELECT count(*) FROM service_requests) AS test_request_count');
 assert.equal(Number(q.rows[0].paid_booking_count),0);
 assert.ok(Number(q.rows[0].test_request_count)>=3);
 console.log('PASS isolated PostgreSQL pilot: real account sessions, role permissions, reservation conflicts, state transitions, availability, no checkout');
}finally{
 server.kill('SIGTERM');
 await pool.end();
}
