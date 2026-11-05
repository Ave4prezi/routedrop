'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {sql,validateRequest,validateQuote}=require('../job-requests');

const good={
 title:'Need backyard cleaning',category:'Lawn care',neighborhood:'Southeast Decatur',
 description:'Remove leaves, bag debris and tidy the backyard garden.',
 budgetCents:10000
};
test('customer job validation allows a $0-upfront quote request, not a payment',()=>{
 const r=validateRequest(good);
 assert.equal(r.error,undefined);
 assert.equal(r.value.budget,10000);
 assert.equal(r.value.desired,null);
});
test('customer input validates category, budget, length and contact details',()=>{
 assert.match(validateRequest({...good,category:'Not a category'}).error,/category/);
 assert.match(validateRequest({...good,budgetCents:0}).error,/budget/);
 assert.match(validateRequest({...good,description:'short'}).error,/description/);
 assert.match(validateRequest({...good,description:'Contact me at test@example.org about lawn cleanup'}).error,/phone numbers or email/);
 assert.match(validateRequest({...good,desiredStart:new Date(Date.now()-2000).toISOString()}).error,/preferred time/);
});
test('business quote validates cents, scope and contact information',()=>{
 assert.equal(validateQuote({priceCents:9200,note:'I can perform this work, leaves and debris only.'}).value.price,9200);
 assert.match(validateQuote({priceCents:100,note:'I can do the whole job.'}).error,/quote/);
 assert.match(validateQuote({priceCents:10000,note:'call 256-555-0123 to arrange a quote'}).error,/contact/);
});
test('customer jobs database keeps owner relation, one quote per business, and no payments', {
 skip:!process.env.ROUTEDROP_TEST_DATABASE_URL && 'requires disposable PostgreSQL'
},async()=>{
 const pool=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('CREATE SCHEMA jobs_ci');
  await client.query('SET LOCAL search_path TO jobs_ci, public');
  await client.query('CREATE TABLE users(id BIGINT PRIMARY KEY)');
  await client.query('CREATE TABLE businesses(id BIGINT PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES users(id))');
  await client.query('INSERT INTO users(id) VALUES(1),(2),(3)');
  await client.query('INSERT INTO businesses(id,owner_id) VALUES(10,2),(11,3)');
  for(const statement of sql)await client.query(statement);
  for(const statement of sql)await client.query(statement);
  const r=await client.query("INSERT INTO customer_job_requests(customer_id,title,category,neighborhood,description,budget_cents) VALUES(1,'Backyard cleaning','Lawn care','Southeast Decatur','Remove leaves and clear garden debris.',10000) RETURNING id");
  const rid=r.rows[0].id;
  await client.query("INSERT INTO customer_job_quotes(request_id,business_id,price_cents,note) VALUES($1,10,9500,'All yard debris removed')",[rid]);
  await client.query('SAVEPOINT duplicate_quote');
  await assert.rejects(()=>client.query("INSERT INTO customer_job_quotes(request_id,business_id,price_cents,note) VALUES($1,10,8900,'A second private quote')",[rid]),e=>e.code==='23505');
  await client.query('ROLLBACK TO SAVEPOINT duplicate_quote');
  await client.query("INSERT INTO customer_job_quotes(request_id,business_id,price_cents,note) VALUES($1,11,9200,'Debris cleanup included')",[rid]);
  const quotes=await client.query('SELECT COUNT(*)::int AS total FROM customer_job_quotes WHERE request_id=$1',[rid]);
  assert.equal(quotes.rows[0].total,2);
  await client.query("UPDATE customer_job_requests SET status='closed' WHERE id=$1",[rid]);
  const status=await client.query('SELECT status FROM customer_job_requests WHERE id=$1',[rid]);
  assert.equal(status.rows[0].status,'closed');
  const tables=await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='jobs_ci'");
  assert.equal(tables.rows.some(r=>/payment|booking|stripe/.test(r.table_name)),false);
 }finally{
  await client.query('ROLLBACK').catch(()=>{});
  client.release();await pool.end();
 }
});
