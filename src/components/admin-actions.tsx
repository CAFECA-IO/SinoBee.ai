"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function ReviewActions({ versionId, approved }: { versionId: string; approved: boolean }) {
  const t = useTranslations("admin");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();
  const act = async (decision: "approve" | "reject" | "revoke") => {
    setErr("");
    const r = await fetch("/api/admin/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId, decision, note: note || undefined }) });
    if (!r.ok) return setErr((await r.json()).error);
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input max-w-sm" placeholder={t("note")} value={note} onChange={(e) => setNote(e.target.value)} />
      {!approved && <button className="btn-primary" onClick={() => act("approve")}>{t("approve")}</button>}
      {!approved && <button className="btn-ghost" onClick={() => act("reject")}>{t("reject")}</button>}
      <button className="btn-danger" onClick={() => confirm(t("confirmRevoke")) && act("revoke")}>{t("revoke")}</button>
      {err && <span className="text-sm text-err">{err}</span>}
    </div>
  );
}

export function VerifyPublisher({ userId, verified }: { userId: string; verified: boolean }) {
  const t = useTranslations("admin");
  const router = useRouter();
  return (
    <button
      className="chip hover:border-accent"
      onClick={async () => {
        await fetch("/api/admin/review", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, verified: !verified }) });
        router.refresh();
      }}
    >
      {verified ? `✔ ${t("verifiedPublisher")}` : t("verifyPublisher")}
    </button>
  );
}

export function ToolReview({ versionId }: { versionId: string }) {
  const t = useTranslations("admin");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();
  const act = async (approve: boolean) => {
    setErr("");
    const r = await fetch("/api/admin/tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId, approve, note: note || undefined }) });
    if (!r.ok) return setErr((await r.json()).error);
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input max-w-sm" placeholder={t("note")} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn-primary" onClick={() => act(true)}>{t("approve")}</button>
      <button className="btn-ghost" onClick={() => act(false)}>{t("reject")}</button>
      {err && <span className="text-sm text-err">{err}</span>}
    </div>
  );
}

export function ReportActions({ reportId, targetType, targetId }: { reportId: string; targetType: string; targetId: string }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const act = async (takedown: boolean) => {
    await fetch("/api/admin/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId, takedown, targetType, targetId }) });
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      <button className="btn-danger" onClick={() => confirm(t("confirmTakedown")) && act(true)}>{t("takedown")}</button>
      <button className="btn-ghost" onClick={() => act(false)}>{t("dismiss")}</button>
    </div>
  );
}
