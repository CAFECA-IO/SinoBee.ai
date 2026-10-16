import { config } from "./config";
import { MODELS } from "./pricing";

/**
 * Published prices are in TWD and already final: raw provider cost (USD) × markup × USD/TWD rate.
 * Only these final prices leave the server; the markup and raw costs stay internal.
 */
export const toTwd = (usd: number) => usd * config.pricing.markup * config.pricing.usdTwd;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Unit prices shown on /pricing and used by the estimator (TWD) */
export function publicPrices() {
  return {
    vmHourly: round(toTwd(config.pricing.vmHourlyUsd)),
    storageGbMonth: round(toTwd(config.pricing.s3GbMonthUsd)),
    writesPer1k: round(toTwd(config.pricing.s3PutPer1kUsd), 4),
    readsPer1k: round(toTwd(config.pricing.s3GetPer1kUsd), 4),
  };
}

/** Pricing numbers safe to send to the browser (TWD, final) */
export function pricingForClient() {
  return {
    ...publicPrices(),
    retentionDays: config.retention.freeDays,
    minBudget: config.payments.minTaskBudget,
  };
}

/** Model prices per 1M tokens in TWD (final) */
export const modelsForClient = () =>
  MODELS.map(({ id, label, vendor, input, output }) => ({ id, label, vendor, input: round(toTwd(input)), output: round(toTwd(output)) }));
