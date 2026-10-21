import { randomUUID } from "node:crypto";
import { db } from "../db";
import { HttpError } from "../errors";

/**
 * Streams that outlive the connection (plan "長回覆斷線", 2026-10-21). NGINX and Cloudflare stay as they are, so the
 * relay itself makes sure a long answer survives the edge:
 *
 *   heartbeat   every SSE response gets ": ping" when nothing was sent for 15 s - a model buffering a big tool
 *               argument is silent for minutes, and the edge cut such streams after 90 s without a byte (measured
 *               2026-10-21 with scripts/edge-probe.py from SinoBee)
 *   resumable   a call with `x-sinobee-request-id` keeps running when the caller goes away: every event is numbered
 *               (`id: n`) and kept for 15 minutes, `GET /api/v1/llm/streams/{id}` with `Last-Event-ID: n` continues
 *               after n, and the same id POSTed again joins the running call instead of calling the model twice -
 *               one upstream call, one charge
 *   jobs        `POST /api/v1/llm/jobs` starts the same call in the background and answers at once;
 *               `GET /api/v1/llm/jobs/{id}?after=n` returns the events after n (waits up to 20 s for new ones). Every
 *               request is short, so no proxy limit applies.
 *
 * Events live in this process's memory while it runs the call and in PostgreSQL (LlmStream, LlmStreamChunk, written
 * about once a second) so another server process can serve the resume. Only the caller's own user can read them.
 */

export const KEEP_MS = 15 * 60_000;
const FLUSH_MS = 1000;
const MAX_STORED_BYTES = 20 * 1024 * 1024;
export const heartbeatMs = () => Number(process.env.LLM_HEARTBEAT_MS) || 15_000;

export const validRequestId = (v: string | null | undefined) => (v && /^[A-Za-z0-9_.:-]{8,80}$/.test(v) ? v : null);

/** What a reader needs: events so far, whether the call ended (and how), a way to wait for more */
export interface Source {
  events: string[];
  done: boolean;
  error: string | null;
  wait(ms?: number): Promise<void>;
}

/** One running call's events, in this process */
export class Live implements Source {
  events: string[] = [];
  done = false;
  error: string | null = null;
  bytes = 0;
  private waiters = new Set<() => void>();
  private pending: string[] = [];
  private pendingSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private stored = 0;
  constructor(
    readonly key: string | null,
    readonly dbId: string | null,
  ) {}

  /** Add whole SSE events ("…\n\n") */
  push(text: string) {
    for (const ev of splitEvents(text)) {
      this.events.push(ev);
      this.bytes += ev.length;
      if (this.dbId) this.queue(ev);
    }
    this.wake();
  }

  end(error: string | null = null) {
    if (this.done) return;
    this.done = true;
    this.error = error;
    this.wake();
    if (this.dbId) void this.flush(true);
    if (this.key) setTimeout(() => live.get(this.key!) === this && live.delete(this.key!), KEEP_MS).unref?.();
  }

  wait(ms = 30_000) {
    if (this.done) return Promise.resolve();
    return new Promise<void>((res) => {
      const t = setTimeout(() => (this.waiters.delete(done), res()), ms);
      const done = () => (clearTimeout(t), res());
      this.waiters.add(done);
    });
  }

  private wake() {
    const w = [...this.waiters];
    this.waiters.clear();
    for (const f of w) f();
  }

  private queue(ev: string) {
    if (this.stored + ev.length > MAX_STORED_BYTES) return; // past the cap: still delivered live, not resumable
    if (!this.pending.length) this.pendingSeq = this.events.length - 1;
    this.pending.push(ev);
    this.stored += ev.length;
    this.timer ??= setTimeout(() => void this.flush(false), FLUSH_MS);
  }

  private flushing: Promise<void> = Promise.resolve();
  flush(final: boolean) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.pending;
    const seq = this.pendingSeq;
    this.pending = [];
    const id = this.dbId!;
    this.flushing = this.flushing.then(async () => {
      try {
        if (batch.length) await db.llmStreamChunk.create({ data: { streamId: id, seq, events: batch } });
        if (final) await db.llmStream.update({ where: { id }, data: { status: this.error ? "error" : "done", error: this.error, events: this.events.length, bytes: this.bytes } });
      } catch (e) {
        console.warn("llm stream store", (e as Error).message);
      }
    });
    return this.flushing;
  }
}

/** A call running in another server process: its events as they reach PostgreSQL */
class Stored implements Source {
  events: string[] = [];
  done = false;
  error: string | null = null;
  constructor(private readonly id: string) {}
  async refresh() {
    const chunks = await db.llmStreamChunk.findMany({ where: { streamId: this.id, seq: { gte: this.events.length } }, orderBy: { seq: "asc" } });
    for (const c of chunks) {
      const evs = c.events as string[];
      if (c.seq > this.events.length) break; // a gap: wait for the earlier chunk
      this.events.push(...evs.slice(this.events.length - c.seq));
    }
    const row = await db.llmStream.findUnique({ where: { id: this.id }, select: { status: true, error: true, events: true } });
    if (!row) (this.done = true), (this.error = "gone");
    else if (row.status !== "running" && this.events.length >= row.events) (this.done = true), (this.error = row.error);
  }
  async wait(ms = 400) {
    await new Promise((r) => setTimeout(r, Math.min(ms, 400)));
    await this.refresh();
  }
}

/** SSE text → whole events, each ending in a blank line */
export function splitEvents(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split("\n\n")) if (part.trim()) out.push(part + "\n\n");
  return out;
}

const live = new Map<string, Live>();
let lastSweep = 0;

const keyOf = (userId: string, requestId: string) => `${userId}:${requestId}`;

async function sweep() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  await db.llmStream.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } }).catch(() => {});
}

/** Start keeping a call's events under (user, request id). joined: the same id is already running or finished
 * within 15 minutes - read that one instead of calling the model again. */
export async function begin(userId: string, requestId: string): Promise<{ live: Live; joined: false } | { source: Source; joined: true }> {
  await sweep();
  const key = keyOf(userId, requestId);
  const here = live.get(key);
  if (here) return { source: here, joined: true };
  try {
    const row = await db.llmStream.create({ data: { key, userId } });
    const l = new Live(key, row.id);
    live.set(key, l);
    return { live: l, joined: false };
  } catch {
    const s = await find(userId, requestId);
    if (s) return { source: s, joined: true };
    throw new HttpError(409, "this request id is in use");
  }
}

/** Forget a call that never started (refused, upstream error), so the same id can be tried again */
export async function drop(l: Live) {
  if (l.key && live.get(l.key) === l) live.delete(l.key);
  if (l.dbId) await db.llmStream.delete({ where: { id: l.dbId } }).catch(() => {});
}

/** The kept events of (user, request id), in this process or from PostgreSQL; null when there are none */
export async function find(userId: string, requestId: string): Promise<Source | null> {
  const key = keyOf(userId, requestId);
  const here = live.get(key);
  if (here) return here;
  const row = await db.llmStream.findUnique({ where: { key }, select: { id: true, createdAt: true } });
  if (!row || row.createdAt.getTime() < Date.now() - KEEP_MS) return null;
  const s = new Stored(row.id);
  await s.refresh();
  return s;
}

export const newJobId = () => `job_${randomUUID().replace(/-/g, "")}`;

/**
 * The SSE response for a source from event `after` on. Numbers the events (`id: n`, 1-based) when `ids`; sends
 * ": ping" whenever nothing went out for the heartbeat interval. onCancel: the caller went away.
 */
export function sseResponse(src: Source, opts: { after?: number; ids?: boolean; headers?: Record<string, string>; onCancel?: () => void } = {}): Response {
  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  const beat = heartbeatMs();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      let last = Date.now();
      const send = (s: string) => {
        if (closed) return;
        controller.enqueue(enc.encode(s));
        last = Date.now();
      };
      timer = setInterval(() => Date.now() - last >= beat && send(": ping\n\n"), Math.max(20, Math.min(beat, 5000)));
      timer.unref?.();
      let i = Math.max(0, opts.after ?? 0);
      void (async () => {
        try {
          while (!closed) {
            if (i < src.events.length) {
              const evs = src.events.slice(i);
              send(evs.map((e, k) => (opts.ids ? `id: ${i + k + 1}\n${e}` : e)).join(""));
              i += evs.length;
              continue;
            }
            if (src.done) {
              if (timer) clearInterval(timer);
              closed = true;
              if (src.error && src.error !== "client aborted") controller.error(new Error(src.error));
              else controller.close();
              return;
            }
            await src.wait(beat);
          }
        } catch (e) {
          if (!closed) {
            closed = true;
            if (timer) clearInterval(timer);
            controller.error(e);
          }
        }
      })();
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
      opts.onCancel?.();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", ...(opts.headers ?? {}) } });
}

/** One poll of a job: the events after `after`, waiting up to `waitMs` for new ones */
export async function poll(src: Source, after: number, waitMs: number) {
  const until = Date.now() + Math.max(0, Math.min(waitMs, 25_000));
  while (src.events.length <= after && !src.done && Date.now() < until) await src.wait(Math.min(until - Date.now(), 25_000));
  const events = src.events.slice(after);
  const next = after + events.length;
  const finished = src.done && next >= src.events.length;
  return { events, next, status: finished ? (src.error && src.error !== "client aborted" ? "error" : "done") : "running", error: finished ? src.error : null };
}

/** Tests: act as another server process that never saw these calls */
export function forgetLocal() {
  live.clear();
}
