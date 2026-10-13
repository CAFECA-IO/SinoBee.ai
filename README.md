# SinoBee.ai

Official website of [SinoBee](https://github.com/CAFECA-IO/SinoBee) — the open-source swarm-intelligence AI assistant that works on your computer.

| Feature | Where |
|---|---|
| Introduction, download & install guide | `/`, `/download` |
| **Skill Hub** — submit, download, rate (★1–5), threaded discussion; review + ed25519 signing; revocations; SinoBee-compatible **Hub API v1** | `/skills`, `/api/v1/*`, `/.well-known/sinobee-hub-keys.json` |
| **Sign in with CAFECA** (popup / redirect / cross-device QR, ERC-1271 verification, signing channel) | `/login`, `/api/auth/*` |
| **Commissioned tasks** paid in TWDC through the CAFECA signing channel; one isolated Docker container per user; metered at **1.5 × (tokens + AWS VM + AWS S3)**; public/private; 👍/👎 + comments; budget exhausted → partial results + CAFECA notification → top-up or close | `/tasks`, `worker/` |
| **Retention**: non-subscribers' containers and results are kept 7 days after a task finishes, then deleted (downloads return 410) | `worker/index.ts` cleanup |
| **Benchmarks**: anyone can commission an evaluation; every public report records time, requester, skill, model, method, process and result; model leaderboard + per-skill reports | `/benchmarks` |
| zh-TW (default) / English | `src/messages/*.json` |

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS 4 · next-intl 4 · Prisma 7 + PostgreSQL (or SQLite when no database is configured) · viem (CAFECA chain 8018) · dockerode · S3 or local storage.

```
src/app/[locale]/…        pages (server components)
src/app/api/…             JSON API (auth, tasks, payments, skills, comments, Hub v1)
src/lib/cafeca/           CAFECA sign-in protocol + verifier (vendored from Luphia/cafeca, viem only)
src/lib/skills/           Agent Skills spec validation, content hash (identical to SinoBee), bundle, scan, ed25519 signing
src/lib/payments.ts       TWDC payment intents + on-chain Transfer verification
src/lib/pricing.ts        1.5× billing formula, model price table
src/lib/notify.ts         inbox + CAFECA notification webhook
worker/                   task runner: claim → docker run → meter → stop at budget → upload → notify; cleanup
prisma/                   PostgreSQL schema + migrations, seed (SinoBee bundled skills as cafeca/*)
prisma/sqlite/            SQLite schema (generated) + migrations
```

## Quick start (development, no Docker / no wallet needed)

```bash
npm install
npm run db:generate             # Prisma clients for PostgreSQL and SQLite
cp .env.example .env            # then set: DEV_LOGIN=1  PAYMENT_MODE=mock  RUNNER_MODE=mock
npx tsx scripts/hub-keygen.ts   # paste HUB_SIGNING_KEY into .env
npm run db:migrate              # DATABASE_URL empty → creates ./data/sinobee.db (SQLite)
npm run db:seed                 # publishes SinoBee's bundled skills as cafeca/*
npm run dev                     # http://localhost:3000
npm run worker                  # second terminal
npm test
```

`DEV_LOGIN=1` shows a developer sign-in button (ignored in production builds). `PAYMENT_MODE=mock` auto-confirms payments, `RUNNER_MODE=mock` simulates SinoBee runs so the whole budget → top-up → completion → download flow can be exercised.

## Database: PostgreSQL or SQLite

| `DATABASE_URL` | Database | Schema / migrations |
|---|---|---|
| `postgresql://…` | PostgreSQL | `prisma/schema.prisma`, `prisma/migrations` |
| empty (default) | SQLite file at `SQLITE_PATH` (default `./data/sinobee.db`) | `prisma/sqlite/schema.prisma`, `prisma/sqlite/migrations` |

`prisma.config.ts`, the app and the worker all pick the database the same way (`src/lib/db-target.ts`), so `npm run db:migrate`, `npm run db:seed`, `npm run dev` and `npm run worker` work unchanged for both.

SQLite is meant for development and small single-host installs (one web process + one worker); use PostgreSQL in production.

When you change `prisma/schema.prisma`:

```bash
npm run db:sqlite-schema        # regenerate prisma/sqlite/schema.prisma
npm run db:generate
# PostgreSQL migration:  DATABASE_URL=postgresql://… npx prisma migrate dev --name <change>
# SQLite migration:      DATABASE_URL= npx prisma migrate dev --name <change>
```

Keep the models portable: no scalar lists (`String[]`), no raw SQL; use `icontains()` from `src/lib/db.ts` for case-insensitive search.

## Production

```bash
# 1. SinoBee image used for user containers
git clone https://github.com/CAFECA-IO/SinoBee && docker build -t sinobee:latest SinoBee
# 2. configure
cp .env.example .env   # PUBLIC_ORIGIN=https://sinobee.ai, TREASURY_ADDRESS, ADMIN_ACCOUNTS, HUB_SIGNING_KEY,
                       # STORAGE_DRIVER=s3 + S3_BUCKET, model API keys, CAFECA_NOTIFY_URL …
# 3. run
docker compose up -d --build
docker compose run --rm migrate      # migrations + seed
```

The worker needs the Docker socket (it creates `sb-u-<userId>` containers with a `sb-home-<userId>` volume, CPU/memory/pids limits, `no-new-privileges`).

### Sign in with CAFECA

No registration with CAFECA is needed. The site issues a one-time nonce bound to the browser, the wallet signs an EIP-712 `SignIn` message with the user's Passkey, and the backend verifies it with `isValidSignature` (ERC-1271) on chain 8018 — see `src/lib/signin-flow.ts`. `PUBLIC_ORIGIN` must exactly match the public origin (scheme + host + port). The site metadata shown in the wallet is served at `/.well-known/cafeca-site.json`.

### Payments

`POST /api/tasks` creates the task and a payment intent → the browser calls `channel.sendCalls([TWDC.transfer(treasury, amount)])` through the CAFECA signing channel → `POST /api/payments/:id/confirm {txHash}` → the server reads the receipt and requires a `Transfer(from=user, to=treasury, value≥amount)` log from the TWDC contract (each tx hash can be used once).

### Billing

```
charge (TWDC) = PRICE_MARKUP(1.5) × (token cost + VM cost + S3 cost) × USD_TWD_RATE
token cost = SinoBee's own per-call accounting for the task's session (vendor prices, cache discounts)
VM cost    = run seconds × AWS_VM_HOURLY_USD
S3 cost    = result size × retention days × AWS_S3_GB_MONTH_USD + request fees
```

The meter runs every 15 s; when the charge reaches the budget the agent is stopped, the `outputs/` folder is packaged as a partial result and the user is asked (inbox + CAFECA) to top up or close. A top-up resumes the same SinoBee session in the same container.

### Skill Hub

Implements `docs/SKILL_HUB.md` §5 of SinoBee. Verified end-to-end with the real SinoBee CLI: `sinobee skills search`, `install hub:<publisher>/<name>` (trust `verified` after review + signature + verified publisher, `community` otherwise), `publish` (Bearer token from `/account`), `sync-revocations`.

Pin the Hub key in SinoBee:

```yaml
# ~/.sinobee/config.yaml
skills:
  hub_url: https://sinobee.ai
  hub_keys: ["<key from /.well-known/sinobee-hub-keys.json>"]
```

## Open items

- **CAFECA notifications**: the CAFECA README does not yet document a notification API. Notifications are stored in the on-site inbox and POSTed to `CAFECA_NOTIFY_URL` when configured (`src/lib/notify.ts`).
- **Model keys in user containers**: the worker passes `RUNNER_PASS_ENV` keys into user containers. Since commissioned agents run with `approval: auto`, prefer per-task scoped keys or an LLM gateway in production.
- **Unused budget**: charges never exceed the budget; the remaining balance is shown but refunds (treasury → user) are not automated.
- Model and AWS prices are reference values — review `src/lib/pricing.ts` and the `AWS_*` env vars before launch.

## License

MIT © 2026 CAFECA
