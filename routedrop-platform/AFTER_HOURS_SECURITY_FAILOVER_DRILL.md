# RouteDrop after-hours incident call-tree and failover drill

**INTERNAL TRAINING DRAFT — NOT ACTIVE 24/7 MONITORING, LEGAL POLICY, OR AN EMERGENCY SERVICE.**
Fictional test only. No actual customer identities, financial records, credentials, screenshots of confidential data, production systems, or real security events are used in a drill. Do not send automated emergency texts unless an explicitly authorized service is configured and tested.

## Existing arrangements (operator-reported)

- Two separate internal incident contacts are designated: primary and backup. Their names and direct phone numbers are deliberately **not stored in this public GitHub repository**.
- The project operator reports that a direct call and return call worked on November 15, 2026.
- Routine support hours selected: Monday–Friday, 9:00 AM–5:00 PM America/Chicago.
- A temporary shared support email passed a harmless two-way message test, but email is **not** a monitored after-hours emergency paging service.
- **The primary-unavailable failover case is NOT TESTED YET.** No qualified third-party incident responder has been engaged and no real threat monitoring capability is confirmed.

## Decision and escalation ladder — proposal requiring owner approval

| Stage | Responsible person | Test action | Result to record |
| --- | --- | --- | --- |
| 1. Intake | Person discovering the incident | Label the scenario **TEST ONLY — SIMULATED SECURITY INCIDENT**. Note time (Central), generic category and who discovered it; no real data | Discovery timestamp |
| 2. Primary attempt | Discoverer | Instruct primary **ahead of the drill** not to answer one planned call; call primary direct number once and document whether it was answered | Attempt timestamp and outcome |
| 3. Backup escalation | Discoverer | Call backup's distinct direct number and explain primary is unavailable in a **drill**, not an actual breach | Backup acknowledgement and timestamp |
| 4. Backup decision | Backup | State: "I am taking ownership of this simulated incident"; identify the next safe action, escalation contact, and what needs independent assessment | Ownership and decision noted |
| 5. Handoff to primary | Backup | Once available, call primary directly and give only a fictional incident reference and current state | Handoff time and acknowledgment |
| 6. Close drill | Both | Record actual delivery/reachability, any missed calls, whether either number was unreachable, elapsed time and corrective action | Operator sign-off in private incident log |

For a real suspected compromise, prioritize human safety and lawful reporting obligations; avoid tampering with forensic logs or making arbitrary production changes. If the platform is experiencing a real threat, contact an appropriately qualified security incident-response professional; counsel must determine notice obligations. If an incident poses imminent danger to life, call local emergency services.

## Suggested internal rehearsal targets — NOT GUARANTEED OR PUBLISHED SERVICE LEVELS

- Attempt primary promptly upon learning of a high-priority security issue.
- If primary is unreachable, attempt the backup without waiting for an email response.
- Prefer a quick, direct phone acknowledgment in the drill and record **measured** times rather than claiming an agreed response SLA.
- If both are unreachable, mark **FAIL**. Owner must establish an independent external escalation path before inviting real provider information.

## Blank evidence record (fill privately, not in GitHub)

- Drill ID: ______
- Date/time and timezone: ______
- Discoverer and witnesses: ______
- Fictional incident category: ______
- Primary attempted at: ______; answered? ______
- Backup contacted at: ______; answered? ______
- Backup explicitly accepted ownership at: ______
- Primary callback/handoff at: ______
- Elapsed time to first human acknowledgment: ______
- PASS/FAIL and reasons: ______
- Follow-up and owner: ______

**Never put personal phone numbers, personal email addresses, password reset codes, incident credentials or private screenshots in public issues/PRs.** Keep the filled record in a restricted-access location, and only update the public register with a generalized test result.

## Remaining independent launch gates

- Obtain written or documented acceptance of a qualified *external* incident responder and an emergency escalation route; a quote request alone is not a contract or on-call service.
- Approve actual acknowledgement expectations, hours, contingency methods, decision authority and lawful incident-notification policy with the operating entity, security assessor and counsel.
- Test primary unavailability, backup unreachable, and a shared-mailbox outage without processing real data or changing payment/security settings.
- Security and legal assessments are still open; completing a drill does not approve live bookings, live payments or real provider identity intake.
