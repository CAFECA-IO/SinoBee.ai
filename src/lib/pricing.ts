import { config } from "./config";

/**
 * Billing rules for commissioned tasks (shown on /pricing):
 *   charge (TWD) = token cost USD × FX × buffer          ← exactly the published model price (same table as subscriptions)
 *                + (VM rental USD + S3 storage USD) × FX × markup
 * Token cost = uncached input × input + cache reads × cacheRead + cache writes × cacheWrite + output × output, using the
 * vendor USD prices snapshotted on the task when it was created (ModelPrice row in force then).
 * FX (base rate, e.g. 32.5) and buffer (1.08) are the site pricing settings, also snapshotted on the task.
 * VM cost = runtime seconds × hourly on-demand price of one task slot; S3 = size × retention × GB-month + requests.
 */

export type ModelInfo = {
  id: string; // provider/model as SinoBee expects (SINOBEE_MODEL)
  label: string;
  vendor: string;
  /** vendor USD per 1M tokens */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

/**
 * Starting price list, copied into the ModelPrice table by the seed (and on first use when the table is empty).
 * After that the admin backend (/admin?tab=models) is the only source; see src/lib/models.ts.
 * Prices mirror sinobee/pricing.py (checked 2026-10-13). Vendors that don't bill cache writes: cacheWrite = input.
 */
export const DEFAULT_MODELS: ModelInfo[] = [
  { id: "anthropic/claude-opus-5-5", label: "Claude Opus 5.5", vendor: "Anthropic", input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 },
  { id: "anthropic/claude-sonnet-5-5", label: "Claude Sonnet 5.5", vendor: "Anthropic", input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
  { id: "anthropic/claude-haiku-5-5", label: "Claude Haiku 5.5", vendor: "Anthropic", input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 },
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol", vendor: "OpenAI", input: 5, cacheRead: 0.5, cacheWrite: 5, output: 30 },
  { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra", vendor: "OpenAI", input: 2, cacheRead: 0.2, cacheWrite: 2, output: 12 },
  { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna", vendor: "OpenAI", input: 0.2, cacheRead: 0.02, cacheWrite: 0.2, output: 1.2 },
  { id: "gemini/gemini-3.1-pro", label: "Gemini 3.1 Pro", vendor: "Google", input: 2, cacheRead: 0.2, cacheWrite: 2, output: 12 },
  { id: "gemini/gemini-3.8-flash", label: "Gemini 3.8 Flash", vendor: "Google", input: 0.75, cacheRead: 0.075, cacheWrite: 0.75, output: 3.75 },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", vendor: "DeepSeek", input: 0.66, cacheRead: 0.022, cacheWrite: 0.66, output: 1.98 },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", vendor: "DeepSeek", input: 0.15, cacheRead: 0.003, cacheWrite: 0.15, output: 0.6 },
];

export type UsdPrices = { input: number; cacheRead: number; cacheWrite: number; output: number };
export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };

/** Vendor USD cost of token usage. inputTokens is the TOTAL prompt size (cached and cache-write tokens included). */
export function tokenCostUsd(p: UsdPrices | Pick<ModelInfo, "input" | "output"> | undefined, u: TokenUsage): number {
  if (!p) return 0;
  const cr = u.cacheReadTokens ?? 0;
  const cw = u.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, u.inputTokens - cr - cw);
  const q = p as Partial<UsdPrices> & { input: number; output: number };
  return (uncached * q.input + cr * (q.cacheRead ?? q.input) + cw * (q.cacheWrite ?? q.input) + u.outputTokens * q.output) / 1_000_000;
}

export function vmCostUsd(seconds: number): number {
  return (seconds / 3600) * config.pricing.vmHourlyUsd;
}

/** S3 cost for storing `bytes` for `days`, plus `puts` and `gets` requests */
export function s3CostUsd(bytes: number, days: number, puts = 1, gets = 0): number {
  const gb = bytes / 1024 ** 3;
  return gb * config.pricing.s3GbMonthUsd * (days / 30) + (puts / 1000) * config.pricing.s3PutPer1kUsd + (gets / 1000) * config.pricing.s3GetPer1kUsd;
}

export type CostBreakdown = { tokenUsd: number; vmUsd: number; s3Usd: number };

/**
 * TWD to charge. `buffer` is the published-price buffer snapshotted on the task; legacy tasks without one (null)
 * keep their old rule, where the markup also applied to tokens.
 */
export function chargeTwd(c: CostBreakdown, fx: number, buffer: number | null, markup = config.pricing.markup): number {
  const twd = c.tokenUsd * fx * (buffer ?? markup) + (c.vmUsd + c.s3Usd) * fx * markup;
  return Math.ceil(twd * 1e6) / 1e6;
}

/** Each part in TWD, as shown on the task page */
export function chargeParts(c: CostBreakdown, fx: number, buffer: number | null, markup = config.pricing.markup) {
  return { tokens: c.tokenUsd * fx * (buffer ?? markup), vm: c.vmUsd * fx * markup, s3: c.s3Usd * fx * markup };
}
