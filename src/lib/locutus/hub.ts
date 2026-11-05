/**
 * Locutus hub: Borg Locutus nodes supply models to the relay (Borg docs/spec/locutus-platform-link.md,
 * `borg-locutus-link/1`).
 *
 * Nodes dial in over WebSocket (GET …/link, upgraded) and keep the link open, so they need no open port. A node
 * proves its address by signing the hub's challenge with EIP-191 (viem verifyMessage); only addresses registered in
 * /admin → Settings → locutus.nodes are accepted.
 *
 * To the relay the hub is one more OpenAI-compatible upstream on 127.0.0.1 (provider `locutus`, config.ts):
 *   GET  /openai/models             models the connected nodes serve
 *   POST /openai/chat/completions   dispatched to a node; the node's answer is streamed back unchanged
 *   POST /openai/messages           the same for the Anthropic format
 *   GET  /status                    connected nodes and nodes waiting for approval (for /admin)
 *   POST /reload                    re-read the settings now (an admin approved or removed a node)
 *   POST /ignore {address}          stop listing a waiting node until the hub restarts
 * all with `Authorization: Bearer <locutus.hubSecret>`. Holds, settlement, resumable streams and parameter
 * compatibility stay in the relay; the hub only finds a node and moves bytes.
 *
 * Each answer ends with a receipt the node signs (request hash, model, tokens); the hub checks it and logs it, so a
 * node's work can be audited and paid for later.
 */
import type http from "node:http";
import type { Duplex } from "node:stream";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { verifyMessage, type Address, type Hex } from "viem";

export const LINK_DOMAIN = "borg-locutus-link/1";
export const RECEIPT_DOMAIN = "borg-locutus-receipt/1";
/** jobs a node may hold beyond its declared slots (its backend queues them) */
export const QUEUE = 3;
const PATHS: Record<string, { path: string; format: string }> = {
  "/openai/chat/completions": { path: "chat/completions", format: "openai" },
  "/openai/messages": { path: "messages", format: "anthropic" },
};

export type NodeModel = { id: string; sha256: string; vision?: boolean; formats: string[]; context?: number };

export type Receipt = { id: string; request: string; model: string; model_sha256: string; prompt: number; output: number; address: string; sig: string };

export const helloMessage = (hub: string, nonce: string, address: string, ts: number) =>
  `${LINK_DOMAIN}\nhub:${hub}\nnonce:${nonce}\naddress:${address.toLowerCase()}\nts:${ts}`;

export const receiptMessage = (r: Omit<Receipt, "sig">) =>
  `${RECEIPT_DOMAIN}\nid:${r.id}\nrequest:${r.request}\nmodel:${r.model}\nmodel_sha256:${r.model_sha256}\nprompt:${r.prompt}\noutput:${r.output}\naddress:${r.address.toLowerCase()}`;

/** "0xabc…=147-strata, 0xdef…" → address → label */
export function parseNodes(list: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of list) {
    const [addr, label] = item.split("=");
    if (/^0x[0-9a-fA-F]{40}$/.test(addr)) out.set(addr.toLowerCase(), label || `${addr.slice(0, 6)}…${addr.slice(-4)}`);
  }
  return out;
}

export type HubOptions = {
  /** shown to nodes in the challenge and signed by them (e.g. the site's host) */
  name: string;
  enabled: () => boolean;
  secret: () => string;
  /** registered node addresses (lowercase) → label */
  nodes: () => Map<string, string>;
  log?: (...a: unknown[]) => void;
  pingMs?: number;
  /** a node must answer the challenge within this many ms */
  helloMs?: number;
  /** a job must get its first byte (head) within this many ms (a cold model loads first) */
  headMs?: number;
  onReceipt?: (r: Receipt, ok: boolean, node: string) => void;
  /** addresses refused outright and never listed as waiting (lowercase) */
  blocked?: () => Set<string>;
  /** re-read the settings (POST /reload) */
  reload?: () => Promise<void>;
};

/** A node that proved its address but is not registered yet: an admin approves it in /admin */
export type Waiting = { address: string; ip: string; agent: string; slots: number; models: NodeModel[]; first: string; last: string; attempts: number };
/** at most this many waiting nodes are kept (the oldest drop out) */
const MAX_WAITING = 50;

type Node = { ws: WebSocket; address: string; label: string; models: NodeModel[]; slots: number; agent: string; since: Date; jobs: Set<string>; served: number; badReceipts: number; alive: boolean };
type Job = { id: string; node: Node; res: http.ServerResponse; requestHash: string; model: string; head: boolean; timer?: NodeJS.Timeout };

export class LocutusHub {
  readonly nodes = new Map<string, Node>();
  readonly jobs = new Map<string, Job>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 32 << 20 });
  private log: (...a: unknown[]) => void;
  private pinger: NodeJS.Timeout;
  readonly waiting = new Map<string, Waiting>();
  private ignored = new Set<string>();

  constructor(private o: HubOptions) {
    this.log = o.log ?? ((...a) => console.log(new Date().toISOString(), "[locutus]", ...a));
    this.pinger = setInterval(() => {
      this.sync();
      for (const n of this.nodes.values()) {
        if (!n.alive) {
          n.ws.terminate();
          continue;
        }
        n.alive = false;
        n.ws.ping();
      }
    }, o.pingMs ?? 20_000);
    this.pinger.unref();
  }

  close() {
    clearInterval(this.pinger);
    for (const n of this.nodes.values()) n.ws.terminate();
    this.wss.close();
  }

  // ───────────── nodes ─────────────

  /** `server.on("upgrade", hub.upgrade)`: …/link becomes a node link, anything else is refused */
  upgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (!path.endsWith("/link")) return socket.destroy();
    const fwd = String(req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    const ip = (fwd || req.socket.remoteAddress || "").replace(/^::ffff:/, "").slice(0, 64);
    this.wss.handleUpgrade(req, socket, head, (ws) => this.link(ws, ip));
  };

  /** Settings changed: linked nodes that are no longer registered go, renamed ones take the new name */
  sync() {
    const reg = this.o.nodes();
    const blocked = this.o.blocked?.() ?? new Set<string>();
    for (const n of [...this.nodes.values()]) {
      const label = reg.get(n.address);
      if (!label || blocked.has(n.address)) {
        n.ws.send(JSON.stringify({ t: "error", message: "no longer registered on this platform" }));
        this.drop(n, "no longer registered");
      } else n.label = label;
    }
    for (const a of this.waiting.keys()) if (reg.has(a) || blocked.has(a)) this.waiting.delete(a);
  }

  /** The waiting nodes, newest attempt first */
  pending(): Waiting[] {
    return [...this.waiting.values()].sort((a, b) => b.last.localeCompare(a.last));
  }

  ignore(address: string) {
    const a = address.toLowerCase();
    this.ignored.add(a);
    this.waiting.delete(a);
  }

  private note(address: string, ip: string, h: { agent?: string; slots?: number }, models: NodeModel[]) {
    if (this.ignored.has(address)) return;
    const now = new Date().toISOString();
    const w = this.waiting.get(address);
    this.waiting.set(address, { address, ip, agent: String(h.agent ?? "").slice(0, 80), slots: Math.max(1, Math.min(64, Number(h.slots) || 1)), models: models.slice(0, 16), first: w?.first ?? now, last: now, attempts: (w?.attempts ?? 0) + 1 });
    if (this.waiting.size > MAX_WAITING) {
      const oldest = [...this.waiting.values()].sort((a, b) => a.last.localeCompare(b.last))[0];
      this.waiting.delete(oldest.address);
    }
  }

  private link(ws: WebSocket, ip = "") {
    const nonce = randomBytes(32).toString("hex");
    const refuse = (message: string) => {
      ws.send(JSON.stringify({ t: "error", message }));
      ws.close();
    };
    if (!this.o.enabled()) return refuse("Locutus supply is turned off on this platform");
    ws.send(JSON.stringify({ t: "challenge", v: 1, nonce, hub: this.o.name }));
    const timer = setTimeout(() => refuse("no hello"), this.o.helloMs ?? 15_000);
    ws.once("message", async (raw) => {
      clearTimeout(timer);
      let h: { t?: string; v?: number; address?: string; ts?: number; sig?: string; models?: NodeModel[]; slots?: number; agent?: string };
      try {
        h = JSON.parse(String(raw));
      } catch {
        return refuse("hello is not JSON");
      }
      const address = String(h.address ?? "").toLowerCase();
      if (h.t !== "hello" || h.v !== 1 || !/^0x[0-9a-f]{40}$/.test(address)) return refuse("bad hello");
      if (this.o.blocked?.().has(address)) return refuse(`address ${address} is blocked on this platform`);
      if (Math.abs(Date.now() / 1000 - Number(h.ts)) > 120) return refuse("clock differs from the platform's by more than 120 s");
      const ok = await verifyMessage({ address: address as Address, message: helloMessage(this.o.name, nonce, address, Number(h.ts)), signature: String(h.sig) as Hex }).catch(() => false);
      if (!ok) return refuse("signature does not match the address");
      const models = (Array.isArray(h.models) ? h.models : [])
        .filter((m) => m && typeof m.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/.test(m.id) && Array.isArray(m.formats))
        .map((m) => ({ id: m.id, sha256: String(m.sha256 ?? "").slice(0, 200), vision: !!m.vision, formats: m.formats.map(String).slice(0, 4), context: Number(m.context) || undefined }));
      const label = this.o.nodes().get(address);
      // signed but not registered: listed for an admin to approve (only proven addresses, so nobody can fill the list with others')
      if (!label) {
        this.note(address, ip, h, models);
        return refuse(`address ${address} is not registered on this platform yet; an admin can approve it in /admin`);
      }
      this.waiting.delete(address);
      // one link per node: a new one replaces the old (a restarted node should not wait for the old link to time out)
      const old = this.nodes.get(address);
      if (old) {
        old.ws.send(JSON.stringify({ t: "error", message: "replaced by a newer link" }));
        this.drop(old, "replaced by a newer link");
      }
      const node: Node = { ws, address, label, models, slots: Math.max(1, Math.min(64, Number(h.slots) || 1)), agent: String(h.agent ?? "").slice(0, 80), since: new Date(), jobs: new Set(), served: 0, badReceipts: 0, alive: true };
      this.nodes.set(address, node);
      ws.on("pong", () => (node.alive = true));
      ws.on("message", (m) => this.frame(node, m));
      ws.on("close", () => this.nodes.get(address) === node && this.drop(node, "link closed"));
      ws.on("error", () => undefined);
      ws.send(JSON.stringify({ t: "welcome", label }));
      this.log(`node ${label} (${address}) linked: ${models.map((m) => m.id).join(", ") || "no models"}, ${node.slots} slot(s), ${node.agent}`);
    });
  }

  /** the node is gone: its unfinished jobs fail */
  private drop(node: Node, why: string) {
    if (this.nodes.get(node.address) === node) this.nodes.delete(node.address);
    for (const id of node.jobs) this.finish(this.jobs.get(id), 503, `Locutus node ${node.label}: ${why}`);
    node.jobs.clear();
    node.ws.terminate();
    this.log(`node ${node.label} unlinked: ${why}`);
  }

  private frame(node: Node, raw: WebSocket.RawData) {
    node.alive = true;
    let f: { t?: string; id?: string; status?: number; type?: string; chunk?: string; message?: string; receipt?: Receipt };
    try {
      f = JSON.parse(String(raw));
    } catch {
      return;
    }
    const job = f.id ? this.jobs.get(f.id) : undefined;
    if (!job || job.node !== node) return;
    if (f.t === "head" && !job.head) {
      job.head = true;
      clearTimeout(job.timer);
      job.res.writeHead(Number(f.status) || 502, { "content-type": String(f.type || "application/json"), "x-sinobee-locutus-node": node.label });
      job.res.flushHeaders();
    } else if (f.t === "data" && job.head) {
      job.res.write(String(f.chunk ?? ""));
    } else if (f.t === "end") {
      void this.receipt(job, f.receipt);
      node.served++;
      this.finish(job);
    } else if (f.t === "fail") {
      this.finish(job, Number(f.status) || 502, `Locutus node ${node.label}: ${f.message ?? "failed"}`);
    }
  }

  private async receipt(job: Job, r: Receipt | undefined) {
    let ok = false;
    try {
      ok = !!r && r.id === job.id && r.request === job.requestHash && r.address?.toLowerCase() === job.node.address && (await verifyMessage({ address: job.node.address as Address, message: receiptMessage(r), signature: r.sig as Hex }));
    } catch {
      ok = false;
    }
    if (!ok) job.node.badReceipts++;
    this.log(`receipt ${ok ? "ok" : "INVALID"} ${job.node.label} ${job.model} in ${r?.prompt ?? "?"} out ${r?.output ?? "?"} (${job.id})`);
    if (r) this.o.onReceipt?.(r, ok, job.node.label);
  }

  /** End a job: after a head the stream just ends (or breaks, when it failed); before a head an error is sent */
  private finish(job: Job | undefined, status?: number, message?: string) {
    if (!job || !this.jobs.has(job.id)) return;
    this.jobs.delete(job.id);
    job.node.jobs.delete(job.id);
    clearTimeout(job.timer);
    const res = job.res;
    if (res.writableEnded) return;
    if (status === undefined) return void res.end();
    if (job.head) return void res.destroy(new Error(message)); // the relay sees a broken stream and settles what it got
    res.writeHead(status >= 500 || status === 429 ? 503 : status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message, type: status >= 500 || status === 429 ? "upstream_unavailable" : "invalid_request_error" } }));
  }

  // ───────────── the relay's side ─────────────

  private authorized(req: http.IncomingMessage) {
    const secret = this.o.secret();
    const got = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!secret || got.length !== secret.length) return false;
    return timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  }

  models() {
    const seen = new Map<string, NodeModel>();
    for (const n of this.nodes.values()) for (const m of n.models) if (!seen.has(m.id)) seen.set(m.id, m);
    return [...seen.values()];
  }

  status() {
    return [...this.nodes.values()].map((n) => ({ label: n.label, address: n.address, agent: n.agent, since: n.since.toISOString(), slots: n.slots, busy: n.jobs.size, served: n.served, badReceipts: n.badReceipts, models: n.models }));
  }

  /** The least busy node that serves this model in this format and has room */
  pick(model: string, format: string): Node | null {
    let best: Node | null = null;
    for (const n of this.nodes.values()) {
      if (!n.models.some((m) => m.id === model && m.formats.includes(format))) continue;
      if (n.jobs.size >= n.slots + QUEUE) continue;
      if (!best || n.jobs.size / n.slots < best.jobs.size / best.slots) best = n;
    }
    return best;
  }

  /** `http.createServer(hub.http)` */
  http = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (path === "/health") return void res.end("ok");
    if (!this.authorized(req)) return json(401, { error: { message: "invalid hub key", type: "authentication_error" } });
    if (req.method === "GET" && path === "/openai/models")
      return json(200, { object: "list", data: this.models().map((m) => ({ id: m.id, object: "model", owned_by: "locutus", context_length: m.context ?? null, vision: !!m.vision })) });
    if (req.method === "GET" && path === "/status") return json(200, { enabled: this.o.enabled(), nodes: this.status(), pending: this.pending() });
    if (req.method === "POST" && path === "/reload") {
      void (this.o.reload?.() ?? Promise.resolve()).then(
        () => (this.sync(), json(200, { enabled: this.o.enabled(), nodes: this.status(), pending: this.pending() })),
        (e) => json(500, { error: { message: (e as Error).message, type: "server_error" } }),
      );
      return;
    }
    if (req.method === "POST" && path === "/ignore") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          this.ignore(String(JSON.parse(Buffer.concat(chunks).toString("utf8")).address ?? ""));
          json(200, { ok: true });
        } catch {
          json(400, { error: { message: "JSON body required", type: "invalid_request_error" } });
        }
      });
      return;
    }
    const route = PATHS[path];
    if (req.method !== "POST" || !route) return json(404, { error: { message: `no route ${req.method} ${path}`, type: "invalid_request_error" } });
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let model = "";
      try {
        model = String(JSON.parse(body).model ?? "");
      } catch {
        return json(400, { error: { message: "JSON body required", type: "invalid_request_error" } });
      }
      const node = this.pick(model, route.format);
      if (!node) {
        const any = [...this.nodes.values()].some((n) => n.models.some((m) => m.id === model));
        return json(503, { error: { message: any ? `every Locutus node serving ${model} is busy` : `no Locutus node serving ${model} is connected`, type: "upstream_unavailable" } });
      }
      const id = randomUUID();
      const job: Job = { id, node, res, model, requestHash: createHash("sha256").update(body, "utf8").digest("hex"), head: false };
      job.timer = setTimeout(() => {
        node.ws.send(JSON.stringify({ t: "cancel", id }));
        this.finish(job, 503, `Locutus node ${node.label} did not start answering in time`);
      }, this.o.headMs ?? 300_000);
      this.jobs.set(id, job);
      node.jobs.add(id);
      // the relay went away (its caller closed): stop the node's work too
      res.on("close", () => {
        if (this.jobs.has(id)) {
          node.ws.send(JSON.stringify({ t: "cancel", id }));
          this.finish(job);
        }
      });
      node.ws.send(JSON.stringify({ t: "job", id, path: route.path, body }));
    });
  };
}
