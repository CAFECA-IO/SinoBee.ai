/**
 * Local Boltchain node for `npm run swarm`:
 *   - the site wallet and master key are settings generated automatically and kept encrypted in the database
 *     (/admin → Settings → Boltchain); this only provides the node;
 *   - builds the node image (docker/boltchain) and runs it as the `sinobee-boltchain` container
 *     (JSON-RPC with --rpc-storage published on 127.0.0.1 only, data in a docker volume);
 *   - a fresh node starts from the latest epoch-end snapshot of the public testnet instead of genesis.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";

export const BOLT_REF = process.env.BOLTCHAIN_REF || "b4fba15";
export const IMAGE = `sinobee-boltchain:${BOLT_REF}`;
export const CONTAINER = process.env.BOLT_NODE_CONTAINER || "sinobee-boltchain";
const VOLUME = `${CONTAINER}-data`;
/** bump when the `docker run` options change: an older container is recreated (the chain data volume stays) */
const RUN_CONFIG = "2";
/** public testnet: JSON-RPC (for the snapshot checkpoint) and the Certificates contract (ADR 0016) */
const TESTNET_RPC = process.env.BOLT_TESTNET_RPC || "http://211.22.118.149:8545";
const TESTNET_CERTIFICATES = "0xbd9a05789d74d1ccf616ac44f9fda3a11e812173";
const EPOCH_SLOTS = 600;

type Log = (line: string) => void;

// ---------------- settings ----------------

/** public testnet Certificates contract, used when the site has none configured */
export const DEFAULT_CERTIFICATES = TESTNET_CERTIFICATES;

export const isLocalRpc = (url: string) => {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

export function siteAddress(key: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as `0x${string}`).address : null;
}

// ---------------- docker ----------------

const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8" });

export function dockerAvailable(): boolean {
  const r = docker(["info", "--format", "{{.ServerVersion}}"]);
  return r.status === 0 && !!r.stdout.trim();
}

function streamed(args: string[], log: Log): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const on = (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) log(l);
    };
    p.stdout.on("data", on);
    p.stderr.on("data", on);
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`docker ${args[0]} exited with ${c}`))));
    p.on("error", reject);
  });
}

async function rpc<T>(url: string, method: string, params: unknown[] = [], timeoutMs = 5000): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

/** `<number>:<hash>` of the last epoch-end block on the public testnet (fast start), or null */
export async function latestCheckpoint(): Promise<string | null> {
  try {
    const head = Number(BigInt(await rpc<string>(TESTNET_RPC, "eth_blockNumber", [], 8000)));
    const end = Math.floor(head / EPOCH_SLOTS) * EPOCH_SLOTS - EPOCH_SLOTS; // a finalized epoch end, not the live one
    if (end <= 0) return null;
    const b = await rpc<{ hash: string }>(TESTNET_RPC, "eth_getBlockByNumber", [`0x${end.toString(16)}`, false], 8000);
    return b?.hash ? `${end}:${b.hash}` : null;
  } catch {
    return null;
  }
}

/** Builds the image if missing and starts (or reuses) the node container */
export async function startNode(root: string, rpcPort: number, log: Log, opts: { rebuild?: boolean } = {}) {
  if (opts.rebuild || docker(["image", "inspect", IMAGE]).status !== 0) {
    log(`building ${IMAGE} from Luphia/Boltchain@${BOLT_REF} (first time: ~10–20 min)…`);
    await streamed(["build", "--progress=plain", "-t", IMAGE, "--build-arg", `BOLTCHAIN_REF=${BOLT_REF}`, path.join(root, "docker", "boltchain")], (l) => {
      if (/^#\d+ (\[|DONE|ERROR)|error|Compiling boltchain|Finished/i.test(l)) log(l);
    });
  }
  const state = docker(["inspect", "-f", '{{.State.Running}} {{.Config.Image}} {{index .Config.Labels "sinobee.node-config"}}', CONTAINER]);
  if (state.status === 0) {
    const [running, image, cfg] = state.stdout.trim().split(" ");
    if (image !== IMAGE || cfg !== RUN_CONFIG) {
      log(`replacing ${CONTAINER} (${image} → ${IMAGE}); chain data is kept`);
      docker(["rm", "-f", CONTAINER]);
    } else if (running === "true") {
      log(`node ${CONTAINER} already running`);
      return;
    } else {
      log(`starting node ${CONTAINER}`);
      if (docker(["start", CONTAINER]).status !== 0) throw new Error(`docker start ${CONTAINER} failed`);
      return;
    }
  }
  const fresh = docker(["volume", "inspect", VOLUME]).status !== 0;
  const checkpoint = fresh ? await latestCheckpoint() : null;
  if (checkpoint) log(`fresh node: starting from testnet snapshot ${checkpoint}`);
  const p2p = process.env.BOLT_NODE_P2P_PORT || "8017";
  const run = docker([
    "run", "-d", "--name", CONTAINER, "--restart", "unless-stopped",
    "--init", // forwards SIGTERM to the node so `docker stop` shuts it down cleanly
    "--label", `sinobee.node-config=${RUN_CONFIG}`,
    "-v", `${VOLUME}:/data`,
    "-p", `127.0.0.1:${rpcPort}:8545`, // RPC (with block hosting) never leaves this machine
    "-p", `127.0.0.1:${process.env.BOLT_NODE_METRICS_PORT || "9017"}:9017`,
    "-p", `${p2p}:8017/tcp`, "-p", `${p2p}:8017/udp`,
    ...(checkpoint ? ["-e", `BOLT_CHECKPOINT=${checkpoint}`] : []),
    IMAGE,
  ]);
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr.trim().split("\n").pop()}`);
  log(`node ${CONTAINER} started (RPC http://127.0.0.1:${rpcPort}, P2P :${p2p})`);
}

/** Waits for the node's RPC, then reports height and the site wallet's balance */
export async function waitForNode(url: string, address: string | null, log: Log, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const id = Number(BigInt(await rpc<string>(url, "eth_chainId")));
      const height = Number(BigInt(await rpc<string>(url, "eth_blockNumber")));
      let bal = "?";
      if (address) bal = (Number(BigInt(await rpc<string>(url, "eth_getBalance", [address, "latest"])) / 10n ** 15n) / 1000).toString();
      log(`node ready: chain ${id}, height ${height}${address ? `, site wallet ${address} holds ${bal} BOLT` : ""}`);
      if (address && bal === "0") log(`fund the site wallet with BOLT to store objects on Boltchain; until then they stay in the mirror (local/S3)`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  log(`node RPC not ready after ${Math.round(timeoutMs / 1000)} s — the site runs anyway; check: docker logs ${CONTAINER}`);
  return false;
}

export function stopNode(log: Log) {
  if (docker(["stop", "-t", "20", CONTAINER]).status === 0) log(`node ${CONTAINER} stopped (data kept in volume ${VOLUME})`);
}
