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
        {dimensions.map((d) => (
          <span key={d} className="chip">{t(`dim.${d}`)} {counts[d]}</span>
        ))}
        {(changed || dirty) && <span className="badge bg-warn-soft text-warn">{t("draftBadge", { v: version })}</span>}
      </div>

      {dimensions.map((d) => (
        <section key={d} className="card space-y-3 p-5">
          <h3 className="font-semibold">{t(`dim.${d}`)}</h3>
          {items.map((it, idx) =>
            it.dimension !== d ? null : (
              <div key={`${it.id}-${idx}`} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[56px_1fr_1fr_auto]">
                <span className="font-mono text-xs text-muted">{it.id || t("new")}</span>
                <textarea className="input min-h-14 text-sm" value={it.zh} onChange={(e) => update(idx, { zh: e.target.value })} aria-label="zh" />
                <textarea className="input min-h-14 text-sm" value={it.en} onChange={(e) => update(idx, { en: e.target.value })} aria-label="en" />
                <button
                  className="text-xs text-err"
                  onClick={() => {
                    setItems(items.filter((_, i) => i !== idx));
                    setDirty(true);
                  }}
                >
                  {t("remove")}
                </button>
              </div>
            ),
          )}
          <button
            className="btn-ghost !py-1.5 text-sm"
            onClick={() => {
              setItems([...items, { id: "", dimension: d, zh: "", en: "" }]);
              setDirty(true);
            }}
          >
            {t("add")}
          </button>
        </section>
      ))}

      <div className="card sticky bottom-4 space-y-3 p-5">
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
                alert(t("published", { v: r.version }));
                router.refresh();
              })
            }
          >
            {t("publish")}
          </button>
        </div>
        {dirty && <p className="text-xs text-muted">{t("saveFirst")}</p>}
        {err && <p className="text-sm text-err" role="alert">{err}</p>}
      </div>
    </div>
  );
}
