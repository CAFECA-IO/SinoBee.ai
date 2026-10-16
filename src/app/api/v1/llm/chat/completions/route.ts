import { relay } from "@/lib/llm/relay";

export const dynamic = "force-dynamic";

/** OpenAI-compatible chat completions for subscribers (OpenAI, Gemini, DeepSeek models) */
export const POST = (req: Request) => relay(req, "openai", "chat");
