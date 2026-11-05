/**
 * /admin → 模型定價 → Locutus card: the registered nodes, the nodes waiting for approval (they linked with a valid
 * signature but are not registered), and every Locutus model with the nodes that serve it, its price and whether it
 * is offered. The hub runs in its own process; this module talks to it over its local HTTP port.
 */
import { config } from "../config";
import { HttpError } from "../errors";
import { pricesAt, savePrice } from "../models";
import { saveSetting } from "../settings/store";
import { sv, svBool, svList } from "../settings/cache";
import { parseNodes, type NodeModel, type Waiting } from "./hub";

export type LinkedNode = { label: string; address: string; agent: string; since: string; slots: number; busy: number; served: number; badReceipts: number; models: NodeModel[] };
type HubStatus = { enabled: boolean; nodes: LinkedNode[]; pending: Waiting[] };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** node names go into a comma-separated setting as "0x…=name" */
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

function hubBase() {
  const base = config.llm.providers.locutus?.base ?? "";
  return base ? base.replace(/\/openai$/, "") : "";
}

async function hub<T>(path: string, body?: unknown): Promise<T> {
  const base = hubBase();
  if (!base) throw new HttpError(409, "Locutus supply is turned off (locutus.enabled)");
  const r = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${config.llm.providers.locutus.key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new HttpError(502, `Locutus hub: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** Tell the hub the settings changed (it also re-reads them every 30 s, so a failure here only delays it) */
async function reload() {
  await hub("/reload", {}).catch(() => undefined);
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const titled = (id: string) => id.replace(/[-_]+/g, " ").replace(/\b([a-z])/g, (c) => c.toUpperCase());

export async function locutusOverview() {
  const enabled = svBool("locutus.enabled");
  let status: HubStatus = { enabled, nodes: [], pending: [] };
  let hubError: string | null = null;
  if (enabled) {
    try {
      status = await hub<HubStatus>("/status");
    } catch (e) {
      hubError = (e as Error).message;
    }
  }
  const registered = parseNodes(svList("locutus.nodes"));
  const linked = new Map(status.nodes.map((n) => [n.address, n]));
  const nodes = [...registered].map(([address, label]) => {
    const n = linked.get(address);
    return { address, short: short(address), label, linked: !!n, since: n?.since ?? null, agent: n?.agent ?? null, slots: n?.slots ?? null, busy: n?.busy ?? 0, served: n?.served ?? 0, badReceipts: n?.badReceipts ?? 0, models: n?.models.map((m) => m.id) ?? [] };
  });

  // every Locutus model: priced ones (offered or not) and the ones linked nodes serve
  const rows = (await pricesAt(new Date(8.64e15))).filter((m) => m.modelId.startsWith("locutus/"));
  const ids = new Set([...rows.map((m) => m.modelId), ...status.nodes.flatMap((n) => n.models.map((m) => `locutus/${m.id}`))]);
  const models = [...ids].sort().map((modelId) => {
    const bare = modelId.slice("locutus/".length);
    const row = rows.find((m) => m.modelId === modelId);
    const serving = status.nodes.filter((n) => n.models.some((m) => m.id === bare));
    const decl = serving.flatMap((n) => n.models.filter((m) => m.id === bare));
    return {
      modelId,
      label: row?.label ?? titled(bare),
      vision: decl.some((m) => m.vision),
      context: decl.length ? Math.max(...decl.map((m) => m.context ?? 0)) || null : null,
      nodes: serving.map((n) => n.label),
      slots: serving.reduce((s, n) => s + n.slots, 0),
      priced: !!row,
      enabled: row?.enabled ?? false,
      usd: row ? { input: row.usd.input, output: row.usd.output } : { input: 0, output: 0 },
    };
  });
  const pending = status.pending.map((w) => ({ ...w, short: short(w.address) }));
  return { enabled, publicUrl: sv("locutus.publicUrl"), hubError, nodes, pending, blocked: svList("locutus.blocked").map((a) => a.toLowerCase()), models };
}

function checkAddress(a: string) {
  if (!ADDRESS.test(a)) throw new HttpError(400, "the address must be 0x followed by 40 hex digits (locutusd init shows it)");
  return a.toLowerCase();
}
function checkLabel(l: string) {
  if (!LABEL.test(l)) throw new HttpError(400, "the name may use letters, digits, . _ - (up to 40, no spaces)");
  return l;
}

async function writeNodes(actorId: string, nodes: Map<string, string>) {
  await saveSetting(actorId, "locutus.nodes", [...nodes].map(([a, l]) => `${a}=${l}`).join(","));
}
async function writeBlocked(actorId: string, blocked: Set<string>) {
  await saveSetting(actorId, "locutus.blocked", [...blocked].join(","));
}

/** Register (or rename) a node. `offer`: also offer the models it declared, at price 0 when they have none yet. */
export async function registerNode(actorId: string, address: string, label: string, offer = false) {
  const a = checkAddress(address);
  const l = checkLabel(label);
  const nodes = parseNodes(svList("locutus.nodes"));
  if ([...nodes].some(([x, y]) => y === l && x !== a)) throw new HttpError(409, `another node is already called ${l}`);
  nodes.set(a, l);
  await writeNodes(actorId, nodes);
  const blocked = new Set(svList("locutus.blocked").map((x) => x.toLowerCase()));
  if (blocked.delete(a)) await writeBlocked(actorId, blocked);
  let offered: string[] = [];
  if (offer) {
    const waiting = (await hub<HubStatus>("/status").catch(() => null))?.pending.find((w) => w.address === a);
    offered = await offerModels(actorId, (waiting?.models ?? []).map((m) => `locutus/${m.id}`));
  }
  await reload();
  return { address: a, label: l, offered };
}

async function offerModels(actorId: string, modelIds: string[]) {
  const rows = await pricesAt(new Date(8.64e15));
  const out: string[] = [];
  for (const modelId of modelIds) {
    const row = rows.find((m) => m.modelId === modelId);
    if (row?.enabled) continue;
    const usd = row?.usd ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    await savePrice(actorId, { modelId, label: row?.label ?? titled(modelId.slice("locutus/".length)), vendor: row?.vendor ?? "Locutus", usd, enabled: true });
    out.push(modelId);
  }
  return out;
}

export async function removeNode(actorId: string, address: string) {
  const a = checkAddress(address);
  const nodes = parseNodes(svList("locutus.nodes"));
  if (!nodes.delete(a)) throw new HttpError(404, "not a registered node");
  await writeNodes(actorId, nodes);
  await reload();
}

/** Refuse an address for good: unregistered and no longer listed as waiting */
export async function blockNode(actorId: string, address: string) {
  const a = checkAddress(address);
  const nodes = parseNodes(svList("locutus.nodes"));
  if (nodes.delete(a)) await writeNodes(actorId, nodes);
  const blocked = new Set(svList("locutus.blocked").map((x) => x.toLowerCase()));
  blocked.add(a);
  await writeBlocked(actorId, blocked);
  await reload();
}

export async function unblockNode(actorId: string, address: string) {
  const a = checkAddress(address);
  const blocked = new Set(svList("locutus.blocked").map((x) => x.toLowerCase()));
  if (!blocked.delete(a)) throw new HttpError(404, "not blocked");
  await writeBlocked(actorId, blocked);
  await reload();
}

/** Hide a waiting node until the hub restarts (it keeps retrying; block it to refuse it for good) */
export async function ignoreNode(address: string) {
  await hub("/ignore", { address: checkAddress(address) });
}

/** Price and offer one Locutus model from the card (USD per 1M tokens; Locutus has no cache pricing) */
export async function setModel(actorId: string, p: { modelId: string; label?: string; input: number; output: number; enabled: boolean }) {
  if (!p.modelId.startsWith("locutus/")) throw new HttpError(400, "not a Locutus model");
  const row = (await pricesAt(new Date(8.64e15))).find((m) => m.modelId === p.modelId);
  return savePrice(actorId, {
    modelId: p.modelId,
    label: p.label?.trim() || row?.label || titled(p.modelId.slice("locutus/".length)),
    vendor: row?.vendor ?? "Locutus",
    usd: { input: p.input, cacheRead: p.input, cacheWrite: p.input, output: p.output },
    enabled: p.enabled,
  });
}
