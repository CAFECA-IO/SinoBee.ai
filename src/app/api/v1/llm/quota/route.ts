import { llmAuth, errorResponse } from "@/lib/llm/relay";
import { quotaStatus } from "@/lib/llm/quota";
import { currentUser } from "@/lib/auth";
import { pointBalance } from "@/lib/crowd/points";
import { QuotaError } from "@/lib/llm/quota";

export const dynamic = "force-dynamic";

/** Quota rings for the SinoBee GUI and the account page: % used, tokens left (cheapest model), releases */
export async function GET(req: Request) {
  try {
    const user = req.headers.get("authorization") || req.headers.get("x-api-key") ? (await llmAuth(req)).user : await currentUser();
    if (!user) return Response.json({ error: { message: "sign in required", type: "authentication_error" } }, { status: 401 });
    try {
      return Response.json(await quotaStatus(user.id));
    } catch (e) {
      // no subscription: the points can still pay for model calls, so SinoBee still learns the balance
      if (e instanceof QuotaError && e.window === "subscription") {
        const r = errorResponse("openai", e);
        const body = await r.json();
        return Response.json({ ...body, points: { balance: await pointBalance(user.id), rate: 1, unit: "TWD" } }, { status: r.status });
      }
      throw e;
    }
  } catch (e) {
    return errorResponse("openai", e);
  }
}
