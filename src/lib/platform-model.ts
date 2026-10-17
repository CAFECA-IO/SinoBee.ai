import { config } from "./config";
import { HttpError } from "./errors";
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

export type ChatUsage = { prompt: number; output: number; cacheRead: number; cacheWrite: number };
export type ChatMessage = { role: "user" | "assistant"; content: string };

/** The provider's error text, whatever shape it comes in (Gemini wraps errors in an array; proxies send HTML) */
async function errorText(r: Response): Promise<string> {
  const raw = await r.text().catch(() => "");
  try {
    const j = JSON.parse(raw) as unknown;
    const o = (Array.isArray(j) ? j[0] : j) as { error?: { message?: string } | string; message?: string };
    const m = typeof o?.error === "string" ? o.error : (o?.error?.message ?? o?.message);
    if (m) return `${r.status} ${m}`;
  } catch {
    /* not JSON */
  }
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return text ? `${r.status} ${text}` : `${r.status}`;
}

class ModelCallError extends Error {
  constructor(message: string, readonly retryElsewhere: boolean) {
    super(message);
  }
}

async function callOnce(pm: PlatformModel, system: string, messages: ChatMessage[], maxTokens: number, timeoutMs: number): Promise<{ text: string; usage: ChatUsage }> {
  const { api, upstream, provider } = pm;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let r: Response;
    try {
      r =
        api.kind === "anthropic"
          ? await fetch(`${api.base}/v1/messages`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-api-key": api.key, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model: upstream, system, messages, max_tokens: maxTokens }),
              signal: ctrl.signal,
            })
          : await fetch(`${api.base}/chat/completions`, {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${api.key}` },
              // OpenAI's reasoning models count their thinking as completion tokens
              body: JSON.stringify({ model: upstream, messages: [{ role: "system", content: system }, ...messages], ...(provider === "openai" ? { max_completion_tokens: maxTokens * 2 } : { max_tokens: maxTokens }) }),
              signal: ctrl.signal,
            });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      // a timeout would only repeat on the next model; an unreachable host may be one provider's problem
      throw new ModelCallError(aborted ? `timed out after ${Math.round(timeoutMs / 1000)} s` : `unreachable: ${(e as Error).message}`, !aborted);
    }
    if (!r.ok) throw new ModelCallError(await errorText(r), true);
    if (api.kind === "anthropic") {
      const j = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
      const u = j.usage ?? {};
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheWrite = u.cache_creation_input_tokens ?? 0;
      return { text: (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""), usage: { prompt: (u.input_tokens ?? 0) + cacheRead + cacheWrite, output: u.output_tokens ?? 0, cacheRead, cacheWrite } };
    }
    const j = (await r.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } };
    return { text: j.choices?.[0]?.message?.content ?? "", usage: { prompt: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, cacheRead: j.usage?.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: 0 } };
  } finally {
    clearTimeout(timer);
  }
}

// models that just failed (unknown model ID, rejected key, provider down) are tried last for a while
const g = globalThis as unknown as { __sbModelFailures?: Map<string, number> };
const failures = (g.__sbModelFailures ??= new Map<string, number>());
const FAILURE_MS = 10 * 60_000;

/**
 * One request to the platform model. When it fails (e.g. a model ID the provider does not know → 404, or a rejected
 * key) the next usable model is tried, so one wrong entry in Model prices does not stop drafting and screening.
 * Throws 503 NO_PLATFORM_MODEL when no provider key is set, 502 with every model's error when all fail.
 */
export async function platformChat(opts: { system: string; messages: ChatMessage[]; maxTokens: number; timeoutMs?: number }): Promise<{ text: string; usage: ChatUsage; model: ModelPriceView }> {
  const usable = await usableModels();
  if (!usable.length) throw new HttpError(503, NO_PLATFORM_MODEL);
  const chosen = config.crowd.specModel;
  const now = Date.now();
  const rank = (u: PlatformModel) => ((failures.get(u.model.modelId) ?? 0) > now - FAILURE_MS ? 2 : 0) + (u.model.modelId === chosen ? 0 : 1);
  const order = usable.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map((x) => x.u);
  const errors: string[] = [];
  for (const pm of order) {
    try {
      const out = await callOnce(pm, opts.system, opts.messages, opts.maxTokens, opts.timeoutMs ?? 240_000);
      failures.delete(pm.model.modelId);
      return { ...out, model: pm.model };
    } catch (e) {
      const msg = `${pm.model.modelId}: ${(e as Error).message}`;
      console.warn("platform model", msg);
      errors.push(msg);
      failures.set(pm.model.modelId, Date.now());
      if (!(e instanceof ModelCallError) || !e.retryElsewhere) break;
    }
  }
  throw new HttpError(502, `AI model error (check the model IDs in /admin → Model prices and the API keys): ${errors.join("; ").slice(0, 600)}`);
}
