import { config } from "../config";
import { HttpError } from "../errors";
import { s3CostUsd } from "../pricing";

/**
 * Crowdfunding rules (numbers come from /admin → Settings → Crowdfunding).
 *
 *  share         NT$30 by default; backers pledge 1, 5 or 20 shares at a time
 *  proposal fee  NT$30, non-refundable, becomes credit for the spec dialogue (tokens) and storage; when the credit
 *                runs out the dialogue stops until another fee is bought; unused credit joins the budget when funded
 *  durations     7 / 30 / 90 / 180 days, service fee 0 / 3 / 6 / 10 % of what is collected
 *  goal          P90 cost estimate grossed up for the fee, rounded up to whole shares
 *  files         50 MB of reference files at storage cost; every further started 50 MB block uses one share of credit
 */

export const SHARE_OPTIONS = [1, 5, 20] as const;

export const sharePrice = () => Math.max(1, Math.round(config.crowd.sharePrice));

/** Offered durations with their fee rate, shortest first */
export function durations(): { days: number; rate: number }[] {
  return Object.entries(config.crowd.feeRates)
    .map(([d, r]) => ({ days: Number(d), rate: r }))
    .sort((a, b) => a.days - b.days);
}

export function feeRate(days: number): number {
  const r = config.crowd.feeRates[days];
  if (r === undefined) throw new HttpError(400, `crowdfunding period must be one of ${durations().map((d) => d.days).join(", ")} days`);
  return r;
}

/** Round up to whole shares */
export const toShares = (twd: number) => Math.ceil(Math.max(0, twd) / sharePrice() - 1e-9) * sharePrice();

/** Smallest goal that still covers the P90 estimate after the service fee */
export function minimumGoal(p90Twd: number, rate: number): number {
  return Math.max(sharePrice(), toShares(p90Twd / (1 - rate)));
}

/** Service fee on an amount collected (whole TWD, rounded half up) */
export const serviceFee = (amount: number, rate: number) => Math.round(amount * rate);

/** How many paid blocks of extra file space `bytes` of reference files need */
export function fileBlocks(bytes: number): number {
  const over = bytes - config.crowd.freeFileBytes;
  return over > 0 ? Math.ceil(over / config.crowd.blockBytes) : 0;
}

/** Proposal credit (TWD) needed to add a file of `size` bytes when `before` bytes are already stored */
export function fileCost(before: number, size: number, fx: number): { storage: number; blocks: number; total: number } {
  // keep it for the longest campaign plus the results retention
  const longest = Math.max(...durations().map((d) => d.days), 0);
  const storage = s3CostUsd(size, longest + config.crowd.resultsDays, 1, 3) * fx * config.pricing.markup;
  const blocks = fileBlocks(before + size) - fileBlocks(before);
  const total = Math.ceil((storage + blocks * sharePrice()) * 1e6) / 1e6;
  return { storage, blocks, total };
}

/** The proposal spec the dialogue produces (stored on Task.spec) */
export type Spec = {
  summary: string;
  scope?: string;
  outOfScope?: string;
  deliverables: string[];
  method: string[];
  acceptance: string[];
  estimate: { p50Twd: number; p90Twd: number; basis?: string };
  stretch?: { title: string; twd: number }[];
  risks?: string[];
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max: number, each = 500) =>
  Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : typeof v === "string" && v.trim() ? [v.trim().slice(0, each)] : [];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);

/** Clean whatever the model or the editor sent into a Spec (missing parts become empty) */
export function normalizeSpec(v: unknown): Spec {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const e = (o.estimate && typeof o.estimate === "object" ? o.estimate : {}) as Record<string, unknown>;
  const p50 = num(e.p50Twd);
  const p90 = Math.max(num(e.p90Twd), p50);
  const stretch = Array.isArray(o.stretch)
    ? o.stretch
        .map((s) => (s && typeof s === "object" ? { title: str((s as Record<string, unknown>).title, 200), twd: num((s as Record<string, unknown>).twd) } : null))
        .filter((s): s is { title: string; twd: number } => !!s && !!s.title && s.twd > 0)
        .slice(0, 3)
    : [];
  return {
    summary: str(o.summary, 2000),
    scope: str(o.scope, 4000) || undefined,
    outOfScope: str(o.outOfScope, 2000) || undefined,
    deliverables: list(o.deliverables, 20),
    method: list(o.method, 20),
    acceptance: list(o.acceptance, 10),
    estimate: { p50Twd: p50, p90Twd: p90, basis: str(e.basis, 1000) || undefined },
    stretch,
    risks: list(o.risks, 10),
  };
}

/** What still blocks opening the campaign (empty = ready) */
export function specGaps(s: Spec | null): string[] {
  if (!s) return ["spec"];
  const gaps: string[] = [];
  if (!s.summary) gaps.push("summary");
  if (!s.deliverables.length) gaps.push("deliverables");
  if (!s.method.length) gaps.push("method");
  if (!s.acceptance.length) gaps.push("acceptance");
  if (!(s.estimate.p90Twd > 0)) gaps.push("estimate");
  return gaps;
}

/** The spec as the instructions the agent receives (Task.prompt once funding opens) */
export function specMarkdown(title: string, description: string, s: Spec): string {
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  const numbered = (xs: string[]) => xs.map((x, i) => `${i + 1}. ${x}`).join("\n");
  return [
    `# ${title}`,
    "",
    description,
    "",
    "## Summary",
    s.summary,
    s.scope ? `\n## Scope\n${s.scope}` : "",
    s.outOfScope ? `\n## Out of scope\n${s.outOfScope}` : "",
    "",
    "## Deliverables",
    bullets(s.deliverables),
    "",
    "## Method and milestones",
    numbered(s.method),
    "",
    "## Acceptance criteria",
    numbered(s.acceptance),
    s.risks?.length ? `\n## Risks and assumptions\n${bullets(s.risks)}` : "",
  ]
    .filter((x) => x !== "")
    .join("\n")
    .trim();
}

/** How many stretch goals (in spec order, cumulative amounts) the money collected beyond the goal pays for */
export function unlockedStretch(spec: Pick<Spec, "stretch"> | null, goal: number, collected: number): number {
  let extra = collected - goal;
  let n = 0;
  for (const s of spec?.stretch ?? []) {
    if (extra < s.twd) break;
    extra -= s.twd;
    n++;
  }
  return n;
}

/** The agent's acceptance self-check (outputs/acceptance.json) */
export type Acceptance = { criteria: { criterion: string; passed: boolean; evidence?: string }[]; summary?: string };

export function normalizeAcceptance(v: unknown): Acceptance | null {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o || !Array.isArray(o.criteria)) return null;
  const criteria = o.criteria
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : null))
    .filter((c): c is Record<string, unknown> => !!c && typeof c.criterion === "string")
    .slice(0, 20)
    .map((c) => ({ criterion: String(c.criterion).slice(0, 500), passed: c.passed === true, evidence: typeof c.evidence === "string" ? c.evidence.slice(0, 1000) : undefined }));
  return { criteria, summary: typeof o.summary === "string" ? o.summary.slice(0, 4000) : undefined };
}
