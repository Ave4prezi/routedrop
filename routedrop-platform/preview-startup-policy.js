'use strict';
// Synthetic-only preview fail-closed startup guard. This is not a real-data
// deployment check or legal/security certification.
function assertSafePreviewStartup(env=process.env){
 const flag=env.ROUTEDROP_PRIVATE_PREVIEW_ONLY;
 const docsMode=env.ROUTEDROP_PROVIDER_DOCS_MODE;
 const requested=(typeof flag==='string'&&flag.trim()!==''&&flag!=='false')||docsMode==='synthetic';
 if(!requested)return {requested:false,enabled:false};
 const problems=[];
 const requireFlag=(key,value)=>{if(env[key]!==value)problems.push(key+' must equal '+value)};
 requireFlag('ROUTEDROP_PRIVATE_PREVIEW_ONLY','true');
 requireFlag('ROUTEDROP_STAGING_LOCK','true');
 requireFlag('ROUTEDROP_PROVIDER_DOCS_MODE','synthetic');
 requireFlag('ROUTEDROP_PROVIDER_VERIFICATION_ENABLED','true');
 if(typeof env.ROUTEDROP_STAGING_PASSWORD!=='string'||env.ROUTEDROP_STAGING_PASSWORD.length<18)
  problems.push('ROUTEDROP_STAGING_PASSWORD must have at least 18 characters');
 if(env.STRIPE_SECRET_KEY)problems.push('STRIPE_SECRET_KEY must be absent');
 if(env.STRIPE_WEBHOOK_SECRET)problems.push('STRIPE_WEBHOOK_SECRET must be absent');
 if(env.ROUTEDROP_LIVE_APPROVED==='true')problems.push('ROUTEDROP_LIVE_APPROVED cannot be true');
 if(env.ROUTEDROP_DEFERRED_BETA_ENABLED==='true')problems.push('ROUTEDROP_DEFERRED_BETA_ENABLED cannot be true');
 if(env.ROUTEDROP_PROVIDER_DOC_SCAN_REQUIRED==='true')
  problems.push('ROUTEDROP_PROVIDER_DOC_SCAN_REQUIRED cannot be used to represent real intake in the fictional preview');
 if(problems.length)throw Error('Refusing unsafe fictional-preview startup: '+problems.join('; '));
 return {requested:true,enabled:true};
}
module.exports={assertSafePreviewStartup};
