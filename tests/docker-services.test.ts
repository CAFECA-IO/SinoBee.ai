import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setEnv } from "../scripts/docker-services";

test("setEnv replaces the key's line (commented or not), appends new keys and keeps the rest; .env is mode 600", () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "env-")), ".env");
  writeFileSync(f, "# PostgreSQL\nDATABASE_URL=\nSQLITE_PATH=./data/sinobee.db\n# OLLAMA_URL=http://old:11434\n");
  const saved = { d: process.env.DATABASE_URL, o: process.env.OLLAMA_URL, c: process.env.COMFYUI_URL };
  try {
    setEnv(f, "DATABASE_URL", "postgresql://sb_1:pw@127.0.0.1:15432/sinobee");
    setEnv(f, "OLLAMA_URL", "http://127.0.0.1:11434");
    setEnv(f, "COMFYUI_URL", "http://127.0.0.1:8188");
    assert.equal(
      readFileSync(f, "utf8"),
      "# PostgreSQL\nDATABASE_URL=postgresql://sb_1:pw@127.0.0.1:15432/sinobee\nSQLITE_PATH=./data/sinobee.db\nOLLAMA_URL=http://127.0.0.1:11434\nCOMFYUI_URL=http://127.0.0.1:8188\n",
    );
    assert.equal(statSync(f).mode & 0o777, 0o600);
    assert.equal(process.env.OLLAMA_URL, "http://127.0.0.1:11434");
  } finally {
    for (const [k, v] of [["DATABASE_URL", saved.d], ["OLLAMA_URL", saved.o], ["COMFYUI_URL", saved.c]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("task containers reach the swarm's Ollama / H3 by name on the sinobee network; remote servers are passed on", async () => {
  const { taskServices, config } = await import("../src/lib/config");
  assert.deepEqual(taskServices({ OLLAMA_URL: "http://127.0.0.1:11434", COMFYUI_URL: "http://localhost:8188" }), {
    ollama: "http://sinobee-ollama:11434",
    comfyui: "http://sinobee-h3:8188",
    local: true,
  });
  assert.deepEqual(taskServices({ OLLAMA_URL: "http://gpu-box:11434/", COMFYUI_URL: "" }), { ollama: "http://gpu-box:11434", comfyui: null, local: false });
  const saved = { o: process.env.OLLAMA_URL, c: process.env.COMFYUI_URL };
  process.env.OLLAMA_URL = "http://127.0.0.1:11434";
  process.env.COMFYUI_URL = "http://127.0.0.1:8188";
  try {
    const env = Object.fromEntries(config.runner.containerEnv);
    assert.equal(env.SINOBEE_OLLAMA_URL, "http://sinobee-ollama:11434");
    assert.equal(env.OLLAMA_HOST, "http://sinobee-ollama:11434");
    assert.equal(env.COMFYUI_URL, "http://sinobee-h3:8188");
    assert.equal(config.runner.network, "sinobee");
  } finally {
    for (const [k, v] of [["OLLAMA_URL", saved.o], ["COMFYUI_URL", saved.c]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
