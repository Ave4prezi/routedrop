'use strict';
const crypto=require('crypto');
// Applies to a disposable preview only. It is fail-closed and never protects Stripe
// webhook authenticity: that endpoint continues to require a signed Stripe event.
function secureEqual(a,b) {
 const ah=crypto.createHash('sha256').update(String(a)).digest();
 const bh=crypto.createHash('sha256').update(String(b)).digest();
 return crypto.timingSafeEqual(ah,bh);
}
function createStagingGate({enabled,password}) {
 return (req,res,next)=>{
  if(!enabled)return next();
  if(req.path==='/health'||req.path==='/api/stripe/webhook')return next();
  if(!password || password.length<18)return res.status(503).send('Staging access not configured.');
  const auth=req.get('authorization')||'';
  let username='',pass='';
  if(auth.startsWith('Basic ') && auth.length<=1024){
   try {
    const decoded=Buffer.from(auth.slice(6),'base64').toString('utf8');
    const cut=decoded.indexOf(':');
    if(cut>=0){username=decoded.slice(0,cut);pass=decoded.slice(cut+1);}
   }catch(err){}
  }
  if(secureEqual(username,'routedrop-staging')&&secureEqual(pass,password))return next();
  res.set('WWW-Authenticate','Basic realm="RouteDrop staging", charset="UTF-8"');
  res.set('Cache-Control','no-store');
  return res.status(401).send('This RouteDrop staging environment is private.');
 };
}
module.exports={createStagingGate};
