"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { confirmDialog } from "@/components/confirm";
import { formatPrice, publishedTwd } from "@/lib/price-math";

const KINDS = ["input", "output", "cacheRead", "cacheWrite"] as const;
type Kind = (typeof KINDS)[number];

async function send(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return (j.error === "invalid_request" ? j.issues?.[0]?.message : j.error) ?? `HTTP ${r.status}`;
}

export type ModelRow = { modelId: string; label: string; vendor: string; usd: Record<Kind, number>; enabled: boolean; sortOrder: number };

const pct = (a: number, b: number) => (a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null);

/**
 * One model's price in its detail panel: vendor USD with the published NT$ beside each field, the change from the
 * current price, when it takes effect, and whether it is offered. Every save adds a history row.
 */
export function ModelPriceForm({ row, fx, buffer, closeHref }: { row?: ModelRow; fx: number; buffer: number; closeHref?: string }) {
  const t = useTranslations("admin.md");
  const tp = useTranslations("admin.prices");
  const router = useRouter();
  const [modelId, setModelId] = useState(row?.modelId ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [vendor, setVendor] = useState(row?.vendor ?? "");
  const [usd, setUsd] = useState<Record<Kind, string>>(() => Object.fromEntries(KINDS.map((k) => [k, row ? String(row.usd[k]) : ""])) as Record<Kind, string>);
  const [enabled, setEnabled] = useState(row?.enabled ?? false);
  const [sortOrder, setSortOrder] = useState(String(row?.sortOrder ?? 1000));
  const [when, setWhen] = useState<"now" | "at">("now");
  const [at, setAt] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const nums = Object.fromEntries(KINDS.map((k) => [k, Number(usd[k])])) as Record<Kind, number>;
  const valid = KINDS.every((k) => usd[k] !== "" && Number.isFinite(nums[k]) && nums[k] >= 0) && /^[a-z0-9_-]+\/.+/i.test(modelId) && label.trim() && vendor.trim() && (when === "now" || !!at);
  const changes = row ? KINDS.map((k) => pct(row.usd[k], nums[k])).filter((x): x is number => x !== null && x !== 0) : [];
  const dirty = !row || KINDS.some((k) => nums[k] !== row.usd[k]) || enabled !== row.enabled || label !== row.label || vendor !== row.vendor || Number(sortOrder) !== row.sortOrder || when === "at";

  return (
    <form
      className="space-y-3"
      data-model={modelId || "new"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (row && row.enabled && !enabled && !(await confirmDialog(t("withdrawConfirm", { model: label })))) return;
        setErr("");
        setSaved(false);
        setBusy(true);
        const e2 = await send("/api/admin/prices", "POST", {
          modelId: modelId.trim(), label: label.trim(), vendor: vendor.trim(), usd: nums, enabled, sortOrder: Number(sortOrder),
          effectiveAt: when === "at" && at ? new Date(at).toISOString() : undefined,
        });
        setBusy(false);
        if (e2) return setErr(e2);
        setSaved(true);
        if (!row && closeHref) router.push(`${closeHref}&model=${encodeURIComponent(modelId.trim())}`);
        else router.refresh();
      }}
    >
      {!row && (
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">{tp("modelId")}</span>
          <input className="input font-mono" placeholder="provider/model" value={modelId} onChange={(e) => setModelId(e.target.value)} />
        </label>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
        <label className="block text-sm"><span className="mb-1 block text-xs text-muted">{tp("label")}</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="block text-sm"><span className="mb-1 block text-xs text-muted">{tp("vendor")}</span><input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs text-muted">{t("usdLegend")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => {
            const ok = usd[k] !== "" && Number.isFinite(nums[k]);
            const d = row && ok ? pct(row.usd[k], nums[k]) : null;
            return (
              <label key={k} className="block text-sm">
                <span className="mb-1 block text-xs">{tp(`k.${k}`)}</span>
                <input className="input font-mono" inputMode="decimal" value={usd[k]} name={k} onChange={(e) => setUsd({ ...usd, [k]: e.target.value })} />
                <span className="mt-0.5 block font-mono text-[11px] text-muted" data-published={k}>
                  = NT${ok ? formatPrice(publishedTwd(nums[k], fx, buffer)) : "—"}
                  {d ? <span className={d > 0 ? " text-warn" : " text-ok"}> {d > 0 ? "+" : ""}{d}%</span> : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {changes.length > 0 && <p className="rounded-xl bg-panel-2 px-3 py-2 text-xs text-muted">{t("impact")}</p>}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t("offered")}</label>
        <label className="flex items-center gap-2 text-muted">{tp("sort")} <input className="input !w-20 !py-1.5" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></label>
      </div>
      <fieldset className="space-y-1.5 text-sm">
        <legend className="mb-1 text-xs text-muted">{t("when")}</legend>
        <label className="flex items-center gap-2"><input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} /> {t("now")}</label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="radio" name="when" checked={when === "at"} onChange={() => setWhen("at")} /> {t("at")}
          {when === "at" && <input className="input !w-auto !py-1.5" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={t("at")} />}
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={busy || !valid || !dirty}>{row ? t("saveNew") : tp("add")}</button>
        {saved && <span className="text-sm text-ok">✓ {tp("saved")}</span>}
        {err && <span className="text-sm text-err" role="alert">{err}</span>}
      </div>
    </form>
  );
}

/** The vendor switch on its group header: pause every model of the vendor at once */
export function VendorPauseSwitch({ vendor, label, paused, offered }: { vendor: string; label: string; paused: boolean; offered: number }) {
  const t = useTranslations("admin.prices");
  const tm = useTranslations("admin.md");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        role="switch"
        checked={!paused}
        disabled={busy}
        aria-label={`${label} ${paused ? tm("vendorPaused") : t("running")}`}
        onChange={async (e) => {
          const pause = !e.target.checked;
          if (pause && !(await confirmDialog(t("pauseConfirm", { vendor: label, n: offered })))) return;
          setBusy(true);
          setErr("");
          const e2 = await send("/api/admin/llm/vendors", "POST", { vendor, paused: pause });
          setBusy(false);
          if (e2) return setErr(e2);
          router.refresh();
        }}
      />
      <span className={paused ? "font-semibold text-warn" : "text-muted"}>{paused ? tm("vendorPaused") : t("running")}</span>
      {err && <span className="text-err" role="alert">{err}</span>}
    </label>
  );
}

/** "修改" for the price formula: FX and buffer for every model */
export function PricingFormula({ fx, buffer }: { fx: number; buffer: number }) {
  const t = useTranslations("admin.prices");
  const tm = useTranslations("admin.md");
  const router = useRouter();
  const [f, setF] = useState(String(fx));
  const [b, setB] = useState(String(buffer));
  const [at, setAt] = useState("");
  const [err, setErr] = useState("");
  const changed = Number(f) !== fx || Number(b) !== buffer;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        if (!(await confirmDialog(t("settingsConfirm")))) return;
        const e2 = await send("/api/admin/prices/settings", "PUT", { fx: Number(f), buffer: Number(b), effectiveAt: at ? new Date(at).toISOString() : undefined });
        if (e2) return setErr(e2);
        router.refresh();
      }}
    >
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">{t("fx")}</span><input className="input !w-28 font-mono" inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} name="fx" /></label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">{t("buffer")}</span><input className="input !w-24 font-mono" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} name="buffer" /></label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">{t("effective")}</span><input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
      <button className="btn-primary" disabled={!changed}>{t("applyAll")}</button>
      {err && <span className="text-sm text-err" role="alert">{err}</span>}
      <p className="basis-full text-xs text-muted">{tm("bufferNote")}</p>
    </form>
  );
}
