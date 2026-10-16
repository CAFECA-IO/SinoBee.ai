import { llmAuth, errorResponse } from "@/lib/llm/relay";
import { quotaStatus } from "@/lib/llm/quota";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Quota rings for the SinoBee GUI and the account page: % used, tokens left (cheapest model), releases */
export async function GET(req: Request) {
  try {
    const user = req.headers.get("authorization") || req.headers.get("x-api-key") ? (await llmAuth(req)).user : await currentUser();
    if (!user) return Response.json({ error: { message: "sign in required", type: "authentication_error" } }, { status: 401 });
    return Response.json(await quotaStatus(user.id));
  } catch (e) {
    return errorResponse("openai", e);
  }
}
