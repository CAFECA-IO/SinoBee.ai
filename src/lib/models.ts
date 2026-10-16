import { db } from "./db";
import { HttpError } from "./errors";
import { DEFAULT_MODELS, type ModelInfo } from "./pricing";
import { audit } from "./roles";
import { publishedTwd } from "./price-math";

/**
 * Model prices, kept in the ModelPrice table with full history.
 *
 *   published price (TWD per 1M tokens) = vendor USD × FX rate × buffer
 *
 * The FX rate (default 32.5) and the buffer (default 1.08) are site settings; every price row snapshots the
 * values in force when it was saved, so old rows keep the price they were published with. The row in force for
 * a model is the latest one with effectiveAt <= now. The pricing page, the admin backend, the task form and
 * (later) subscription quota accounting all read from here, so they can never disagree.
 */

export const PRICE_KINDS = ["input", "cacheRead", "cacheWrite", "output"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];
export type Prices = Record<PriceKind, number>;

export type ModelPriceView = {
  rowId: string;
  modelId: string;
  label: string;
  vendor: string;
  usd: Prices;
  fx: number;
  buffer: number;
  /** published, TWD per 1M tokens */
  twd: Prices;
  enabled: boolean;
  sortOrder: number;
  effectiveAt: Date;
};

export const DEFAULT_FX = 32.5;
export const DEFAULT_BUFFER = 1.08;
const FX_KEY = "pricing.fx";
const BUFFER_KEY = "pricing.buffer";

export { publishedTwd, formatPrice } from "./price-math";

export async function pricingSettings(): Promise<{ fx: number; buffer: number }> {
  const rows = await db.siteSetting.findMany({ where: { key: { in: [FX_KEY, BUFFER_KEY] } } });
  const get = (k: string, d: number) => {
    const v = Number(rows.find((r) => r.key === k)?.value);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return { fx: get(FX_KEY, DEFAULT_FX), buffer: get(BUFFER_KEY, DEFAULT_BUFFER) };
}

type Row = Awaited<ReturnType<typeof db.modelPrice.findMany>>[number];

function view(r: Row): ModelPriceView {
  const fx = Number(r.fxRate);
  const buffer = Number(r.buffer);
  const usd: Prices = { input: Number(r.inputUsd), cacheRead: Number(r.cacheReadUsd), cacheWrite: Number(r.cacheWriteUsd), output: Number(r.outputUsd) };
  const twd = Object.fromEntries(PRICE_KINDS.map((k) => [k, publishedTwd(usd[k], fx, buffer)])) as Prices;
  return { rowId: r.id, modelId: r.modelId, label: r.label, vendor: r.vendor, usd, fx, buffer, twd, enabled: r.enabled, sortOrder: r.sortOrder, effectiveAt: r.effectiveAt };
}

/** Copy DEFAULT_MODELS into an empty table (seed, fresh installs, tests) */
export async function ensureModelPrices() {
  if ((await db.modelPrice.count()) > 0) return;
  const { fx, buffer } = await pricingSettings();
  const at = new Date(0);
  await db.modelPrice.createMany({
    data: DEFAULT_MODELS.map((m, i) => ({
      modelId: m.id, label: m.label, vendor: m.vendor,
      inputUsd: m.input, cacheReadUsd: m.cacheRead, cacheWriteUsd: m.cacheWrite, outputUsd: m.output,
      fxRate: fx, buffer, sortOrder: i * 10, effectiveAt: at,
    })),
  });
}

// Short cache shared by every module copy in this process (Next bundles route handlers and pages separately,
// so a module-level variable would not see the invalidation from an admin save). Other processes (the worker)
// see a change within CACHE_MS.
const CACHE_MS = 10_000;
const g = globalThis as unknown as { __sbModelPrices?: { at: number; rows: Row[] } | null };
export const invalidateModelCache = () => {
  g.__sbModelPrices = null;
};

async function allRows(): Promise<Row[]> {
  const c = g.__sbModelPrices;
  if (c && Date.now() - c.at < CACHE_MS) return c.rows;
  await ensureModelPrices();
  const rows = await db.modelPrice.findMany({ orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] });
  g.__sbModelPrices = { at: Date.now(), rows };
  return rows;
}

/** Price rows in force at `at`, one per model (including withdrawn ones), sorted for display */
export async function pricesAt(at = new Date()): Promise<ModelPriceView[]> {
  const seen = new Map<string, ModelPriceView>();
  for (const r of await allRows()) if (r.effectiveAt <= at && !seen.has(r.modelId)) seen.set(r.modelId, view(r));
  return [...seen.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

/** Models offered now (enabled), with their published prices */
export async function currentModels(): Promise<ModelPriceView[]> {
  return (await pricesAt()).filter((m) => m.enabled);
}

/** Rows that take effect later (admin view) */
export async function scheduledPrices(now = new Date()): Promise<ModelPriceView[]> {
  return (await allRows()).filter((r) => r.effectiveAt > now).map(view).sort((a, b) => +a.effectiveAt - +b.effectiveAt);
}

export async function priceHistory(modelId: string): Promise<ModelPriceView[]> {
  return (await db.modelPrice.findMany({ where: { modelId }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] })).map(view);
}

/** Lookup map for labels/vendors of every model ever priced (old tasks keep showing a name) */
export async function modelCatalog(): Promise<Map<string, ModelPriceView>> {
  const m = new Map<string, ModelPriceView>();
  for (const v of await pricesAt(new Date(8.64e15))) m.set(v.modelId, v);
  for (const v of await pricesAt()) m.set(v.modelId, v);
  return m;
}

export const modelLabel = (cat: Map<string, ModelPriceView>, id: string) => cat.get(id)?.label ?? id;

/** Vendor USD prices in the shape the task cost code expects */
export const asModelInfo = (v: ModelPriceView): ModelInfo => ({ id: v.modelId, label: v.label, vendor: v.vendor, ...v.usd });

export async function offeredModel(modelId: string): Promise<ModelPriceView | undefined> {
  return (await currentModels()).find((m) => m.modelId === modelId);
}

// ───────────── admin writes ─────────────

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const usdOk = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100_000;

export type PriceInput = {
  modelId: string;
  label: string;
  vendor: string;
  usd: Prices;
  enabled: boolean;
  sortOrder?: number;
  /** defaults to now; a future date schedules the change */
  effectiveAt?: Date;
};

/** Save a new price row (history is never rewritten). FX and buffer come from the current settings. */
export async function savePrice(actorId: string, p: PriceInput) {
  if (!MODEL_ID.test(p.modelId)) throw new HttpError(400, "model id must look like provider/model");
  if (!p.label.trim() || !p.vendor.trim()) throw new HttpError(400, "label and vendor are required");
  for (const k of PRICE_KINDS) if (!usdOk(p.usd[k])) throw new HttpError(400, `invalid ${k} price`);
  const effectiveAt = p.effectiveAt ?? new Date();
  if (Number.isNaN(+effectiveAt)) throw new HttpError(400, "invalid effective date");
  if (+effectiveAt < Date.now() - 60_000) throw new HttpError(400, "effective date cannot be in the past");
  const { fx, buffer } = await pricingSettings();
  const prev = (await pricesAt(new Date(8.64e15))).find((m) => m.modelId === p.modelId);
  const row = await db.modelPrice.create({
    data: {
      modelId: p.modelId, label: p.label.trim(), vendor: p.vendor.trim(),
      inputUsd: p.usd.input, cacheReadUsd: p.usd.cacheRead, cacheWriteUsd: p.usd.cacheWrite, outputUsd: p.usd.output,
      fxRate: fx, buffer, enabled: p.enabled, sortOrder: p.sortOrder ?? prev?.sortOrder ?? 1000, effectiveAt, createdById: actorId,
    },
  });
  invalidateModelCache();
  await audit(actorId, prev ? "price.update" : "price.create", { type: "model", id: p.modelId }, {
    usd: p.usd, fx, buffer, enabled: p.enabled, effectiveAt: effectiveAt.toISOString(), previous: prev ? { usd: prev.usd, fx: prev.fx, buffer: prev.buffer, enabled: prev.enabled } : null,
  });
  return view(row);
}

/**
 * Change the FX rate and/or buffer. Every model in force gets a new row at the new rate, effective at `effectiveAt`,
 * so the published table changes in one step and the history shows why.
 */
export async function savePricingSettings(actorId: string, s: { fx: number; buffer: number; effectiveAt?: Date }) {
  if (!(s.fx >= 1 && s.fx <= 1000)) throw new HttpError(400, "FX rate out of range");
  if (!(s.buffer >= 1 && s.buffer <= 3)) throw new HttpError(400, "buffer must be between 1 and 3");
  const effectiveAt = s.effectiveAt ?? new Date();
  if (+effectiveAt < Date.now() - 60_000) throw new HttpError(400, "effective date cannot be in the past");
  const before = await pricingSettings();
  const models = await pricesAt(new Date(8.64e15));
  await db.$transaction([
    db.siteSetting.upsert({ where: { key: FX_KEY }, create: { key: FX_KEY, value: String(s.fx) }, update: { value: String(s.fx) } }),
    db.siteSetting.upsert({ where: { key: BUFFER_KEY }, create: { key: BUFFER_KEY, value: String(s.buffer) }, update: { value: String(s.buffer) } }),
    ...models.map((m) =>
      db.modelPrice.create({
        data: {
          modelId: m.modelId, label: m.label, vendor: m.vendor,
          inputUsd: m.usd.input, cacheReadUsd: m.usd.cacheRead, cacheWriteUsd: m.usd.cacheWrite, outputUsd: m.usd.output,
          fxRate: s.fx, buffer: s.buffer, enabled: m.enabled, sortOrder: m.sortOrder, effectiveAt, createdById: actorId,
        },
      }),
    ),
  ]);
  invalidateModelCache();
  await audit(actorId, "pricing.settings", { type: "site", id: "pricing" }, { before, after: { fx: s.fx, buffer: s.buffer }, effectiveAt: effectiveAt.toISOString(), models: models.length });
}

/** Cheapest model for quota display: blended price (3 × input + 1 × output) ÷ 4, TWD per 1M tokens */
export async function cheapestBlended(): Promise<{ model: ModelPriceView; blendedTwd: number } | null> {
  let best: { model: ModelPriceView; blendedTwd: number } | null = null;
  for (const m of await currentModels()) {
    const b = (3 * m.twd.input + m.twd.output) / 4;
    if (b > 0 && (!best || b < best.blendedTwd)) best = { model: m, blendedTwd: b };
  }
  return best;
}

/** Allowances are shown as tokens of this model, at its published price right now */
export const TOKEN_REFERENCE_MODEL = "anthropic/claude-sonnet-5-5";

/**
 * TWD per 1M tokens (input : output = 3 : 1) of Claude Sonnet 5.5 at the price in effect now, for turning a TWD
 * allowance into a token count. Falls back to the cheapest offered model if Sonnet 5.5 is not offered.
 */
export async function referenceBlended(): Promise<{ model: ModelPriceView; blendedTwd: number } | null> {
  const m = (await currentModels()).find((x) => x.modelId === TOKEN_REFERENCE_MODEL);
  const b = m ? (3 * m.twd.input + m.twd.output) / 4 : 0;
  return m && b > 0 ? { model: m, blendedTwd: b } : cheapestBlended();
}

/** model id → label, for display (server components) */
export async function modelLabels(): Promise<Record<string, string>> {
  return Object.fromEntries([...(await modelCatalog()).values()].map((m) => [m.modelId, m.label]));
}
