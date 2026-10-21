# SinoBee.ai

Official website of [SinoBee](https://github.com/CAFECA-IO/SinoBee) — the open-source swarm-intelligence AI assistant that works on your computer.

| Feature | Where |
|---|---|
| Introduction, download & install guide | `/`, `/download` |
| **Skill Hub** — submit, download, rate (★1–5), threaded discussion; review + ed25519 signing; revocations; SinoBee-compatible **Hub API v1** | `/skills`, `/api/v1/*`, `/.well-known/sinobee-hub-keys.json` |
| **Sign in with CAFECA** (popup / redirect / cross-device QR, ERC-1271 verification, signing channel) | `/login`, `/api/auth/*` |
| **Crowdfunded tasks** (the only way tasks run): describe it, pay the NT$30 proposal fee, and a model drafts the title, category, spec and cost estimate (the goal); edit lines or ask the model, pick a period, submit. NT$30 shares (1 / 5 / 20); the proposal fee is credit for the spec model and reference files (50 MB free, then 1 share per 50 MB); 7 / 30 / 90-day campaigns (0 / 3 / 6 % fee) or paid in full by the proposer (no fee, charged when the screening passes); cards saved with Oen tokens and charged only when the goal is reached; points and subscription quota pledges; the agent reports progress as comments; leftover budget becomes platform points | `/crowd`, `/crowd/new`, `/tasks/:id`, `/tasks` (mine), `src/lib/crowd/`, `worker/` |
| **Retention**: results are kept `crowd.resultsDays` for the backers, then deleted (downloads return 410); each task's container is removed after settlement | `worker/index.ts` cleanup |
| **Benchmarks**: evaluations are crowdfunds too (`kind = EVALUATION`; the model picks the method and criteria if the proposer leaves them open); the report (`outputs/evaluation.json`) is published once the backers accept the run, with time, proposer, skill, model, method, process and result; model leaderboard + per-skill reports | `/benchmarks` |
| zh-TW (default) / English | `src/messages/*.json` |

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS 4 · next-intl 4 · Prisma 7 + PostgreSQL (or SQLite when no database is configured) · viem (CAFECA chain 8018) · dockerode · S3 or local storage.

```
src/app/[locale]/…        pages (server components)
src/app/api/…             JSON API (auth, tasks, payments, skills, comments, Hub v1)
src/lib/cafeca/           CAFECA sign-in protocol + verifier (vendored from Luphia/cafeca, viem only)
src/lib/skills/           Agent Skills spec validation, content hash (identical to SinoBee), bundle, scan, ed25519 signing
src/lib/payments.ts       Oen payments (proposal fees, card pledges, subscriptions), webhook + reconciliation
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

`DEV_LOGIN=1` shows a developer sign-in button (ignored in production builds). `PAYMENT_MODE=mock` auto-confirms payments, `RUNNER_MODE=mock` simulates SinoBee runs so the whole proposal → funding → run → review → settlement flow can be exercised.

## One command: `npm run swarm`

Runs the whole stack on **http://localhost:10023**: starts the docker services below, generates the Prisma clients, applies migrations, seeds the official skills, builds the site when needed, then starts the web server and the task worker together (prefixed logs, Ctrl-C stops everything).

```bash
npm run swarm                     # production build + worker on :10023, with every docker service
npm run swarm -- --dev            # next dev (hot reload, DEV_LOGIN works) + worker
npm run swarm -- --build          # fresh site build, latest SinoBee image, rebuild the Boltchain and H3 images, pull PostgreSQL and Ollama again
npm run swarm -- --no-worker      # web only
npm run swarm -- --no-agent       # do not start the agent gateway (線上使用)
npm run swarm -- --no-boltchain   # do not start the Boltchain node
npm run swarm -- --no-postgres    # never start PostgreSQL (SQLite unless DATABASE_URL is set)
npm run swarm -- --postgres       # start PostgreSQL even though SQLite data exists (the data is not copied)
npm run swarm -- --no-ollama      # do not start Ollama
npm run swarm -- --no-h3          # do not start MiniMax H3
npm run swarm -- --rebuild-node   # rebuild only the Boltchain node image
SWARM_PORT=12345 npm run swarm
```

### Docker services

| Container | What it is | Image | Published on | Written to `.env` |
|---|---|---|---|---|
| `sinobee-boltchain` | Boltchain node for storage deals and certificates | built from `docker/boltchain` | RPC `127.0.0.1:8545`, P2P `:8017` | — (settings in the database) |
| `sinobee-postgres` | PostgreSQL database | `postgres:17-alpine`, pulled | `127.0.0.1:15432` | `DATABASE_URL` |
| `sinobee-ollama` | Ollama, local models for SinoBee.ai | `ollama/ollama:0.34.4`, pulled | `127.0.0.1:11434` | `OLLAMA_URL` |
| `sinobee-h3` | ComfyUI with MiniMax H3 (video), for SinoBee.ai | built from `docker/minimax-h3` | `127.0.0.1:8188` | `COMFYUI_URL` |

- **Images.** A missing image is built from source or pulled the first time. `--build` rebuilds or pulls it again. A container whose image or options changed is recreated, and its data volume is kept.
- **SinoBee image.** Tasks run in the SinoBee image (`runner.image`, default `sinobee:latest`). swarm does not build it at start-up and only reports when it is missing. `--build` builds the latest one from `SINOBEE_SRC` (default `https://github.com/CAFECA-IO/SinoBee.git#main`; a `#tag` or a local folder also works). When the image changed, stopped task containers are removed so the next task starts from the new image; running ones keep the old image until they are removed.
- **Data.** Each service keeps its data in a named volume: `sinobee-boltchain-data`, `sinobee-postgres-data`, `sinobee-ollama-data` and `sinobee-h3-models`.
- **Stopping.** The containers stop with the swarm. Set `SWARM_KEEP=1` (or `BOLT_NODE_KEEP=1`) to leave them running.
- **Without docker** the site runs with SQLite, local storage and no Ollama or H3.

**Boltchain node.** Before the site starts, swarm prepares Boltchain storage:

1. **Settings.** The site wallet (`BOLT_WALLET_KEY`), the master key (`BOLT_MASTER_KEY`) and the testnet Certificates contract are generated on the first run and kept encrypted in the database (/admin → Settings → Boltchain).
2. **Image.** The node image is built from source (Luphia/Boltchain at `BOLTCHAIN_REF`), so the first build takes about 10–20 minutes.
3. **Container.** JSON-RPC with `--rpc-storage` is published on 127.0.0.1 only, and P2P runs on port 8017. A new node starts from the latest testnet epoch snapshot instead of syncing from genesis.
4. **Wallet check.** Once the node answers, swarm logs the chain height and the site wallet's balance. The testnet has no faucet, so send BOLT to that address. Until then, objects stay in the local/S3 mirror and move to Boltchain once the wallet can pay.

A remote `BOLT_RPC_URL` (not localhost) uses that node instead of starting one.

**PostgreSQL.** swarm starts PostgreSQL when `.env` has no `DATABASE_URL` and there is no SQLite data yet:

- It generates a random user (`sb_…`) and a random password, creates the `sinobee` database, and writes `DATABASE_URL=postgresql://…@127.0.0.1:15432/sinobee` to `.env`. `.env` is then set to mode 600; **back it up**, since the password is only there.
- Later runs start the same container again from that `DATABASE_URL`.
- An existing SQLite database is kept. `--postgres` switches to a new, empty PostgreSQL; the SQLite data is not copied.
- A `DATABASE_URL` that points anywhere else is used as it is, and no container is started.
- The port is published on 127.0.0.1 only. Task containers cannot reach the database.

**Ollama.** Ollama runs on the GPU when docker has an NVIDIA GPU (NVIDIA Container Toolkit), and on the CPU otherwise.

- swarm writes `OLLAMA_URL=http://127.0.0.1:11434` to `.env`.
- Models are not pulled automatically. Download them in /admin → 模型與定價 → Ollama, which lists recommended open models (or any Ollama model name) with download progress, or run `docker exec sinobee-ollama ollama pull <model>`.
- Ollama is also a model source for the platform's own AI jobs. Downloaded models appear as `ollama/<name>` in the model lists of /admin → 模型與定價 and can be put into the high, standard and light tiers. They need no API key and are added to Model prices at 0. Settings → Ollama URL overrides `OLLAMA_URL`.
- An `OLLAMA_URL` on another host uses that server instead of starting one.

**MiniMax H3.** ComfyUI with MiniMax H3 renders the videos of the `ai-video-production` skill.

- **GPU.** It needs an NVIDIA GPU with a CUDA 13 driver and the NVIDIA Container Toolkit. Without one it is skipped, with a note in the log.
- **Image.** The image is built from `docker/minimax-h3`: ComfyUI `COMFYUI_REF` (default `v0.38.2`) on PyTorch for CUDA 13.
- **Model files (~76 GB).** They are downloaded from Hugging Face `Comfy-Org/MiniMax-H3` into the `sinobee-h3-models` volume on the first start, before ComfyUI answers. Follow the download with `docker logs -f sinobee-h3`. A restart resumes it.
- **Which files.** By default: the pruned int8 fl2va and ref2va models, the int8 Qwen3-VL text encoder, the video and audio VAEs, and the turbo LoRAs. `H3_FILES` (space-separated paths in that repository) replaces the set, and `HF_TOKEN` is used when set.
- swarm writes `COMFYUI_URL=http://127.0.0.1:8188` to `.env`. A `COMFYUI_URL` on another host uses that server instead of starting one.

**Only for SinoBee.ai.** Ollama and H3 are published on 127.0.0.1 only.

- They are attached to the `sinobee` docker network. The worker creates the SinoBee task containers on that network too, unless a network is set in /admin → Settings (`runner.network`). This also holds when the worker runs without swarm (e.g. under pm2), because it reads `OLLAMA_URL` / `COMFYUI_URL` from `.env`.
- Task containers get `SINOBEE_OLLAMA_URL` and `OLLAMA_HOST` (`http://sinobee-ollama:11434`), which SinoBee uses for `ollama/…` models, and `COMFYUI_URL` (`http://sinobee-h3:8188`), which the `ai-video-production` skill uses. An `OLLAMA_URL` / `COMFYUI_URL` on another host is passed to the tasks as it is.
- Existing user containers join the network but only get these variables when they are recreated.

Ports can be changed with `SINOBEE_POSTGRES_PORT`, `SINOBEE_OLLAMA_PORT`, `SINOBEE_H3_PORT` and `BOLT_NODE_RPC_PORT`; images with `SINOBEE_POSTGRES_IMAGE`, `SINOBEE_OLLAMA_IMAGE`, `COMFYUI_REF` and `BOLTCHAIN_REF`.

### 線上使用 (each user's own SinoBee)

The header's 線上使用 button opens `/agent`. It needs a signed-in user, then starts that user's own SinoBee container and opens it through the **agent gateway** (`npm run agent-gateway`, started by swarm on port 10025).

- **Container.** It is named `sb-u-<user id>` and built from the SinoBee image (`runner.image`). It runs the Web UI and a virtual desktop.
- **Data.** The user's files and settings live in the volumes `sb-uhome-<user id>` and `sb-uwork-<user id>`. A container that nobody used for `AGENT_IDLE_HOURS` (default 2) is stopped, and the next visit starts it again.
- **Ports.** They are published on 127.0.0.1 only, so only the gateway reaches the container. It is on the `sinobee` network, so SinoBee can use Ollama and MiniMax H3.
- **Own origin.** SinoBee's Web UI must be served from the root of an origin, so the gateway has its own: `AGENT_ORIGIN`, default `http://localhost:10025`. In production, point e.g. `https://agent.sinobee.ai` at port 10025 in the reverse proxy (WebSockets included), set `AGENT_ORIGIN=https://agent.sinobee.ai` in `.env`, and run `npm run agent-gateway` next to the web server and the worker (e.g. a third pm2 process).
- **Sign-in.** The site hands the browser over with a signed one-minute ticket, and the gateway keeps its own signed cookie. It adds the container's server token to every request, so the browser never sees it.
- **No platform API keys** go into these containers. Users sign in to SinoBee.ai inside SinoBee (subscription models) or use local models.
- The desktop view (`/__vnc/…`) goes through the gateway too.

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
# 1. SinoBee image used for user containers (or: npm run swarm -- --build)
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

### Admin (/admin)

Five groups, twelve sections: **Overview** (one inbox of everything waiting — skill and tool versions, reports, proposals in screening, disputes, payments Oen has not reported back on — oldest first; go-live checks split into what blocks users and what is advice; the last admin actions), **Review** (content review: skills and tools in one queue, list + detail, scan findings first, the diff against the last approved version; approving a flagged version needs "I read the findings", sending back or revoking needs a reason the publisher receives — the API enforces both), Reports (grouped per reported thing, with what a takedown does), Crowdfunding (disputes to decide, proposals in screening), Screening checklist, **Users** (table with plan, 30-day spend and payments; a detail panel with usage, payments, published items and permissions; disabling an account stops sign-in, sessions and API tokens), **Payments** (search, counts per status, period, CSV export, a detail panel with the refund and what it does), **Plans** (side by side; margin from the real average 30-day spend of subscription periods, or the whole allowance until there is usage; one-click fixes), **Models & pricing** (tier chains with why a model would be skipped, vendor groups with key status and pause, a model panel with the USD → NT$ preview, schedule and price history), Settings (one group at a time, what each still needs, the go-live list), Audit log (filters, before → after) and Storage. Old `?tab=` links redirect. Strings: `scripts/i18n-admin.py`.

### Sign in with CAFECA

No registration with CAFECA is needed. The site issues a one-time nonce bound to the browser, the wallet signs an EIP-712 `SignIn` message with the user's Passkey, and the backend verifies it with `isValidSignature` (ERC-1271) on chain 8018 — see `src/lib/signin-flow.ts`. `PUBLIC_ORIGIN` must exactly match the public origin (scheme + host + port). The site metadata shown in the wallet is served at `/.well-known/cafeca-site.json`.

### Billing

```
charge (TWD) = (token cost at the published model price × price buffer) + (VM cost + S3 cost) × markup
VM cost    = run seconds × AWS_VM_HOURLY_USD
S3 cost    = result size × retention days × AWS_S3_GB_MONTH_USD + request fees
```

Model prices and the exchange rate are snapshotted when a crowdfund is funded. The meter runs every 15 s and never charges more than the task budget; when the budget runs out the agent is stopped, `outputs/` is packaged as a partial result and the proposer can open a top-up round or close the task.

### Crowdfunding

`src/lib/crowd/` — see the header of `lifecycle.ts` for the state machine (DRAFT → FUNDING → CHARGING → QUEUED … → settled, or UNFUNDED). The worker runs `crowdTick` every minute. Cards are saved through Oen's token checkout (`POST /checkout-token`; the token arrives only in the unsigned webhook with `purpose: "token"` and is accepted once, for a pending binding) and charged with `POST /token/transactions` (Idempotency-Key, one charge per backer and task). Settings: /admin → Settings → Crowdfunding. Every payment on the site (proposal fees, subscriptions, pledges) charges a saved card; there is no hosted checkout. With `PAYMENT_MODE=mock` the card binding page and charges are simulated (`/pay/mock-card/:id`; a card bound with "decline" fails every charge).

**Test mode** (`site.testMode`, /admin → Settings → payments): shows a TEST ribbon on the home page and in the admin; new cards and payments use Oen's testing environment (`oen.testMerchantId` / `oen.testToken` when set) and are flagged `sandbox` — they keep using that environment for lookups and refunds, are only offered while test mode is on, and are left out of revenue.

After a crowdfunded run the backers review it (`review.ts`): the agent's `outputs/acceptance.json` self-check is shown, votes are weighted by paid shares for `crowd.reviewDays`, a rejection queues a rework with the backers' reasons (`crowd.maxReworks`), and what is still rejected goes to /admin → Crowdfunding (disputes). While funding, the proposer can publish spec revisions (charging waits `crowd.exitHours` so backers can withdraw); money beyond the goal unlocks stretch goals; when the budget runs out the proposer can open an all-or-nothing top-up round (`crowd.topupDays`). Backer comments marked "reference" reach the agent as `inputs/backer-notes.md` (untrusted data). Crowdfunded tasks run in their own container (`sb-c-<taskId>`), removed after settlement.

Discovery and trust (`explore.ts`, `reputation.ts`, `screening.ts`): `/crowd` lists open and funded campaigns by category with ending-soon / almost-funded / popular / newest sorting and title search; proposers show a track record (funded / ended, accepted, first-time accepted, platform refunds, KYC level). Submitted proposals go through `crowd.screening` (ai / off): the proposal is queued and the worker (`screeningTick`, every 10 s) has the AI answer every yes/no item of the published checklist (`checklist.ts`, built-in default `checklist-default.ts`: 105 items in six dimensions — legality, privacy, IP, safety, feasibility, spec). All items must pass; otherwise the proposal goes back to draft with the failed items and reasons. The result records how many items passed and failed and why, and the proposer is notified either way. If no model answers, the worker retries. Admins cannot approve or reject: in /admin → Crowdfunding they can only ask for a re-review, optionally with a note the AI reads as context. Admins edit the checklist in /admin → Checklist, by hand or by asking a model, and publish versions (≥ 100 items). The checklist is listed in the crowdfunding terms (`/crowd-terms`); proposers and backers must agree, and the version they agreed to is stored (`termsVersion`). The period starts when the campaign opens. Campaign pages carry link previews for every major platform (`share.ts`): a 1200×630 PNG drawn by `/api/crowd/:id/og` (next/og; CJK glyphs fetched per picture from `crowd.ogFontUrl`, or `OG_FONT_PATH` for a local TTF/OTF), a title ≤ 60 and description ≤ 160 characters, Open Graph and X card tags, canonical URL, optional `fb:app_id` / `twitter:site` (Settings → Crowdfunding). The picture URL carries a version of what it shows, so platforms fetch a new one as funding progresses. The share dialog links Facebook, X, LINE, Threads, LinkedIn, Telegram and WhatsApp. Crowdfunds can be reported; a takedown during the campaign cancels it and returns every pledge, a funded task is only hidden. `crowd.pledgeMinKyc` / `crowd.voteMinKyc` can require a CAFECA KYC level. Model prices are snapshotted again when a campaign is funded.

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
  - Document shares (`kind: "doc"`): a report or interactive page a skill made, with the files it uses at their relative paths (`entry` names the main file). Conversation shares carry linked reports the same way, under `doc<n>/`. Markdown renders on the page (images, KaTeX math, mermaid); HTML/SVG runs in a sandboxed frame from `/api/shares/<id>/raw/<cap>/<path>`: an opaque origin with no cookies, a CSP that limits its network to the share's own files, and a 12-hour capability in the path instead of a session. Opened directly in a tab, such a page redirects to the share page.
  - Link previews: SinoBee sends a description and a 1200×630 picture (`thumb`); `/s/<id>` emits Open Graph and X card tags and `/api/shares/<id>/og` serves the picture, for LINK and PUBLIC shares only. Only PUBLIC shares may be indexed.

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
- **Model keys in task containers**: the worker passes `RUNNER_PASS_ENV` keys into task containers. Since agents run with `approval: auto`, prefer per-task scoped keys or an LLM gateway in production.
- Model and AWS prices are reference values — review `src/lib/pricing.ts` and the `AWS_*` env vars before launch.

## License

MIT © 2026 CAFECA
