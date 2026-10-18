"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { confirmDialog } from "./confirm";

type Installed = { name: string; size: number; modifiedAt: string; parameterSize?: string; quantization?: string };
type Recommended = { name: string; size: string; tier: "high" | "standard" | "light"; caps: string[]; note: { zh: string; en: string } };
type Pull = { name: string; state: "running" | "done" | "error"; status: string; completed: number; total: number; error?: string };
type Status = { configured: boolean; base?: string; ok?: boolean; version?: string | null; error?: string; installed?: Installed[]; recommended: Recommended[]; pulls: Pull[] };

const gb = (n: number) => `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;

async function call(method: string, body?: unknown) {
  const r = await fetch("/api/admin/ollama", { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error === "invalid_request" ? (j.issues?.[0]?.message ?? "invalid") : (j.error ?? `HTTP ${r.status}`));
  return j;
}

/** /admin → AI 模型 → Ollama: local open models as a platform model source */
export function OllamaAdmin() {
  const t = useTranslations("admin.ollama");
  const zh = useLocale().startsWith("zh");
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const [custom, setCustom] = useState("");
  const [err, setErr] = useState("");
  const alive = useRef(true);
  const wasRunning = useRef(false);
  // bumped when a download starts, so polling switches to the fast interval at once
  const [kick, setKick] = useState(0);

  const load = useCallback(async () => {
    const st = (await call("GET").catch((e) => ({ configured: true, ok: false, error: (e as Error).message, recommended: [], pulls: [] }))) as Status;
    if (!alive.current) return st;
    setS(st);
    const running = st.pulls.some((p) => p.state === "running");
    // a download finished: the model lists above were synced on the server
    if (wasRunning.current && !running) router.refresh();
    wasRunning.current = running;
    return st;
  }, [router]);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const st = await load();
      if (alive.current) timer = setTimeout(tick, st.pulls.some((p) => p.state === "running") ? 2000 : 15000);
    };
    void tick();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [load, kick]);

  const pull = async (model: string) => {
    setErr("");
    try {
      await call("POST", { model });
      wasRunning.current = true;
      setKick((k) => k + 1);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = async (model: string) => {
    if (!(await confirmDialog(t("confirmDelete", { model }), { danger: true }))) return;
    setErr("");
    try {
      await call("DELETE", { model });
      await load();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const installed = new Set((s?.installed ?? []).map((m) => m.name));
  const has = (name: string) => installed.has(name) || installed.has(name.includes(":") ? name : `${name}:latest`);
  const pullOf = (name: string) => s?.pulls.find((p) => p.name === name);

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="h3 flex-1">{t("title")}</h2>
        {s?.configured && (
          <span className={`chip ${s.ok ? "text-ok" : "text-err"}`}>
            {s.ok ? t("connected", { version: s.version ?? "?" }) : t("offline")}
          </span>
        )}
      </div>
      <p className="text-sm text-muted">{t("lead")}</p>
      {!s && <p className="text-sm text-muted">…</p>}
      {s && !s.configured && <p className="text-sm text-warn">{t("notConfigured")}</p>}
      {s?.configured && !s.ok && (
        <p className="text-sm text-err">
          {s.base} — {s.error}
        </p>
      )}

      {s?.ok && (
        <>
          <div>
            <h3 className="mb-2 font-semibold">{t("installed")}</h3>
            {(s.installed ?? []).length === 0 ? (
              <p className="text-sm text-muted">{t("none")}</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {(s.installed ?? []).map((m) => (
                  <li key={m.name} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="font-mono">ollama/{m.name}</span>
                    <span className="text-xs text-muted">
                      {[m.parameterSize, m.quantization, gb(m.size)].filter(Boolean).join(" · ")}
                    </span>
                    <button type="button" className="ml-auto text-xs text-err" onClick={() => remove(m.name)}>
                      {t("delete")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">{t("useHint")}</p>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">{t("recommended")}</h3>
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
              {s.recommended.map((r) => {
                const p = pullOf(r.name);
                const pct = p && p.total ? Math.floor((p.completed / p.total) * 100) : 0;
                return (
                  <div key={r.name} className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{r.name}</span>
                      <span className="chip text-xs">{t(`tier.${r.tier}`)}</span>
                      <span className="ml-auto text-xs text-muted">{r.size}</span>
                    </div>
                    <p className="text-xs text-muted">{zh ? r.note.zh : r.note.en}</p>
                    <p className="text-xs text-muted">{r.caps.map((c) => t(`cap.${c}`)).join(" · ")}</p>
                    {has(r.name) ? (
                      <span className="text-xs font-semibold text-ok">{t("isInstalled")}</span>
                    ) : p?.state === "running" ? (
                      <PullBar p={p} pct={pct} label={t("downloading")} />
                    ) : (
                      <button type="button" className="btn-ghost !py-1.5 text-sm" onClick={() => pull(r.name)}>
                        {p?.state === "error" ? t("retry") : t("download")}
                      </button>
                    )}
                    {p?.state === "error" && <p className="text-xs text-err">{p.error}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) void pull(custom.trim()).then(() => setCustom(""));
            }}
          >
            <label className="block flex-1 text-sm">
              {t("custom")}
              <input className="input mt-1 font-mono" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="qwen3.6:35b" maxLength={120} />
            </label>
            <button className="btn-primary !py-2 text-sm" disabled={!custom.trim()}>
              {t("download")}
            </button>
          </form>
          {s.pulls
            .filter((p) => p.state === "running" && !s.recommended.some((r) => r.name === p.name))
            .map((p) => (
              <PullBar key={p.name} p={p} pct={p.total ? Math.floor((p.completed / p.total) * 100) : 0} label={`${p.name} · ${t("downloading")}`} />
            ))}
        </>
      )}
      {err && (
        <p className="text-sm text-err" role="alert">
          {err}
        </p>
      )}
    </section>
  );
}

function PullBar({ p, pct, label }: { p: Pull; pct: number; label: string }) {
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted">
        {label} {p.total ? `${pct}% · ${gb(p.completed)} / ${gb(p.total)}` : p.status}
      </p>
    </div>
  );
}
