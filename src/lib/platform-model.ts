import { config } from "./config";
import { currentModels, type ModelPriceView } from "./models";

export type PlatformModel = { model: ModelPriceView; provider: string; api: { kind: "openai" | "anthropic"; base: string; key: string }; upstream: string };

/** Offered models whose provider has an API key set in /admin → Settings, in the admin's order */
export async function usableModels(): Promise<PlatformModel[]> {
  const out: PlatformModel[] = [];
  for (const model of await currentModels()) {
    const provider = model.modelId.split("/")[0];
    const api = config.llm.providers[provider];
    if (api?.key) out.push({ model, provider, api, upstream: model.modelId.split("/").slice(1).join("/") });
  }
  return out;
}

/**
 * The model SinoBee itself uses (drafting proposal specs, screening, editing the checklist): the one chosen in
 * /admin → Settings → Crowdfunding (crowd.specModel) when it is offered and its provider has a key; otherwise the
 * first offered model that has a key. null when no provider key is set at all.
 */
export async function platformModel(): Promise<PlatformModel | null> {
  const usable = await usableModels();
  const chosen = config.crowd.specModel;
  return usable.find((u) => u.model.modelId === chosen) ?? usable[0] ?? null;
}

export const NO_PLATFORM_MODEL = "no AI model is available: set an API key for one of the offered models' providers in /admin → Settings → API keys";
