/**
 * Docker services started by `npm run swarm` next to the Boltchain node (scripts/boltchain-node.ts):
 *
 *   sinobee-postgres  PostgreSQL (official image). Created when .env has no DATABASE_URL and there is no SQLite data
 *                     yet (or with --postgres): a random user and password are generated and DATABASE_URL is written
 *                     to .env. Published on 127.0.0.1 only; not reachable from task containers.
 *   sinobee-ollama    Ollama (official image). OLLAMA_URL is written to .env. Uses the GPU when docker has one.
 *   sinobee-h3        ComfyUI with MiniMax H3 (built from docker/minimax-h3). Needs an NVIDIA GPU; the model files
 *                     (~76 GB) are downloaded into a volume on its first start. COMFYUI_URL is written to .env.
 *
 * Ollama and H3 are for SinoBee.ai only: published on 127.0.0.1 and attached to the `sinobee` docker network, which
 * the worker also gives the task containers (src/lib/config.ts taskServices), so tasks reach them as
 * http://sinobee-ollama:11434 and http://sinobee-h3:8188. Images that are missing are built (H3) or pulled (Postgres, Ollama); --build rebuilds and
 * re-pulls them, and a container whose image changed is recreated (its volume is kept).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

type Log = (line: string) => void;

export const NETWORK = "sinobee";
export const POSTGRES_IMAGE = process.env.SINOBEE_POSTGRES_IMAGE || "postgres:17-alpine";
export const OLLAMA_IMAGE = process.env.SINOBEE_OLLAMA_IMAGE || "ollama/ollama:0.34.4";
/** ComfyUI release the H3 image is built from (MiniMax H3 needs ≥ 0.36 for every template) */
export const COMFYUI_REF = process.env.COMFYUI_REF || "v0.38.2";
export const H3_IMAGE = `sinobee-minimax-h3:${COMFYUI_REF}`;
const PG = { container: "sinobee-postgres", volume: "sinobee-postgres-data", port: Number(process.env.SINOBEE_POSTGRES_PORT || 15432) };
const OLLAMA = { container: "sinobee-ollama", volume: "sinobee-ollama-data", port: Number(process.env.SINOBEE_OLLAMA_PORT || 11434) };
const H3 = { container: "sinobee-h3", volume: "sinobee-h3-models", port: Number(process.env.SINOBEE_H3_PORT || 8188) };
/** bump when the `docker run` options of these services change: the containers are recreated (volumes stay) */
const RUN_CONFIG = "1";

const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8" });
const ok = (args: string[]) => docker(args).status === 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function streamed(args: string[], log: Log, filter: (l: string) => boolean = () => true): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const on = (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim() && filter(l)) log(l);
    };
    p.stdout.on("data", on);
    p.stderr.on("data", on);
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`docker ${args[0]} exited with ${c}`))));
    p.on("error", reject);
  });
}

/** Whether docker can give containers an NVIDIA GPU (NVIDIA Container Toolkit) */
export function hasNvidiaGpu(): boolean {
  const r = docker(["info", "--format", "{{json .Runtimes}}"]);
  return r.status === 0 && /nvidia/i.test(r.stdout);
}

export function ensureNetwork(log: Log) {
  if (ok(["network", "inspect", NETWORK])) return;
  if (!ok(["network", "create", "--label", "ai.sinobee.managed=1", NETWORK])) throw new Error(`docker network create ${NETWORK} failed`);
  log(`created docker network ${NETWORK}`);
}

/** Pulls an image when it is missing, or always with `refresh` */
async function pulled(image: string, refresh: boolean, log: Log) {
  if (!refresh && ok(["image", "inspect", image])) return;
  log(`pulling ${image}…`);
  await streamed(["pull", image], log, (l) => /Status|Digest|error/i.test(l));
}

/**
 * Starts the container, reusing one that runs the same image (by id) and run config; anything else is replaced.
 * Returns true when it (re)started the container.
 */
function ensureContainer(name: string, image: string, runArgs: string[], log: Log): boolean {
  const state = docker(["inspect", "-f", '{{.State.Running}} {{.Image}} {{index .Config.Labels "sinobee.service-config"}}', name]);
  const imageId = docker(["image", "inspect", "-f", "{{.Id}}", image]).stdout.trim();
  if (state.status === 0) {
    const [running, id, cfg] = state.stdout.trim().split(" ");
    if (id === imageId && cfg === RUN_CONFIG) {
      if (running === "true") return false;
      if (!ok(["start", name])) throw new Error(`docker start ${name} failed`);
      log(`started ${name}`);
      return true;
    }
    log(`replacing ${name} (new image or options); its data volume is kept`);
    docker(["rm", "-f", name]);
  }
  const r = docker(["run", "-d", "--name", name, "--restart", "unless-stopped", "--label", "ai.sinobee.managed=1", "--label", `sinobee.service-config=${RUN_CONFIG}`, ...runArgs, image]);
  if (r.status !== 0) throw new Error(`docker run ${name} failed: ${r.stderr.trim().split("\n").pop()}`);
  log(`started ${name}`);
  return true;
}

// ---------------- .env ----------------

/** Sets KEY=value in .env (replacing an existing line, commented or not, for that key), mode 600 */
export function setEnv(file: string, key: string, value: string) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = text.split("\n");
  const i = (() => {
    const set = lines.findIndex((l) => new RegExp(`^\\s*${key}=`).test(l));
    return set >= 0 ? set : lines.findIndex((l) => new RegExp(`^\\s*#\\s*${key}=`).test(l));
  })();
  if (i >= 0) lines[i] = `${key}=${value}`;
  else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(`${key}=${value}`, "");
  }
  writeFileSync(file, lines.join("\n"));
  chmodSync(file, 0o600);
  process.env[key] = value;
}

const isLocal = (url: string) => {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

// ---------------- PostgreSQL ----------------

/**
 * Decides the database for this run and makes sure our PostgreSQL container runs when it is used.
 * Returns what it did, for the log.
 */
export async function postgres(root: string, log: Log, opts: { refresh?: boolean; force?: boolean } = {}) {
  const envFile = path.join(root, ".env");
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (url) {
    // ours: localhost on our port. Anything else is a database someone else runs.
    let ours = false;
    try {
      const u = new URL(url);
      ours = isLocal(url) && Number(u.port || 5432) === PG.port;
    } catch {
      /* not a URL we manage */
    }
    if (!ours) return;
    await pulled(POSTGRES_IMAGE, !!opts.refresh, log);
    const u = new URL(url);
    ensureContainer(PG.container, POSTGRES_IMAGE, pgRunArgs(decodeURIComponent(u.username), decodeURIComponent(u.password), u.pathname.slice(1) || "sinobee"), log);
    await pgReady(log);
    return;
  }
  const sqlite = path.resolve(root, process.env.SQLITE_PATH || "./data/sinobee.db");
  if (!opts.force && existsSync(sqlite) && statSync(sqlite).size > 0) {
    log(`keeping SQLite (${path.relative(root, sqlite)} has data); run with --postgres to start a new PostgreSQL instead (the SQLite data is not copied)`);
    return;
  }
  if (ok(["volume", "inspect", PG.volume]))
    throw new Error(`volume ${PG.volume} exists but .env has no DATABASE_URL: restore the DATABASE_URL line, or remove the volume (docker volume rm ${PG.volume}) to start empty`);
  const user = `sb_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(24).toString("base64url");
  await pulled(POSTGRES_IMAGE, !!opts.refresh, log);
  ensureContainer(PG.container, POSTGRES_IMAGE, pgRunArgs(user, password, "sinobee"), log);
  await pgReady(log);
  setEnv(envFile, "DATABASE_URL", `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${PG.port}/sinobee`);
  log(`PostgreSQL ready: user ${user} with a random password, saved as DATABASE_URL in .env (mode 600; back it up)`);
}

function pgRunArgs(user: string, password: string, db: string) {
  return [
    "-e", `POSTGRES_USER=${user}`, "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${db}`,
    "-v", `${PG.volume}:/var/lib/postgresql/data`,
    "-p", `127.0.0.1:${PG.port}:5432`, // never leaves this machine; not on the task network
  ];
}

async function pgReady(log: Log, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    // pg_isready answers during the init run too; a real query only succeeds once the final server is up
    if (ok(["exec", PG.container, "sh", "-c", 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select 1"'])) return;
    await sleep(1000);
  }
  log(`PostgreSQL did not answer in ${timeoutMs / 1000} s — check: docker logs ${PG.container}`);
}

// ---------------- Ollama ----------------

export async function ollama(root: string, log: Log, opts: { refresh?: boolean } = {}) {
  const url = process.env.OLLAMA_URL?.trim();
  if (url && !isLocal(url)) {
    log(`using the Ollama server at ${url}`);
    return;
  }
  ensureNetwork(log);
  await pulled(OLLAMA_IMAGE, !!opts.refresh, log);
  const gpu = hasNvidiaGpu();
  ensureContainer(OLLAMA.container, OLLAMA_IMAGE, [
    "--network", NETWORK,
    "-v", `${OLLAMA.volume}:/root/.ollama`,
    "-p", `127.0.0.1:${OLLAMA.port}:11434`,
    ...(gpu ? ["--gpus", "all"] : []),
  ], log);
  setEnv(path.join(root, ".env"), "OLLAMA_URL", `http://127.0.0.1:${OLLAMA.port}`);
  log(`Ollama on http://127.0.0.1:${OLLAMA.port} (${gpu ? "GPU" : "CPU only"}); tasks reach it as http://${OLLAMA.container}:11434 — add models with: docker exec ${OLLAMA.container} ollama pull <model>`);
  return `http://${OLLAMA.container}:11434`;
}

// ---------------- MiniMax H3 (ComfyUI) ----------------

export async function minimaxH3(root: string, log: Log, opts: { rebuild?: boolean } = {}) {
  const url = process.env.COMFYUI_URL?.trim();
  if (url && !isLocal(url)) {
    log(`using the ComfyUI (MiniMax H3) server at ${url}`);
    return;
  }
  if (!hasNvidiaGpu()) {
    log("no NVIDIA GPU in docker (NVIDIA Container Toolkit): MiniMax H3 not started; set COMFYUI_URL to a GPU server's ComfyUI instead");
    return;
  }
  ensureNetwork(log);
  if (opts.rebuild || !ok(["image", "inspect", H3_IMAGE])) {
    log(`building ${H3_IMAGE} (ComfyUI ${COMFYUI_REF}, PyTorch CUDA 13)…`);
    await streamed(["build", "--progress=plain", "-t", H3_IMAGE, "--build-arg", `COMFYUI_REF=${COMFYUI_REF}`, path.join(root, "docker", "minimax-h3")], log, (l) =>
      /^#\d+ (\[|DONE|ERROR)|error/i.test(l),
    );
  }
  const fresh = !ok(["volume", "inspect", H3.volume]);
  ensureContainer(H3.container, H3_IMAGE, [
    "--network", NETWORK,
    "--gpus", "all",
    "--shm-size", "16g",
    "-v", `${H3.volume}:/models`,
    "-p", `127.0.0.1:${H3.port}:8188`,
    ...(process.env.HF_TOKEN ? ["-e", `HF_TOKEN=${process.env.HF_TOKEN}`] : []),
    ...(process.env.H3_FILES ? ["-e", `H3_FILES=${process.env.H3_FILES}`] : []),
  ], log);
  setEnv(path.join(root, ".env"), "COMFYUI_URL", `http://127.0.0.1:${H3.port}`);
  log(
    `MiniMax H3 (ComfyUI) on http://127.0.0.1:${H3.port}; tasks reach it as http://${H3.container}:8188` +
      (fresh ? ` — first start downloads the model files (~76 GB) before ComfyUI answers: docker logs -f ${H3.container}` : ""),
  );
  return `http://${H3.container}:8188`;
}

// ---------------- SinoBee image (task containers) ----------------

/** Where the SinoBee image is built from: a git URL (`#ref` picks the branch or tag) or a local folder */
export const SINOBEE_SRC = process.env.SINOBEE_SRC || "https://github.com/CAFECA-IO/SinoBee.git#main";

/**
 * The image the worker runs tasks in (setting runner.image, default sinobee:latest). Not built at start-up: with
 * `build` (swarm --build) it is built from the latest SINOBEE_SRC; otherwise a missing image is only reported.
 */
export async function sinobeeImage(image: string, log: Log, opts: { build?: boolean } = {}) {
  if (!opts.build) {
    if (!ok(["image", "inspect", image])) log(`SinoBee image ${image} is missing: tasks cannot run until it exists (npm run swarm -- --build builds it)`);
    return;
  }
  const before = docker(["image", "inspect", "-f", "{{.Id}}", image]).stdout.trim();
  log(`building ${image} from ${SINOBEE_SRC}…`);
  await streamed(["build", "--pull", "--progress=plain", "-t", image, SINOBEE_SRC], log, (l) => /^#\d+ (\[|DONE|ERROR)|error/i.test(l));
  const after = docker(["image", "inspect", "-f", "{{.Id}}", image]).stdout.trim();
  if (before && after !== before) {
    // task containers are created per user and reused: idle ones are removed so the next task gets the new image
    const idle = docker(["ps", "-aq", "--filter", "label=ai.sinobee.managed=1", "--filter", "label=ai.sinobee.user", "--filter", "status=exited"]).stdout.split("\n").filter(Boolean);
    for (const id of idle) docker(["rm", id]);
    log(`${image} updated${idle.length ? `; removed ${idle.length} stopped task container(s) so they start from it` : ""} (running task containers keep the old image until they are removed)`);
  } else log(`${image} is up to date`);
}

/** Stops the services this run started (volumes are kept) */
export function stopServices(names: string[], log: Log) {
  for (const n of names) if (ok(["stop", "-t", "20", n])) log(`${n} stopped (data kept)`);
}

export const SERVICE = { postgres: PG.container, ollama: OLLAMA.container, h3: H3.container };
