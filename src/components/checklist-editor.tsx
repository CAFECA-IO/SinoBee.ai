"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { confirmDialog } from "./confirm";

type Item = { id: string; dimension: string; zh: string; en: string };

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? (j.issues ? j.issues.map((i: { message: string }) => i.message).join("; ") : `HTTP ${r.status}`));
  return j;
}

/** Admin editor for the screening checklist draft: by hand or by talking to a model, then publish */
export function ChecklistEditor({ items: initial, dimensions, min, version, changed }: { items: Item[]; dimensions: readonly string[]; min: number; version: number; changed: boolean }) {
  const t = useTranslations("checklist");
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [dim, setDim] = useState("");
  const [find, setFind] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const counts = useMemo(() => Object.fromEntries(dimensions.map((d) => [d, items.filter((i) => i.dimension === d).length])), [items, dimensions]);
  const problems = [...(items.length < min ? [t("needMin", { min, n: items.length })] : []), ...dimensions.filter((d) => !counts[d]).map((d) => t("emptyDim", { d: t(`dim.${d}`) }))];
  const update = (idx: number, patch: Partial<Item>) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    setDirty(true);
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy("");
  };
  return (
    <div className="space-y-6">
      <div className="card space-y-3 p-5">
        <div className="font-semibold">{t("ai")}</div>
        <p className="text-xs text-muted">{t("aiHint")}</p>
        <textarea className="input min-h-20" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t("aiPlaceholder")} maxLength={4000} />
        <button
          className="btn-primary !py-2"
          disabled={!!busy || !instruction.trim()}
          onClick={() =>
            run("ai", async () => {
              const r = await send("/api/admin/checklist/ai", "POST", { instruction });
              setItems(r.items);
              setReply(r.reply);
              setDirty(false);
              setInstruction("");
              router.refresh();
            })
          }
        >
          {busy === "ai" ? t("thinking") : t("aiApply")}
        </button>
        {reply && <p className="whitespace-pre-wrap rounded-xl bg-panel-2 p-3 text-sm">{reply}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">{t("total", { n: items.length, min })}</span>
        {(changed || dirty) && <span className="badge bg-warn-soft text-warn">{t("draftBadge", { v: version })}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`chip !py-1 ${dim === "" ? "!border-accent bg-accent-soft font-semibold !text-ink" : ""}`} onClick={() => setDim("")}>{t("allDims")}</button>
        {dimensions.map((d) => (
          <button key={d} type="button" className={`chip !py-1 ${dim === d ? "!border-accent bg-accent-soft font-semibold !text-ink" : ""}`} onClick={() => setDim(d)}>{t(`dim.${d}`)} {counts[d]}</button>
        ))}
        <span className="flex-1" />
        <input className="input !w-56 !py-1.5" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("find")} aria-label={t("find")} />
      </div>

      {dimensions.filter((d) => !dim || d === dim).map((d) => {
        const rows = items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.dimension === d && (!find.trim() || `${it.id} ${it.zh} ${it.en}`.toLowerCase().includes(find.trim().toLowerCase())));
        if (find.trim() && !rows.length) return null;
        return (
          <section key={d} className="card overflow-hidden">
            <h3 className="border-b border-line px-4 py-2.5 font-semibold">{t(`dim.${d}`)} <span className="text-sm font-normal text-muted">· {counts[d]}</span></h3>
            <ul className="divide-y divide-line">
              {rows.map(({ it, idx }) =>
                editing === idx ? (
                  <li key={`${it.id}-${idx}`} className="space-y-2 bg-panel-2/50 px-4 py-3">
                    <div className="font-mono text-xs text-muted">{it.id || t("new")}</div>
                    <textarea className="input min-h-14 text-sm" value={it.zh} onChange={(e) => update(idx, { zh: e.target.value })} aria-label="中文" autoFocus />
                    <textarea className="input min-h-14 text-sm" value={it.en} onChange={(e) => update(idx, { en: e.target.value })} aria-label="English" />
                    <div className="flex gap-2">
                      <button type="button" className="btn-ghost !py-1.5 text-sm" onClick={() => setEditing(null)}>{t("done")}</button>
                      <button
                        type="button"
                        className="btn-ghost !py-1.5 text-sm text-err"
                        onClick={() => {
                          setItems(items.filter((_, i) => i !== idx));
                          setEditing(null);
                          setDirty(true);
                        }}
                      >
                        {t("remove")}
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={`${it.id}-${idx}`} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                    <span className="w-10 shrink-0 pt-0.5 font-mono text-xs text-muted">{it.id || t("new")}</span>
                    <div className="min-w-0 flex-1">
                      <div>{it.zh || <span className="text-muted">—</span>}</div>
                      <div className="text-xs text-muted">{it.en}</div>
                    </div>
                    <button type="button" className="shrink-0 text-xs text-accent" onClick={() => setEditing(idx)}>{t("edit")}</button>
                  </li>
                ),
              )}
            </ul>
            <div className="border-t border-line px-4 py-2.5">
              <button
                type="button"
                className="btn-ghost !py-1.5 text-sm"
                onClick={() => {
                  setItems([...items, { id: "", dimension: d, zh: "", en: "" }]);
                  setEditing(items.length);
                  setDirty(true);
                }}
              >
                {t("add")}
              </button>
            </div>
          </section>
        );
      })}

      {(dirty || changed || !!ok || !!err) && (
      <div className="card sticky bottom-4 space-y-3 p-4 shadow-lg">
        {problems.length > 0 && <p className="text-sm text-warn">{problems.join("；")}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost !py-2" disabled={!!busy || !dirty} onClick={() => run("save", async () => { const r = await send("/api/admin/checklist", "PUT", { items }); setItems(r.items); setDirty(false); router.refresh(); })}>
            {t("save")}
          </button>
          <button className="btn-ghost !py-2 text-err" disabled={!!busy} onClick={() => run("discard", async () => { if (!(await confirmDialog(t("confirmDiscard"), { danger: true }))) return; await send("/api/admin/checklist", "DELETE"); router.refresh(); location.reload(); })}>
            {t("discard")}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-64 flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("note")} maxLength={2000} />
          <button
            className="btn-primary !py-2"
            disabled={!!busy || dirty || problems.length > 0 || !note.trim()}
            onClick={() =>
              run("publish", async () => {
                if (!(await confirmDialog(t("confirmPublish")))) return;
                const r = await send("/api/admin/checklist/publish", "POST", { note });
                setNote("");
                setOk(t("published", { v: r.version }));
                router.refresh();
              })
            }
          >
            {t("publish")}
          </button>
        </div>
        {dirty && <p className="text-xs text-muted">{t("saveFirst")}</p>}
        {ok && <p className="text-sm text-ok" role="status">{ok}</p>}
        {err && <p className="text-sm text-err" role="alert">{err}</p>}
      </div>
      )}
    </div>
  );
}
