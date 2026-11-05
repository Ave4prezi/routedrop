'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {install,handleStripeEvent}=require('../post-service');

function routesFor({pool,stripe,queueDeferredEmail=async()=>{}}) {
 const routes={};
 const app={get:(path,...handlers)=>routes[path]=handlers.at(-1),post:(path,...handlers)=>routes[path]=handlers.at(-1)};
 const forbidden=(res,msg,status=400)=>res.status(status).json({error:msg});
 install(app,{pool,stripe,baseUrl:'https://beta.example.test',enabled:true,requireDb:()=>{},
  requireUser:()=>()=>{},safe:fn=>fn,limiter:()=>{},forbidden,queueDeferredEmail});
 return routes;
}
function response(){
 return {statusCode:200,status(x){this.statusCode=x;return this;},json(x){this.body=x;return this;}};
}
const paidBooking=(override={})=>({
 id:7,booking_id:41,customer_id:5,price_cents:10000,
 payment_intent_id:'pi_paid_41',status:'pending',booking_status:'paid',refunded_cents:0,stripe_dispute_status:null,...override
});
test('provider approval of a customer refund reverses the transfer and the exact 8% fee',async()=>{
 const sql=[],calls=[];
 const client={query:async(query,params)=>{
  sql.push({query,params});
  if(query.startsWith('SELECT r.*'))return {rows:[paidBooking()],rowCount:1};
  return {rows:[],rowCount:1};
 },release(){}};
 const pool={
  connect:async()=>client,
  query:async(query,params)=>{
   sql.push({query,params});
   if(query.includes("SET status='refunded',refund_id"))return {rows:[{booking_id:41}],rowCount:1};
   return {rows:[],rowCount:1};
  }
 };
 const stripe={refunds:{create:async(params,options)=>{calls.push({params,options});return {id:'re_full_41',status:'succeeded'};}}};
 const routes=routesFor({pool,stripe});
 const res=response();
 await routes['/api/deferred-refunds/:id/decision']({params:{id:'7'},body:{decision:'approve'},user:{id:9}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.status,'refunded');
 assert.equal(calls.length,1);
 assert.equal(calls[0].params.payment_intent,'pi_paid_41');
 assert.equal(calls[0].params.amount,10000);
 assert.equal(calls[0].params.reverse_transfer,true);
 assert.equal(calls[0].params.refund_application_fee,true);
 assert.equal(calls[0].options.idempotencyKey,'routedrop-deferred-full-refund-v1-7');
 assert.match(sql.find(x=>x.query.startsWith('SELECT r.*')).query,/b\.owner_id=\$2/);
 assert.ok(sql.find(x=>x.query.includes("SET status='refunded',refund_id")));
});
test('provider cannot refund a booking that is unpaid, disputed or already refunded',async()=>{
 for(const override of [{booking_status:'payment_failed'},{refunded_cents:10000},{stripe_dispute_status:'needs_response'},{status:'processing'}]){
  let touched=false;
  const client={query:async sql=>{
   if(sql.startsWith('SELECT r.*'))return {rows:[paidBooking(override)],rowCount:1};
   return {rowCount:1};
  },release(){}};
  const pool={connect:async()=>client,query:async()=>{throw Error('Unexpected refund query')}};
  const stripe={refunds:{create:async()=>{touched=true;return {status:'succeeded'};}}};
  const res=response();
  await routesFor({pool,stripe})['/api/deferred-refunds/:id/decision']({params:{id:'7'},body:{decision:'approve'},user:{id:9}},res);
  assert.equal(res.statusCode,409);
  assert.equal(touched,false);
 }
});
test('signed Stripe refund events require an exact linked refund request, amount and original payment',async()=>{
 const q=[],emails=[];
 const db={query:async(sql,params)=>{
  q.push({sql,params});
  if(sql.startsWith('SELECT r.id,r.status'))return {rows:[{id:7,status:'processing',refund_id:'re_full_41',booking_id:41,price_cents:10000,payment_intent_id:'pi_paid_41'}],rowCount:1};
  return {rowCount:1,rows:[{id:41}]};
 }};
 const obj={id:'re_full_41',status:'succeeded',amount:10000,payment_intent:'pi_paid_41',metadata:{routedrop_deferred_refund_id:'7'}};
 await handleStripeEvent({type:'refund.updated',data:{object:obj}},db,{},async(_db,id,kind)=>emails.push({id,kind}));
 assert.equal(q.length,3);
 assert.match(q[1].sql,/status='refunded'/);
 assert.match(q[2].sql,/status='refunded'/);
 assert.deepEqual(emails,[{id:41,kind:'refund'}]);
 q.length=0;emails.length=0;
 await handleStripeEvent({type:'refund.updated',data:{object:{...obj,amount:9999}}},db,{},async(_db,id,kind)=>emails.push({id,kind}));
 assert.equal(q.length,1);
 assert.deepEqual(emails,[]);
});
test('signed failed refund event moves request to manual review without making a second refund',async()=>{
 const q=[];
 const db={query:async(sql,params)=>{
  q.push({sql,params});
  if(sql.startsWith('SELECT r.id,r.status'))return {rows:[{id:7,status:'processing',refund_id:null,booking_id:41,price_cents:10000,payment_intent_id:'pi_paid_41'}]};
  return {rowCount:1};
 }};
 await handleStripeEvent({type:'refund.failed',data:{object:{id:'re_full_41',status:'failed',amount:10000,payment_intent:'pi_paid_41',metadata:{routedrop_deferred_refund_id:'7'}}}},db,{});
 assert.equal(q.length,2);
 assert.match(q[1].sql,/status='needs_review'/);
});
