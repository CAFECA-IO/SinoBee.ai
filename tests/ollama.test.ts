import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { useTestDb } from "./helpers/testdb";

useTestDb();

/** A stand-in for Ollama: native API (/api/*) and the OpenAI-compatible one (/v1/*) */
const installed = new Set<string>(["qwen3.5:4b"]);
const chats: string[] = [];
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const send = (j: unknown, status = 200) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(j));
    };
    const url = req.url!;
    if (url === "/api/version") return send({ version: "0.34.4" });
    if (url === "/api/tags") return send({ models: [...installed].map((name) => ({ name, size: 3.3e9, modified_at: "2026-10-18T00:00:00Z", details: { parameter_size: "4B", quantization_level: "Q4_K_M" } })) });
    if (url === "/v1/models") return send({ object: "list", data: [...installed].map((id) => ({ id, object: "model" })) });
    if (url === "/api/pull") {
      const { model } = JSON.parse(body);
      if (model === "no-such:model") return send({ error: "pull model manifest: file does not exist" });
      res.setHeader("content-type", "application/x-ndjson");
      res.write(JSON.stringify({ status: "pulling manifest" }) + "\n");
      for (const done of [0, 5e8, 1e9]) {
        res.write(JSON.stringify({ status: "pulling abc", digest: "sha256:abc", total: 1e9, completed: done }) + "\n");
        await new Promise((r) => setTimeout(r, 20));
      }
      installed.add(model);
      res.end(JSON.stringify({ status: "success" }) + "\n");
      return;
    }
    if (url === "/api/delete") {
      installed.delete(JSON.parse(body).model);
      res.end();
      return;
    }
    if (url === "/v1/chat/completions") {
      const j = JSON.parse(body);
      chats.push(`${j.model} ${req.headers.authorization}`);
      return send({ choices: [{ message: { content: "local pong" } }], usage: { prompt_tokens: 7, completion_tokens: 2 } });
    }
    send({ error: "no route" }, 404);
  });
});

let db: typeof import("../src/lib/db").db;
let ollama: typeof import("../src/lib/ollama");
let ai: typeof import("../src/lib/ai-models");
let admin: { id: string };

before(async () => {
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  process.env.OLLAMA_URL = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"]) delete process.env[k];
  ({ db } = await import("../src/lib/db"));
  ollama = await import("../src/lib/ollama");
  ai = await import("../src/lib/ai-models");
  admin = await db.user.create({ data: { account: "0x" + "e".repeat(40), handle: "admin" } });
});
after(() => srv.close());

test("Ollama is a model source: installed models are listed as ollama/<name> and platform jobs can use them", async () => {
  const st = await ollama.ollamaStatus();
  assert.equal(st.configured && st.ok && st.version, "0.34.4");
  assert.deepEqual(st.installed!.map((m) => m.name), ["qwen3.5:4b"]);
  assert.ok(st.recommended.length >= 5 && st.recommended.every((r) => /^[a-z0-9.-]+:[a-z0-9.]+$/.test(r.name)));

  const c = await ai.syncCatalog(admin.id);
  assert.deepEqual(c.ollama.models.map((m) => m.id), ["qwen3.5:4b"]);
  await ai.saveTierConfig(admin.id, { tiers: { high: [], standard: [], light: ["ollama/qwen3.5:4b"] }, jobs: { spec: "light", screening: "light", checklist: "light", pricing: "light" } });
  const { platformChat } = await import("../src/lib/platform-model");
  const r = await platformChat({ job: "spec", system: "s", messages: [{ role: "user", content: "ping" }], maxTokens: 50 });
  assert.equal(r.text, "local pong");
  assert.equal(r.modelId, "ollama/qwen3.5:4b");
  assert.deepEqual(chats, ["qwen3.5:4b Bearer ollama"]);

  // added to Model prices without an AI price lookup: local models cost nothing
  const added = await ai.addModelsWithAiPrices(admin.id, ["ollama/qwen3.5:4b"]);
  assert.deepEqual(added[0].usd, { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
});

test("admins pull models from the admin page: progress, then the model lists include it; bad names and failures are reported", async () => {
  const job = ollama.startPull(admin.id, "qwen3.6:35b");
  assert.equal(job.state, "running");
  for (let i = 0; i < 50 && job.state === "running"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(job.state, "done");
  assert.deepEqual([job.completed, job.total], [1e9, 1e9]);
  await new Promise((r) => setTimeout(r, 50)); // the catalog sync after the pull
  assert.ok((await ai.modelCatalogFromApi()).ollama.models.some((m) => m.id === "qwen3.6:35b"));

  assert.throws(() => ollama.startPull(admin.id, "rm -rf /"), /not an Ollama model name/);
  const bad = ollama.startPull(admin.id, "no-such:model");
  for (let i = 0; i < 50 && bad.state === "running"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(bad.state, "error");
  assert.match(bad.error!, /file does not exist/);

  await ollama.deleteModel(admin.id, "qwen3.6:35b");
  assert.ok(!installed.has("qwen3.6:35b"));
});
