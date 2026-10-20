"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { confirmDialog } from "./confirm";

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
      <button className="btn-danger" onClick={async () => (await confirmDialog(t("confirmRevoke"), { danger: true })) && act("revoke")}>{t("revoke")}</button>
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
      <button className="btn-danger" onClick={async () => (await confirmDialog(t("confirmTakedown"), { danger: true })) && act(true)}>{t("takedown")}</button>
      <button className="btn-ghost" onClick={() => act(false)}>{t("dismiss")}</button>
    </div>
  );
}

/** An evaluation skill's 4 security checks, and recording its sandbox behavior test */
export function EvaluatorSecurity({ versionId, report, approved }: {
  versionId: string; approved: boolean;
  report: { static?: { ok: boolean; issues: string[] }; behavior?: { ok: boolean | null; note?: string | null; at?: string | null }; suite?: { ok: boolean | null; checked: number; problems?: string[] } } | null;
}) {
  const t = useTranslations("admin");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();
  const r = report ?? {};
  const mark = (v: boolean | null | undefined) => (v === true ? <span className="text-ok">✓</span> : v === false ? <span className="text-err">✕</span> : <span className="text-muted">–</span>);
  const record = async (ok: boolean) => {
    setErr("");
    const res = await fetch("/api/admin/review/security", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId, ok, note: note || undefined }) });
    if (!res.ok) return setErr((await res.json()).error);
    router.refresh();
  };
  return (
    <div className="space-y-2 rounded-xl border border-line p-3 text-sm">
      <div className="font-semibold">{t("evSecurity")}</div>
      <div>{mark(r.static?.ok)} {t("evStatic")}{r.static?.issues?.length ? <ul className="list-disc pl-5 text-xs text-err">{r.static.issues.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}</div>
      <div>{mark(r.behavior?.ok)} {t("evBehavior")} {r.behavior?.note && <span className="text-xs text-muted">— {r.behavior.note}</span>}</div>
      <div>{mark(r.suite?.ok)} {t("evSuite", { n: r.suite?.checked ?? 0 })}{r.suite?.problems?.length ? <ul className="list-disc pl-5 text-xs text-err">{r.suite.problems.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}</div>
      <div>{mark(approved || null)} {t("evReview")}</div>
      {r.behavior?.ok !== false && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted">{t("evBehaviorHow")}</span>
          <input className="input max-w-xs" placeholder={t("note")} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-ghost" onClick={() => record(true)}>{t("evPass")}</button>
          <button className="btn-danger" onClick={() => record(false)}>{t("evFail")}</button>
        </div>
      )}
      {err && <span className="text-sm text-err">{err}</span>}
    </div>
  );
}
