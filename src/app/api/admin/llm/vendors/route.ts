import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { durations, setPaused } from "@/lib/llm/pause";

/** Pause or resume every model of one vendor at once (the models' own 提供 switches are left as they are) */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = z.object({ vendor: z.string().trim().min(1).max(60).regex(/^[a-z0-9_-]+$/i), paused: z.boolean() }).parse(await req.json());
  const s = await setPaused(admin.id, b.vendor.toLowerCase(), b.paused);
  return json({ ok: true, vendor: b.vendor.toLowerCase(), paused: !!s.since, since: s.since, ...durations(s) });
});
