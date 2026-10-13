/**
 * npm run swarm — run the whole SinoBee.ai stack on one port (default 10023):
 *   1. apply database migrations (PostgreSQL if DATABASE_URL is set, otherwise SQLite)
 *   2. seed the official skills (idempotent)
 *   3. build the site if needed (production mode)
 *   4. start the web server on :10023 and the task worker, with prefixed logs
 *
 * Options:
 *   npm run swarm -- --dev        next dev instead of a production build (hot reload, DEV_LOGIN works)
 *   npm run swarm -- --build      force a fresh production build
 *   npm run swarm -- --no-worker  web only
 *   SWARM_PORT=12345 npm run swarm
 */
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

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

const color = { swarm: "\x1b[33m", web: "\x1b[36m", worker: "\x1b[35m" } as const;
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
let stopping = false;
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  log("swarm", "stopping…");
  for (const c of children) c.kill("SIGTERM");
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
  await run("swarm", bin("tsx"), ["prisma/seed.ts"]);

  if (!dev && (args.has("--build") || !existsSync(path.join(root, ".next", "BUILD_ID")))) {
    log("swarm", "building the site (production)…");
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
