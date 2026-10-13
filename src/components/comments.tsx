import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { CommentForm, DeleteComment } from "./comment-form";
import { LocalDate } from "./date";

type Target = "SKILL" | "TASK" | "EVALUATION";

const who = (u: { handle: string | null; publisher: string | null; account: string }) =>
  u.publisher ?? (u.handle ? `@${u.handle}` : `${u.account.slice(0, 6)}…${u.account.slice(-4)}`);

export async function Comments({ targetType, targetId }: { targetType: Target; targetId: string }) {
  const t = await getTranslations("comments");
  const me = await currentUser();
  const rows = await db.comment.findMany({
    where: { targetType, targetId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  const roots = rows.filter((c) => !c.parentId);
  const replies = (id: string) => rows.filter((c) => c.parentId === id);
  const Item = ({ c, nested = false }: { c: (typeof rows)[number]; nested?: boolean }) => (
    <div className={nested ? "ml-6 border-l border-line pl-4" : ""}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-ink">{who(c.user)}</span>
        <LocalDate value={c.createdAt} />
        {me && (me.id === c.userId || me.isAdmin) && !c.deletedAt && <DeleteComment id={c.id} />}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{c.deletedAt ? <em className="text-muted">{t("deleted")}</em> : c.body}</p>
    </div>
  );
  return (
    <section className="space-y-5">
      <h3 className="h3">
        {t("title")} <span className="text-muted">({rows.filter((r) => !r.deletedAt).length})</span>
      </h3>
      {roots.length === 0 && <p className="text-sm text-muted">{t("empty")}</p>}
      {roots.map((c) => (
        <div key={c.id} className="space-y-3">
          <Item c={c} />
          {replies(c.id).map((r) => (
            <Item key={r.id} c={r} nested />
          ))}
          {me && !c.deletedAt && <CommentForm targetType={targetType} targetId={targetId} parentId={c.id} compact />}
        </div>
      ))}
      {me ? <CommentForm targetType={targetType} targetId={targetId} /> : <p className="text-sm text-muted">{t("loginToComment")}</p>}
    </section>
  );
}
