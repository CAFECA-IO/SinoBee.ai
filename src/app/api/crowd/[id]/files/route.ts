import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { HttpError } from "@/lib/errors";
import { FILE_VISIBILITY, addFile } from "@/lib/crowd/proposal";

/** Upload one reference file (multipart: file, visibility). Storage and extra space are paid from the proposal credit. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file is required");
  const v = String(form.get("visibility") ?? "BACKERS");
  const visibility = (FILE_VISIBILITY as readonly string[]).includes(v) ? (v as (typeof FILE_VISIBILITY)[number]) : "BACKERS";
  const { file: row, cost } = await addFile(user.id, (await ctx.params).id, { filename: file.name, contentType: file.type, data: Buffer.from(await file.arrayBuffer()), visibility });
  return json({ file: { id: row.id, filename: row.filename, sizeBytes: Number(row.sizeBytes), visibility: row.visibility }, cost });
});
