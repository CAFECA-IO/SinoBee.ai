"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Icon } from "./icon";
import { confirmDialog } from "./confirm";
import { Action, DangerConfirm, Field, SettingControl, Toggle, displayValue, type ControlState } from "./settings-controls";
import { checkValue, isDanger, type Control, type L, type Ui } from "@/lib/settings/ui";

export type SettingItem = {
  key: string;
  group: string;
  provider?: string;
  type: "text" | "url" | "number" | "secret" | "select" | "bool" | "list";
  label: string;
  help?: string;
  options?: string[];
  restart?: boolean;
  generated?: boolean;
  required?: boolean;
  env?: string;
  source: "env" | "db" | "default" | "unset";
  value: string;
  secretSet?: boolean;
  hint?: string;
  derived?: string;
  /** a page that helps fill it in, e.g. where to get an API key */
  link?: { url: string; label: string };
  schemes?: string[];
  control: Control;
  ui: Ui;
  defaultValue?: string;
  pendingRestart?: boolean;
};

export type SettingsSection = { id: string; title: string; description?: string; extra?: ReactNode };

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.errors) throw new Error(j.error === "invalid_request" ? (j.issues?.[0]?.message ?? "invalid") : (j.error ?? `HTTP ${r.status}`));
  return j;
}

/** an item still needs a value before going live */
const missing = (i: SettingItem) => !!i.required && (i.type === "secret" ? !i.secretSet : !i.value);
const lang = (l: L | string | undefined, zh: boolean) => (typeof l === "string" ? l : l ? (zh ? l.zh : l.en) : "");

/**
 * Settings as one board with a change set (design: 建議組合 / 操作元件). Groups on the left; every field is a field row
 * whose control comes from the registry. Edits become drafts that survive switching groups; the change bar at the
 * bottom counts them (dangerous ones and restart-only ones too), and "檢閱並套用" opens the review: old → new for each,
 * when it takes effect, and a sentence to tick for each dangerous one. The set is applied in one request and lands
 * in the change log, where it can be reverted.
 */
export function SettingsBoard({ sections, items, canEdit, initial, counts, zh, titles }: { sections: SettingsSection[]; items: SettingItem[]; canEdit: boolean; initial?: string; counts?: Record<string, number>; zh: boolean; titles: Record<string, string> }) {
  const t = useTranslations("admin.settings");
  const tc = useTranslations("admin.ctl");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [group, setGroup] = useState(() => (sections.some((s) => s.id === initial) ? initial! : sections[0]?.id));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, L>>({});
  const [review, setReview] = useState(false);
  const [done, setDone] = useState<{ n: number; failed: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const changed = Object.keys(drafts).filter((k) => byKey.has(k));
  const dangerous = changed.filter((k) => {
    const i = byKey.get(k)!;
    return i.generated || (drafts[k] !== i.value && isDanger(i, drafts[k]));
  });
  const restart = changed.filter((k) => byKey.get(k)!.restart);

  // ?setting=<key>: open its group, scroll to it and mark it (links from 站台健康 and warnings)
  useEffect(() => {
    const key = new URL(window.location.href).searchParams.get("setting");
    const it = key ? byKey.get(key) : undefined;
    if (!it) return;
    setGroup(it.group);
    setFocus(it.key);
    setTimeout(() => document.querySelector(`[data-setting="${CSS.escape(it.key)}"]`)?.scrollIntoView({ block: "center" }), 50);
  }, [byKey]);
  // leaving with drafts asks first
  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed.length]);

  const setDraft = useCallback(
    (key: string, v: string | undefined) => {
      setDone(null);
      setDrafts((d) => {
        const it = byKey.get(key)!;
        const n = { ...d };
        if (v === undefined || (it.type !== "secret" && !it.generated && v === it.value)) delete n[key];
        else n[key] = v;
        return n;
      });
      setErrors((e) => {
        if (!e[key]) return e;
        const n = { ...e };
        delete n[key];
        return n;
      });
    },
    [byKey],
  );
  const validate = (key: string) => {
    const it = byKey.get(key)!;
    if (drafts[key] === undefined) return;
    const r = checkValue({ ...it, ui: it.ui }, drafts[key]);
    if (!r.ok) setErrors((e) => ({ ...e, [key]: r.error }));
  };
  const openReview = () => {
    const errs: Record<string, L> = {};
    for (const k of changed) {
      const r = checkValue(byKey.get(k)!, drafts[k]);
      if (!r.ok) errs[k] = r.error;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = byKey.get(Object.keys(errs)[0])!;
      setGroup(first.group);
      setQ("");
      setOnlyTodo(false);
      return;
    }
    setReview(true);
  };
  const apply = async (confirmed: string[]) => {
    const r = await post("/api/admin/settings", { changes: changed.map((key) => ({ key, value: drafts[key] })), confirmed });
    const errs = (r.errors ?? {}) as Record<string, L>;
    setErrors(errs);
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => errs[k])));
    setDone({ n: changed.length - Object.keys(errs).length, failed: Object.keys(errs).length });
    setReview(false);
    router.refresh();
  };

  const match = (i: SettingItem) => {
    if (onlyTodo && !missing(i) && !errors[i.key] && drafts[i.key] === undefined) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return [i.label, i.key, i.env ?? "", i.help ?? ""].some((x) => x.toLowerCase().includes(s));
  };
  const todo = items.filter(missing).length;
  const across = !!q.trim() || onlyTodo;
  const pick = (id: string) => {
    setGroup(id);
    setQ("");
    setOnlyTodo(false);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("group", id);
      u.searchParams.delete("setting");
      window.history.replaceState(null, "", u);
    } catch {}
  };
  return (
    <div className="space-y-4 pb-24">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="min-w-0 lg:sticky lg:top-20 lg:self-start" aria-label={t("sections")}>
          <ul className="card flex gap-1 overflow-x-auto p-1.5 text-sm lg:flex-col lg:overflow-visible">
            {sections.map((s) => {
              const n = counts?.[s.id] ?? items.filter((i) => i.group === s.id && missing(i)).length;
              const d = changed.filter((k) => byKey.get(k)!.group === s.id).length;
              const on = !across && group === s.id;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => pick(s.id)} aria-current={on ? "true" : undefined} data-group-link={s.id}
                    className={`flex min-h-10 w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left ${on ? "bg-accent-soft font-semibold text-ink" : "text-muted hover:bg-panel-2 hover:text-ink"}`}>
                    <span className="flex-1">{s.title}</span>
                    {d > 0 && <span className="rounded-full bg-[#fff1dc] px-1.5 text-[11px] font-semibold text-[#7a4300]" title={tc("draftN", { n: d })}>{tc("draftShort", { n: d })}</span>}
                    {n > 0 && <span className="rounded-full bg-warn-soft px-1.5 text-[11px] font-semibold text-warn" title={tc("todoN", { n })}>{n}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 space-y-4">
          <div className="card flex flex-wrap items-center gap-3 p-2.5">
            <span className="pl-1 text-muted"><Icon name="search" /></span>
            <SearchBox value={q} onChange={setQ} label={t("search")} />
            <OnlyTodo on={onlyTodo} onChange={setOnlyTodo} label={t("onlyTodo", { n: todo })} zh={zh} />
          </div>
          {sections.map((s) => {
            if (!across && s.id !== group) return null;
            const its = items.filter((i) => i.group === s.id && match(i));
            if (!its.length && across) return null;
            return (
              <section key={s.id} id={`set-${s.id}`} className="card scroll-mt-24" data-group={s.id}>
                <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
                  <h2 className="h3">{s.title}</h2>
                  {s.description && <p className="text-xs text-muted">{s.description}</p>}
                </header>
                {s.extra}
                {its.map((i) => (
                  <FieldRow key={i.key} item={i} draft={drafts[i.key]} error={errors[i.key]} canEdit={canEdit} zh={zh} focused={focus === i.key}
                    onChange={(v) => setDraft(i.key, v)} onBlur={() => validate(i.key)} />
                ))}
              </section>
            );
          })}
          {across && !items.some(match) && <p className="text-sm text-muted">{t("noMatch")}</p>}
        </div>
      </div>

      {canEdit && (changed.length > 0 || done) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[#0b1528] text-white" role="region" aria-label={tc("changeBar")}>
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            {changed.length > 0 ? (
              <>
                <span className="flex-1 text-sm">{tc("bar", { n: changed.length, danger: dangerous.length, restart: restart.length })}</span>
                <button type="button" className="min-h-11 rounded-xl border border-[#c9d6dc] px-4 text-sm" onClick={async () => (await confirmDialog(tc("discardAsk", { n: changed.length }))) && (setDrafts({}), setErrors({}))}>{tc("discardAll")}</button>
                <button type="button" className="min-h-11 rounded-xl bg-[#6fe3b0] px-4 text-sm font-semibold text-[#04201a]" onClick={openReview}>{tc("review")}</button>
              </>
            ) : done ? (
              <span className="flex-1 text-sm">{done.failed ? tc("appliedSome", { n: done.n, failed: done.failed }) : tc("applied", { n: done.n })} · <a href="#changes" className="font-semibold text-[#6fe3b0] underline">{tc("seeLog")}</a></span>
            ) : null}
          </div>
        </div>
      )}
      {review && <Review changed={changed} drafts={drafts} byKey={byKey} titles={titles} zh={zh} onClose={() => setReview(false)} onApply={apply} />}
    </div>
  );
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <span className="min-w-0 flex-1">
      <ControlText value={value} onChange={onChange} label={label} />
    </span>
  );
}
function ControlText({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  // the search box is a plain text field of the kit (component 2)
  return <Field value={value} onChange={onChange} label={label} placeholder={label} />;
}
function OnlyTodo({ on, onChange, label, zh }: { on: boolean; onChange: (v: boolean) => void; label: string; zh: boolean }) {
  return (
    <span className="flex items-center gap-2 pr-2 text-sm">
      <span className="font-medium">{label}</span>
      <Toggle on={on} onChange={onChange} label={label} zh={zh} />
    </span>
  );
}

/** One field row: name, help, labels (when it takes effect, where the value comes from, danger) | control and messages */
function FieldRow({ item, draft, error, canEdit, zh, focused, onChange, onBlur }: { item: SettingItem; draft: string | undefined; error?: L; canEdit: boolean; zh: boolean; focused: boolean; onChange: (v: string | undefined) => void; onBlur: () => void }) {
  const t = useTranslations("admin.settings");
  const tc = useTranslations("admin.ctl");
  const locked = item.source === "env";
  const need = missing(item);
  const state: ControlState = locked ? "locked" : error ? "error" : draft !== undefined ? "draft" : "default";
  const was = item.type === "secret" ? (item.secretSet ? item.hint ?? "••••" : tc("notSet")) : item.generated ? tc("generatedHidden") : item.value === "" ? tc("notSet") : displayValue(item, item.value, zh);
  return (
    <div className={`grid gap-3 border-t border-line px-4 py-3.5 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] ${draft !== undefined ? "bg-[#fffcf6] dark:bg-[#1d1a12]" : need ? "bg-warn-soft/40" : ""} ${focused ? "ring-2 ring-inset ring-accent" : ""}`} data-setting={item.key} onBlur={onBlur}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 font-semibold">
          {item.label}
          {need && <span className="badge bg-warn-soft text-warn">{t("needed")}</span>}
        </div>
        {item.help && <div className="mt-0.5 text-xs text-muted">{item.help}</div>}
        {item.link && (
          <a href={item.link.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-accent underline-offset-2 hover:underline">{item.link.label} ↗</a>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
          {item.restart ? (
            <span className="badge bg-[#fff1dc] text-[#7a4300]">{item.pendingRestart ? tc("restartPending") : tc("effectRestart")}</span>
          ) : (
            <span className="badge bg-accent-soft text-ok" title={tc("effectLiveTip")}>{tc("effectLive")}</span>
          )}
          {locked ? (
            <span className="badge bg-warn-soft text-warn">{t("source.env", { env: item.env ?? "" })}</span>
          ) : item.source === "db" ? (
            <span className="badge bg-panel-2 text-muted">{tc("sourceDb")}</span>
          ) : (
            <span className="badge bg-panel-2 text-muted">{item.source === "default" ? tc("sourceDefault") : tc("sourceUnset")}</span>
          )}
          {(item.ui.danger || item.generated) && <span className="badge bg-err-soft text-err" title={lang(item.ui.danger, zh)}>{tc("danger")}</span>}
        </div>
      </div>
      <div className="min-w-0 space-y-1">
        <SettingControl item={item} value={item.value} draft={draft} onChange={onChange} state={state} disabled={!canEdit || locked || !!item.ui.readOnly} zh={zh} />
        {item.ui.note && <div className="text-xs text-muted">{lang(item.ui.note, zh)}</div>}
        {item.derived && item.control !== "readonly" && <div className="break-all font-mono text-xs text-muted">{item.key === "hub.signingKey" ? t("publicKey") : t("address")}: {item.derived}</div>}
        {draft !== undefined && !error && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#7a4300]">
            <span>● {tc("draftWas", { was })}</span>
            <button type="button" className="font-semibold underline" onClick={() => onChange(undefined)}>{tc("undo")}</button>
          </div>
        )}
        {error && <div className="text-xs text-err" role="alert">{lang(error, zh)}</div>}
        {locked && <div className="text-xs text-muted">{tc("lockedNote", { env: item.env ?? "" })}</div>}
        {canEdit && !locked && draft === undefined && item.source === "db" && !item.generated && item.type !== "secret" && item.defaultValue !== undefined && item.value !== item.defaultValue && (
          <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => onChange("")}>{tc("toDefault", { v: displayValue(item, item.defaultValue, zh) })}</button>
        )}
      </div>
    </div>
  );
}

/** The review: each change old → new, when it takes effect, and the consequence to tick for dangerous ones */
function Review({ changed, drafts, byKey, titles, zh, onClose, onApply }: { changed: string[]; drafts: Record<string, string>; byKey: Map<string, SettingItem>; titles: Record<string, string>; zh: boolean; onClose: () => void; onApply: (confirmed: string[]) => Promise<void> }) {
  const tc = useTranslations("admin.ctl");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const rows = changed.map((k) => {
    const i = byKey.get(k)!;
    const v = drafts[k];
    const danger = i.generated || isDanger(i, v);
    const from = i.type === "secret" ? (i.secretSet ? i.hint ?? "••••" : tc("notSet")) : i.generated ? tc("generatedHidden") : i.value === "" ? tc("notSet") : displayValue(i, i.value, zh);
    const to = v === "" ? (i.generated ? tc("regenerate") : i.defaultValue !== undefined ? `${tc("defaultIs")} ${displayValue(i, i.defaultValue, zh)}` : tc("cleared")) : displayValue(i, v, zh);
    return { k, i, danger, from, to, text: lang(i.ui.danger, zh) || tc("dangerGenerated") };
  });
  const need = rows.filter((r) => r.danger);
  const ready = need.every((r) => ticked[r.k]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-labelledby="review-title" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex h-full w-full max-w-[440px] flex-col gap-4 overflow-y-auto bg-panel p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="review-title" className="h3">{tc("reviewN", { n: rows.length })}</h2>
          <button type="button" className="grid h-11 w-11 place-items-center rounded-xl text-muted hover:bg-panel-2" aria-label={tc("close")} onClick={onClose}>✕</button>
        </div>
        {rows.map((r) => (
          <div key={r.k} className={`flex flex-col gap-1.5 rounded-xl p-3 ${r.danger ? "border border-err/40 bg-err-soft/30" : "border border-line"}`} data-review={r.k}>
            <span className="text-xs text-muted">{titles[r.i.group] ?? r.i.group} › {r.i.label}</span>
            <span className="break-all font-mono text-[13px]"><span className="text-err line-through">{r.from}</span> → <span className="text-ok">{r.to}</span></span>
            <span className="text-xs text-muted">{r.i.restart ? tc("effectRestartLong") : tc("effectLiveLong")}</span>
            {r.danger && <DangerConfirm text={tc("iUnderstand", { text: r.text })} checked={!!ticked[r.k]} onChange={(v) => setTicked((t) => ({ ...t, [r.k]: v }))} />}
          </div>
        ))}
        <Action kind="primary" disabled={!ready || busy} onClick={async () => { setBusy(true); await onApply(need.map((r) => r.k)); setBusy(false); }}>
          {busy ? tc("applying") : tc("applyN", { n: rows.length })}
        </Action>
        <span className="text-xs text-muted">{tc("revertable")}</span>
      </div>
    </div>
  );
}

type ChangeSet = { id: string; at: string; actor: string | null; reverts?: string; entries: { key: string; cleared: boolean; secret: boolean; value: string | null; previous: string | null; previousSource: string | null }[] };

/** The change log: each applied set, who and when, old → new; a set can be put back */
export function ChangeLog({ items, titles, zh, canEdit }: { items: SettingItem[]; titles: Record<string, string>; zh: boolean; canEdit: boolean }) {
  const tc = useTranslations("admin.ctl");
  const router = useRouter();
  const [sets, setSets] = useState<ChangeSet[] | null>(null);
  const [msg, setMsg] = useState("");
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const load = useCallback(async () => {
    const r = await fetch("/api/admin/settings/history").then((x) => x.json()).catch(() => ({ sets: [] }));
    setSets(r.sets ?? []);
  }, []);
  useEffect(() => void load(), [load, items]);
  const show = (key: string, v: string | null, src?: string | null) => {
    const i = byKey.get(key);
    if (v === null) {
      if (src === "default" && i?.defaultValue !== undefined) return `${tc("defaultIs")} ${displayValue(i, i.defaultValue, zh)}`;
      return src && src !== "db" ? tc("notSet") : "—";
    }
    if (v === "" && i?.defaultValue !== undefined) return `${tc("defaultIs")} ${displayValue(i, i.defaultValue, zh)}`;
    return i ? displayValue(i, v, zh) : v;
  };
  return (
    <section id="changes" className="card scroll-mt-24" aria-labelledby="changes-title">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
        <h2 id="changes-title" className="h3">{tc("log")}</h2>
        <p className="text-xs text-muted">{tc("logHelp")}</p>
      </header>
      {msg && <p className="border-t border-line px-4 py-2 text-sm text-ok" role="status">{msg}</p>}
      {sets === null ? (
        <p className="border-t border-line px-4 py-3 text-sm text-muted">…</p>
      ) : sets.length === 0 ? (
        <p className="border-t border-line px-4 py-3 text-sm text-muted">{tc("logEmpty")}</p>
      ) : (
        <ul>
          {sets.slice(0, 15).map((s) => (
            <li key={s.id} className="flex flex-wrap items-start gap-3 border-t border-line px-4 py-3 text-sm">
              <span className="w-40 shrink-0 text-xs text-muted">{new Date(s.at).toLocaleString(zh ? "zh-TW" : "en-US")}{s.actor ? ` · ${s.actor}` : ""}</span>
              <ul className="min-w-0 flex-1 space-y-1">
                {s.entries.map((e, j) => {
                  const i = byKey.get(e.key);
                  return (
                    <li key={j} className="break-words">
                      <span className="text-muted">{i ? `${titles[i.group] ?? i.group} › ${i.label}` : e.key}</span>{" "}
                      {e.secret ? <span>{tc("secretChanged")}</span> : <span className="font-mono text-[13px]">{show(e.key, e.previous, e.previousSource)} → {show(e.key, e.value)}</span>}
                    </li>
                  );
                })}
              </ul>
              {canEdit && s.entries.some((e) => !e.secret) && (
                <Action kind="link" onClick={async () => {
                  if (!(await confirmDialog(tc("revertAsk")))) return;
                  const r = await post("/api/admin/settings/history", { revert: s.id }).catch((e) => ({ error: (e as Error).message }));
                  setMsg(r.error ? r.error : tc("reverted", { n: r.reverted?.length ?? 0, skipped: r.skipped?.length ?? 0 }));
                  router.refresh();
                  void load();
                }}>{tc("revert")}</Action>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OenCheck() {
  const t = useTranslations("admin.settings");
  const [res, setRes] = useState<{ ok: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        className="btn-ghost !py-1.5"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setRes(await post("/api/admin/settings/check-oen", {}).catch((e) => ({ ok: false, error: (e as Error).message })));
          setBusy(false);
        }}
      >
        {t("check")}
      </button>
      {res && (res.ok ? <span className="text-ok">✓ {t("checkOk")}</span> : <span className="text-err">{res.error}</span>)}
    </span>
  );
}

export function RotateHubKey() {
  const t = useTranslations("admin.settings");
  const router = useRouter();
  return (
    <button
      className="btn-ghost !py-1.5"
      onClick={async () => {
        if (!(await confirmDialog(t("confirmRotate"), { danger: true }))) return;
        await post("/api/admin/settings/rotate-hub", {});
        router.refresh();
      }}
    >
      {t("rotate")}
    </button>
  );
}

export function CopyText({ text }: { text: string }) {
  const t = useTranslations("admin.settings");
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="icon-btn" aria-label={t("copy")} data-tip={ok ? "✓" : t("copy")} onClick={async () => { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      <Icon name={ok ? "check" : "copy"} />
    </button>
  );
}
