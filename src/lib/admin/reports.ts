import { db } from "../db";

export type ReportTarget = { title: string; href: string; owner: string | null; gone: boolean };

const handle = (u: { handle: string | null; publisher: string | null; account: string } | null) => (u ? u.handle ?? u.publisher ?? u.account.slice(0, 10) : null);

/** What each reported thing is (title, link, owner), so an admin can judge a report without opening it first */
export async function reportTargets(rows: { targetType: string; targetId: string }[]): Promise<Map<string, ReportTarget>> {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.targetType === type).map((r) => r.targetId))];
  const [tasks, shares, tools] = await Promise.all([
    db.task.findMany({ where: { id: { in: ids("task") } }, select: { id: true, title: true, user: true } }),
    db.conversationShare.findMany({ where: { id: { in: ids("share") } }, select: { id: true, title: true, owner: true } }),
    db.tool.findMany({ where: { id: { in: ids("tool") } }, select: { id: true, name: true, owner: true } }),
  ]);
  const out = new Map<string, ReportTarget>();
  for (const t of tasks) out.set(`task:${t.id}`, { title: t.title, href: `/tasks/${t.id}`, owner: handle(t.user), gone: false });
  for (const s of shares) out.set(`share:${s.id}`, { title: s.title, href: `/s/${s.id}`, owner: handle(s.owner), gone: false });
  for (const t of tools) out.set(`tool:${t.id}`, { title: `${t.owner.publisher ?? handle(t.owner)}/${t.name}`, href: `/tools/${t.owner.publisher ?? t.owner.account}/${t.name}`, owner: handle(t.owner), gone: false });
  for (const r of rows) {
    const k = `${r.targetType}:${r.targetId}`;
    if (!out.has(k)) out.set(k, { title: r.targetId, href: r.targetType === "share" ? `/s/${r.targetId}` : r.targetType === "task" ? `/tasks/${r.targetId}` : "#", owner: null, gone: true });
  }
  return out;
}
