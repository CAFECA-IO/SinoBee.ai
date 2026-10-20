import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { useTestDb } from "./helpers/testdb";
import { COMBOS, payload } from "./helpers/bench-fixture";

/** Evaluation report design R2 (2026-10-21): every trial's outputs are uploaded by hash and shown in the report */
const { dir } = useTestDb();
process.env.STORAGE_LOCAL_DIR = path.join(dir, "storage");
let db: typeof import("../src/lib/db").db;
let O: typeof import("../src/lib/eval-outputs");
let put: typeof import("../src/app/api/v1/evals/outputs/[sha]/route");
let get: typeof import("../src/app/api/v1/evals/[id]/outputs/route");
let route: typeof import("../src/app/api/v1/evals/route");
let userId = "";
let tok = "";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const HTML = Buffer.from('<html><head><link rel="stylesheet" href="s.css"></head><body><img src="img/a.png"><img src="../../etc/passwd"><script src="app.js"></script><p>額定風速 12 m/s</p></body></html>');
const PNG = Buffer.from("89504e470d0a1a0a00", "hex");
const CSS = Buffer.from("body{color:red}");
const JS = Buffer.from("console.log('</script>')");

before(async () => {
  ({ db } = await import("../src/lib/db"));
  O = await import("../src/lib/eval-outputs");
  put = await import("../src/app/api/v1/evals/outputs/[sha]/route");
  get = await import("../src/app/api/v1/evals/[id]/outputs/route");
  route = await import("../src/app/api/v1/evals/route");
  userId = (await db.user.create({ data: { account: "0x" + "7".repeat(40), handle: "bee2" } })).id;
  tok = "sbh_" + randomBytes(24).toString("base64url");
  await db.apiToken.create({ data: { userId, name: "device: test", prefix: tok.slice(0, 10), tokenHash: sha(tok), scopes: "evals:write" } });
});

const upload = (body: Buffer, h = sha(body), auth = true) => put.PUT(
  new Request(`http://localhost/api/v1/evals/outputs/${h}`, { method: "PUT", headers: auth ? { authorization: `Bearer ${tok}` } : {}, body: new Uint8Array(body) }),
  { params: Promise.resolve({ sha: h }) });
const read = (id: number, q: string) => get.GET(new Request(`http://localhost/api/v1/evals/${id}/outputs?${q}`), { params: Promise.resolve({ id: String(id) }) });

test("an output is stored by its hash, only by a signed-in SinoBee, only when the hash matches", async () => {
  assert.equal((await upload(HTML, sha(HTML), false)).status, 401);
  assert.equal((await upload(HTML, sha("other"))).status, 400);
  for (const b of [HTML, PNG, CSS, JS]) assert.equal((await upload(b)).status, 201);
  assert.equal((await upload(HTML)).status, 201);                 // the same file again: fine
});

async function publish(visibility = "public") {
  const p = payload(COMBOS.opusFlash, { visibility });
  const files = [["index.html", HTML], ["img/a.png", PNG], ["s.css", CSS], ["app.js", JS]] as const;
  for (const t of p.tasks[0].trials as { outputs: unknown[]; grades: { evidence?: string; where?: unknown }[] }[]) {
    t.outputs = files.map(([n, b]) => ({ path: n, kind: n.endsWith(".png") ? "image" : "text", bytes: b.length, sha256: sha(b), uploaded: true }));
    t.outputs.push({ path: "big.png", kind: "image", bytes: 9e6, sha256: sha("never sent"), uploaded: false });
    t.grades[0] = { ...t.grades[0], evidence: "額定風速 12 m/s", where: { file: "index.html", start: 10, end: 20 } };
  }
  const r = await route.POST(new Request("http://localhost/api/v1/evals", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(p) }));
  assert.equal(r.status, 201, await r.clone().text());
  return (await r.json()).id as number;
}

test("a report serves only the files it lists, as data, and an HTML output as one sandbox page", async () => {
  const id = await publish();
  const saved = await db.benchEval.findUnique({ where: { id } });
  const out = (saved!.data as { tasks: { trials: { outputs: { sha256: string; uploaded: boolean }[]; grades: { where?: unknown }[] }[] }[] }).tasks[0].trials[0];
  assert.equal(out.outputs[0].sha256, sha(HTML));
  assert.deepEqual(out.grades[0].where, { file: "index.html", start: 10, end: 20 });

  const f = await read(id, `sha=${sha(HTML)}&path=index.html`);
  assert.equal(f.status, 200);
  assert.match(f.headers.get("content-type")!, /^text\/plain/);           // never rendered as a page on this origin
  assert.match(f.headers.get("content-security-policy")!, /sandbox/);
  assert.equal(Buffer.from(await f.arrayBuffer()).toString(), HTML.toString());
  assert.equal((await read(id, `sha=${sha(PNG)}&path=img/a.png`)).headers.get("content-type"), "image/png");
  assert.equal((await read(id, `sha=${sha("never sent")}&path=big.png`)).status, 404);   // listed, not uploaded
  assert.equal((await read(id, `sha=${"0".repeat(64)}`)).status, 404);                   // not in this report

  const pg = await (await read(id, `page=1&task=youtube-roadster&trial=1&path=index.html`)).json();
  assert.match(pg.html, /connect-src 'none'/);
  assert.match(pg.html, /data:image\/png;base64,/);
  assert.match(pg.html, /body\{color:red\}/);
  assert.match(pg.html, /<\\\/script>/);
  assert.match(pg.html, /src="\.\.\/\.\.\/etc\/passwd"/);                 // outside the trial: left as is (blocked by the CSP)
  assert.match(pg.html, /sinobeeFind/);
  assert.equal((await read(id, `page=1&task=youtube-roadster&trial=1&path=big.png`)).status, 404);
});

test("a private report's outputs are its publisher's only", async () => {
  const id = await publish("private");
  assert.equal((await read(id, `sha=${sha(HTML)}&path=index.html`)).status, 404);
  const own = await get.GET(new Request(`http://localhost/api/v1/evals/${id}/outputs?sha=${sha(HTML)}&path=index.html`, { headers: { authorization: `Bearer ${tok}` } }), { params: Promise.resolve({ id: String(id) }) });
  assert.equal(own.status, 200);
});

test("paths stay inside the trial", () => {
  assert.equal(O.resolveRel("index.html", "img/a.png"), "img/a.png");
  assert.equal(O.resolveRel("pages/index.html", "../img/a.png"), "img/a.png");
  assert.equal(O.resolveRel("index.html", "../x"), null);
  assert.equal(O.resolveRel("index.html", "https://evil.example/x.js"), null);
  assert.equal(O.resolveRel("index.html", "//evil.example/x.js"), null);
  assert.equal(O.kindOf("a.HTML"), "html");
  assert.equal(O.serveType("x.svg"), "image/svg+xml");
  assert.match(O.serveType("x.html"), /^text\/plain/);
});
