'use strict';
// Dedicated, password-protected, nonproduction Stripe test environment.
function assertSandboxConfig(env=process.env){
 if(env.ROUTEDROP_PAYMENT_SANDBOX_ONLY!=='true')return false;
 if(env.ROUTEDROP_PRIVATE_PREVIEW_ONLY==='true' ||
    env.ROUTEDROP_STAGING_LOCK!=='true' ||
    env.ROUTEDROP_PROVIDER_DOCS_MODE!=='synthetic' ||
    env.ROUTEDROP_LIVE_APPROVED==='true')
  throw Error('Stripe test sandbox requires staging lock, synthetic-only documents and no live-payment approval');
 const key=env.STRIPE_SECRET_KEY||'';
 if(key && !/^sk_test_/.test(key))
  throw Error('Stripe payment sandbox rejects non-test API keys');
 const db=env.DATABASE_URL||'';
 if(db){
  let name='';
  try{name=new URL(db).pathname.replace(/^\//,'');}catch{}
  if(name!=='routedrop_payment_sandbox')throw Error('Payment sandbox requires isolated routedrop_payment_sandbox database');
 }
 return true;
}
function allowsFictionalSignup(email){
 return /@(?:example\.test|example\.invalid|ci\.invalid)$/i.test(email);
}
module.exports={assertSandboxConfig,allowsFictionalSignup};
