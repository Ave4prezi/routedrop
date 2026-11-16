'use strict';
// Synthetic preview acknowledgement ONLY. This is not a binding provider contract.
// Changing the text requires a new version and independent legal approval for real onboarding.
const crypto=require('node:crypto');
const VERSION='synthetic-preview-2026-11-v1';
const TEXT='This is a fictional-data-only RouteDrop preview. I will use invented names, businesses and example.test/example.invalid email addresses; I will not submit real identity, insurance, license or payment information. No actual service bookings, payments, payouts or verified-provider status are provided. Early-access pricing is a proposal: no required monthly membership and an 8% platform fee on successfully collected service payments after customer approval. Participation does not guarantee jobs, revenue or launch access. This preview acknowledgement is not a real provider agreement.';
const SHA256=crypto.createHash('sha256').update(TEXT).digest('hex');
const schema=[
 "CREATE TABLE IF NOT EXISTS provider_preview_acknowledgements (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, version TEXT NOT NULL, terms_sha256 CHAR(64) NOT NULL, accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,version))",
 "CREATE INDEX IF NOT EXISTS provider_preview_ack_business ON provider_preview_acknowledgements(business_id,accepted_at)"
];
const valid=body=>Boolean(body && body.pilotConsent===true && body.pilotAgreementVersion===VERSION);
const publicTerms=()=>({version:VERSION,text:TEXT});
async function record(db,userId,businessId){
 if(!Number.isSafeInteger(Number(userId))||!Number.isSafeInteger(Number(businessId)))throw Error('Invalid synthetic preview account');
 await db.query(
  'INSERT INTO provider_preview_acknowledgements(user_id,business_id,version,terms_sha256) VALUES($1,$2,$3,$4)',
  [userId,businessId,VERSION,SHA256]
 );
}
module.exports={VERSION,TEXT,SHA256,schema,valid,publicTerms,record};
