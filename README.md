# SinoBee.ai

Official website of [SinoBee](https://github.com/CAFECA-IO/SinoBee) — the open-source swarm-intelligence AI assistant that works on your computer.

| Feature | Where |
|---|---|
| Introduction, download & install guide | `/`, `/download` |
| **Skill Hub** — submit, download, rate (★1–5), threaded discussion; review + ed25519 signing; revocations; SinoBee-compatible **Hub API v1** | `/skills`, `/api/v1/*`, `/.well-known/sinobee-hub-keys.json` |
| **Sign in with CAFECA** (popup / redirect / cross-device QR, ERC-1271 verification, signing channel) | `/login`, `/api/auth/*` |
| **Commissioned tasks** paid in TWDC through the CAFECA signing channel; one isolated Docker container per user; metered at **1.5 × (tokens + AWS VM + AWS S3)**; public/private; 👍/👎 + comments; budget exhausted → partial results + CAFECA notification → top-up or close | `/tasks`, `worker/` |
| **Crowdfunded tasks**: NT$30 shares (1 / 5 / 20); NT$30 proposal fee as credit for an AI spec dialogue and reference files (50 MB free, then 1 share per 50 MB); 7 / 30 / 90 / 180-day campaigns (0 / 3 / 6 / 10 % fee); cards saved with Oen tokens and charged only when the goal is reached; points and subscription quota pledges; the agent reports progress as comments; leftover budget becomes platform points | `/crowd/new`, `/tasks/:id`, `src/lib/crowd/` |
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
cp .env.example .env            # then set DEV_LOGIN=1; for local testing export PAYMENT_MODE=mock RUNNER_MODE=mock
npm run db:migrate              # DATABASE_URL empty → creates ./data/sinobee.db (SQLite)
npm run db:seed                 # publishes SinoBee's bundled skills as cafeca/*
npm run dev                     # http://localhost:3000
npm run worker                  # second terminal
npm test
```

`DEV_LOGIN=1` shows a developer sign-in button (ignored in production builds). `PAYMENT_MODE=mock` auto-confirms payments, `RUNNER_MODE=mock` simulates SinoBee runs so the whole budget → top-up → completion → download flow can be exercised.

## One command: `npm run swarm`

Runs the whole stack on **http://localhost:10023**: generates the Prisma clients, applies migrations, seeds the official skills, builds the site when needed, then starts the web server and the task worker together (prefixed logs, Ctrl-C stops both).

```bash
npm run swarm                 # production build + worker on :10023
npm run swarm -- --dev        # next dev (hot reload, DEV_LOGIN works) + worker
npm run swarm -- --build      # force a fresh build
npm run swarm -- --no-worker  # web only
npm run swarm -- --no-boltchain   # do not start the Boltchain node
npm run swarm -- --rebuild-node   # rebuild the Boltchain node image
SWARM_PORT=12345 npm run swarm
```

**Boltchain node.** Before the site starts, swarm prepares Boltchain storage:

1. **Settings.** It fills in the `BOLT_*` settings in `.env`, creating the file from `.env.example` if needed. Values you already set are never overwritten. On the first run it adds:
   - `BOLT_RPC_URL=http://127.0.0.1:8545` and `BOLT_CHAIN_ID=8018`;
   - a new site wallet (`BOLT_WALLET_KEY`) and a master key (`BOLT_MASTER_KEY`). `.env` is then set to mode 600; **back it up**.
   - the testnet Certificates contract (`BOLT_CERTIFICATES`).
2. **Node.** It builds the node image `docker/boltchain`. The image is built from source (Luphia/Boltchain at `BOLTCHAIN_REF`), so the first build takes about 10–20 minutes.
3. **Container.** It starts the image as the `sinobee-boltchain` container:
   - JSON-RPC with `--rpc-storage` is published on 127.0.0.1 only;
   - P2P runs on port 8017;
   - chain data lives in the `sinobee-boltchain-data` volume.

   A new node starts from the latest testnet epoch snapshot instead of syncing from genesis.
4. **Wallet check.** Once the node answers, swarm logs the chain height and the site wallet's balance. The testnet has no faucet, so send BOLT to that address. Until then, objects stay in the local/S3 mirror and move to Boltchain once the wallet can pay.

Other options:
- A remote `BOLT_RPC_URL` (not localhost) uses that node instead of starting one.
- Without docker, the site runs with Boltchain storage off.
- The node stops with swarm; set `BOLT_NODE_KEEP=1` to keep it running.

Objects stored before Boltchain was turned on can be moved later: `npm run storage-migrate -- --anchor-skills --run`.

If `PUBLIC_ORIGIN` points to localhost on another port (e.g. the `:3000` default in `.env.example`), swarm moves it to the swarm port so Sign in with CAFECA keeps matching; a public origin such as `https://sinobee.ai` behind a reverse proxy is left unchanged.

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
cp .env.example .env   # only bootstrap values: PUBLIC_ORIGIN=https://sinobee.ai, OWNER_ACCOUNT, DATABASE_URL
                       # everything else (Oen, model API keys, S3, CAFECA…) → /admin → Settings, encrypted in the DB;
                       # keys and passwords are generated automatically. Back up data/secrets.key (or set SECRETS_KEY).
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

### Crowdfunding

`src/lib/crowd/` — see the header of `lifecycle.ts` for the state machine (DRAFT → FUNDING → CHARGING → QUEUED … → settled, or UNFUNDED). The worker runs `crowdTick` every minute. Cards are saved through Oen's token checkout (`POST /checkout-token`; the token arrives only in the unsigned webhook with `purpose: "token"` and is accepted once, for a pending binding) and charged with `POST /token/transactions` (Idempotency-Key, one charge per backer and task). Settings: /admin → Settings → Crowdfunding. With `PAYMENT_MODE=mock` the card binding page and charges are simulated (`/pay/mock-card/:id`).

After a crowdfunded run the backers review it (`review.ts`): the agent's `outputs/acceptance.json` self-check is shown, votes are weighted by paid shares for `crowd.reviewDays`, a rejection queues a rework with the backers' reasons (`crowd.maxReworks`), and what is still rejected goes to /admin → Disputes. While funding, the proposer can publish spec revisions (charging waits `crowd.exitHours` so backers can withdraw); money beyond the goal unlocks stretch goals; when the budget runs out the proposer can open an all-or-nothing top-up round (`crowd.topupDays`). Backer comments marked "reference" reach the agent as `inputs/backer-notes.md` (untrusted data). Crowdfunded tasks run in their own container (`sb-c-<taskId>`), removed after settlement.

Discovery and trust (`explore.ts`, `reputation.ts`, `screening.ts`): `/crowd` lists open and funded campaigns by category with ending-soon / almost-funded / popular / newest sorting and title search; proposers show a track record (funded / ended, accepted, first-time accepted, platform refunds, KYC level). Submitted proposals go through `crowd.screening` (ai / off): the proposal is queued and the worker (`screeningTick`, every 10 s) has the AI answer every yes/no item of the published checklist (`checklist.ts`, built-in default `checklist-default.ts`: 105 items in six dimensions — legality, privacy, IP, safety, feasibility, spec). All items must pass; otherwise the proposal goes back to draft with the failed items and reasons. The result records how many items passed and failed and why, and the proposer is notified either way. If no model answers, the worker retries. Admins cannot approve or reject: in /admin → Proposal review they can only ask for a re-review, optionally with a note the AI reads as context. Admins edit the checklist in /admin → Checklist, by hand or by asking a model, and publish versions (≥ 100 items). The checklist is listed in the crowdfunding terms (`/crowd-terms`); proposers and backers must agree, and the version they agreed to is stored (`termsVersion`). The period starts when the campaign opens. Campaign pages carry link previews for every major platform (`share.ts`): a 1200×630 PNG drawn by `/api/crowd/:id/og` (next/og; CJK glyphs fetched per picture from `crowd.ogFontUrl`, or `OG_FONT_PATH` for a local TTF/OTF), a title ≤ 60 and description ≤ 160 characters, Open Graph and X card tags, canonical URL, optional `fb:app_id` / `twitter:site` (Settings → Crowdfunding). The picture URL carries a version of what it shows, so platforms fetch a new one as funding progresses. The share dialog links Facebook, X, LINE, Threads, LinkedIn, Telegram and WhatsApp. Crowdfunds can be reported; a takedown during the campaign cancels it and returns every pledge, a funded task is only hidden. `crowd.pledgeMinKyc` / `crowd.voteMinKyc` can require a CAFECA KYC level. Model prices are snapshotted again when a campaign is funded.

### Skill Hub

Implements `docs/SKILL_HUB.md` §5 of SinoBee. Verified end-to-end with the real SinoBee CLI: `sinobee skills search`, `install hub:<publisher>/<name>` (trust `verified` after review + signature + verified publisher, `community` otherwise), `publish` (Bearer token from `/account`), `sync-revocations`.

Pin the Hub key in SinoBee:

```yaml
# ~/.sinobee/config.yaml
skills:
  hub_url: https://sinobee.ai
  hub_keys: ["<key from /.well-known/sinobee-hub-keys.json>"]
```

### SinoBee sign-in, tools, vault and shares

- **`sinobee login`** uses the OAuth 2.0 device authorization grant (RFC 8628). The flow:
  - `POST /api/v1/device/code` starts the sign-in.
  - The user approves it at `/device`.
  - SinoBee polls `POST /api/v1/device/token` until it gets an `sbh_` token.
  - The token is bound to a device and carries scopes: `skills:publish tools:write vault:rw shares:write`.
  - Users sign devices out under **Account → Signed-in SinoBee installs**. `GET /api/v1/me` backs `sinobee whoami`.
- **Tools** (`/api/v1/tools`, pages `/tools`): database browsers registered from SinoBee as `TOOL.json` (`sinobee.tool/v1`).
  - Credentials are rejected by the schema and a scanner.
  - Private versions are only visible to the owner; public versions are reviewed (Admin → Tool reviews). A tool that goes public never exposes its private versions.
- **Vault** (`/api/v1/vault/*`): end-to-end encrypted. Each signed-in SinoBee also holds its own sealed copy of the vault key (`/api/v1/vault/devices`), so the passphrase is only needed once per machine or never (approve a new machine from an old one). Signing a device out deletes its copy.
  - The server stores an X25519 public key, the private key wrapped with a scrypt-derived key, and sealed packs (ephemeral X25519 + HKDF + AES-GCM).
  - Everything is encrypted in SinoBee; the server cannot read it.
- **Shares** (`/api/v1/shares`, page `/s/<id>`, list `/shares`):
  - SinoBee redacts and previews before upload.
  - Visibility: `LINK`, `LOGIN` (optionally limited to specific CAFECA accounts, by address or @handle), or `PUBLIC`.
  - Multipart upload with attachments (25 MB each, 100 MB per share); default expiry 30 days; the server refuses conversations that still contain obvious secrets. Viewers can import a share into their own SinoBee ("Continue in my SinoBee").
  - Owners can change the visibility, set expiry, and revoke a share. Viewers can report a share; admins handle reports with a takedown.

### Boltchain storage and notarization

When `BOLT_RPC_URL`, `BOLT_WALLET_KEY` and `BOLT_MASTER_KEY` are set (see `.env.example`), every `putObject` is recorded and moved to Boltchain right away by the **storage keeper**. This covers skill bundles, task results, tool manifests, vault packs and shares. The keeper runs inside the worker, or on its own with `npm run storage-keeper [-- --loop]`.

1. **Seal**: each object is sealed with **bolt-vault** (`vendor/bolt-vault`, WASM built from Boltchain `crates/vault`) for its own X25519 key. That key is encrypted with the master key.
2. **Store**: the keeper lists the blocks in a deal index (dag-cbor, byte-identical to `bolt-ipld`). It hands the blocks to the site's own node with `bolt_hostBlocks` (the node must run with `--rpc-storage`), then pays `SwarmStorage.createDeal` from the site wallet. The website absorbs the storage fees.
3. **Read**: reads use the local/S3 mirror and fall back to `bolt_getBlocks`. Every block is checked against its CID, and the result against its sha256.
4. **Delete**: deleting an object destroys its key (crypto-shred). The deal is then cancelled, closed, and the refunds withdrawn.
5. **Renew**: deals are extended before they end — never past an object's keep-until date. Policies by kind: shares keep 2 copies until they expire; replaced vault versions keep their deal 7 days; versions of public tools are kept 90 days after deletion. An hourly audit compares the database with the chain and re-stores objects whose deal ended early; admins are notified when the wallet runs low (`BOLT_LOW_BALANCE_WEI`).
6. **Notarize**: if `BOLT_CERTIFICATES` is set, skill versions (bundle + SKILL.md), tool versions and shares are notarized with the Certificates contract (ADR 0016). The page shows the certificate code, which links to `<explorer>/cert/<code>`.
7. **Monitor**: Admin → Boltchain storage shows the wallet, its balance, object counts and errors.

**Legal documents.** Every terms page (`/terms`, `/privacy`, `/refunds`, `/crowd-terms`) is rendered from markdown and stored as a numbered version (`LegalVersion`, by SHA-256). With Boltchain on, each version gets a **public** certificate: the markdown itself is kept on Boltchain as 256 KiB raw blocks listed in the certificate's manifest (the explorer format, `verify.js`), so anyone can download it from the certificate page and check it against the hash; the page shows the BOLTCHAIN badge with the certificate link and offers the markdown (`/api/legal/:id`) so anyone can check the hash. The worker snapshots the documents every 10 minutes and whenever a checklist is published.

Tests run against `tests/helpers/stub-boltchain.ts`. It is a JSON-RPC stand-in that follows `SwarmStorage.sol` and `Certificates.sol`, so the tests need no chain.

## Open items

- **CAFECA notifications**: the CAFECA README does not yet document a notification API. Notifications are stored in the on-site inbox and POSTed to `CAFECA_NOTIFY_URL` when configured (`src/lib/notify.ts`).
- **Model keys in user containers**: the worker passes `RUNNER_PASS_ENV` keys into user containers. Since commissioned agents run with `approval: auto`, prefer per-task scoped keys or an LLM gateway in production.
- **Unused budget**: charges never exceed the budget; the remaining balance is shown but refunds (treasury → user) are not automated.
- Model and AWS prices are reference values — review `src/lib/pricing.ts` and the `AWS_*` env vars before launch.

## License

MIT © 2026 CAFECA
