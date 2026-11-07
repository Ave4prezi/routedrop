'use strict';

// Require verified TLS for all remotely hosted PostgreSQL connections.
// Avoid connection-string sslmode overriding pg's explicit SSL configuration.
function securePoolConnection(databaseUrl) {
 if (typeof databaseUrl!=='string' || !databaseUrl) throw Error('DATABASE_URL is required');
 let url;
 try { url=new URL(databaseUrl); } catch { throw Error('DATABASE_URL must be a valid PostgreSQL URL'); }
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname)throw Error('DATABASE_URL must be PostgreSQL');
 const host=url.hostname.toLowerCase();
 const local=['localhost','127.0.0.1','[::1]','::1'].includes(host);
 const mode=(url.searchParams.get('sslmode')||'').toLowerCase();
 if(mode && !['require','verify-ca','verify-full'].includes(mode))
  throw Error('Unsafe PostgreSQL sslmode is not allowed');
 if(url.searchParams.has('ssl') || ['sslrootcert','sslcert','sslkey'].some(key=>url.searchParams.has(key)))
  throw Error('Custom PostgreSQL SSL URL parameters require a reviewed certificate configuration');
 url.searchParams.delete('sslmode');
 return {
  connectionString:url.toString(),
  max:5,
  idleTimeoutMillis:30000,
  connectionTimeoutMillis:10000,
  ssl:local?false:{rejectUnauthorized:true}
 };
}
module.exports={securePoolConnection};
