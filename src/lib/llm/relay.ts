import { config } from "../config";
import { HttpError } from "../errors";
import { bearerAuth } from "../auth";
import { currentModels, type ModelPriceView } from "../models";
import { QuotaError, avgOutput, hold, pointsContext, quotaContext, quotaHeaders, settle, topUp, type QuotaCtx, type Settlement } from "./quota";

/**
 * Subscription model relay.
 *
 *   POST /api/v1/llm/chat/completions        OpenAI format (OpenAI, Gemini, DeepSeek models)
 *   POST /api/v1/llm/anthropic/v1/messages    Anthropic format (Claude models)
 *   POST /api/v1/llm/embeddings               OpenAI format
 *
 * Requests are passed through in the caller's own format (tools, caching, thinking keep working), with a
 * whitelist of parameters, max_tokens capped, the platform key added and usage reporting forced on. Responses
 * are forwarded unchanged except that a stream which runs out of quota ends with finish_reason / stop_reason
 * "quota". Billing is in quota.ts.
 *
 * A model that no longer accepts an optional sampling parameter (Claude Opus 5.5: "`temperature` is deprecated for
 * this model") gets the request again without it - same hold, settled once - and is remembered, so later requests
 * leave it out from the start; the response carries x-sinobee-dropped-params so the client stops sending it
 * (param-compat.ts). Other 400s are passed back unchanged.
 */

import { learn as learnParam, rejectedParam, stripKnown } from "./param-compat";

type Fmt = "openai" | "anthropic";

// ───────────── auth, errors ─────────────

/** sbh_ device token from `sinobee login` with the llm scope (Authorization: Bearer … or x-api-key: …) */
export async function llmAuth(req: Request) {
  const a = await bearerAuth(req);
  if (!a) throw new HttpError(401, "invalid or missing SinoBee.ai token — run `sinobee login`");
  if (!a.scopes.includes("llm")) throw new HttpError(403, "token lacks the llm scope — run `sinobee login` again");
  if (config.llm.requireSignature && !a.signed) throw new HttpError(401, "this site only accepts signed requests from SinoBee — update SinoBee and run `sinobee login`");
  return a;
}

export function errorResponse(fmt: Fmt, e: unknown): Response {
  const status = e instanceof HttpError ? e.status : 500;
  const message = e instanceof Error ? e.message : String(e);
  const q = e instanceof QuotaError ? e : null;
  const headers: Record<string, string> = {};
  if (q?.retryAt) headers["retry-after"] = String(Math.max(1, Math.ceil((q.retryAt.getTime() - Date.now()) / 1000)));
  const extra = q ? { quota: q.window, retry_at: q.retryAt?.toISOString() ?? null } : {};
  const type = q ? (q.window === "subscription" ? "subscription_required" : q.window === "provider" ? "overloaded" : "insufficient_quota") : status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status >= 500 ? "api_error" : "invalid_request_error";
  const body = fmt === "anthropic" ? { type: "error", error: { type, message, ...extra } } : { error: { message, type, code: q?.window ?? null, ...extra } };
  return Response.json(body, { status, headers });
}

// ───────────── models ─────────────

/** "anthropic/claude-sonnet-5-5", "claude-sonnet-5-5" or "claude-sonnet-5.5" → the offered model */
export async function resolveModel(name: unknown, fmt: Fmt): Promise<{ model: ModelPriceView; provider: string; upstreamName: string }> {
  if (typeof name !== "string" || !name) throw new HttpError(400, "model is required");
  const norm = (s: string) => s.toLowerCase().replace(/\./g, "-");
  const models = await currentModels();
  const m = models.find((x) => x.modelId === name) ?? models.find((x) => norm(x.modelId.split("/").slice(1).join("/")) === norm(name.includes("/") ? name.split("/").slice(1).join("/") : name));
  if (!m) throw new HttpError(404, `model ${name} is not offered on SinoBee.ai (GET /api/v1/llm/models)`);
  const provider = m.modelId.split("/")[0];
  const p = config.llm.providers[provider];
  if (!p) throw new HttpError(400, `provider ${provider} is not available through the relay`);
  if (p.kind !== fmt) throw new HttpError(400, fmt === "openai" ? `${m.modelId} uses the Anthropic format: POST /api/v1/llm/anthropic/v1/messages` : `${m.modelId} uses the OpenAI format: POST /api/v1/llm/chat/completions`);
  if (!p.key) throw new QuotaError("provider", `${provider} models are temporarily unavailable`);
  return { model: m, provider, upstreamName: m.modelId.split("/").slice(1).join("/") };
}

// ───────────── token estimates (holds and streams; never trusted over upstream usage) ─────────────

/** Conservative token estimate: UTF-8 bytes ÷ 3 (≈ 1 token per CJK character, overestimates English) */
export const estimateTokens = (v: unknown) => (v == null ? 0 : Math.ceil(Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8") / 3));

// ───────────── request shaping ─────────────

const OPENAI_KEYS = ["model", "messages", "tools", "tool_choice", "temperature", "top_p", "max_tokens", "max_completion_tokens", "stream", "stop", "response_format", "parallel_tool_calls", "reasoning_effort", "seed", "presence_penalty", "frequency_penalty", "user"];
const ANTHROPIC_KEYS = ["model", "messages", "system", "tools", "tool_choice", "max_tokens", "temperature", "top_p", "top_k", "stop_sequences", "stream", "thinking"];

function pick(body: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(Object.entries(body).filter(([k]) => keys.includes(k)));
}

// ───────────── the relay ─────────────

type Prepared = {
  fmt: Fmt;
  /** optional sampling parameters left out because this model does not accept them (param-compat.ts) */
  dropped: string[];
  ctx: QuotaCtx;
  model: ModelPriceView;
  provider: string;
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
  stream: boolean;
  promptEstimate: number;
  endpoint: string;
  deviceId: string | null;
  /** aborted when the caller goes away (a proxy timeout, a closed app): the upstream call is stopped with it */
  signal?: AbortSignal;
};

export async function relay(req: Request, fmt: Fmt, endpoint: "chat" | "messages" | "embeddings"): Promise<Response> {
  let prepared: Prepared | null = null;
  try {
    const auth = await llmAuth(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new HttpError(400, "JSON body required");
    // `x-sinobee-billing: points`: the user agreed in SinoBee to continue with platform points (1:1, quota.ts)
    const ctx = req.headers.get("x-sinobee-billing") === "points" ? await pointsContext(auth.user.id) : await quotaContext(auth.user.id);
    const { model, provider, upstreamName } = await resolveModel(body.model, fmt);
    const p = config.llm.providers[provider];
    const key = p.key;

    if (endpoint === "embeddings") {
      const payload = { ...pick(body, ["input", "dimensions", "encoding_format"]), model: upstreamName };
      const promptEstimate = estimateTokens(body.input);
      prepared = { fmt, dropped: stripKnown(upstreamName, payload), ctx, model, provider, url: `${p.base}/embeddings`, headers: { authorization: `Bearer ${key}` }, payload, stream: false, promptEstimate, endpoint, deviceId: auth.device?.id ?? null, signal: req.signal };
      return await runPlain(prepared, 0);
    }

    const stream = body.stream === true;
    const cap = config.llm.maxOutputTokens;
    if (fmt === "openai") {
      const payload = pick(body, OPENAI_KEYS);
      if (!Array.isArray(payload.messages) || !payload.messages.length) throw new HttpError(400, "messages required");
      payload.model = upstreamName;
      const asked = Number(payload.max_completion_tokens ?? payload.max_tokens ?? 0) || 0;
      const maxOut = Math.min(asked || (stream ? cap : config.llm.defaultOutputTokens), cap);
      const promptEstimate = estimateTokens({ m: payload.messages, t: payload.tools });
      prepared = { fmt, dropped: stripKnown(upstreamName, payload), ctx, model, provider, url: `${p.base}/chat/completions`, headers: { authorization: `Bearer ${key}` }, payload, stream, promptEstimate, endpoint, deviceId: auth.device?.id ?? null, signal: req.signal };
      const setMax = (n: number) => {
        delete payload.max_tokens;
        delete payload.max_completion_tokens;
        payload[provider === "openai" ? "max_completion_tokens" : "max_tokens"] = n;
      };
      if (stream) {
        setMax(maxOut);
        payload.stream_options = { include_usage: true };
        return await runStream(prepared, Math.min(await avgOutput(ctx.userId, model.modelId), maxOut), maxOut);
      }
      return await runPlain(prepared, maxOut, setMax);
    }

    const payload = pick(body, ANTHROPIC_KEYS);
    if (!Array.isArray(payload.messages) || !payload.messages.length) throw new HttpError(400, "messages required");
    payload.model = upstreamName;
    const maxOut = Math.min(Number(payload.max_tokens) || config.llm.defaultOutputTokens, cap);
    payload.max_tokens = maxOut;
    const headers: Record<string, string> = { "x-api-key": key, "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01" };
    const beta = req.headers.get("anthropic-beta");
    if (beta && /^[a-z0-9,\-. ]{1,300}$/i.test(beta)) headers["anthropic-beta"] = beta;
    const promptEstimate = estimateTokens({ m: payload.messages, s: payload.system, t: payload.tools });
    prepared = { fmt, dropped: stripKnown(upstreamName, payload), ctx, model, provider, url: `${p.base}/v1/messages`, headers, payload, stream, promptEstimate, endpoint, deviceId: auth.device?.id ?? null, signal: req.signal };
    if (stream) return await runStream(prepared, Math.min(await avgOutput(ctx.userId, model.modelId), maxOut), maxOut);
    return await runPlain(prepared, maxOut, (n) => (payload.max_tokens = n));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error("llm relay", e);
    return errorResponse(prepared?.fmt ?? fmt, e);
  }
}

function fetchOnce(p: Prepared, signal?: AbortSignal) {
  return fetch(p.url, { method: "POST", headers: { "content-type": "application/json", ...p.headers }, body: JSON.stringify(p.payload), signal });
}

/** The upstream call. A 400 that says the model does not accept an optional sampling parameter (temperature,
 * top_p, top_k) is answered by sending the same request again without it, and the model is remembered so later
 * requests leave it out from the start (param-compat.ts). Other errors are returned as they are. */
async function upstream(p: Prepared, signal?: AbortSignal): Promise<Response> {
  for (let round = 0; ; round++) {
    const r = await fetchOnce(p, signal);
    if ((r.status !== 400 && r.status !== 422) || round >= 3) return r;
    const text = await r.text().catch(() => "");
    let message = text;
    try {
      const j = JSON.parse(text);
      message = j?.error?.message ?? j?.message ?? text;
    } catch {
      /* not JSON */
    }
    const param = rejectedParam(r.status, String(message), p.payload);
    if (!param) return new Response(text, { status: r.status, headers: r.headers });
    learnParam(String(p.payload.model), param);
    delete p.payload[param];
    p.dropped.push(param);
  }
}

/** Tells the client which parameters were left out, so it can stop sending them */
const droppedHeader = (p: Prepared): Record<string, string> => (p.dropped.length ? { "x-sinobee-dropped-params": p.dropped.join(",") } : {});

/** Strip upstream error details that could identify our account; keep the type and message */
async function upstreamError(p: Prepared, r: Response): Promise<Response> {
  const text = await r.text().catch(() => "");
  let message = `upstream error ${r.status}`;
  try {
    const j = JSON.parse(text);
    message = j?.error?.message ?? j?.message ?? message;
  } catch {
    /* not JSON */
  }
  const status = r.status === 429 || r.status >= 500 ? 503 : r.status;
  const body = p.fmt === "anthropic" ? { type: "error", error: { type: status === 503 ? "overloaded_error" : "invalid_request_error", message } } : { error: { message, type: status === 503 ? "upstream_unavailable" : "invalid_request_error", code: null } };
  return Response.json(body, { status });
}

// ───────────── usage parsing ─────────────

type U = { prompt: number; output: number; cacheRead: number; cacheWrite: number };

function openaiUsage(u: Record<string, unknown> | undefined): U | null {
  if (!u) return null;
  const d = (u.prompt_tokens_details ?? {}) as Record<string, number>;
  return {
    prompt: Number(u.prompt_tokens ?? u.input_tokens ?? 0),
    output: Number(u.completion_tokens ?? 0),
    cacheRead: Number(d.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0),
    cacheWrite: 0,
  };
}

/** Anthropic input_tokens excludes cached and cache-write tokens; our prompt is the total */
function anthropicUsage(u: Record<string, unknown> | undefined, prev?: U): U | null {
  if (!u) return prev ?? null;
  const cr = Number(u.cache_read_input_tokens ?? prev?.cacheRead ?? 0);
  const cw = Number(u.cache_creation_input_tokens ?? prev?.cacheWrite ?? 0);
  const input = u.input_tokens != null ? Number(u.input_tokens) + cr + cw : (prev?.prompt ?? 0);
  return { prompt: input, output: Number(u.output_tokens ?? prev?.output ?? 0), cacheRead: cr, cacheWrite: cw };
}

// ───────────── non-streaming ─────────────

async function runPlain(p: Prepared, maxOut: number, setMax?: (n: number) => void): Promise<Response> {
  // the whole response arrives at once, so the hold covers the most it can cost: we lower max_tokens to what fits
  const { ledger, output } = await hold(p.ctx, p.model, { prompt: p.promptEstimate, output: maxOut, minOutput: maxOut > 0 ? Math.min(256, maxOut) : 0 }, { endpoint: p.endpoint, stream: false, deviceId: p.deviceId, fit: maxOut > 0 });
  if (setMax) setMax(output);
  // The caller may give up before the whole answer is ready - a proxy in front of this server cuts requests that
  // send nothing for ~100 s (a non-streaming call that writes a long answer does exactly that). Then nobody receives
  // the answer: stop the upstream call and refund the hold instead of charging for it. (Clients should stream.)
  const gone = () => p.signal?.aborted === true;
  let r: Response;
  let text: string;
  try {
    r = await upstream(p, p.signal);
    if (!r.ok) {
      await settle(ledger.id, { kind: "refund", reason: `upstream ${r.status}` });
      return upstreamError(p, r);
    }
    text = await r.text();
    if (gone()) throw new Error("client aborted");
  } catch (e) {
    const aborted = gone();
    await settle(ledger.id, { kind: "refund", reason: aborted ? "client aborted before the answer arrived (not delivered)" : `upstream unreachable: ${(e as Error).message}` });
    if (aborted) throw new HttpError(499, "client closed the request");
    throw new HttpError(503, "model provider unreachable");
  }
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    await settle(ledger.id, { kind: "estimate", prompt: p.promptEstimate, output, reason: "unparseable upstream response" });
    return new Response(text, { status: 502 });
  }
  const u = p.fmt === "anthropic" ? anthropicUsage(json.usage as Record<string, unknown>) : openaiUsage(json.usage as Record<string, unknown>);
  const s: Settlement = u ? { kind: "usage", ...u } : { kind: "estimate", prompt: p.promptEstimate, output: estimateTokens(p.fmt === "anthropic" ? json.content : json.choices), reason: "no usage in response" };
  const done = await settle(ledger.id, s);
  return Response.json(json, { status: r.status, headers: { ...(await quotaHeaders(p.ctx.plan, done).catch(() => ({}))), ...droppedHeader(p) } });
}

// ───────────── streaming ─────────────

const enc = new TextEncoder();

/** Text-ish deltas we count as output while streaming */
function deltaText(fmt: Fmt, ev: Record<string, unknown>): string {
  if (fmt === "openai") {
    let s = "";
    for (const c of (ev.choices as { delta?: Record<string, unknown> }[] | undefined) ?? []) {
      const d = c.delta ?? {};
      if (typeof d.content === "string") s += d.content;
      if (typeof d.reasoning_content === "string") s += d.reasoning_content;
      for (const tc of (d.tool_calls as { function?: { name?: string; arguments?: string } }[] | undefined) ?? []) s += (tc.function?.name ?? "") + (tc.function?.arguments ?? "");
    }
    return s;
  }
  if (ev.type === "content_block_delta") {
    const d = (ev.delta ?? {}) as Record<string, string>;
    return d.text ?? d.partial_json ?? d.thinking ?? "";
  }
  return "";
}

async function runStream(p: Prepared, expected: number, maxOut: number): Promise<Response> {
  const { ledger } = await hold(p.ctx, p.model, { prompt: p.promptEstimate, output: expected }, { endpoint: p.endpoint, stream: true, deviceId: p.deviceId });
  const ac = new AbortController();
  let r: Response;
  try {
    r = await upstream(p, ac.signal);
  } catch (e) {
    await settle(ledger.id, { kind: "refund", reason: `upstream unreachable: ${(e as Error).message}` });
    throw new HttpError(503, "model provider unreachable");
  }
  if (!r.ok || !r.body) {
    await settle(ledger.id, { kind: "refund", reason: `upstream ${r.status}` });
    return upstreamError(p, r);
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let counted = 0; // estimated output tokens so far
  let chars = ""; // pending text not yet converted to tokens
  let heldOutput = expected;
  let usage: U | null = null;
  let sawOutput = false;
  let settled = false;
  let openBlock: number | null = null; // anthropic content block in progress
  let lastId = "relay";

  const finish = async (s: Settlement) => {
    if (settled) return null;
    settled = true;
    return await settle(ledger.id, s).catch((e) => {
      console.error("llm settle", e);
      return null;
    });
  };
  const estimateNow = (): Settlement => ({ kind: "estimate", prompt: usage?.prompt || p.promptEstimate, output: Math.max(counted + estimateTokens(chars), usage?.output ?? 0), reason: "" });

  const quotaTail = () =>
    p.fmt === "openai"
      ? `data: ${JSON.stringify({ id: lastId, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "quota" }] })}\n\ndata: [DONE]\n\n`
      : (openBlock != null ? `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: openBlock })}\n\n` : "") +
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "quota", stop_sequence: null }, usage: { output_tokens: counted } })}\n\n` +
        `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;

  const out = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done && !buf.trim()) {
          const row = await finish(usage ? { kind: "usage", ...usage } : ({ ...estimateNow(), reason: "stream ended without usage" } as Settlement));
          // headers left before the answer existed: the answer's share of the quota goes last, as an SSE comment
          // (ignored by SSE parsers that do not look for it)
          const q = await quotaHeaders(p.ctx.plan, row).catch(() => ({}));
          if (Object.keys(q).length) controller.enqueue(enc.encode(`: x-sinobee-quota ${JSON.stringify(q)}\n\n`));
          controller.close();
          return;
        }
        if (done) buf += "\n\n"; // flush a last event without its blank line
        else buf += dec.decode(value, { stream: true });
        // forward complete SSE events only, so we can stop cleanly between them
        const cut = buf.lastIndexOf("\n\n");
        if (cut < 0) return;
        const chunk = buf.slice(0, cut + 2);
        buf = buf.slice(cut + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }
          if (typeof ev.id === "string") lastId = ev.id;
          if (p.fmt === "openai") {
            if (ev.usage) usage = openaiUsage(ev.usage as Record<string, unknown>);
          } else {
            if (ev.type === "message_start") usage = anthropicUsage((ev.message as { usage?: Record<string, unknown> })?.usage, usage ?? undefined);
            if (ev.type === "message_delta") usage = anthropicUsage(ev.usage as Record<string, unknown>, usage ?? undefined);
            if (ev.type === "content_block_start") openBlock = Number(ev.index ?? 0);
            if (ev.type === "content_block_stop") openBlock = null;
          }
          const t = deltaText(p.fmt, ev);
          if (t) {
            sawOutput = true;
            chars += t;
            if (chars.length > 64) {
              counted += estimateTokens(chars);
              chars = "";
            }
          }
        }
        // reserve more as the stream outgrows its hold
        while (counted + estimateTokens(chars) > heldOutput && heldOutput < maxOut) {
          const step = Math.min(config.llm.topUpTokens, maxOut - heldOutput);
          if (!(await topUp(p.ctx, ledger.id, step, counted))) {
            // this chunk would go past what is reserved: drop it and end the stream
            ac.abort();
            controller.enqueue(enc.encode(quotaTail()));
            await finish({ kind: "estimate", prompt: usage?.prompt || p.promptEstimate, output: heldOutput, reason: "stopped: quota used up" });
            controller.close();
            return;
          }
          heldOutput += step;
        }
        controller.enqueue(enc.encode(chunk));
      } catch (e) {
        await finish(sawOutput ? ({ ...estimateNow(), reason: `stream error: ${(e as Error).message}` } as Settlement) : { kind: "refund", reason: `stream error: ${(e as Error).message}` });
        controller.error(e);
      }
    },
    async cancel() {
      // client went away: stop the upstream call and settle what was produced (upstream bills it anyway)
      ac.abort();
      await finish({ ...estimateNow(), reason: "client aborted" } as Settlement);
    },
  });
  return new Response(out, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", ...droppedHeader(p) } });
}

/** OpenAI-style model list with published prices (TWD per 1M tokens) */
export async function modelList() {
  const models = await currentModels();
  return {
    object: "list",
    data: models
      .filter((m) => config.llm.providers[m.modelId.split("/")[0]])
      .map((m) => ({
        id: m.modelId,
        object: "model",
        owned_by: m.vendor,
        name: m.label,
        format: config.llm.providers[m.modelId.split("/")[0]].kind,
        price_twd_per_1m: m.twd,
        available: !!config.llm.providers[m.modelId.split("/")[0]].key,
      })),
  };
}
