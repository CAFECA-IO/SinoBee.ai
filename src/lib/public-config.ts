import { config } from "./config";
import { currentModels, pricingSettings } from "./models";

/**
 * Published prices are in TWD and final:
 *   model tokens = vendor USD × FX × buffer (the ModelPrice table, same as subscriptions)
 *   VM and storage = AWS USD × FX × markup
 * Only these final prices leave the server.
 */
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** VM / storage unit prices shown on /pricing and used by the estimator (TWD) */
export async function publicPrices() {
  const { fx } = await pricingSettings();
  const twd = (usd: number) => usd * config.pricing.markup * fx;
  return {
    vmHourly: round(twd(config.pricing.vmHourlyUsd)),
    storageGbMonth: round(twd(config.pricing.s3GbMonthUsd)),
    writesPer1k: round(twd(config.pricing.s3PutPer1kUsd), 4),
    readsPer1k: round(twd(config.pricing.s3GetPer1kUsd), 4),
  };
}

/** Models offered for crowdfunded tasks with their published prices per 1M tokens (TWD) */
export const modelsForClient = async () =>
  (await currentModels()).map(({ modelId, label, vendor, twd }) => ({ id: modelId, label, vendor, input: twd.input, cacheRead: twd.cacheRead, output: twd.output }));
