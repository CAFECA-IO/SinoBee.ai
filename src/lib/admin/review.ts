import { db, icontains } from "../db";
import { HttpError } from "../errors";
import type { ToolManifest } from "../tools/spec";
import { fileChanges, lineDiff } from "./diff";

/** Content review in /admin: skill and tool versions in one queue */

export type ReviewKind = "skill" | "tool";
export type ReviewStatusFilter = "pending" | "approved" | "rejected";
export const REVIEW_STATUSES: ReviewStatusFilter[] = ["pending", "approved", "rejected"];

const STATUS = {
  pending: ["PENDING_REVIEW"],
  approved: ["APPROVED"],
  rejected: ["REJECTED", "REVOKED"],
} as const;

export type QueueItem = {
  kind: ReviewKind;
  id: string;
  name: string;
  version: string;
  status: string;
  findings: number;
  verdict: string;
  since: Date;
};

export async function reviewQueue(opts: { kind?: ReviewKind; status: ReviewStatusFilter; q?: string; take?: number }): Promise<QueueItem[]> {
  const take = opts.take ?? 200;
  const status = { in: [...STATUS[opts.status]] };
  const q = opts.q?.trim();
  const asc = opts.status === "pending";
  const [skills, tools] = await Promise.all([
    opts.kind === "tool"
      ? []
      : db.skillVersion.findMany({
          where: { status, ...(q ? { OR: [{ skill: { name: icontains(q) } }, { skill: { publisher: { publisher: icontains(q) } } }] } : {}) },
          include: { skill: { include: { publisher: true } } },
          orderBy: { publishedAt: asc ? "asc" : "desc" },
          take,
        }),
    opts.kind === "skill"
      ? []
      : db.toolVersion.findMany({
          where: { status, ...(q ? { OR: [{ tool: { name: icontains(q) } }, { tool: { owner: { publisher: icontains(q) } } }] } : {}) },
          include: { tool: { include: { owner: true } } },
          orderBy: { publishedAt: asc ? "asc" : "desc" },
          take,
        }),
  ]);
  const items: QueueItem[] = [
    ...skills.map((v) => ({
      kind: "skill" as const, id: v.id, name: `${v.skill.publisher.publisher}/${v.skill.name}`, version: v.version, status: v.status,
      findings: (v.scanFindings as unknown[]).length, verdict: v.scanVerdict, since: v.publishedAt,
    })),
    ...tools.map((v) => {
      const findings = (v.scanFindings as unknown[]).length;
      return {
        kind: "tool" as const, id: v.id, name: `${v.tool.owner.publisher ?? v.tool.owner.account.slice(0, 10)}/${v.tool.name}`, version: v.version, status: v.status,
        findings, verdict: findings ? "WARNING" : "CLEAN", since: v.publishedAt,
      };
    }),
  ];
  items.sort((a, b) => (asc ? a.since.getTime() - b.since.getTime() : b.since.getTime() - a.since.getTime()));
  return items.slice(0, take);
}

export type Finding = { where: string; rule: string; excerpt: string };

/** One version with everything the reviewer needs: findings, the previous version and what changed since */
export async function reviewDetail(kind: ReviewKind, id: string) {
  if (kind === "skill") {
    const v = await db.skillVersion.findUnique({ where: { id }, include: { skill: { include: { publisher: true } } } });
    if (!v) return null;
    // the previous approved version is the reference; else the latest earlier one
    const ref =
      (await db.skillVersion.findFirst({ where: { skillId: v.skillId, status: "APPROVED", publishedAt: { lt: v.publishedAt } }, orderBy: { publishedAt: "desc" } })) ??
      (await db.skillVersion.findFirst({ where: { skillId: v.skillId, publishedAt: { lt: v.publishedAt }, id: { not: v.id } }, orderBy: { publishedAt: "desc" } }));
    const findings = (v.scanFindings as { file: string; rule: string; excerpt: string }[]).map((f) => ({ where: f.file, rule: f.rule, excerpt: f.excerpt }));
    return {
      kind, id: v.id, name: `${v.skill.publisher.publisher}/${v.skill.name}`, version: v.version, status: v.status, verdict: v.scanVerdict,
      description: v.skill.description, since: v.publishedAt, reviewNote: v.reviewNote, reviewedAt: v.reviewedAt,
      publisher: { id: v.skill.publisherId, handle: v.skill.publisher.publisher ?? v.skill.publisher.account, verified: v.skill.publisher.publisherVerified },
      href: `/skills/${v.skill.publisher.publisher}/${v.skill.name}?v=${v.version}`,
      evaluation: v.skill.kind === "evaluation", securityReport: v.securityReport,
      findings,
      previous: ref ? { version: ref.version, status: ref.status, at: ref.reviewedAt ?? ref.publishedAt } : null,
      source: v.skillMd,
      sourceName: "SKILL.md",
      diff: ref ? lineDiff(ref.skillMd, v.skillMd) : null,
      files: fileChanges(ref ? (ref.files as Record<string, string>) : null, v.files as Record<string, string>),
    };
  }
  const v = await db.toolVersion.findUnique({ where: { id }, include: { tool: { include: { owner: true } } } });
  if (!v) return null;
  const ref =
    (await db.toolVersion.findFirst({ where: { toolId: v.toolId, status: "APPROVED", publishedAt: { lt: v.publishedAt } }, orderBy: { publishedAt: "desc" } })) ??
    (await db.toolVersion.findFirst({ where: { toolId: v.toolId, publishedAt: { lt: v.publishedAt }, id: { not: v.id } }, orderBy: { publishedAt: "desc" } }));
  const m = v.manifest as ToolManifest;
  const json = (x: unknown) => JSON.stringify(x, null, 2);
  return {
    kind, id: v.id, name: `${v.tool.owner.publisher ?? v.tool.owner.account.slice(0, 10)}/${v.tool.name}`, version: v.version, status: v.status,
    verdict: (v.scanFindings as unknown[]).length ? "WARNING" : "CLEAN",
    description: `${m.title ?? ""}${m.description ? ` — ${m.description}` : ""}`, since: v.publishedAt, reviewNote: v.reviewNote, reviewedAt: v.reviewedAt,
    publisher: { id: v.tool.ownerId, handle: v.tool.owner.publisher ?? v.tool.owner.account, verified: v.tool.owner.publisherVerified },
    href: `/tools/${v.tool.owner.publisher ?? v.tool.owner.account}/${v.tool.name}`,
    evaluation: false, securityReport: null,
    findings: (v.scanFindings as { level: string; path: string; message: string }[]).map((f) => ({ where: f.path, rule: f.level, excerpt: f.message })),
    previous: ref ? { version: ref.version, status: ref.status, at: ref.reviewedAt ?? ref.publishedAt } : null,
    source: json(m),
    sourceName: "TOOL.json",
    diff: ref ? lineDiff(json(ref.manifest), json(m)) : null,
    files: [] as ReturnType<typeof fileChanges>,
    engine: m.database?.engine,
  };
}

export type ReviewDetail = NonNullable<Awaited<ReturnType<typeof reviewDetail>>>;

/** Shortest reason a publisher can act on */
export const MIN_REASON = 4;

/**
 * The review rules the page shows, enforced on the server too: a rejection or revocation says why (the publisher is
 * told), and approving a version the scanner flagged needs the reviewer to confirm they read the findings.
 */
export function assertReviewInput(v: { findings: number }, decision: "approve" | "reject" | "revoke", note: string | undefined, acknowledged: boolean | undefined) {
  if ((decision === "reject" || decision === "revoke") && (note ?? "").trim().length < MIN_REASON) throw new HttpError(400, "say why: the publisher receives the reason");
  if (decision === "approve" && v.findings > 0 && !acknowledged) throw new HttpError(400, "confirm that you checked the scan findings before approving");
}
