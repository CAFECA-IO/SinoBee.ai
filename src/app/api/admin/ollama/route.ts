import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { deleteModel, ollamaStatus, startPull } from "@/lib/ollama";

/** Ollama: connection, installed models, recommended open models and running downloads */
export const GET = handle(async () => {
  await requireAdmin();
  return json(await ollamaStatus());
});

const Body = z.object({ model: z.string().trim().min(1).max(120) });

/** Download a model into Ollama (runs in the background; poll GET) */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  return json({ pull: startPull(admin.id, Body.parse(await req.json()).model) });
});

/** Remove a model from Ollama */
export const DELETE = handle(async (req: Request) => {
  const admin = await requireAdmin();
  await deleteModel(admin.id, Body.parse(await req.json()).model);
  return json({ ok: true });
});
