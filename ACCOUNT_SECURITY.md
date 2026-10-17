# Account security (Phase 2)

## Behavior

- School authentication rechecks active user, school status, role, session version and
  token revocation on each request. Suspension/closure rejects subsequent school API
  requests and public enrollment. The platform status transaction increments all school
  users' session versions and invalidates recovery and signup challenges. Reactivation
  requires signing in again; it does not revive old cookies.
- New login cookies include a random session identifier. Normal online logout records
  only a SHA-256 token digest until expiry, so replaying that cookie is rejected without
  signing out another device. Offline logout hides the local workspace immediately; server
  revocation requires connectivity. No local financial records or queues are deleted.
- `POST /api/auth/logout-all` advances the current user's session version. Every older
  workspace and signup-verification cookie then fails validation. Account security in the
  app exposes this action and password change to all school roles.
- Password change checks the current password, atomically changes the hash, advances the
  session version, invalidates outstanding codes and writes an audit event. Both the new
  auth endpoint and the older training endpoint use the same service. Sign in again after
  changing a password. Request-time password hashing uses asynchronous scrypt.
- Platform admin tokens have a separate signature purpose, a random session identifier
  and a credential stamp. Changing the admin's stored password invalidates its sessions.
  Online platform logout revokes the individual token. Old platform cookies require a new
  login after this rollout. Platform admins are email-based operator accounts; SMS school
  recovery does not grant platform access.

## SMS password recovery

The sign-in form offers **Forgot password?**. Enter the account phone, then a six-digit
reset code and a new password (10–128 characters). The API uses the existing KudiSMS
corporate transport with a distinct password-reset message. Signup and reset codes use
different keyed digest purposes and cannot be exchanged.

`POST /api/auth/password-reset/request` always returns 202 with a random reference and
the same neutral message for eligible, unknown, inactive and suspended accounts. Decoy
records follow the same storage path. Delivery starts after the response so provider
latency does not reveal account existence. Only eligible account phones receive SMS.
No code, password, provider credential or raw session cookie is logged or returned.

The pending reset is saved before delivery. The API must remain running to finish the
short delivery task. If it restarts or delivery fails, request another code after cooldown;
the account remains intact. There is no promise of closed-process SMS delivery.

`POST /api/auth/password-reset/confirm` requires the reference, code and new password.
Codes expire after 10 minutes, are single use, allow five guesses, and are invalidated by
a replacement request, password change or school suspension. Aggregate limits survive
replacement references. Concurrent completions are serialized; only one succeeds.
Successful reset invalidates every old session and recovery/signup challenge, records an
audit event, and returns to sign-in without creating a workspace session. It does not
mark an owner verified, activate a school, restart a trial, or erase offline work.

Existing owners without control of their saved phone need an operator-assisted identity
review. Changing a number during password recovery is intentionally unavailable.

## Abuse limits and deployment

Limits use PostgreSQL's existing verification rate-limit table, shared by API instances.
They fail closed if storage is unavailable and return 429 with Retry-After. Counters
include successful requests; this avoids allowing distributed credential guessing that
resets its history after a successful attempt.

- School login: 60/IP and 20/normalized phone per 15 minutes.
- Platform login: 30/IP and 10/normalized email per 15 minutes.
- Owner registration: 30/IP and 10/phone per hour, plus Phase 1 registration/SMS limits.
- Reset requests: 20/IP per hour, five/phone per day, one/phone per minute, plus an outer
  30/IP per-hour guard. Signup and recovery share the conservative 500/day SMS cap.
- Reset guesses: 60/IP and 20/phone per hour, in addition to five per challenge.
- Password change: 15/IP per 15 minutes.
- Public enrollment: 180/IP requests per 10 minutes; writes have a separate 30/IP limit,
  enforced before JSON parsing. The previous instance-local map was removed.

Keep `NODE_ENV=production`, the KudiSMS settings and `TRUST_PROXY_HOPS` correctly configured
as described in OWNER_SMS_VERIFICATION.md. A proxy misconfiguration can group all clients
into one IP or allow spoofing. Review pilot limits for shared networks and school volume.

Generate Prisma, apply migration `20261015000000_account_security`, then deploy API and
frontend together. The migration adds session versions, reset challenges and revocation
digests; it does not remove school records. Configure maintenance to prune expired reset
and revocation rows, and rate-limit rows older than 48 hours (longest window is one day).
Retain audit records according to the school's retention policy.

Tests use a separate local `sync_test` database. The new integration suite covers reset
expiry/guess limits, provider failure, concurrent completion, cookie replay, password
change, signup boundary and suspension/reactivation. Test live SMS and the actual proxy
path before enabling production recovery. Cached offline screens cannot be remotely
erased; revocation prevents subsequent server access and sync.

Security guidance: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
and https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html.


## Batch 2 ? staff access, shared-device tabs and SMS budget

Owners can create receptionist access alongside instructor/student accounts in School setup ? People. Manage staff access loads a paginated online list of instructors/receptionists. Deactivation/reactivation requires a reason and reviewed account version; it increments sessionVersion, invalidates reset challenges and writes an audit in the same transaction. Owners and student accounts cannot be targeted by this staff endpoint. No records are deleted. Reactivation permits a new login without restoring old cookies. Complete or reassign staff work as needed.

Tabs lock when another tab starts authentication, logs out, clears authentication or changes identity/role. These locks do not call the logout endpoint and therefore do not revoke a newer account's cookie. Shared authentication revisions fence delayed login/session responses. Visible tabs recheck their session every minute and on focus/reconnection. Offline devices retain their local work; remote deactivation is enforced by the API immediately and reflected in the UI on its next successful server check. Offline caches cannot be remotely erased or locked until the device reconnects.

`sms-delivery-global` limits provider delivery attempts to 500 per 24-hour rate window. Request/IP/account/phone abuse limits remain separate. Verification reserves this budget only after pending-account/cooldown checks. Recovery reserves it after eligibility checks and a durable one-time delivery claim. Unknown/disabled accounts, rejected resends and repeated recovery delivery tasks do not consume delivery budget. Provider failures/timeouts still count as attempts because delivery/billing may be uncertain. An unavailable budget fails closed and leaves the code unusable; public recovery responses remain neutral. There is no automatic retry of a claimed delivery after a worker crash: request another code after the cooldown.

Deploy migration `20261016020000_reset_delivery_claim` before the updated API; regenerate Prisma and deploy API/web together. The migration adds nullable deliveryStartedAt to password_resets. It has only been applied to the isolated local integration-test database during implementation. Verify the real KudiSMS account in staging as part of launch validation.
