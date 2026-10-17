import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { getObject } from "@/lib/storage";
import { canReadFile, removeFile } from "@/lib/crowd/proposal";
import { canView } from "@/lib/tasks/service";

/** Download a reference file (public files: anyone who can see the task; backer files: backers; agent files: proposer) */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await ctx.params;
  const u = await currentUser();
  const f = await db.taskInputFile.findUnique({ where: { id: fileId }, include: { task: true } });
  if (!f || f.taskId !== id || f.deletedAt || !canView(f.task, u?.id) || !(await canReadFile(f.task, f, u?.id))) return new Response("not found", { status: 404 });
  const body = await getObject(f.key);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      "content-length": String(body.length),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) => {
  const user = await requireUser();
  const { id, fileId } = await ctx.params;
  await removeFile(user.id, id, fileId);
  return json({ ok: true });
});
