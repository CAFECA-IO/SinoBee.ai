"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Icon } from "./icon";

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
};

export type SettingsSection = { id: string; title: string; description?: string; extra?: ReactNode };

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error === "invalid_request" ? (j.issues?.[0]?.message ?? "invalid") : (j.error ?? `HTTP ${r.status}`));
  return j;
}

/** an item still needs a value before going live */
const missing = (i: SettingItem) => !!i.required && (i.type === "secret" ? !i.secretSet : !i.value);

/**
 * Settings as one board: section index with status dots, search, a "needs attention" filter, and per-section
 * drafts saved together (or discarded) — so several related values (e.g. Oen domain + token) change at once.
 */
export function SettingsBoard({ sections, items, canEdit }: { sections: SettingsSection[]; items: SettingItem[]; canEdit: boolean }) {
  const t = useTranslations("admin.settings");
  const [q, setQ] = useState("");
  const [onlyTodo, setOnlyTodo] = useState(false);
  const match = (i: SettingItem) => {
    if (onlyTodo && !missing(i)) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return [i.label, i.key, i.env ?? "", i.help ?? ""].some((x) => x.toLowerCase().includes(s));
  };
  const todo = items.filter(missing).length;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav className="min-w-0 lg:sticky lg:top-20 lg:self-start" aria-label={t("sections")}>
        <ul className="flex gap-1 overflow-x-auto pb-1 text-sm lg:flex-col lg:overflow-visible">
          {sections.map((s) => {
            const its = items.filter((i) => i.group === s.id);
            const warn = its.some(missing);
            return (
              <li key={s.id}>
                <a href={`#set-${s.id}`} className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-muted hover:bg-panel-2 hover:text-ink">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${warn ? "bg-warn" : "bg-ok"}`} aria-hidden />
                  {s.title}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 space-y-5">
        <div className="card flex flex-wrap items-center gap-3 p-3">
          <span className="text-muted"><Icon name="search" /></span>
          <input className="input min-w-0 flex-1 !border-0 !bg-transparent !shadow-none" placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search")} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" role="switch" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} />
            {t("onlyTodo", { n: todo })}
          </label>
        </div>
        {sections.map((s) => {
          const its = items.filter((i) => i.group === s.id && match(i));
          if (!its.length && (q || onlyTodo)) return null;
          return <Section key={s.id} section={s} items={its} canEdit={canEdit} />;
        })}
        {q && !items.some(match) && <p className="text-sm text-muted">{t("noMatch")}</p>}
      </div>
    </div>
  );
}

function Section({ section, items, canEdit }: { section: SettingsSection; items: SettingItem[]; canEdit: boolean }) {
  const t = useTranslations("admin.settings");
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(items.map((i) => [i.key, i.type === "secret" ? "" : i.value])), [items]);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = items.filter((i) => (draft[i.key] ?? "") !== (initial[i.key] ?? ""));
  const save = async (changes: { key: string; value: string }[]) => {
    setBusy(true);
    setSaved(false);
    setErrors({});
    try {
      const r = await post("/api/admin/settings", { changes });
      setErrors(r.errors ?? {});
      // secrets are write-only: clear what was typed once it is stored
      const stored = changes.filter((c) => !(r.errors ?? {})[c.key] && items.find((i) => i.key === c.key)?.type === "secret");
      if (stored.length) setDraft((d) => ({ ...d, ...Object.fromEntries(stored.map((c) => [c.key, ""])) }));
      if (r.ok) setSaved(true);
      router.refresh();
    } catch (e) {
      setErrors({ _: (e as Error).message });
    }
    setBusy(false);
  };
  return (
    <section id={`set-${section.id}`} className="card scroll-mt-24" data-group={section.id}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
        <h2 className="h3">{section.title}</h2>
        {section.description && <p className="text-xs text-muted">{section.description}</p>}
      </header>
      {section.extra}
      {items.map((i) => (
        <Field
          key={i.key}
          item={i}
          canEdit={canEdit}
          value={draft[i.key] ?? ""}
          error={errors[i.key]}
          onChange={(v) => {
            setSaved(false);
            setDraft((d) => ({ ...d, [i.key]: v }));
          }}
          onClear={() => save([{ key: i.key, value: "" }])}
        />
      ))}
      {canEdit && (dirty.length > 0 || saved || errors._) && (
        <footer className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-b-2xl border-t border-line bg-panel/95 p-3 backdrop-blur">
          {dirty.length > 0 ? (
            <>
              <span className="text-sm">{t("dirty", { n: dirty.length })}</span>
              <span className="flex-1" />
              <button className="btn-ghost !py-1.5" disabled={busy} onClick={() => { setDraft(initial); setErrors({}); }}>{t("discard")}</button>
              <button className="btn-primary !py-1.5" disabled={busy} onClick={() => save(dirty.map((i) => ({ key: i.key, value: draft[i.key] ?? "" })))}>
                {busy ? t("saving") : t("saveN", { n: dirty.length })}
              </button>
            </>
          ) : (
            saved && <span className="text-sm text-ok">✓ {t("saved")}</span>
          )}
          {errors._ && <span className="text-sm text-err" role="alert">{errors._}</span>}
        </footer>
      )}
    </section>
  );
}

function Field({ item, canEdit, value, error, onChange, onClear }: { item: SettingItem; canEdit: boolean; value: string; error?: string; onChange: (v: string) => void; onClear: () => void }) {
  const t = useTranslations("admin.settings");
  const [reveal, setReveal] = useState(false);
  const locked = item.source === "env";
  const disabled = !canEdit || locked;
  const listSet = new Set(value.split(",").filter(Boolean));
  const need = missing(item);
  let input: ReactNode;
  if (item.type === "select")
    input = (
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={item.label}>
        {item.options!.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} disabled={disabled} onClick={() => onChange(o)} className={`rounded-lg border px-3 py-1.5 text-sm ${value === o ? "border-accent bg-accent-soft font-semibold text-ink" : "border-line text-muted hover:border-accent"} disabled:opacity-60`}>
            {o}
          </button>
        ))}
      </div>
    );
  else if (item.type === "bool")
    input = <input type="checkbox" role="switch" checked={value === "1"} disabled={disabled} onChange={(e) => onChange(e.target.checked ? "1" : "0")} aria-label={item.label} />;
  else if (item.type === "list" && item.options)
    input = (
      <div className="flex flex-wrap gap-4 text-sm">
        {item.options.map((o) => (
          <label key={o} className="flex items-center gap-2">
            <input
              type="checkbox"
              role="switch"
              disabled={disabled}
              checked={listSet.has(o)}
              onChange={(e) => {
                const s = new Set(listSet);
                if (e.target.checked) s.add(o);
                else s.delete(o);
                onChange(item.options!.filter((x) => s.has(x)).join(","));
              }}
            />
            {o}
          </label>
        ))}
      </div>
    );
  else
    input = (
      <div className="flex items-center gap-2">
        <input
          className={`input ${item.type === "secret" || item.type === "number" || item.type === "url" ? "font-mono text-[13px]" : ""} ${need ? "!border-warn" : ""}`}
          type={item.type === "secret" && !reveal ? "password" : "text"}
          inputMode={item.type === "number" ? "decimal" : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={item.type === "secret" ? (item.secretSet ? t("replace") : t("enter")) : item.source === "default" || item.source === "unset" ? item.value || t("empty") : ""}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={item.label}
        />
        {item.type === "secret" && value && (
          <button type="button" className="icon-btn" onClick={() => setReveal((r) => !r)} aria-label={reveal ? t("hide") : t("show")} data-tip={reveal ? t("hide") : t("show")}>
            <Icon name={reveal ? "eyeOff" : "eye"} />
          </button>
        )}
      </div>
    );

  return (
    <div className={`grid gap-3 border-t border-line px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] ${need ? "bg-warn-soft/40" : ""}`} data-setting={item.key}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 font-medium">
          {item.label}
          {need && <span className="badge bg-warn-soft text-warn">{t("needed")}</span>}
        </div>
        {item.help && <div className="mt-0.5 text-xs text-muted">{item.help}</div>}
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
          <span className={`badge ${locked ? "bg-warn-soft text-warn" : item.source === "db" ? "bg-accent-soft text-ok" : "bg-panel-2 text-muted"}`} data-tip={item.env ? `env ${item.env}` : item.key}>
            {locked ? t("source.env", { env: item.env ?? "" }) : t(`source.${item.source}`)}
          </span>
          {item.type === "secret" && item.secretSet && <span className="badge bg-panel-2 text-muted">{item.generated ? t("generated") : t("set", { hint: item.hint ?? "" })}</span>}
          {item.restart && <span className="badge bg-panel-2 text-muted">{t("restart")}</span>}
        </div>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">{input}</div>
          {canEdit && !locked && item.source === "db" && !item.generated && (
            <button type="button" className="icon-btn" onClick={() => confirm(t("confirmClear")) && onClear()} aria-label={t("clear")} data-tip={t("clear")}>
              <Icon name="x" />
            </button>
          )}
        </div>
        {item.derived && <div className="break-all font-mono text-xs text-muted">{item.key === "hub.signingKey" ? t("publicKey") : t("address")}: {item.derived}</div>}
        {error && <div className="text-xs text-err" role="alert">{error}</div>}
      </div>
    </div>
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
        if (!confirm(t("confirmRotate"))) return;
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
