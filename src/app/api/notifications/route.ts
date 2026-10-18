import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { pointBalance } from "@/lib/crowd/points";

export const GET = handle(async () => {
  const user = await requireUser();
  // the user menu polls this: unread notifications and the platform points balance
  const [unread, points] = await Promise.all([db.notification.count({ where: { userId: user.id, readAt: null } }), pointBalance(user.id)]);
  return json({ unread, points });
});

/** mark read: { ids } or { all: true } */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const b = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }).parse(await req.json());
  await db.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(b.all ? {} : { id: { in: b.ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  return json({ ok: true });
});
