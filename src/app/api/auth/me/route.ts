import { currentUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const GET = handle(async () => {
  const u = await currentUser();
  if (!u) return json(null);
  return json({ id: u.id, account: u.account, handle: u.handle, publisher: u.publisher, isAdmin: u.isAdmin, channelId: u.channelId });
});
