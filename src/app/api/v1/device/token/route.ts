import { z } from "zod";
import { handle, json } from "@/lib/http";
import { pollDeviceToken } from "@/lib/device-flow";

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** RFC 8628 device access token request (polled by SinoBee) */
export const POST = handle(async (req: Request) => {
  const ct = req.headers.get("content-type") ?? "";
  const raw = ct.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(await req.text())) : await req.json().catch(() => ({}));
  const body = z.object({ grant_type: z.literal(GRANT).optional(), device_code: z.string().min(20).max(100) }).parse(raw);
  const r = await pollDeviceToken(body.device_code);
  const headers = { "cache-control": "no-store" };
  return r.ok ? json(r.body, { headers }) : json({ error: r.error }, { status: 400, headers });
});
