import { destroySession } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const POST = handle(async () => {
  await destroySession();
  return json({ ok: true });
});
