import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { claimSite } from "@/lib/roles";

/** Enter the one-time owner claim code printed in the server log (only while the site has no owner) */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { code } = z.object({ code: z.string().min(4).max(64) }).parse(await req.json());
  const u = await claimSite(user, code);
  return json({ ok: true, role: u.role });
});
