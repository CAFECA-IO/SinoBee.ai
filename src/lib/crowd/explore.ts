import { db, icontains } from "../db";
import { isCategory } from "./rules";

/**
 * The public crowdfunding directory: open campaigns (sorted by ending soon, almost funded, popular or newest) and
 * funded ones. Totals are computed here so the page needs one query per list.
 */

export const SORTS = ["ending", "almost", "popular", "newest"] as const;
export type Sort = (typeof SORTS)[number];

export type CampaignCard = {
  id: string;
  title: string;
  category: string | null;
  status: string;
  goalTwd: number;
  pledged: number;
  backers: number;
  deadlineAt: Date | null;
  createdAt: Date;
  proposer: string;
  proposerId: string;
};

export async function listCampaigns(opts: { view?: "open" | "funded"; sort?: string; category?: string; q?: string; take?: number }): Promise<CampaignCard[]> {
  const funded = opts.view === "funded";
  const q = opts.q?.trim().slice(0, 100);
  const rows = await db.task.findMany({
    where: {
      crowdfund: true,
      isPublic: true,
      takenDownAt: null,
      status: funded ? { in: ["QUEUED", "RUNNING", "NEEDS_FUNDING", "IN_REVIEW", "COMPLETED"] } : { in: ["FUNDING", "CHARGING"] },
      ...(isCategory(opts.category) ? { category: opts.category } : {}),
      ...(q ? { title: icontains(q) } : {}),
    },
    include: { user: true, pledges: { where: { status: { in: ["ACTIVE", "CHARGED", "FAILED"] } }, select: { amountTwd: true, userId: true } } },
    orderBy: funded ? { fundedAt: "desc" } : { createdAt: "desc" },
    take: 300,
  });
  const cards = rows.map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    status: t.status,
    goalTwd: t.goalTwd ?? 0,
    pledged: t.pledges.reduce((a, p) => a + p.amountTwd, 0),
    backers: new Set(t.pledges.map((p) => p.userId)).size,
    deadlineAt: t.deadlineAt,
    createdAt: t.createdAt,
    proposer: t.user.publisher ?? (t.user.handle ? `@${t.user.handle}` : `${t.user.account.slice(0, 6)}…`),
    proposerId: t.userId,
  }));
  const sort = (SORTS as readonly string[]).includes(opts.sort ?? "") ? (opts.sort as Sort) : "ending";
  if (!funded) {
    const ratio = (c: CampaignCard) => c.pledged / Math.max(1, c.goalTwd);
    if (sort === "ending") cards.sort((a, b) => (a.deadlineAt?.getTime() ?? Infinity) - (b.deadlineAt?.getTime() ?? Infinity));
    if (sort === "almost") cards.sort((a, b) => ratio(b) - ratio(a));
    if (sort === "popular") cards.sort((a, b) => b.backers - a.backers || b.pledged - a.pledged);
    if (sort === "newest") cards.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  return cards.slice(0, opts.take ?? 60);
}
