import { config } from "@/lib/config";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Public site flags the browser needs (test mode ribbon) */
export async function GET() {
  return json({ testMode: config.testMode }, { headers: { "cache-control": "no-store" } });
}
