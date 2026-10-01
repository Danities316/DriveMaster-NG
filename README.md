# DriveMaster NG

Offline-first PWA for Nigerian driving schools. Product requirements are in DriveMaster_NG_PRD_v1.2.docx (provided separately).

## Implemented

- Public home page with outcome-focused messaging, an interactive payment example, FAQs, responsive navigation, and existing-school sign-in.
- Operational dashboard with confirmed collections, outstanding balances, pending-work indicators, a seven-day chart, and a searchable payment ledger.

The home page is available at `/#home`, sign-in at `/#login`, and the authenticated workspace at `/#app`. Visitors without a session land on the home page. Existing signed-in users go straight to their workspace. Home-page sample records are illustrative and never saved to the school database.

- React, Vite, TypeScript, Tailwind and Dexie frontend; Express, Prisma and PostgreSQL backend.
- Phone/password login with HTTP-only signed session cookies and current-account role checks.
- School-scoped student registration, editing, search and append-only NGN payments.
- Exact integer money arithmetic, input validation and derived balances.
- Atomic local saves, automatic outbox delivery, persistent retries, incremental downloads and explicit student conflict resolution.
- Transactional server receipts prevent duplicate application after a lost response. Sync writes also create audit events.
- Status and retry controls; pending work survives reload, network failure and logout. Switching schools is blocked while work remains unsynchronized.

Synchronization covers students, payments, vehicle registration, mileage readings and fuel claims. Full-tank-to-full-tank consumption and discrepancy flags are derived from synchronized fuel records and owner-configured vehicle benchmarks. See [FLEET_RECORDING.md](FLEET_RECORDING.md) for setup and calculation rules. Training packages, group outings, student confirmation and student cost summaries are available under Training; see [TRAINING.md](TRAINING.md). Fuel claim approval, WhatsApp receipts, correction transactions and production onboarding remain unfinished. Audit logging in this update covers sync writes; older direct CRUD routes do not yet have complete audit coverage.

See [SYNC.md](SYNC.md) for protocol details, migration notes, limitations and acceptance checks. Automatic synchronization runs while the app is open; a closed app resumes on reopening.

## Run locally in VS Code

Open the extracted source folder containing this package.json, then open Terminal > New Terminal. Use Node.js 22+ and npm 10+.

```powershell
npm ci
npm run prisma:generate --workspace=apps/api
```

If apps/api/.env does not already exist, copy apps/api/.env.example to it. Configure DATABASE_URL, WEB_ORIGIN and AUTH_TOKEN_SECRET there. Keep existing settings when upgrading.

Apply the checked-in migrations to your development database before starting the updated API:

```powershell
npm exec --workspace=apps/api -- prisma migrate deploy
```

This runs Prisma from apps/api, where it loads the local .env file. The new migrations add synchronization storage/triggers, student versions and missing payment/authentication schema fields. No changes to your configured database are applied merely by opening the source folder.

Run these in two separate VS Code terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Open http://localhost:5173 and sign in with an existing development account. The web app proxies /api to port 4000. Production requires HTTPS and correctly configured cookie origins.

## Verify

```powershell
npm run build:shared
npm run prisma:generate --workspace=apps/api
npm test
npm run typecheck
npm run lint
npm run build
```

Regular tests use fake IndexedDB and mocked HTTP/repositories. The PostgreSQL integration suite is opt-in and refuses any database except a local database named sync_test. See SYNC.md for running it. Real browser/device and deployment acceptance checks are separate from automated tests.

## API

- POST /api/auth/login; GET /api/auth/me; POST /api/auth/logout
- GET and POST /api/students
- GET and PATCH /api/students/:id
- GET and POST /api/students/:id/payments
- POST /api/v1/sync/batch
- GET /api/v1/sync/changes?schoolId=...&cursor=0&limit=100
- GET /api/health

The backend derives tenant and actor identity from the authenticated session. Supplied school IDs must match it. Instructor accounts cannot access student/payment synchronization. Payments cannot be edited or deleted through these APIs.
