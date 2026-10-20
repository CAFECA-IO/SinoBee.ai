import { db, icontains } from "@/lib/db";
import { requireBearer } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { publishSkill } from "@/lib/skills/service";
import { LISTED, trustOf } from "@/lib/skills/api";
import { compareVersions } from "@/lib/skills/spec";
import { securityStatus } from "@/lib/bench-suites";

/** an evaluation skill is for `target` when one of its targets is the name, "*", or a glob matching it */
const matches = (targets: string, name: string) =>
  targets.split(",").map((x) => x.trim()).filter(Boolean).some((g) => g === "*" || g === name || new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(name));

const PAGE = 20;

/** Hub API v1 search — `sinobee skills search <q>`; ?kind=evaluation[&target=<skill>] lists evaluation skills */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const kind = sp.get("kind") === "evaluation" ? "evaluation" : sp.get("kind") === "skill" ? "skill" : null;
  const target = (sp.get("target") ?? "").trim().slice(0, 120);
  const where = {
    versions: { some: LISTED },
    publisher: { publisher: { not: null } },
    ...(kind ? { kind } : {}),
    ...(q
      ? { OR: [{ name: icontains(q) }, { description: icontains(q) }, { tags: { some: { tag: q.toLowerCase() } } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    db.skill.count({ where }),
    db.skill.findMany({
      where,
      include: { publisher: true, versions: { where: LISTED } },
      orderBy: [{ downloads: "desc" }, { updatedAt: "desc" }],
      ...(target ? {} : { skip: (page - 1) * PAGE, take: PAGE }),
    }),
  ]);
  const picked = target ? rows.filter((s) => s.kind === "evaluation" && matches(s.targets || "*", target)) : rows;
  const items = picked.map((s) => {
    const latest = [...s.versions].sort((a, b) => compareVersions(b.version, a.version))[0];
    return {
      id: `${s.publisher.publisher}/${s.name}`,
      name: s.name,
      description: s.description,
      latest: latest?.version ?? null,
      trust: trustOf(s.publisher, latest),
      publisher: s.publisher.publisher,
      downloads: s.downloads,
      rating: Math.round(s.ratingAvg * 100) / 100,
      kind: s.kind,
      ...(s.kind === "evaluation" ? {
        targets: s.targets || "*",
        reviewed: latest?.status === "APPROVED",
        security: latest ? securityStatus(latest.securityReport, latest.status === "APPROVED") : null,
      } : {}),
    };
  });
  return json({ items, page, total: target ? items.length : total });
});

/** Hub API v1 publish — `sinobee skills publish <name>` (Bearer token, multipart bundle + manifest) */
export const POST = handle(async (req: Request) => {
  const { user } = await requireBearer(req, "skills:publish");
  const form = await req.formData();
  const f = form.get("bundle");
  if (!(f instanceof File)) return json({ error: "multipart field `bundle` required" }, 400);
  const res = await publishSkill(user, Buffer.from(await f.arrayBuffer()), f.name || "bundle.tar.gz");
  // the client-supplied manifest is informational; the Hub recomputes hashes from the bundle
  return json(res, res.status === "rejected" ? 422 : 201);
});
