'use strict';
const crypto=require('crypto');
const express=require('express');
const rateLimit=require('express-rate-limit');
// Applies to a disposable preview only. It is fail-closed and never protects Stripe
// webhook authenticity: that endpoint continues to require a signed Stripe event.
function secureEqual(a,b) {
 const ah=crypto.createHash('sha256').update(String(a)).digest();
 const bh=crypto.createHash('sha256').update(String(b)).digest();
 return crypto.timingSafeEqual(ah,bh);
}
function createStagingGate({enabled,password,browserSession,loginPath}) {
 return (req,res,next)=>{
  if(!enabled)return next();
  if(req.path==='/health'||req.path==='/api/stripe/webhook')return next();
  if(!password || password.length<18)return res.status(503).send('Staging access not configured.');
  if(browserSession?.(req)){
   res.set('Cache-Control','private, no-store');
   return next();
  }
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
  res.set('Cache-Control','no-store');
  if(!loginPath)res.set('WWW-Authenticate','Basic realm="RouteDrop staging", charset="UTF-8"');
  if(loginPath&&req.method==='GET'&&!req.path.startsWith('/api/')&&req.accepts('html'))return res.redirect(303,loginPath);
  return res.status(401).send('This RouteDrop staging environment is private.');
 };
}

function mountStagingSignIn(app,{enabled,password}){
 const loginPath='/preview-sign-in';
 const random=()=>crypto.randomBytes(32).toString('hex');
 const sessionCookie='__Host-rd_preview';
 const formCookie='__Host-rd_preview_form';
 const sessionDuration=8*60*60*1000;
 const signingKey=crypto.randomBytes(32);
 const cookieOptions={secure:true,httpOnly:true,sameSite:'strict',path:'/'};
 const signature=value=>crypto.createHmac('sha256',signingKey).update(value).digest('hex');
 const expected='routedrop-staging:'+password;

 function validSession(token){
  if(typeof token!=='string'||!/^\d{13}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token))return false;
  const [expires,nonce,mac]=token.split('.');
  return Number(expires)>Date.now()&&secureEqual(mac,signature(expires+'.'+nonce));
 }

 function signInPage(req,res,error,status=200){
  const previousToken=req.cookies[formCookie];
  const formToken=typeof previousToken==='string'&&/^[a-f0-9]{64}$/.test(previousToken)?previousToken:random();
  res.cookie(formCookie,formToken,{...cookieOptions,maxAge:15*60*1000});
  return res.set({'Cache-Control':'no-store','Referrer-Policy':'same-origin'}).status(status).type('html').send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RouteDrop Payment Staging</title>
<main><h1>RouteDrop Private Staging</h1>
<p>Sign in with your preview credentials.</p>
${error?'<p role="alert">'+error+'</p>':''}
<form method="post" action="/preview-sign-in">
<input type="hidden" name="formToken" value="${formToken}">
<p><label for="preview-username">Username</label><br><input id="preview-username" name="username" type="text" autocomplete="username" required></p>
<p><label for="preview-password">Password</label><br><input id="preview-password" name="password" type="password" autocomplete="current-password" required></p>
<button type="submit">Sign in</button></form></main></html>`);
 }

 if(enabled&&password.length>=18){
  const loginLimiter=rateLimit({windowMs:15*60*1000,limit:12,skipSuccessfulRequests:true,standardHeaders:'draft-7',legacyHeaders:false});
  app.get(loginPath,(req,res)=>signInPage(req,res));
  app.post(loginPath,loginLimiter,express.urlencoded({extended:false,limit:'4kb',parameterLimit:3}),(req,res)=>{
   const {username:enteredUsername,password,formToken}=req.body||{};
   const cookieToken=req.cookies[formCookie];
   const crossSite=req.get('sec-fetch-site')==='cross-site';
   const validToken=typeof formToken==='string'&&typeof cookieToken==='string'&&secureEqual(formToken,cookieToken);
   if(crossSite||!validToken){
    console.warn('RouteDrop preview sign-in rejected: '+(crossSite?'cross-site submission':!cookieToken?'form cookie missing':!formToken?'form token missing':'form token mismatch'));
    return signInPage(req,res,'The sign-in form could not be verified. Reload this page and allow cookies for this site before trying again.',403);
   }
   if(typeof enteredUsername!=='string'||typeof password!=='string'||!secureEqual(enteredUsername+':'+password,expected))return signInPage(req,res,'The username or password was incorrect.',401);
   const session=String(Date.now()+sessionDuration)+'.'+random();
   res.clearCookie(formCookie,cookieOptions);
   // Stripe returns by top-level GET. The form cookie remains Strict.
   res.cookie(sessionCookie,session+'.'+signature(session),{...cookieOptions,sameSite:'lax',maxAge:sessionDuration});
   return res.set('Cache-Control','no-store').redirect(303,'/');
  });
 }

 app.use(createStagingGate({enabled,password,browserSession:req=>validSession(req.cookies[sessionCookie]),loginPath}));
}

module.exports={createStagingGate,mountStagingSignIn};
