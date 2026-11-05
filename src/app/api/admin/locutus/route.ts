import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { blockNode, ignoreNode, locutusOverview, registerNode, removeNode, setModel, unblockNode } from "@/lib/locutus/admin";

/** The Locutus card in /admin → 模型定價: nodes, nodes waiting for approval, models */
export const GET = handle(async () => {
  await requireAdmin();
  return json(await locutusOverview());
});

const address = z.string().trim().max(64);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register"), address, label: z.string().trim().max(40), offer: z.boolean().optional() }),
  z.object({ action: z.literal("remove"), address }),
  z.object({ action: z.literal("block"), address }),
  z.object({ action: z.literal("unblock"), address }),
  z.object({ action: z.literal("ignore"), address }),
  z.object({ action: z.literal("model"), modelId: z.string().trim().max(160), label: z.string().trim().max(120).optional(), input: z.number().min(0).max(100_000), output: z.number().min(0).max(100_000), enabled: z.boolean() }),
]);

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = Body.parse(await req.json());
  if (b.action === "register") return json(await registerNode(admin.id, b.address, b.label, b.offer));
  if (b.action === "remove") await removeNode(admin.id, b.address);
  else if (b.action === "block") await blockNode(admin.id, b.address);
  else if (b.action === "unblock") await unblockNode(admin.id, b.address);
  else if (b.action === "ignore") await ignoreNode(b.address);
  else if (b.action === "model") await setModel(admin.id, b);
  return json({ ok: true });
});
