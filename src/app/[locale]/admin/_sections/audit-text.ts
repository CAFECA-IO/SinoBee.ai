import { getTranslations } from "next-intl/server";

type Row = { action: string; targetType: string | null; targetId: string | null; detail: unknown; actor: { handle: string | null; publisher: string | null; account: string } | null };

/** "skill.approve" → the key under admin.au.action */
export const actionKey = (a: string) => a.replace(/[.-]/g, "_");

export const actorName = (a: Row["actor"]) => (a ? `@${a.handle ?? a.publisher ?? a.account.slice(0, 10)}` : null);

/** One readable line for an audit row: who did what to which */
export async function auditSummary(a: Row) {
  const t = await getTranslations("admin.au");
  const key = actionKey(a.action);
  const label = t.has(`action.${key}`) ? t(`action.${key}`) : a.action;
  const who = actorName(a.actor) ?? t("system");
  const target = a.targetType ? `${a.targetType}:${shortId(a.targetId)}` : "";
  return `${who} ${label}${target ? ` · ${target}` : ""}`;
}

export const shortId = (id: string | null) => (!id ? "" : id.length > 14 ? `${id.slice(0, 8)}…` : id);

export type Change = { key: string; before: string; after: string };

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** before/after pairs from an audit detail, or plain key/value pairs */
export function auditDetail(detail: unknown): { changes: Change[]; fields: [string, string][] } {
  if (!detail || typeof detail !== "object") return { changes: [], fields: detail === null || detail === undefined ? [] : [["", show(detail)]] };
  const d = detail as Record<string, unknown>;
  const changes: Change[] = [];
  const fields: [string, string][] = [];
  if (d.before && d.after && typeof d.before === "object" && typeof d.after === "object") {
    const b = d.before as Record<string, unknown>, a = d.after as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])]) if (show(b[k]) !== show(a[k])) changes.push({ key: k, before: show(b[k]), after: show(a[k]) });
  }
  for (const [k, v] of Object.entries(d)) if (k !== "before" && k !== "after") fields.push([k, show(v)]);
  return { changes, fields };
}
