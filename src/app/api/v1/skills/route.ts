import { db, icontains } from "@/lib/db";
import { userFromBearer } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { publishSkill } from "@/lib/skills/service";
import { LISTED, trustOf } from "@/lib/skills/api";
import { compareVersions } from "@/lib/skills/spec";

const PAGE = 20;

/** Hub API v1 search — `sinobee skills search <q>` */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const where = {
    versions: { some: LISTED },
    publisher: { publisher: { not: null } },
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
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
  ]);
  const items = rows.map((s) => {
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
    };
  });
  return json({ items, page, total });
});

/** Hub API v1 publish — `sinobee skills publish <name>` (Bearer token, multipart bundle + manifest) */
export const POST = handle(async (req: Request) => {
  const user = await userFromBearer(req);
  if (!user) return json({ error: "invalid or missing hub token" }, 401);
  const form = await req.formData();
  const f = form.get("bundle");
  if (!(f instanceof File)) return json({ error: "multipart field `bundle` required" }, 400);
  const res = await publishSkill(user, Buffer.from(await f.arrayBuffer()), f.name || "bundle.tar.gz");
  // the client-supplied manifest is informational; the Hub recomputes hashes from the bundle
  return json(res, res.status === "rejected" ? 422 : 201);
});
