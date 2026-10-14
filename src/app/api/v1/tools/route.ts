import { z } from "zod";
import { db, icontains } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { requireBearer, userFromSessionOrBearer } from "@/lib/auth";
import { publishTool, toolJson } from "@/lib/tools/service";

const PAGE = 20;

/** Public tool directory (approved public tools) */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const where = {
    visibility: "PUBLIC" as const,
    versions: { some: { status: "APPROVED" as const, public: true } },
    ...(q ? { OR: [{ name: icontains(q) }, { description: icontains(q) }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.tool.count({ where }),
    db.tool.findMany({ where, include: { owner: true, versions: { where: { status: "APPROVED", public: true }, orderBy: { publishedAt: "desc" }, take: 1 } }, orderBy: [{ installs: "desc" }, { updatedAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE }),
  ]);
  // `latest` is the newest public version (private versions are never revealed, not even their numbers)
  return json({ items: rows.map((t) => ({ ...toolJson(t), latest: t.versions[0]?.version ?? null, title: (t.versions[0]?.manifest as { title?: string } | undefined)?.title ?? t.name })), page, total });
});

/** Register a tool version from SinoBee (`tools:write`) or the website */
export const POST = handle(async (req: Request) => {
  const user = req.headers.get("authorization") ? (await requireBearer(req, "tools:write")).user : await userFromSessionOrBearer(req, "tools:write");
  const body = z.object({ manifest: z.unknown(), visibility: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE") }).parse(await req.json());
  try {
    return json(await publishTool(user, body.manifest, body.visibility), 201);
  } catch (e) {
    const f = (e as { findings?: unknown }).findings;
    if (f) return json({ error: (e as Error).message, findings: f }, 422);
    throw e;
  }
});
