import { relay } from "@/lib/llm/relay";

export const dynamic = "force-dynamic";

/** Anthropic Messages API for subscribers (base URL for Anthropic SDKs: https://sinobee.ai/api/v1/llm/anthropic) */
export const POST = (req: Request) => relay(req, "anthropic", "messages");
