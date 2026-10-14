import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { revokeDevice } from "@/lib/device-flow";

/** Sign a SinoBee install out (revokes its tokens) */
export const DELETE = handle(async (req: Request) => {
  const user = await requireUser();
  await revokeDevice(user.id, new URL(req.url).searchParams.get("id") ?? "");
  return json({ ok: true });
});
