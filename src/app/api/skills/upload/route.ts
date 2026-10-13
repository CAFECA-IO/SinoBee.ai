import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { publishSkill } from "@/lib/skills/service";

/** Web upload: multipart field `bundle` (SKILL.md or .tar.gz) */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const form = await req.formData();
  const f = form.get("bundle");
  if (!(f instanceof File)) return json({ error: "bundle file required" }, 400);
  const res = await publishSkill(user, Buffer.from(await f.arrayBuffer()), f.name);
  return json(res);
});
