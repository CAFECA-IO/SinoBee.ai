import { ollamaBase } from "./config";
import { HttpError } from "./errors";
import { audit } from "./roles";

/**
 * Ollama as a platform model source (/admin → AI 模型 → Ollama): the installed models appear in the model lists as
 * `ollama/<name>` after a sync, and admins pull recommended open models (or any Ollama model) from the admin page.
 * Pulls run in the background in the web process; the admin page polls ollamaStatus().
 */

export type Recommended = {
  name: string;
  /** download size, as Ollama's library lists it */
  size: string;
  tier: "high" | "standard" | "light";
  caps: ("tools" | "thinking" | "vision")[];
  note: { zh: string; en: string };
};

/** Open models that suit SinoBee's platform jobs (structured writing and review in Chinese and English), large → small */
export const RECOMMENDED: Recommended[] = [
  { name: "qwen3.6:35b", size: "24 GB", tier: "high", caps: ["tools", "thinking", "vision"], note: { zh: "MoE（35B，每次啟用約 3B）；256K 上下文，中英文寫作與審核都穩，速度快", en: "MoE (35B, ~3B active); 256K context, strong Chinese and English writing and review, fast" } },
  { name: "qwen3.6:27b", size: "19 GB", tier: "high", caps: ["tools", "thinking", "vision"], note: { zh: "27B dense；推理較深，適合規格撰寫", en: "27B dense; deeper reasoning, good for spec drafting" } },
  { name: "gpt-oss:120b", size: "65 GB", tier: "high", caps: ["tools", "thinking"], note: { zh: "OpenAI 開放權重；需要 80 GB 等級的 GPU", en: "OpenAI open weights; needs an 80 GB-class GPU" } },
  { name: "gemma4:31b", size: "20 GB", tier: "high", caps: ["tools", "thinking", "vision"], note: { zh: "Google Gemma 4；256K 上下文", en: "Google Gemma 4; 256K context" } },
  { name: "gpt-oss:20b", size: "14 GB", tier: "standard", caps: ["tools", "thinking"], note: { zh: "16 GB 顯示記憶體可跑；審核與清單整理", en: "Runs in 16 GB of VRAM; screening and checklist work" } },
  { name: "gemma4:26b", size: "18 GB", tier: "standard", caps: ["tools", "thinking", "vision"], note: { zh: "MoE（26B，每次啟用約 4B）；速度快", en: "MoE (26B, ~4B active); fast" } },
  { name: "qwen3.5:9b", size: "7.6 GB", tier: "light", caps: ["tools", "thinking", "vision"], note: { zh: "輕量工作（清單修訂）；8 GB 顯示記憶體可跑", en: "Light jobs (checklist edits); runs in 8 GB of VRAM" } },
  { name: "gemma4:12b", size: "8 GB", tier: "light", caps: ["tools", "thinking", "vision"], note: { zh: "輕量、256K 上下文", en: "Light, 256K context" } },
  { name: "qwen3.5:4b", size: "4 GB", tier: "light", caps: ["tools", "thinking", "vision"], note: { zh: "沒有 GPU 時也能用 CPU 跑", en: "Usable on CPU when there is no GPU" } },
];

/** Ollama model names: library/name:tag, namespace/name:tag or a registry host path */
const NAME = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){0,2}(:[a-zA-Z0-9][a-zA-Z0-9._-]{0,80})?$/;

export type Installed = { name: string; size: number; modifiedAt: string; parameterSize?: string; quantization?: string };
type Pull = { name: string; state: "running" | "done" | "error"; status: string; completed: number; total: number; error?: string; at: number };

const g = globalThis as unknown as { __sbOllamaPulls?: Map<string, Pull> };
const pulls = (g.__sbOllamaPulls ??= new Map<string, Pull>());

async function api<T>(path: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const base = ollamaBase();
  if (!base) throw new HttpError(503, "Ollama is not configured (OLLAMA_URL in .env, or /admin → Settings → Ollama URL)");
  const r = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  if (!r.ok) throw new HttpError(502, `Ollama ${r.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export async function ollamaStatus() {
  const base = ollamaBase();
  const recent = [...pulls.values()].filter((p) => p.state === "running" || Date.now() - p.at < 10 * 60_000);
  if (!base) return { configured: false as const, recommended: RECOMMENDED, pulls: recent };
  try {
    const [v, tags] = await Promise.all([
      api<{ version?: string }>("/api/version"),
      api<{ models?: { name: string; size: number; modified_at: string; details?: { parameter_size?: string; quantization_level?: string } }[] }>("/api/tags"),
    ]);
    const installed: Installed[] = (tags.models ?? []).map((m) => ({ name: m.name, size: m.size, modifiedAt: m.modified_at, parameterSize: m.details?.parameter_size, quantization: m.details?.quantization_level }));
    return { configured: true as const, base, ok: true as const, version: v.version ?? null, installed, recommended: RECOMMENDED, pulls: recent };
  } catch (e) {
    return { configured: true as const, base, ok: false as const, error: (e as Error).message.slice(0, 300), installed: [] as Installed[], recommended: RECOMMENDED, pulls: recent };
  }
}

/** Starts downloading a model into Ollama (POST /api/pull, streamed progress); refreshes the model lists when done */
export function startPull(actorId: string, name: string) {
  const model = name.trim();
  if (!NAME.test(model) || model.length > 120) throw new HttpError(400, "not an Ollama model name (e.g. qwen3.6:35b)");
  if (!ollamaBase()) throw new HttpError(503, "Ollama is not configured");
  const running = pulls.get(model);
  if (running?.state === "running") return running;
  const job: Pull = { name: model, state: "running", status: "starting", completed: 0, total: 0, at: Date.now() };
  pulls.set(model, job);
  void (async () => {
    try {
      const r = await fetch(`${ollamaBase()}/api/pull`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, stream: true }) });
      if (!r.ok || !r.body) throw new Error(`Ollama ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
      // NDJSON lines: {status, digest?, total?, completed?} per layer, then {status:"success"} (or {error})
      const layers = new Map<string, { total: number; completed: number }>();
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (!done) buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        // the last line may come without a newline
        buf = done ? "" : (lines.pop() ?? "");
        for (const l of lines) {
          if (!l.trim()) continue;
          const m = JSON.parse(l) as { status?: string; digest?: string; total?: number; completed?: number; error?: string };
          if (m.error) throw new Error(m.error);
          if (m.digest && m.total) layers.set(m.digest, { total: m.total, completed: m.completed ?? 0 });
          job.total = [...layers.values()].reduce((a, x) => a + x.total, 0);
          job.completed = [...layers.values()].reduce((a, x) => a + x.completed, 0);
          job.status = m.status ?? job.status;
          job.at = Date.now();
        }
        if (done) break;
      }
      if (job.status !== "success") throw new Error(`pull ended without success (${job.status})`);
      job.state = "done";
      await audit(actorId, "ai.ollama.pull", { type: "site", id: "ai" }, { model });
      // the new model shows up in the pickers as ollama/<name>
      const { syncCatalog } = await import("./ai-models");
      await syncCatalog(null).catch(() => undefined);
    } catch (e) {
      Object.assign(job, { state: "error", error: (e as Error).message.slice(0, 300), at: Date.now() });
    }
  })();
  return job;
}

export async function deleteModel(actorId: string, name: string) {
  const model = name.trim();
  if (!NAME.test(model)) throw new HttpError(400, "not an Ollama model name");
  await api("/api/delete", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) });
  await audit(actorId, "ai.ollama.delete", { type: "site", id: "ai" }, { model });
  const { syncCatalog } = await import("./ai-models");
  await syncCatalog(null).catch(() => undefined);
}
