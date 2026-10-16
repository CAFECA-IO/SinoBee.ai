import { after } from "next/server";
import { handleWebhook } from "@/lib/payments";

/**
 * Oen payment notification. Unsigned, so it is only a hint: we answer 200 at once (Oen waits 10 s and retries
 * twice at most) and afterwards re-read the transaction from Oen's API, which is the only thing we trust.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  after(async () => {
    try {
      const r = await handleWebhook(body);
      if (r.ignored) console.info("oen webhook ignored:", r.ignored);
    } catch (e) {
      console.warn("oen webhook:", (e as Error).message);
    }
  });
  return Response.json({ ok: true });
}
