import { useTranslations } from "next-intl";

const STYLE: Record<string, string> = {
  DRAFT: "bg-panel-2 text-muted",
  FUNDING: "bg-accent-soft text-accent",
  CHARGING: "bg-warn-soft text-warn",
  UNFUNDED: "bg-panel-2 text-muted",
  AWAITING_PAYMENT: "bg-warn-soft text-warn",
  QUEUED: "bg-panel-2 text-muted",
  RUNNING: "bg-accent-soft text-accent",
  NEEDS_FUNDING: "bg-warn-soft text-warn",
  COMPLETED: "bg-accent-soft text-ok",
  FAILED: "bg-err-soft text-err",
  CANCELLED: "bg-panel-2 text-muted",
  PENDING_REVIEW: "bg-warn-soft text-warn",
  APPROVED: "bg-accent-soft text-ok",
  REJECTED: "bg-err-soft text-err",
  REVOKED: "bg-err-soft text-err",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("status");
  return <span className={`badge ${STYLE[status] ?? "bg-panel-2"}`}>{t(status)}</span>;
}
