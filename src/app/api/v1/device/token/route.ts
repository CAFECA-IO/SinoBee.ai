import { z } from "zod";
import { handle, json } from "@/lib/http";
import { pollDeviceToken, refreshDeviceToken } from "@/lib/device-flow";

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/**
 * RFC 8628 device access token request (polled by SinoBee), and grant_type=refresh_token for signed devices
 * (the refresh request must carry the device signature headers).
 */
export const POST = handle(async (req: Request) => {
  const ct = req.headers.get("content-type") ?? "";
  // read a copy: the signature check of a refresh needs the untouched body
  const text = await req.clone().text();
  const raw = ct.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(text)) : (() => { try { return JSON.parse(text); } catch { return {}; } })();
  const headers = { "cache-control": "no-store" };
  if (raw?.grant_type === "refresh_token") {
    const { refresh_token } = z.object({ refresh_token: z.string().min(20).max(200) }).parse(raw);
    return json(await refreshDeviceToken(req, refresh_token), { headers });
  }
  const body = z.object({ grant_type: z.literal(GRANT).optional(), device_code: z.string().min(20).max(100) }).parse(raw);
  const r = await pollDeviceToken(body.device_code);
  return r.ok ? json(r.body, { headers }) : json({ error: r.error }, { status: 400, headers });
});
