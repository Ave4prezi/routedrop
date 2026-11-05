'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {sql,paymentFee}=require('../post-service');

test('disposable PostgreSQL migration, slot uniqueness, and legacy-data isolation', {
 skip:!process.env.ROUTEDROP_TEST_DATABASE_URL && 'requires disposable PostgreSQL connection'
}, async()=>{
 const pool=new Pool({connectionString:process.env.ROUTEDROP_TEST_DATABASE_URL,ssl:false});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('CREATE SCHEMA deferred_ci');
  await client.query('SET LOCAL search_path TO deferred_ci, public');
  await client.query('CREATE TABLE users(id BIGINT PRIMARY KEY)');
  await client.query('CREATE TABLE listings(id BIGINT PRIMARY KEY)');
  await client.query("CREATE TABLE bookings(id BIGINT PRIMARY KEY,status TEXT NOT NULL)");
  await client.query("INSERT INTO users(id) VALUES(1),(2)");
  await client.query("INSERT INTO listings(id) VALUES(101)");
  await client.query("INSERT INTO bookings(id,status) VALUES(1,'paid')");
  for(const statement of sql)await client.query(statement);
  // Every schema statement must remain safe on repeated service restarts.
  for(const statement of sql)await client.query(statement);
  const result=await client.query("INSERT INTO deferred_bookings(listing_id,customer_id,stripe_customer_id,price_cents,fee_cents,consent_terms,hold_expires_at) VALUES(101,1,'cus_test_one',10000,$1,'deferred-v1',now()+interval '45 minutes') RETURNING id",[paymentFee(10000)]);
  const first=result.rows[0].id;
  await client.query('SAVEPOINT duplicate_probe');
  await assert.rejects(()=>client.query("INSERT INTO deferred_bookings(listing_id,customer_id,stripe_customer_id,price_cents,fee_cents,consent_terms,hold_expires_at) VALUES(101,2,'cus_test_two',10000,800,'deferred-v1',now()+interval '45 minutes')"),e=>e.code==='23505');
  await client.query('ROLLBACK TO SAVEPOINT duplicate_probe');
  await client.query("UPDATE deferred_bookings SET status='canceled' WHERE id=$1",[first]);
  const second=await client.query("INSERT INTO deferred_bookings(listing_id,customer_id,stripe_customer_id,price_cents,fee_cents,consent_terms,hold_expires_at) VALUES(101,2,'cus_test_two',10000,800,'deferred-v1',now()+interval '45 minutes') RETURNING id");
  assert.equal(second.rowCount,1);
  const old=await client.query("SELECT COUNT(*)::int AS total FROM bookings WHERE status='paid'");
  assert.equal(old.rows[0].total,1);
  const current=await client.query("SELECT COUNT(*)::int AS count FROM deferred_bookings WHERE status='awaiting_card'");
  assert.equal(current.rows[0].count,1);
 }finally{
  await client.query('ROLLBACK').catch(()=>{});
  client.release();
  await pool.end();
 }
});
