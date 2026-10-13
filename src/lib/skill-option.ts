import { db } from "./db";

export async function skillOption(versionId?: string) {
  if (!versionId) return null;
  const v = await db.skillVersion.findUnique({ where: { id: versionId }, include: { skill: { include: { publisher: true } } } });
  if (!v || v.status === "REVOKED" || v.status === "REJECTED") return null;
  return { id: v.id, label: `${v.skill.publisher.publisher}/${v.skill.name}@${v.version}` };
}
