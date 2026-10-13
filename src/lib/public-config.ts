import { config } from "./config";
import { MODELS } from "./pricing";

/** Pricing numbers safe to send to the browser */
export function pricingForClient() {
  return {
    markup: config.pricing.markup,
    usdTwd: config.pricing.usdTwd,
    vmHourlyUsd: config.pricing.vmHourlyUsd,
    s3GbMonthUsd: config.pricing.s3GbMonthUsd,
    s3PutPer1kUsd: config.pricing.s3PutPer1kUsd,
    s3GetPer1kUsd: config.pricing.s3GetPer1kUsd,
    retentionDays: config.retention.freeDays,
    minBudget: config.payments.minTaskBudget,
  };
}

export const modelsForClient = () => MODELS.map(({ id, label, vendor, input, output }) => ({ id, label, vendor, input, output }));
