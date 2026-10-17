import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { startBinding } from "@/lib/crowd/cards";

/** Save a card with Oen (3-D Secure binding page); returns the page to open */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { returnTo, email } = z.object({ returnTo: z.string().regex(/^\/[^/\\]/).max(300).default("/account"), email: z.string().email().optional() }).parse(await req.json().catch(() => ({})));
  const billing = (user.billing ?? null) as { email?: string } | null;
  return json(await startBinding(user.id, { returnTo, email: email ?? billing?.email }));
});
