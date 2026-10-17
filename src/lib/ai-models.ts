import { db } from "./db";
import { config } from "./config";
import { HttpError } from "./errors";
import { audit } from "./roles";
import { pricesAt, savePrice, PRICE_KINDS, type Prices } from "./models";

/**
 * AI models SinoBee itself uses, configured in /admin → AI 模型:
 *  - the catalog: the models each provider's API says exist (synced from GET /models, never typed by hand)
 *  - tiers: high / standard / light, each an ordered list (primary first, then fallbacks)
 *  - jobs: which tier each platform job uses (spec drafting, screening, checklist edits, price lookups)
 * Both are stored as JSON in SiteSetting.
 */

export const TIERS = ["high", "standard", "light"] as const;
export type Tier = (typeof TIERS)[number];
export const JOBS = ["spec", "screening", "checklist", "pricing"] as const;
export type Job = (typeof JOBS)[number];
export const MAX_PER_TIER = 4;

export type TierConfig = { tiers: Record<Tier, string[]>; jobs: Record<Job, Tier> };
export const DEFAULT_TIERS: TierConfig = {
  tiers: { high: [], standard: [], light: [] },
  jobs: { spec: "high", screening: "standard", checklist: "light", pricing: "standard" },
};

export type CatalogModel = { id: string; label: string };
export type ProviderCatalog = { at: string; models: CatalogModel[]; error?: string };
export type Catalog = Record<string, ProviderCatalog>;

const TIERS_KEY = "ai.tiers";
const CATALOG_KEY = "ai.catalog";

const g = globalThis as unknown as { __sbAi?: { at: number; tiers: TierConfig; catalog: Catalog } | null };
const CACHE_MS = 10_000;

async function load() {
  const c = g.__sbAi;
  if (c && Date.now() - c.at < CACHE_MS) return c;
  const rows = await db.siteSetting.findMany({ where: { key: { in: [TIERS_KEY, CATALOG_KEY] } } });
  const parse = <T,>(k: string, d: T): T => {
    try {
      const v = rows.find((r) => r.key === k)?.value;
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  };
  const raw = parse<Partial<TierConfig>>(TIERS_KEY, {});
  const tiers: TierConfig = {
    tiers: Object.fromEntries(TIERS.map((t) => [t, Array.isArray(raw.tiers?.[t]) ? raw.tiers![t].filter((x) => typeof x === "string") : []])) as Record<Tier, string[]>,
    jobs: Object.fromEntries(JOBS.map((j) => [j, TIERS.includes(raw.jobs?.[j] as Tier) ? raw.jobs![j] : DEFAULT_TIERS.jobs[j]])) as Record<Job, Tier>,
  };
  const fresh = { at: Date.now(), tiers, catalog: parse<Catalog>(CATALOG_KEY, {}) };
  g.__sbAi = fresh;
  return fresh;
}

const put = (key: string, value: unknown) => db.siteSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });

export async function tierConfig(): Promise<TierConfig> {
  return (await load()).tiers;
}
export async function modelCatalogFromApi(): Promise<Catalog> {
  return (await load()).catalog;
}

/** The ordered models for a job: its tier's list (primary, then fallbacks); [] = not configured (automatic) */
export async function modelsForJob(job: Job): Promise<string[]> {
  const c = await tierConfig();
  return c.tiers[c.jobs[job]];
}

export async function saveTierConfig(actorId: string, input: TierConfig) {
  const catalog = await modelCatalogFromApi();
  const known = new Set(Object.entries(catalog).flatMap(([p, c]) => c.models.map((m) => `${p}/${m.id}`)));
  const tiers = {} as Record<Tier, string[]>;
  for (const t of TIERS) {
    const list = [...new Set((input.tiers?.[t] ?? []).map((s) => String(s).trim()).filter(Boolean))];
    if (list.length > MAX_PER_TIER) throw new HttpError(400, `at most ${MAX_PER_TIER} models per tier`);
    for (const id of list) {
      const provider = id.split("/")[0];
      // only models the provider's API listed (when that provider has been synced)
      if (!config.llm.providers[provider]) throw new HttpError(400, `unknown provider in ${id}`);
      if (catalog[provider]?.models.length && !known.has(id)) throw new HttpError(400, `${id} is not in ${provider}'s model list; sync the list first`);
    }
    tiers[t] = list;
  }
  const jobs = Object.fromEntries(JOBS.map((j) => [j, TIERS.includes(input.jobs?.[j]) ? input.jobs[j] : DEFAULT_TIERS.jobs[j]])) as Record<Job, Tier>;
  const before = await tierConfig();
  await put(TIERS_KEY, { tiers, jobs });
  g.__sbAi = null;
  await audit(actorId, "ai.tiers", { type: "site", id: "ai" }, { before, after: { tiers, jobs } });
  // every model the platform may use needs a price row so its calls can be charged
  const priced = new Set((await pricesAt(new Date(8.64e15))).map((m) => m.modelId));
  const missing = [...new Set(Object.values(tiers).flat())].filter((id) => !priced.has(id));
  return { tiers, jobs, missingPrices: missing };
}

// ───────────── provider model lists ─────────────

/** Models that cannot answer a chat request (embeddings, speech, images, moderation, legacy completions…) */
const NOT_CHAT = /(embed|tts|whisper|transcribe|dall-e|image|imagen|veo|audio|realtime|moderation|davinci|babbage|aqa|search-preview|computer-use|-live|lyria|robotics)/i;

async function fetchJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  let j: unknown = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!r.ok) {
    const o = (Array.isArray(j) ? j[0] : j) as { error?: { message?: string } } | null;
    throw new Error(`${r.status} ${o?.error?.message ?? text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }
  return j as Record<string, unknown>;
}

export async function listProviderModels(provider: string): Promise<CatalogModel[]> {
  const p = config.llm.providers[provider];
  if (!p?.key) throw new Error("no API key");
  const out: CatalogModel[] = [];
  if (p.kind === "anthropic") {
    let after = "";
    for (let page = 0; page < 10; page++) {
      const j = (await fetchJson(`${p.base}/v1/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`, { "x-api-key": p.key, "anthropic-version": "2023-06-01" })) as { data?: { id: string; display_name?: string }[]; has_more?: boolean; last_id?: string };
      for (const m of j.data ?? []) out.push({ id: m.id, label: m.display_name || m.id });
      if (!j.has_more || !j.last_id) break;
      after = j.last_id;
    }
  } else {
    const j = (await fetchJson(`${p.base}/models`, { authorization: `Bearer ${p.key}` })) as { data?: { id: string; display_name?: string }[] };
    for (const m of j.data ?? []) {
      // Gemini's OpenAI endpoint lists "models/gemini-…" but expects the bare name in requests
      const id = m.id.replace(/^models\//, "");
      out.push({ id, label: m.display_name || id });
    }
  }
  const seen = new Set<string>();
  return out
    .filter((m) => !NOT_CHAT.test(m.id) && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Ask every provider with an API key for its model list; providers without a key are dropped from the catalog */
export async function syncCatalog(actorId: string | null): Promise<Catalog> {
  const previous = await modelCatalogFromApi();
  const catalog: Catalog = {};
  await Promise.all(
    Object.keys(config.llm.providers).map(async (provider) => {
      if (!config.llm.providers[provider].key) return;
      const at = new Date().toISOString();
      try {
        catalog[provider] = { at, models: await listProviderModels(provider) };
      } catch (e) {
        // keep the last good list, with the error, so one outage does not empty the pickers
        catalog[provider] = { at, models: previous[provider]?.models ?? [], error: (e as Error).message.slice(0, 300) };
      }
    }),
  );
  await put(CATALOG_KEY, catalog);
  g.__sbAi = null;
  if (actorId) await audit(actorId, "ai.catalog.sync", { type: "site", id: "ai" }, Object.fromEntries(Object.entries(catalog).map(([p, c]) => [p, c.error ?? c.models.length])));
  return catalog;
}

// ───────────── prices looked up by AI ─────────────

export type PriceGuess = { modelId: string; label: string; vendor: string; usd: Prices; note?: string };
const VENDOR: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google", deepseek: "DeepSeek" };

/**
 * Add models from the catalog to Model prices with list prices looked up by the platform model (pricing job; with web
 * search where the provider supports it). The rows are saved withdrawn (not offered) so an admin checks the prices
 * before offering them; the platform can already use them for its own jobs.
 */
export async function addModelsWithAiPrices(actorId: string, modelIds: string[]): Promise<PriceGuess[]> {
  const ids = [...new Set(modelIds.map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, "pick at least one model");
  if (ids.length > 20) throw new HttpError(400, "at most 20 models at a time");
  const catalog = await modelCatalogFromApi();
  const label = (id: string) => catalog[id.split("/")[0]]?.models.find((m) => `${id.split("/")[0]}/${m.id}` === id)?.label ?? id.split("/").slice(1).join("/");
  const guesses = await lookUpPrices(ids.map((id) => ({ id, label: label(id) })));
  const priced = new Map((await pricesAt(new Date(8.64e15))).map((m) => [m.modelId, m]));
  const saved: PriceGuess[] = [];
  for (const id of ids) {
    const gss = guesses.get(id);
    const usd = gss?.usd ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    const prev = priced.get(id);
    await savePrice(actorId, { modelId: id, label: prev?.label ?? label(id), vendor: prev?.vendor ?? VENDOR[id.split("/")[0]] ?? id.split("/")[0], usd, enabled: prev?.enabled ?? false });
    saved.push({ modelId: id, label: prev?.label ?? label(id), vendor: VENDOR[id.split("/")[0]] ?? "", usd, note: gss?.note ?? (gss ? undefined : "price not found") });
  }
  await audit(actorId, "ai.prices.lookup", { type: "site", id: "ai" }, { models: saved.map((s) => ({ id: s.modelId, usd: s.usd, note: s.note })) });
  return saved;
}

async function lookUpPrices(models: { id: string; label: string }[]): Promise<Map<string, { usd: Prices; note?: string }>> {
  const { platformChat } = await import("./platform-model");
  const system = [
    "You look up the official API list prices of AI models.",
    "For each model give the provider's standard (non-batch) price in USD per 1 million tokens: input, cached input read (cacheRead), cache write (cacheWrite; use the input price when the provider has no separate cache-write price) and output.",
    "Use the provider's official pricing page. If a price has tiers by prompt length, use the lowest tier. If you cannot find a model, set found=false.",
    'Answer with ONE JSON object only: {"models":[{"id":"<id as given>","found":true,"input":0,"cacheRead":0,"cacheWrite":0,"output":0,"note":"<source or caveat, short>"}]}',
  ].join("\n");
  const user = `Models (provider/model id — name):\n${models.map((m) => `${m.id} — ${m.label}`).join("\n")}`;
  const { text } = await platformChat({ job: "pricing", system, messages: [{ role: "user", content: user }], maxTokens: 4000, webSearch: true });
  const out = new Map<string, { usd: Prices; note?: string }>();
  let parsed: { models?: Record<string, unknown>[] };
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new HttpError(502, "the AI did not return prices; try again");
  }
  for (const m of parsed.models ?? []) {
    if (m.found === false || typeof m.id !== "string") continue;
    const usd = Object.fromEntries(PRICE_KINDS.map((k) => [k, Number(m[k])])) as Prices;
    if (PRICE_KINDS.some((k) => !Number.isFinite(usd[k]) || usd[k] < 0 || usd[k] > 10_000) || !(usd.input > 0 || usd.output > 0)) continue;
    out.set(m.id, { usd, note: typeof m.note === "string" ? m.note.slice(0, 200) : undefined });
  }
  return out;
}

export const invalidateAiCache = () => {
  g.__sbAi = null;
};

// A price lookup can take a minute or more (web search), longer than proxies wait: it runs in the background and
// the admin page polls priceLookupState().
type PriceJob = { state: "running" | "done" | "error"; at: number; models: string[]; result?: PriceGuess[]; error?: string };
const pj = globalThis as unknown as { __sbPriceJob?: PriceJob };

export function priceLookupState(): PriceJob | { state: "idle" } {
  const j = pj.__sbPriceJob;
  if (!j || (j.state === "running" && Date.now() - j.at > 15 * 60_000)) return { state: "idle" };
  return j;
}

export function startPriceLookup(actorId: string, modelIds: string[]) {
  if (pj.__sbPriceJob?.state === "running" && Date.now() - pj.__sbPriceJob.at < 15 * 60_000) throw new HttpError(409, "a price lookup is already running");
  const job: PriceJob = { state: "running", at: Date.now(), models: modelIds };
  pj.__sbPriceJob = job;
  void addModelsWithAiPrices(actorId, modelIds).then(
    (result) => Object.assign(job, { state: "done", result }),
    (e) => Object.assign(job, { state: "error", error: (e as Error).message.slice(0, 600) }),
  );
  return { state: "running" as const };
}
