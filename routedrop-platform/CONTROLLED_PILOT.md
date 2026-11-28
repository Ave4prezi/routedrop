# Controlled pilot

Status: preparation only; no live payment authorization.

## Scope
- Start with 3 invited test customers and 2 invited test providers, using synthetic data and sandbox payments only.
- One authorized moderator; no public enrollment or real services until approved.
- Test booking, acceptance, completion, payment success, payment failure/recovery, cancellation, refund, dispute and reconciliation.
- Verify mobile and desktop, role boundaries, notifications, and administrative visibility.

## Entry gates
- Integrated hosted build and migration validated; regression and dependency checks passed.
- Separate sandbox credentials and webhook routing confirmed; no live keys.
- Backup restoration exercised; monitoring and rollback owner assigned.
- Historical unmatched test payment documented and reviewed.

## Stop conditions
Stop immediately for unauthorized access, duplicate charge, wrong recipient, missing booking, incorrect refund, or unreconciled payment. Preserve evidence and disable new pilot bookings.

## Exit gates
All scenarios pass with evidence; no unresolved critical/high findings; independent legal and security reviews before paid/public pilot. Obtain explicit launch approval. No live payments or public deployment under this checklist.
