import { handle, json } from "@/lib/http";
import { bearerAuth } from "@/lib/auth";

/** `sinobee whoami` — any valid token, whatever its scopes */
export const GET = handle(async (req: Request) => {
  const a = await bearerAuth(req);
  if (!a) return json({ error: "invalid or missing hub token — run `sinobee login`" }, 401);
  return json({
    account: a.user.account,
    handle: a.user.handle,
    publisher: a.user.publisher,
    scopes: a.scopes,
    device: a.device ? { id: a.device.id, name: a.device.name } : null,
    token_expires_at: a.token.expiresAt?.toISOString() ?? null,
  });
});
