"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Res = { id: string; version: string; status: string; content_hash: string; findings: { file: string; rule: string; severity: string; excerpt: string }[] };

export function SkillUpload({ publisher }: { publisher: string }) {
  const t = useTranslations("submit");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  return (
    <form
      className="card space-y-4 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        setBusy(true);
        setErr("");
        setRes(null);
        const fd = new FormData();
        fd.set("bundle", file);
        const r = await fetch("/api/skills/upload", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({ error: "upload failed" }));
        setBusy(false);
        if (!r.ok) return setErr(j.error ?? "upload failed");
        setRes(j);
      }}
    >
      <div className="text-sm text-muted">
        {t("publishingAs")} <b className="font-mono text-ink">{publisher}</b>
      </div>
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line p-10 text-center hover:border-accent">
        <input type="file" accept=".md,.tar.gz,.tgz,.tar" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <span className="font-semibold">{file ? file.name : t("drop")}</span>
        <span className="mt-1 text-xs text-muted">{t("dropHint")}</span>
      </label>
      {err && <p className="rounded-lg bg-err-soft p-3 text-sm text-err">{err}</p>}
      {res && (
        <div className={`rounded-xl p-4 text-sm ${res.status === "rejected" ? "bg-err-soft text-err" : "bg-accent-soft"}`}>
          <b>{res.status === "rejected" ? t("rejected") : t("submitted")}</b>
          <div className="mt-1 font-mono text-xs">
            {res.id}@{res.version} · {res.content_hash}
          </div>
          {res.findings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {res.findings.map((f, i) => (
                <li key={i}>
                  [{f.severity}] {f.file}: {f.rule}
                </li>
              ))}
            </ul>
          )}
          {res.status !== "rejected" && (
            <Link href={`/skills/${res.id}`} className="mt-3 inline-block font-semibold text-accent underline">
              {t("view")} →
            </Link>
          )}
        </div>
      )}
      <button className="btn-primary" disabled={!file || busy}>
        {busy ? t("uploading") : t("upload")}
      </button>
    </form>
  );
}
