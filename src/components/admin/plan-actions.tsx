"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { confirmDialog } from "@/components/confirm";
import { marginText } from "@/lib/admin/margin";
import { HEALTHY_MARGIN, MAX_MULTIPLIER, limitsFromMax, planLimits, planMargin } from "@/lib/price-math";

async function send(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return (j.error === "invalid_request" ? j.issues?.[0]?.message : j.error) ?? `HTTP ${r.status}`;
}

export type PlanData = { id?: string; code: string; name: string; nameEn: string; feeTwd: number; multiplier: number; concurrency: number; active: boolean; sortOrder: number };

const n2 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** One-click change from a suggestion: the plan saved with one field changed */
export function ApplyPlanChange({ plan, change, label, confirm, primary }: { plan: PlanData; change: Partial<PlanData>; label: string; confirm: string; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className={primary ? "btn-primary !py-1.5" : "btn-ghost !py-1.5"}
        disabled={busy}
        onClick={async () => {
          if (!(await confirmDialog(confirm))) return;
          setBusy(true);
          setErr("");
          const e = await send("/api/admin/plans", "POST", { ...plan, ...change });
          setBusy(false);
          if (e) return setErr(e);
          router.refresh();
        }}
      >
        {label}
      </button>
      {err && <span className="text-xs text-err" role="alert">{err}</span>}
    </span>
  );
}

/**
 * A paid plan's form, in plain words: monthly fee and how many times the fee a subscriber may use; the allowance,
 * the 6-hour and weekly caps and the worst-case margin follow live.
 */
export function PlanForm({ plan, buffer, tokensPerTwd, closeHref }: { plan?: PlanData; buffer: number; tokensPerTwd: number; closeHref: string }) {
  const t = useTranslations("admin.pl");
  const tp = useTranslations("admin.plans");
  const router = useRouter();
  const [v, setV] = useState({
    code: plan?.code ?? "", name: plan?.name ?? "", nameEn: plan?.nameEn ?? "", feeTwd: String(plan?.feeTwd ?? ""),
    multiplier: String(plan?.multiplier ?? "1"), concurrency: String(plan?.concurrency ?? 2), sortOrder: String(plan?.sortOrder ?? 100),
  });
  const [active, setActive] = useState(plan?.active ?? false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fee = Number(v.feeTwd), mult = Number(v.multiplier);
  const lim = planLimits(fee, mult);
  const badMult = !(mult > 0 && mult <= MAX_MULTIPLIER);
  const margin = planMargin(mult, buffer);
  const tok = (twd: number) => Math.round(twd * tokensPerTwd);
  const f = (k: keyof typeof v, label: string, help?: string, mono = true) => (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input className={`input ${mono ? "font-mono" : ""}`} name={k} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      {help && <span className="mt-0.5 block text-[11px] text-muted">{help}</span>}
    </label>
  );
  return (
    <form
      className="space-y-3"
      data-plan={plan?.code ?? "new"}
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        setBusy(true);
        const e2 = await send("/api/admin/plans", "POST", { id: plan?.id, code: v.code.trim(), name: v.name, nameEn: v.nameEn, feeTwd: fee, multiplier: mult, concurrency: Number(v.concurrency), active, sortOrder: Number(v.sortOrder) });
        setBusy(false);
        if (e2) return setErr(e2);
        router.push(closeHref);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        {f("name", tp("name"), undefined, false)}
        {f("nameEn", tp("nameEn"), undefined, false)}
        {f("feeTwd", t("fee"))}
        {f("multiplier", t("multiplier"), t("multiplierHelp"))}
        {f("concurrency", tp("concurrency"))}
        {f("code", tp("code"), plan ? undefined : t("codeHelp"))}
      </div>
      <dl className="grid grid-cols-2 gap-2 rounded-xl bg-panel-2 p-3 text-xs" aria-live="polite">
        <div><dt className="text-muted">{t("allowance")}</dt><dd className="font-mono text-sm" data-calc="max">NT${n2(lim.maxCostTwd)}</dd><dd className="text-muted">{t("tokens", { n: n2(tok(lim.maxCostTwd)) })}</dd></div>
        <div><dt className="text-muted">{t("marginFull")}</dt><dd className={`font-mono text-sm font-semibold ${badMult ? "" : margin < 1 ? "text-err" : margin < HEALTHY_MARGIN ? "text-warn" : "text-ok"}`} data-calc="margin">{badMult ? "—" : marginText(margin, t)}</dd></div>
        <div><dt className="text-muted">{t("cap6")}</dt><dd className="font-mono" data-calc="l6">NT${n2(lim.l6Twd)}</dd></div>
        <div><dt className="text-muted">{t("cap7")}</dt><dd className="font-mono" data-calc="l168">NT${n2(lim.l168Twd)}</dd></div>
      </dl>
      {badMult && <p className="text-sm text-err" role="alert">{tp("badMult", { max: MAX_MULTIPLIER })}</p>}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" role="switch" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t("onSale")}</label>
        <label className="flex items-center gap-2 text-muted">{tp("sort")} <input className="input !w-20 !py-1.5" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={busy || badMult || !(fee > 0) || !v.code.trim() || !v.name.trim() || !v.nameEn.trim()}>{plan ? tp("save") : tp("add")}</button>
        {err && <span className="text-sm text-err" role="alert">{err}</span>}
      </div>
    </form>
  );
}

/** The free plan: the allowance itself (no fee), concurrency, on / off */
export function FreePlanForm({ plan, proMax, proName, tokensPerTwd, closeHref }: { plan: { name: string; nameEn: string; maxCostTwd: number; concurrency: number; active: boolean }; proMax: number; proName: string; tokensPerTwd: number; closeHref: string }) {
  const t = useTranslations("admin.pl");
  const tp = useTranslations("admin.plans");
  const router = useRouter();
  const [v, setV] = useState({ name: plan.name, nameEn: plan.nameEn, maxCostTwd: String(plan.maxCostTwd), concurrency: String(plan.concurrency) });
  const [active, setActive] = useState(plan.active);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const max = Number(v.maxCostTwd);
  const lim = limitsFromMax(max);
  return (
    <form
      className="space-y-3"
      data-plan="free"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        setBusy(true);
        const e2 = await send("/api/admin/plans/free", "PUT", { name: v.name, nameEn: v.nameEn, maxCostTwd: max, concurrency: Number(v.concurrency), active });
        setBusy(false);
        if (e2) return setErr(e2);
        router.push(closeHref);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm"><span className="mb-1 block text-xs text-muted">{tp("name")}</span><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label className="block text-sm"><span className="mb-1 block text-xs text-muted">{tp("nameEn")}</span><input className="input" value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} /></label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">{tp("freeMax")}</span>
          <input className="input font-mono" name="maxCostTwd" value={v.maxCostTwd} onChange={(e) => setV({ ...v, maxCostTwd: e.target.value })} />
          {proMax > 0 && max > 0 && <span className="mt-0.5 block text-[11px] text-muted">{t("ofPro", { plan: proName, r: n2(proMax / max) })}</span>}
        </label>
        <label className="block text-sm"><span className="mb-1 block text-xs text-muted">{tp("concurrency")}</span><input className="input font-mono" value={v.concurrency} onChange={(e) => setV({ ...v, concurrency: e.target.value })} /></label>
      </div>
      {proMax > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {[10, 20, 50].map((r) => (
            <button key={r} type="button" className="chip hover:border-accent" onClick={() => setV({ ...v, maxCostTwd: String(Math.round((proMax / r) * 100) / 100) })}>{t("setOfPro", { plan: proName, r })}</button>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-panel-2 p-3 text-xs" aria-live="polite">
        <div><dt className="text-muted">{t("tokensShort")}</dt><dd className="font-mono">{n2(Math.round(lim.maxCostTwd * tokensPerTwd))}</dd></div>
        <div><dt className="text-muted">{t("cap6")}</dt><dd className="font-mono" data-calc="l6">NT${n2(lim.l6Twd)}</dd></div>
        <div><dt className="text-muted">{t("cap7")}</dt><dd className="font-mono" data-calc="l168">NT${n2(lim.l168Twd)}</dd></div>
      </dl>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={active} onChange={(e) => setActive(e.target.checked)} /> {tp("freeOn")}</label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={busy || !(max >= 0) || !v.name.trim() || !v.nameEn.trim()}>{tp("save")}</button>
        {err && <span className="text-sm text-err" role="alert">{err}</span>}
      </div>
    </form>
  );
}
