import { POST as report } from "@/app/api/reports/route";

/** Kept for older pages: forwards to POST /api/reports */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
  const body = JSON.stringify({ targetType: "share", targetId: (await ctx.params).id, reason });
  return report(new Request(req.url, { method: "POST", headers: req.headers, body }));
}
