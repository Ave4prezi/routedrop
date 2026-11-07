'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {securePoolConnection}=require('../db-tls');

test('remote PostgreSQL always verifies the database TLS certificate',()=>{
 const options=securePoolConnection('postgresql://user:secret@ep-example.aws.neon.tech:5432/routedrop?sslmode=require&options=endpoint%3Dtest');
 assert.deepEqual(options.ssl,{rejectUnauthorized:true});
 const url=new URL(options.connectionString);
 assert.equal(url.searchParams.has('sslmode'),false);
 assert.equal(url.searchParams.get('options'),'endpoint=test');
 assert.equal(url.hostname,'ep-example.aws.neon.tech');
});
test('secure modes are accepted; unsafe sslmode or custom SSL overrides fail closed',()=>{
 for(const mode of ['require','verify-ca','verify-full'])
  assert.equal(securePoolConnection('postgres://u:p@db.example.com/db?sslmode='+mode).ssl.rejectUnauthorized,true);
 for(const mode of ['disable','allow','prefer','no-verify'])
  assert.throws(()=>securePoolConnection('postgres://u:p@db.example.com/db?sslmode='+mode),/Unsafe PostgreSQL sslmode/);
 for(const query of ['ssl=false','sslrootcert=path','sslcert=path','sslkey=path'])
  assert.throws(()=>securePoolConnection('postgres://u:p@db.example.com/db?'+query),/reviewed certificate/);
});
test('only loopback allows non-TLS for isolated local testing',()=>{
 for(const host of ['localhost','127.0.0.1','[::1]'])
  assert.equal(securePoolConnection('postgres://u:p@'+host+':5432/db').ssl,false);
 assert.deepEqual(securePoolConnection('postgres://u:p@localhost.example.com:5432/db').ssl,{rejectUnauthorized:true});
 assert.throws(()=>securePoolConnection('http://example.com'),/PostgreSQL/);
 assert.throws(()=>securePoolConnection('invalid'),/valid PostgreSQL URL/);
});
