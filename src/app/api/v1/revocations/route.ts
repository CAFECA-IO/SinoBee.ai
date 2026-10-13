import { db } from "@/lib/db";

export async function GET() {
  const rows = await db.revocation.findMany({ orderBy: { createdAt: "asc" } });
  return Response.json({ revoked: rows.map((r) => r.contentHash) }, { headers: { "cache-control": "public, max-age=300" } });
}
