import { llmAuth, errorResponse, modelList } from "@/lib/llm/relay";

export const dynamic = "force-dynamic";

/** Models offered through the relay, with published prices (TWD per 1M tokens) */
export async function GET(req: Request) {
  try {
    await llmAuth(req);
    return Response.json(await modelList());
  } catch (e) {
    return errorResponse("openai", e);
  }
}
