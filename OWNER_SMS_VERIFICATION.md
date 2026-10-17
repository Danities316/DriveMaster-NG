# Owner SMS verification (Phase 1)

New registrations save a pending school and owner, then send an SMS. Only a restricted,
HTTP-only verification cookie is issued. School APIs reject unverified owners, including
owners using previously issued workspace cookies. Successful verification atomically
consumes the challenge, records verification and starts a new school's 14-day trial.
Existing owners must verify on their next online session; existing trial dates, records
and offline queues are preserved. This proves control of a phone, not school accreditation.

## Configure

Production API environment:

- `NODE_ENV=production`
- `SMS_PROVIDER=kudis`
- `KUDISMS_API_KEY`: set through the hosting secret manager; never in frontend variables.
- `KUDISMS_SENDER_ID`: an approved **Corporate Sender ID** in your KudiSMS account.
- `TRUST_PROXY_HOPS`: the verified number of reverse proxies in front of Express. Default
  0 trusts only the direct peer. Never blindly trust arbitrary forwarded client headers.

Startup rejects disabled/mock SMS or missing KudiSMS settings in production. KudiSMS must
have sufficient credit and sender approval. No live paid SMS is sent by automated tests.
The adapter follows https://www.kudisms.net/docs/sms/ (`POST /corporate`, success plus
`error_code=000`), rather than the sample's permissive response checks or `route` field.

For local development explicitly set `SMS_PROVIDER=mock` and optionally
`SMS_MOCK_CODE=123456`. Enter that code on the verification screen. This sends nothing and
logs neither recipient nor code. Mock mode is rejected in production. Existing `.env`
files are not modified by this change.

## Deploy

Generate the client and apply the checked-in migration through your normal deployment:

```powershell
npm run prisma:generate --workspace=apps/api
npm run db:deploy
npm run build
```

Coordinate API and frontend deployment: registration and unverified login now return 202
with verification status rather than a workspace identity. The migration marks existing
owners as requiring verification, retaining their data. It does not treat old phone
numbers as verified or reset existing trials. An existing offline installation may still
show its cached workspace before connecting; server access and uploads remain blocked
until verification. Local unsent work must not be deleted during this transition.

## Rules and acceptance

- Six digits, ten-minute expiry, five attempts per challenge, single use.
- A new send replaces the previous challenge. Failed delivery makes that code unusable.
- 60-second resend cooldown, ten send attempts per owner/phone per day, 20 per IP per hour,
  and a conservative global cap of 500 send attempts per day. Attempts include failures
  and some rejected requests; hitting a cap never activates the account. These conservative
  limits are enforced in PostgreSQL and should be reviewed against pilot volume.
- Verification attempts: 20 per owner and 60 per IP per hour, across replacement codes.
- Initial registration: ten attempts per IP per hour. Proxy configuration affects IP limits.
- Pending cookie: 24 hours. After expiry, sign in with the same phone/password to resume.
- Code digests are keyed with the auth secret and bound to owner, phone and challenge nonce.
  Secret rotation invalidates pending cookies and challenges; request a new code afterward.
- Phone correction invalidates the previous code and respects uniqueness and aggregate limits.
- Provider errors/timeouts preserve the pending account. Acceptance by the provider does
  not verify the owner. Use resend after cooldown when delivery fails.
- New-tab/reload recovery reads server verification status. Verification requires internet.
- Audit verification success without plaintext codes or passwords. Rate-limit keys are hashed.

Run regular tests with one worker on constrained development machines. Database transaction
tests in `ownerVerification.integration.test.ts` use `SYNC_TEST_DATABASE_URL` and refuse any
target other than local `sync_test`. Apply all migrations to that disposable database first;
see SYNC.md. They check concurrent activation, trial start, failed-attempt persistence,
duplicate-phone rollback and concurrent rate limits. Never target a school database.

Before production rollout test real SMS on the intended Nigerian networks, delayed delivery,
low credit/provider outage, an existing owner's verification with queued work, and the
configured proxy path. Keep a support route for an existing owner who no longer controls
their phone; self-service SMS cannot prove ownership of an unavailable number.
