'use strict';
function prospectDemoConfig(env=process.env){
 const enabled=env.ROUTEDROP_PROSPECT_DEMO==='true';
 const username=env.ROUTEDROP_PREVIEW_USERNAME||'routedrop-preview';
 if(!/^[a-zA-Z0-9_-]{3,64}$/.test(username))throw Error('Invalid preview username configuration.');
 if(enabled){
  const forbiddenKeys=['DATABASE_URL','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','ROUTEDROP_STRIPE_IDENTITY_TEST_KEY','ROUTEDROP_STRIPE_IDENTITY_WEBHOOK_SECRET','ROUTEDROP_MODERATION_TOKEN','RESEND_API_KEY'];
  const enabledFlags=['ROUTEDROP_LIVE_APPROVED','ROUTEDROP_IDENTITY_TEST_ENABLED','ROUTEDROP_MODERATOR_PASSKEYS_ENABLED','ROUTEDROP_MODERATOR_ENROLLMENT_ENABLED'];
  if(env.ROUTEDROP_WORKFLOW_PILOT!=='true'||String(env.ROUTEDROP_PREVIEW_ACCESS_PASSWORD||'').length<24||forbiddenKeys.some(k=>!!env[k])||enabledFlags.some(k=>env[k]==='true'))throw Error('Prospect demo requires private authentication and no database, payment, email, identity or moderation integrations.');
 }
 return {enabled,username};
}
module.exports={prospectDemoConfig};
