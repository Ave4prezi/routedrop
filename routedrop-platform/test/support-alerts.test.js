'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSupportAlerts,recipient}=require('../support-alerts');
const {deliverEmail}=require('../mail');
const env={RESEND_API_KEY:'test',ROUTEDROP_EMAIL_FROM:'notify@example.test',PUBLIC_URL:'https://pilot.example.test'};
const log={info(){},error(){}};
test('reports queue even without sender; recipient is fixed and no complaint data is emailed',async()=>{
 let args;const db={query:async(...v)=>{args=v;return {rows:[]};}};
 const a=createSupportAlerts({pool:db,env:{},log});await a.queue(db,'pilot',19);
 assert.equal(recipient,'routedropsupport@gmail.com');assert.equal(args[1][0],'pilot-19');assert.match(args[0],/ON CONFLICT/);assert.match(args[1][1],/#19/);
 await assert.rejects(a.queue(db,'pilot','19\nBCC:bad'));
});
test('unconfigured sender leaves durable queue untouched',async()=>{
 const a=createSupportAlerts({pool:{query(){throw Error('should not claim');}},env:{},send(){throw Error('should not send');},log});await a.process();
});
test('success uses stable provider idempotency key and marks sent only after acceptance',async()=>{
 let calls=[],sent=[];const pool={query:async(sql,args)=>{calls.push([sql,args]);return {rows:sql.includes('RETURNING')?[{id:3,event_key:'pilot-19',subject:'Issue',body:'Review',attempts:1}]:[]};}};
 const a=createSupportAlerts({pool,env,log,send:async m=>{sent.push(m);assert.ok(!calls.some(([s])=>s.includes("status='sent'")));}});
 await a.process();assert.equal(sent[0].to,recipient);assert.match(sent[0].idempotencyKey,/^rd-support-/);assert.ok(calls.some(([s])=>s.includes("status='sent'")));
 const first=sent[0].idempotencyKey;calls=[];await a.process();assert.equal(sent[1].idempotencyKey,first);
});
test('provider failure schedules retry and does not claim success',async()=>{
 let calls=[];const pool={query:async(sql,args)=>{calls.push([sql,args]);return {rows:sql.includes('RETURNING')?[{id:3,event_key:'pilot-19',subject:'Issue',body:'Review',attempts:1}]:[]};}};
 await createSupportAlerts({pool,env,log,send:async()=>{throw Error('secret provider detail');}}).process();
 assert.ok(calls.some(([s])=>s.includes("THEN 'failed' ELSE 'pending'")));assert.ok(!calls.some(([s])=>s.includes("status='sent'")));assert.ok(!JSON.stringify(calls).includes('secret provider detail'));
});
test('provider receives idempotency header',async()=>{
 await deliverEmail({to:recipient,subject:'Test',text:'Test',idempotencyKey:'unique'},env,async(url,opts)=>{assert.equal(opts.headers['Idempotency-Key'],'unique');return {ok:true};});
});
test('pilot queues the alert before committing and rolls back if queue fails',async()=>{
 const {registerPilotRoutes}=require('../booking-pilot');
 for(const fail of [false,true]){
  let handler,events=[];const client={query:async sql=>{events.push(sql);return {rowCount:1,rows:[{id:19,status:'issue_reported'}]};},release(){events.push('release');}};
  const app={get(){},patch(){},post(path,...handlers){if(path.endsWith('/:id/action'))handler=handlers.at(-1);}};
  registerPilotRoutes(app,{pool:{connect:async()=>client},safe:f=>f,requireDb(){},requireUser:()=>()=>{},forbidden(){},emailReady:true,supportAlerts:{queue:async(db,kind,id)=>{assert.equal(db,client);events.push('queue');if(fail)throw Error('queue failed');},process:async()=>{}}});
  const run=()=>handler({params:{id:'19'},body:{action:'report'},user:{role:'customer',id:4}},{json(){events.push('response');}});
  if(fail){await assert.rejects(run());assert.ok(events.includes('ROLLBACK'));assert.ok(!events.includes('COMMIT'));}else{await run();assert.ok(events.indexOf('queue')<events.indexOf('COMMIT'));}
 }
});
