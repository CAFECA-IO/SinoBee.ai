import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { decideDeviceAuth } from "@/lib/device-flow";

/** The signed-in user approves or denies a `sinobee login` request */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { code, approve } = z.object({ code: z.string().min(8).max(12), approve: z.boolean() }).parse(await req.json());
  return json({ ok: true, ...(await decideDeviceAuth(user.id, code, approve)) });
});
