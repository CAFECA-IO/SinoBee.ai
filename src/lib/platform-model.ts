import { config } from "./config";
import { HttpError } from "./errors";
import { currentModels, pricesAt, type ModelPriceView } from "./models";
import { modelsForJob, type Job } from "./ai-models";

export type PlatformModel = { modelId: string; provider: string; api: { kind: "openai" | "anthropic"; base: string; key: string }; upstream: string; price: ModelPriceView | null };

const asPlatform = (modelId: string, price: ModelPriceView | null): PlatformModel | null => {
  const provider = modelId.split("/")[0];
  const api = config.llm.providers[provider];
  return api?.key ? { modelId, provider, api, upstream: modelId.split("/").slice(1).join("/"), price } : null;
};

/** Offered models whose provider has an API key set in /admin → Settings, in the admin's order (automatic mode) */
export async function usableModels(): Promise<PlatformModel[]> {
  return (await currentModels()).map((m) => asPlatform(m.modelId, m)).filter((x): x is PlatformModel => !!x);
}

/**
 * The models a platform job may use, in order: the job's tier in /admin → AI 模型 (primary, then fallbacks; models
 * whose provider has no key are skipped), or — when that tier is empty — every offered model with a key.
 */
export async function jobModels(job: Job): Promise<{ models: PlatformModel[]; configured: string[] }> {
  const configured = await modelsForJob(job);
  if (!configured.length) return { models: await usableModels(), configured };
  const prices = new Map((await pricesAt(new Date(8.64e15))).map((m) => [m.modelId, m]));
  return { models: configured.map((id) => asPlatform(id, prices.get(id) ?? null)).filter((x): x is PlatformModel => !!x), configured };
}

/** The first model a job would try (null when none can be used) */
export async function platformModel(job: Job = "spec"): Promise<PlatformModel | null> {
  return (await jobModels(job)).models[0] ?? null;
}

export const NO_PLATFORM_MODEL = "no AI model is available: set an API key in /admin → Settings → API keys and choose the models in /admin → AI 模型";

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

async function callOnce(pm: PlatformModel, system: string, messages: ChatMessage[], maxTokens: number, timeoutMs: number, webSearch = false): Promise<{ text: string; usage: ChatUsage }> {
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
              body: JSON.stringify({ model: upstream, system, messages, max_tokens: maxTokens, ...(webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] } : {}) }),
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
 * One request for a platform job. The job's models are tried in order (primary, then fallbacks); a model that fails
 * (e.g. a model ID the provider does not know → 404, a rejected key, the provider down) falls through to the next and
 * is tried last for 10 minutes. Throws 503 when no model can be used, 502 with every model's error when all fail.
 * webSearch: let the model search the web where the provider supports it (Anthropic); retried without on refusal.
 */
export async function platformChat(opts: { job: Job; system: string; messages: ChatMessage[]; maxTokens: number; timeoutMs?: number; webSearch?: boolean }): Promise<{ text: string; usage: ChatUsage; modelId: string; price: ModelPriceView | null }> {
  const { models, configured } = await jobModels(opts.job);
  if (!models.length) throw new HttpError(503, configured.length ? `none of the models set for this job (${configured.join(", ")}) has an API key: /admin → Settings → API keys` : NO_PLATFORM_MODEL);
  const now = Date.now();
  const recent = (m: PlatformModel) => ((failures.get(m.modelId) ?? 0) > now - FAILURE_MS ? 1 : 0);
  const order = models.map((m, i) => ({ m, i })).sort((a, b) => recent(a.m) - recent(b.m) || a.i - b.i).map((x) => x.m);
  const errors: string[] = [];
  for (const pm of order) {
    try {
      let out: { text: string; usage: ChatUsage };
      try {
        out = await callOnce(pm, opts.system, opts.messages, opts.maxTokens, opts.timeoutMs ?? 240_000, !!opts.webSearch && pm.api.kind === "anthropic");
      } catch (e) {
        // the web search tool may not be enabled for the account or the model: ask again without it
        if (!(opts.webSearch && pm.api.kind === "anthropic" && e instanceof ModelCallError && /^4\d\d/.test(e.message))) throw e;
        out = await callOnce(pm, opts.system, opts.messages, opts.maxTokens, opts.timeoutMs ?? 240_000, false);
      }
      failures.delete(pm.modelId);
      if (!pm.price) console.warn("platform model", pm.modelId, "has no price row; the call is not charged");
      return { ...out, modelId: pm.modelId, price: pm.price };
    } catch (e) {
      const msg = `${pm.modelId}: ${(e as Error).message}`;
      console.warn("platform model", opts.job, msg);
      errors.push(msg);
      failures.set(pm.modelId, Date.now());
      if (!(e instanceof ModelCallError) || !e.retryElsewhere) break;
    }
  }
  throw new HttpError(502, `AI model error (check /admin → AI 模型 and the API keys): ${errors.join("; ").slice(0, 600)}`);
}

/** Whether a job has any model it could call (else the development stand-ins run, or production reports it) */
export async function jobHasModel(job: Job): Promise<boolean> {
  return (await jobModels(job)).models.length > 0;
}
