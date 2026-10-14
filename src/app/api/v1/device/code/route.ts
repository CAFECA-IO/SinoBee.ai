import { z } from "zod";
import { handle, json } from "@/lib/http";
import { startDeviceAuth } from "@/lib/device-flow";

/** RFC 8628 device authorization request — `sinobee login` */
export const POST = handle(async (req: Request) => {
  const ct = req.headers.get("content-type") ?? "";
  const raw = ct.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(await req.text())) : await req.json().catch(() => ({}));
  const body = z
    .object({
      client_id: z.literal("sinobee").optional(),
      device_name: z.string().trim().min(1).max(80).default("SinoBee"),
      platform: z.string().trim().max(80).optional(),
      scope: z.string().max(200).optional(),
      public_key: z.string().max(64).optional(),
    })
    .parse(raw);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return json(await startDeviceAuth({ deviceName: body.device_name, platform: body.platform, scope: body.scope, ip, publicKey: body.public_key }), {
    headers: { "cache-control": "no-store" },
  });
});
