import { config } from "./config";

/**
 * Billing rules (shown on /pricing):
 *   charge = markup × (token cost + AWS VM rental + AWS S3 cost)   — markup defaults to 1.5
 * Token cost is what SinoBee itself records per model call (vendor list prices, incl. cache discounts).
 * VM cost = runtime seconds × hourly on-demand price of one task slot.
 * S3 cost = result size × retention window × GB-month price + request fees.
 * Raw USD costs are converted to TWDC at the rate snapshotted when the task was created.
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
 * After that the admin backend (/admin?tab=prices) is the only source; see src/lib/models.ts.
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

export function tokenCostUsd(m: Pick<ModelInfo, "input" | "output"> | undefined, input: number, output: number): number {
  if (!m) return 0;
  return (input * m.input + output * m.output) / 1_000_000;
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

/** TWDC to charge for raw USD costs */
export function chargeTwdc(c: CostBreakdown, usdTwd = config.pricing.usdTwd, markup = config.pricing.markup): number {
  const raw = c.tokenUsd + c.vmUsd + c.s3Usd;
  return Math.ceil(raw * markup * usdTwd * 1e6) / 1e6;
}

/** Rough estimate shown before payment */
export function estimate(model: Pick<ModelInfo, "input" | "output"> | undefined, opts: { inputTokens: number; outputTokens: number; minutes: number; resultMb: number; retentionDays: number }) {
  const c: CostBreakdown = {
    tokenUsd: tokenCostUsd(model, opts.inputTokens, opts.outputTokens),
    vmUsd: vmCostUsd(opts.minutes * 60),
    s3Usd: s3CostUsd(opts.resultMb * 1024 ** 2, opts.retentionDays, 2, 4),
  };
  return { ...c, twdc: chargeTwdc(c) };
}
