import { relay } from "@/lib/llm/relay";

export const dynamic = "force-dynamic";

/** OpenAI-compatible embeddings for subscribers */
export const POST = (req: Request) => relay(req, "openai", "embeddings");
