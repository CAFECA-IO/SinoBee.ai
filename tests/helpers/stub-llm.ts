/**
 * Fake model providers for relay tests: an OpenAI-compatible server (/chat/completions, /embeddings) and an
 * Anthropic Messages server (/v1/messages), both with streaming in the vendors' SSE formats and usage reports.
 * Behaviour is set per test through `next`.
 */
import http from "node:http";

export type StubPlan = {
  /** number of text chunks to stream / words in a non-stream reply */
  chunks: number;
  /** text per chunk */
  text: string;
  /** ms between chunks */
  delayMs: number;
  /** omit the usage report */
  noUsage: boolean;
  /** respond with this HTTP status and no output */
  status: number;
  promptTokens: number;
  cacheRead: number;
  cacheWrite: number;
  /** parameters the fake model rejects with a 400 like Claude Opus 5.5's "`temperature` is deprecated for this model." */
  reject?: string[];
  /** ms before a non-streaming reply is sent (a model writing a long answer) */
  replyDelayMs?: number;
};

export class StubLlm {
  next: StubPlan = StubLlm.defaults();
  requests: { path: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }[] = [];
  aborted = 0;
  lastChunkAt = 0;
  server?: http.Server;
  url = "";

  static defaults(): StubPlan {
    return { chunks: 5, text: "hello world ", delayMs: 0, noUsage: false, status: 200, promptTokens: 1000, cacheRead: 0, cacheWrite: 0 };
  }

  async start() {
    this.server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        const body = raw ? JSON.parse(raw) : {};
        this.requests.push({ path: req.url ?? "", body, headers: req.headers });
        const plan = { ...this.next };
        const rejected = (plan.reject ?? []).find((k) => body[k] !== undefined);
        if (rejected) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify(req.url?.endsWith("/v1/messages")
            ? { type: "error", error: { type: "invalid_request_error", message: `\`${rejected}\` is deprecated for this model.` } }
            : { error: { message: `Unsupported parameter: '${rejected}' is not supported with this model.`, type: "invalid_request_error", param: rejected, code: "unsupported_parameter" } }));
        }
        if (plan.status !== 200) {
          res.statusCode = plan.status;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ error: { message: "upstream exploded", type: "server_error" } }));
        }
        const outTokens = Math.ceil((plan.text.length * plan.chunks) / 4);
        let closed = false;
        res.on("close", () => {
          if (!res.writableEnded) {
            closed = true;
            this.aborted++;
          }
        });
        const wait = () => new Promise((r) => setTimeout(r, plan.delayMs));
        if (req.url?.endsWith("/embeddings")) {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }], model: body.model, usage: { prompt_tokens: plan.promptTokens, total_tokens: plan.promptTokens } }));
        }
        if (req.url?.endsWith("/chat/completions")) {
          if (!body.stream) {
            res.setHeader("content-type", "application/json");
            return res.end(JSON.stringify({
              id: "chatcmpl-1", object: "chat.completion", model: body.model,
              choices: [{ index: 0, message: { role: "assistant", content: plan.text.repeat(plan.chunks) }, finish_reason: "stop" }],
              ...(plan.noUsage ? {} : { usage: { prompt_tokens: plan.promptTokens, completion_tokens: outTokens, prompt_tokens_details: { cached_tokens: plan.cacheRead } } }),
            }));
          }
          res.setHeader("content-type", "text/event-stream");
          for (let i = 0; i < plan.chunks && !closed; i++) {
            res.write(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: plan.text }, finish_reason: null }] })}\n\n`);
            this.lastChunkAt = Date.now();
            if (plan.delayMs) await wait();
          }
          if (closed) return;
          res.write(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
          if (!plan.noUsage && (body.stream_options as { include_usage?: boolean })?.include_usage)
            res.write(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: plan.promptTokens, completion_tokens: outTokens, prompt_tokens_details: { cached_tokens: plan.cacheRead } } })}\n\n`);
          this.lastChunkAt = Date.now();
          return res.end("data: [DONE]\n\n");
        }
        if (plan.replyDelayMs && !body.stream) {
          await new Promise((r) => setTimeout(r, plan.replyDelayMs));
          if (closed) return;
        }
        if (req.url?.endsWith("/v1/messages")) {
          const input = plan.promptTokens - plan.cacheRead - plan.cacheWrite;
          const usage = { input_tokens: input, cache_read_input_tokens: plan.cacheRead, cache_creation_input_tokens: plan.cacheWrite };
          if (!body.stream) {
            res.setHeader("content-type", "application/json");
            return res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: plan.text.repeat(plan.chunks) }], stop_reason: "end_turn", ...(plan.noUsage ? {} : { usage: { ...usage, output_tokens: outTokens } }) }));
          }
          res.setHeader("content-type", "text/event-stream");
          const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
          ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", content: [], usage: plan.noUsage ? undefined : { ...usage, output_tokens: 1 } } });
          ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
          for (let i = 0; i < plan.chunks && !closed; i++) {
            ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: plan.text } });
            this.lastChunkAt = Date.now();
            if (plan.delayMs) await wait();
          }
          if (closed) return;
          ev("content_block_stop", { index: 0 });
          ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, ...(plan.noUsage ? {} : { usage: { output_tokens: outTokens } }) });
          ev("message_stop", {});
          this.lastChunkAt = Date.now();
          return res.end();
        }
        res.statusCode = 404;
        res.end("not found");
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this;
  }

  stop() {
    this.server?.close();
  }
}
