import { hubPublicKeys } from "@/lib/skills/signing";

/** ed25519 public keys (raw 32 bytes, base64) — pin them in SinoBee config `skills.hub_keys` */
export function GET() {
  const keys = hubPublicKeys();
  return Response.json(
    { alg: "ed25519", signed: "content_hash (ASCII \"sha256:<hex>\")", keys, public_keys: keys },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" } },
  );
}
