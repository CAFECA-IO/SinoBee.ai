/**
 * npm run swarm — run the whole SinoBee.ai stack on one port (default 10023):
 *   1. apply database migrations (PostgreSQL if DATABASE_URL is set, otherwise SQLite)
 *   2. settings: move registered variables out of .env into the database (secrets encrypted), and generate
 *      missing keys (skill signing key, Boltchain site wallet and master key) — see /admin → Settings
 *   3. Boltchain: start a local node in docker (`sinobee-boltchain`, RPC on 127.0.0.1:8545 with --rpc-storage)
 *      unless a node RPC is configured
 *   4. seed the official skills (idempotent)
 *   5. build the site if needed (production mode)
 *   6. start the web server on :10023 and the task worker, with prefixed logs
 *
 * Options:
 *   npm run swarm -- --dev        next dev instead of a production build (hot reload, DEV_LOGIN works)
 *   npm run swarm -- --build      force a fresh production build
 *   npm run swarm -- --no-worker  web only
 *   npm run swarm -- --no-boltchain   do not start the Boltchain node (storage stays local/S3)
 *   npm run swarm -- --rebuild-node   rebuild the Boltchain node image
 *   BOLT_RPC_URL=https://…   use that node instead of starting one; BOLT_NODE_RPC_PORT, BOLTCHAIN_REF
 *   BOLT_NODE_KEEP=1         leave the node running when the swarm stops
 *   SWARM_PORT=12345 npm run swarm
 */
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CERTIFICATES, dockerAvailable, isLocalRpc, siteAddress, startNode, stopNode, waitForNode } from "./boltchain-node";

const root = path.resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const dev = args.has("--dev");
const port = Number(process.env.SWARM_PORT ?? 10023);
const bin = (name: string) => path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

// The origin users sign in to must match the port we serve on (CAFECA signs the exact origin).
// A local origin on another port (e.g. the :3000 default from .env.example) is moved to this port;
// a public origin (https://sinobee.ai behind a reverse proxy) is kept as is.
if (!process.env.PUBLIC_ORIGIN) process.env.PUBLIC_ORIGIN = `http://localhost:${port}`;
else {
  const u = new URL(process.env.PUBLIC_ORIGIN);
  if (["localhost", "127.0.0.1"].includes(u.hostname) && Number(u.port || 80) !== port) {
    u.port = String(port);
    process.env.PUBLIC_ORIGIN = u.origin;
  }
}

const color = { swarm: "\x1b[33m", web: "\x1b[36m", worker: "\x1b[35m", bolt: "\x1b[32m" } as const;
const log = (who: keyof typeof color, line: string) => console.log(`${color[who]}[${who}]\x1b[0m ${line}`);

function pipe(who: keyof typeof color, p: ChildProcess) {
  for (const s of [p.stdout, p.stderr]) {
    let buf = "";
    s?.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) log(who, l);
    });
  }
}

function run(who: keyof typeof color, cmd: string, argv: string[], env: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    pipe(who, p);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} ${argv.join(" ")} exited with ${code}`))));
    p.on("error", reject);
  });
}

const children: ChildProcess[] = [];
let nodeStarted = false;

/** Local Boltchain node unless one is configured (see scripts/boltchain-node.ts) */
async function boltchain() {
  const { sv } = await import("../src/lib/settings/cache");
  const blog = (l: string) => log("bolt", l);
  const rpcPort = Number(process.env.BOLT_NODE_RPC_PORT || 8545);
  const url = sv("boltchain.rpcUrl") || `http://127.0.0.1:${rpcPort}`;
  const addr = siteAddress(sv("boltchain.walletKey"));
  if (addr) blog(`site wallet ${addr}`);
  if (!isLocalRpc(url)) {
    blog(`using the Boltchain node at ${url}`);
    await waitForNode(url, addr, blog, 15_000);
    return;
  }
  if (!dockerAvailable()) {
    blog("docker is not available: Boltchain storage is off for this run (objects stay in local/S3 storage)");
    return;
  }
  await startNode(root, Number(new URL(url).port || rpcPort), blog, { rebuild: args.has("--rebuild-node") });
  nodeStarted = true;
  await waitForNode(url, addr, blog);
  // tell the web server and the worker where the node is for this run (not stored: the node lives with the swarm)
  if (!sv("boltchain.rpcUrl")) process.env.BOLT_RPC_URL = url;
  if (!sv("boltchain.certificates")) process.env.BOLT_CERTIFICATES = DEFAULT_CERTIFICATES;
}

/** Move .env settings into the database and create missing keys */
async function settings() {
  const store = await import("../src/lib/settings/store");
  await store.loadSettings({ refreshEveryMs: 0 });
  await store.importEnvFile(path.join(root, ".env"), (l) => log("swarm", l));
  await store.generateMissing((l) => log("swarm", l));
}

let stopping = false;
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  log("swarm", "stopping…");
  for (const c of children) c.kill("SIGTERM");
  if (nodeStarted && process.env.BOLT_NODE_KEEP !== "1") stopNode((l) => log("bolt", l));
  setTimeout(() => process.exit(code), 3000).unref();
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

function start(who: "web" | "worker", cmd: string, argv: string[], env: Record<string, string> = {}) {
  const p = spawn(cmd, argv, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  pipe(who, p);
  children.push(p);
  p.on("exit", (code) => {
    if (stopping) return;
    log("swarm", `${who} exited (${code}); shutting down`);
    stopAll(code ?? 1);
  });
}

async function main() {
  const db = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "") ? "PostgreSQL" : `SQLite (${process.env.SQLITE_PATH || "./data/sinobee.db"})`;
  log("swarm", `database: ${db}`);

  await run("swarm", bin("prisma"), ["generate", "--schema", "prisma/schema.prisma"]);
  await run("swarm", bin("prisma"), ["generate", "--schema", "prisma/sqlite/schema.prisma"]);
  await run("swarm", bin("prisma"), ["migrate", "deploy"]);
  await settings();

  if (!args.has("--no-boltchain")) {
    try {
      await boltchain();
    } catch (e) {
      log("bolt", `Boltchain node not started: ${e instanceof Error ? e.message : e} — storage stays local/S3 for this run`);
      delete process.env.BOLT_RPC_URL;
    }
  }
  await run("swarm", bin("tsx"), ["prisma/seed.ts"]);

  if (!dev && (args.has("--build") || !existsSync(path.join(root, ".next", "BUILD_ID")))) {
    log("swarm", "building the site (production)…");
    // stale route types from an earlier `next dev` break type checking after a route is removed
    rmSync(path.join(root, ".next", "dev", "types"), { recursive: true, force: true });
    await run("swarm", bin("next"), ["build"]);
  }

  start("web", bin("next"), [dev ? "dev" : "start", "-p", String(port)], { PORT: String(port) });
  if (!args.has("--no-worker")) start("worker", bin("tsx"), ["worker/index.ts"]);
  log("swarm", `SinoBee.ai → ${process.env.PUBLIC_ORIGIN}  (${dev ? "dev" : "production"}${args.has("--no-worker") ? ", no worker" : " + worker"})  Ctrl-C to stop`);
}

main().catch((e) => {
  log("swarm", String(e instanceof Error ? e.message : e));
  stopAll(1);
});
