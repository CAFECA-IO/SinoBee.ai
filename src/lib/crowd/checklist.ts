import { db } from "../db";
import { config } from "../config";
import { HttpError } from "../errors";
import { currentModels } from "../models";
import { audit } from "../roles";
import type { Prisma } from "@/generated/prisma/client";
import { DEFAULT_CHECKLIST, DIMENSIONS, type ChecklistItem, type Dimension } from "./checklist-default";

/**
 * The proposal screening checklist (yes/no items in six dimensions). The newest published version is the one
 * proposals are screened against and the one shown in the crowdfunding terms. Admins edit a draft by hand or by
 * talking to a model, then publish it as a new version (at least MIN_ITEMS items, every dimension present).
 */

export const MIN_ITEMS = 100;
export { DIMENSIONS, type ChecklistItem, type Dimension };

const PREFIX: Record<Dimension, string> = { legal: "L", privacy: "P", ip: "I", safety: "S", feasibility: "F", spec: "V" };

export type Checklist = { version: number; items: ChecklistItem[]; publishedAt: Date | null; note: string | null };

const view = (r: { version: number; items: unknown; publishedAt: Date | null; note: string | null }): Checklist => ({ version: r.version, items: r.items as ChecklistItem[], publishedAt: r.publishedAt, note: r.note });

/** The published checklist in force (version 1 = the built-in default, created on first use) */
export async function currentChecklist(): Promise<Checklist> {
  const row = await db.checklistVersion.findFirst({ where: { publishedAt: { not: null } }, orderBy: { version: "desc" } });
  if (row) return view(row);
  try {
    const created = await db.checklistVersion.create({ data: { version: 1, items: DEFAULT_CHECKLIST as unknown as Prisma.InputJsonValue, note: "Initial checklist", publishedAt: new Date() } });
    return view(created);
  } catch {
    // created concurrently
    return view(await db.checklistVersion.findFirstOrThrow({ where: { publishedAt: { not: null } }, orderBy: { version: "desc" } }));
  }
}

export async function checklistVersion(version: number): Promise<Checklist | null> {
  const row = await db.checklistVersion.findFirst({ where: { version, publishedAt: { not: null } } });
  return row ? view(row) : null;
}

export async function publishedVersions() {
  await currentChecklist();
  return db.checklistVersion.findMany({ where: { publishedAt: { not: null } }, orderBy: { version: "desc" }, select: { version: true, note: true, publishedAt: true, items: true } });
}

/** The admins' working draft (a copy of the current version until someone changes it) */
export async function draftChecklist(): Promise<Checklist & { changed: boolean }> {
  const cur = await currentChecklist();
  const row = await db.checklistVersion.findFirst({ where: { publishedAt: null } });
  if (!row) return { ...cur, version: 0, publishedAt: null, note: null, changed: false };
  return { ...view(row), changed: JSON.stringify(row.items) !== JSON.stringify(cur.items) };
}

/** Clean and check a list: ids kept or assigned, texts trimmed, dimensions known */
export function normalizeItems(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "items must be a list");
  const used = new Set<string>();
  const next: Record<string, number> = {};
  const items: ChecklistItem[] = [];
  for (const r of raw) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const dimension = String(o.dimension ?? "") as Dimension;
    if (!(DIMENSIONS as readonly string[]).includes(dimension)) throw new HttpError(400, `unknown dimension: ${String(o.dimension)}`);
    const zh = String(o.zh ?? "").trim().slice(0, 500);
    const en = String(o.en ?? "").trim().slice(0, 500);
    if (!zh || !en) throw new HttpError(400, "every item needs both the Chinese and the English text");
    let id = typeof o.id === "string" && /^[A-Z]\d{2,3}$/.test(o.id) && o.id.startsWith(PREFIX[dimension]) && !used.has(o.id) ? o.id : "";
    items.push({ id, dimension, zh, en });
    if (id) used.add(id);
  }
  // new items get the next free number in their dimension
  for (const it of items) {
    if (it.id) continue;
    const p = PREFIX[it.dimension];
    let n = next[p] ?? Math.max(0, ...[...used].filter((x) => x.startsWith(p)).map((x) => Number(x.slice(1))));
    let id = "";
    do id = `${p}${String(++n).padStart(2, "0")}`;
    while (used.has(id));
    next[p] = n;
    it.id = id;
    used.add(id);
  }
  return items;
}

/** What blocks publishing (empty = ok) */
export function checklistProblems(items: ChecklistItem[]): string[] {
  const out: string[] = [];
  if (items.length < MIN_ITEMS) out.push(`at least ${MIN_ITEMS} items are required (now ${items.length})`);
  for (const d of DIMENSIONS) if (!items.some((i) => i.dimension === d)) out.push(`dimension ${d} has no items`);
  return out;
}

export async function saveDraft(actorId: string, raw: unknown) {
  const items = normalizeItems(raw);
  const row = await db.checklistVersion.findFirst({ where: { publishedAt: null } });
  if (row) await db.checklistVersion.update({ where: { id: row.id }, data: { items: items as unknown as Prisma.InputJsonValue, createdById: actorId } });
  else await db.checklistVersion.create({ data: { version: 0, items: items as unknown as Prisma.InputJsonValue, createdById: actorId } });
  return items;
}

export async function discardDraft() {
  await db.checklistVersion.deleteMany({ where: { publishedAt: null } });
}

/** Publish the draft as the next version; it applies to every proposal screened from now on */
export async function publishDraft(actorId: string, note: string) {
  const text = note.trim().slice(0, 2000);
  if (!text) throw new HttpError(400, "describe what changed");
  const draft = await db.checklistVersion.findFirst({ where: { publishedAt: null } });
  if (!draft) throw new HttpError(400, "there is no draft to publish");
  const items = normalizeItems(draft.items);
  const problems = checklistProblems(items);
  if (problems.length) throw new HttpError(400, problems.join("; "));
  const cur = await currentChecklist();
  if (JSON.stringify(items) === JSON.stringify(cur.items)) throw new HttpError(400, "the draft is the same as the current version");
  const version = cur.version + 1;
  await db.checklistVersion.update({ where: { id: draft.id }, data: { version, items: items as unknown as Prisma.InputJsonValue, note: text, publishedAt: new Date(), createdById: actorId } });
  await audit(actorId, "crowd.checklist.publish", { type: "checklist", id: String(version) }, { note: text, items: items.length });
  // the crowdfunding terms list the checklist: snapshot and notarize the new text
  const { snapshotAllLegal } = await import("../legal-versions");
  await snapshotAllLegal().catch((e) => console.warn("legal snapshot", (e as Error).message));
  return { version, items };
}

// ───────────── editing with a model ─────────────

/** Ask a model to change the draft as the admin describes; the result is saved as the draft (not published) */
export async function editDraftWithAi(actorId: string, instruction: string): Promise<{ items: ChecklistItem[]; reply: string }> {
  const text = instruction.trim().slice(0, 4000);
  if (!text) throw new HttpError(400, "describe the change");
  const draft = await draftChecklist();
  const models = await currentModels();
  const model = models.find((m) => m.modelId === config.crowd.specModel) ?? models.find((m) => m.enabled);
  const provider = model?.modelId.split("/")[0] ?? "";
  const p = config.llm.providers[provider];
  if (!model || !p?.key) {
    if (process.env.NODE_ENV === "production") throw new HttpError(503, "no model available");
    // development stand-in: echo the draft unchanged
    return { items: await saveDraft(actorId, draft.items), reply: "(development stand-in) No model key is configured; the draft is unchanged." };
  }
  const system = [
    "You maintain the screening checklist for crowdfunding proposals on SinoBee.ai (AI agent tasks).",
    `Every item is a yes/no question where "yes" means the proposal complies. Dimensions: ${DIMENSIONS.join(", ")}.`,
    `Keep at least ${MIN_ITEMS} items and every dimension. Keep the ids of items you keep; omit the id for new items.`,
    "Each item needs Traditional Chinese (zh) and English (en) text, one sentence each, checkable from the proposal text alone.",
    'Answer with ONE JSON object only: {"reply": "<what you changed, in the admin\'s language>", "items": [{"id"?, "dimension", "zh", "en"}, ...]} — the full list.',
  ].join("\n");
  const user = `Current draft:\n${JSON.stringify(draft.items)}\n\nChange requested:\n${text}`;
  const upstream = model.modelId.split("/").slice(1).join("/");
  const r =
    p.kind === "anthropic"
      ? await fetch(`${p.base}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: upstream, system, messages: [{ role: "user", content: user }], max_tokens: 16000 }) })
      : await fetch(`${p.base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.key}` }, body: JSON.stringify({ model: upstream, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 16000 }) });
  const j = (await r.json().catch(() => ({}))) as { content?: { text?: string }[]; choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!r.ok) throw new HttpError(502, `model error: ${j.error?.message ?? r.status}`);
  const out = p.kind === "anthropic" ? (j.content ?? []).map((c) => c.text ?? "").join("") : (j.choices?.[0]?.message?.content ?? "");
  let parsed: { reply?: unknown; items?: unknown };
  try {
    parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  } catch {
    throw new HttpError(502, "the model did not return a checklist");
  }
  const items = await saveDraft(actorId, parsed.items);
  return { items, reply: typeof parsed.reply === "string" ? parsed.reply : "" };
}

/** The checklist as markdown for the crowdfunding terms */
export function checklistMarkdown(c: Checklist, locale: string): string {
  const zh = locale.startsWith("zh");
  const names: Record<Dimension, [string, string]> = {
    legal: ["合法性", "Legality"],
    privacy: ["個資與隱私", "Privacy and personal data"],
    ip: ["智慧財產權", "Intellectual property"],
    safety: ["安全與倫理", "Safety and ethics"],
    feasibility: ["技術可行性", "Feasibility"],
    spec: ["規格完整與可驗收", "Spec and acceptance"],
  };
  const lines: string[] = [];
  DIMENSIONS.forEach((d, i) => {
    const items = c.items.filter((x) => x.dimension === d);
    if (!items.length) return;
    lines.push(`### ${i + 1}. ${zh ? names[d][0] : names[d][1]}（${items.length}）`.replace("（", zh ? "（" : " (").replace("）", zh ? "）" : ")"), "");
    for (const it of items) lines.push(`- **${it.id}** ${zh ? it.zh : it.en}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}
