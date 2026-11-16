'use strict';
// Offline CLI only. Never expose over HTTP or run on live/payment environments.
const {Pool}=require('pg');
const {securePoolConnection}=require('../db-tls');
const {change}=require('../operator-access');
async function main(argv=process.argv.slice(2),env=process.env){
 if(env.ROUTEDROP_PRIVATE_PREVIEW_ONLY!=='true'||env.ROUTEDROP_STAGING_LOCK!=='true'||
    env.ROUTEDROP_PROVIDER_DOCS_MODE!=='synthetic'||env.ROUTEDROP_LIVE_APPROVED==='true'||
    env.STRIPE_SECRET_KEY||env.ROUTEDROP_OPERATOR_CHANGE_ACK!=='FICTIONAL_PREVIEW_APPROVED')
  throw Error('Operator changes require a separately approved paymentless synthetic preview');
 if(!env.DATABASE_URL)throw Error('Database connection is not configured');
 if(argv.length!==6)throw Error('Usage: node scripts/manage-preview-operator.js <grant|revoke> <actor-fake-email> <target-fake-email> <credential_reviewer|launch_approver|support_reviewer> <expiry-ISO-or-dash> <reason>');
 const [action,actorEmail,targetEmail,role,expiry,reason]=argv;
 const pool=new Pool(securePoolConnection(env.DATABASE_URL));
 try{
  const result=await change(pool,{action,actorEmail,targetEmail,role,expiresAt:expiry==='-'?null:expiry,reason});
  process.stdout.write(JSON.stringify(result)+'\n');
 }finally{await pool.end()}
}
if(require.main===module)main().catch(e=>{console.error('Preview operator change refused:',e.message);process.exitCode=1;});
module.exports={main};
