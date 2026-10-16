"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { HEALTHY_MARGIN, MAX_MULTIPLIER, bufferFor, formatPrice, planLimits, planMargin, publishedTwd } from "@/lib/price-math";

const KINDS = ["input", "cacheRead", "cacheWrite", "output"] as const;
type Kind = (typeof KINDS)[number];

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return j.error === "invalid_request" ? (j.issues?.[0]?.message ?? "invalid") : (j.error ?? `HTTP ${r.status}`);
}

/** datetime-local value → ISO with offset; empty → undefined (= now) */
const isoOrNow = (v: string) => (v ? new Date(v).toISOString() : undefined);

// ───────────── owner claim ─────────────

export function ClaimForm() {
  const t = useTranslations("admin.claim");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        const e2 = await send("/api/admin/claim", "POST", { code });
        setBusy(false);
        if (e2) return setErr(e2);
        router.push("/admin?tab=users");
        router.refresh();
      }}
    >
      <input className="input max-w-xs font-mono uppercase" placeholder="XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("code")} autoComplete="off" />
      <button className="btn-primary" disabled={busy || code.length < 4}>{t("submit")}</button>
      {err && <span className="text-sm text-err" role="alert">{err}</span>}
    </form>
  );
}

// ───────────── roles ─────────────

export function RoleActions({ userId, account, role }: { userId: string; account: string; role: string }) {
  const t = useTranslations("admin.users");
  const [err, setErr] = useState("");
  const [transfer, setTransfer] = useState(false);
  const [confirmAcc, setConfirmAcc] = useState("");
  const router = useRouter();
  const act = async (url: string, body: unknown) => {
    setErr("");
    const e = await send(url, "POST", body);
    if (e) return setErr(e);
    setTransfer(false);
    router.refresh();
  };
  if (role === "SUPERADMIN") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {role === "ADMIN" ? (
        <button className="btn-ghost" onClick={() => act("/api/admin/roles", { userId, role: "USER" })}>{t("revoke")}</button>
      ) : (
        <button className="btn-primary" onClick={() => act("/api/admin/roles", { userId, role: "ADMIN" })}>{t("grant")}</button>
      )}
      {!transfer ? (
        <button className="btn-ghost" onClick={() => setTransfer(true)}>{t("transfer")}</button>
      ) : (
        <span className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft p-2 text-sm text-warn">
          {t("transferConfirm")}
          <input className="input w-80 font-mono text-xs" placeholder={account} value={confirmAcc} onChange={(e) => setConfirmAcc(e.target.value)} aria-label={t("transferConfirm")} />
          <button className="btn-danger" disabled={confirmAcc.trim().toLowerCase() !== account} onClick={() => act("/api/admin/roles/transfer", { userId, confirm: confirmAcc })}>{t("transferGo")}</button>
          <button className="btn-ghost" onClick={() => setTransfer(false)}>{t("cancel")}</button>
        </span>
      )}
      {err && <span className="text-sm text-err" role="alert">{err}</span>}
    </div>
  );
}

// ───────────── prices ─────────────

export type PriceRowProps = {
  modelId: string;
  label: string;
  vendor: string;
  usd: Record<Kind, number>;
  enabled: boolean;
  sortOrder: number;
};

/** `planMultipliers`: active plans' usage multipliers, to show the buffer they need */
export function PricingSettingsForm({ fx, buffer, planMultipliers = [] }: { fx: number; buffer: number; planMultipliers?: number[] }) {
  const t = useTranslations("admin.prices");
  const [f, setF] = useState(String(fx));
  const [b, setB] = useState(String(buffer));
  const [at, setAt] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const router = useRouter();
  const changed = Number(f) !== fx || Number(b) !== buffer;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        setOk(false);
        if (!confirm(t("settingsConfirm"))) return;
        const e2 = await send("/api/admin/prices/settings", "PUT", { fx: Number(f), buffer: Number(b), effectiveAt: isoOrNow(at) });
        if (e2) return setErr(e2);
        setOk(true);
        router.refresh();
      }}
    >
      <label className="text-sm">
        <span className="block text-muted">{t("fx")}</span>
        <input className="input w-28 font-mono" inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} name="fx" />
      </label>
      <label className="text-sm">
        <span className="block text-muted">{t("buffer")}</span>
        <input className="input w-24 font-mono" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} name="buffer" />
      </label>
      <label className="text-sm">
        <span className="block text-muted">{t("effective")}</span>
        <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </label>
      <button className="btn-primary" disabled={!changed}>{t("applyAll")}</button>
      {ok && <span className="text-sm text-ok">✓</span>}
      {err && <span className="text-sm text-err" role="alert">{err}</span>}
      {planMultipliers.length > 0 && (
        <p className={`basis-full text-xs ${Number(b) < bufferFor(planMultipliers) ? "text-err" : Number(b) < bufferFor(planMultipliers, HEALTHY_MARGIN) ? "text-warn" : "text-muted"}`} data-calc="buffer-need">
          {t("bufferNeed", { mult: Math.max(...planMultipliers), even: bufferFor(planMultipliers), healthy: bufferFor(planMultipliers, HEALTHY_MARGIN) })}
        </p>
      )}
    </form>
  );
}

/** Edit one model's vendor USD prices; the published TWD preview uses the same math as the server */
export function PriceEditor({ row, fx, buffer, isNew = false }: { row?: PriceRowProps; fx: number; buffer: number; isNew?: boolean }) {
  const t = useTranslations("admin.prices");
  const [modelId, setModelId] = useState(row?.modelId ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [vendor, setVendor] = useState(row?.vendor ?? "");
  const [usd, setUsd] = useState<Record<Kind, string>>(() => Object.fromEntries(KINDS.map((k) => [k, row ? String(row.usd[k]) : ""])) as Record<Kind, string>);
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const [sortOrder, setSortOrder] = useState(String(row?.sortOrder ?? 1000));
  const [at, setAt] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const router = useRouter();
  const nums = Object.fromEntries(KINDS.map((k) => [k, Number(usd[k])])) as Record<Kind, number>;
  const valid = KINDS.every((k) => usd[k] !== "" && Number.isFinite(nums[k]) && nums[k] >= 0) && modelId && label && vendor;
  const changed =
    isNew || !row || KINDS.some((k) => nums[k] !== row.usd[k]) || enabled !== row.enabled || label !== row.label || vendor !== row.vendor || Number(sortOrder) !== row.sortOrder || !!at;
  return (
    <form
      className="grid gap-3 border-t border-line p-4 text-sm lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_auto]"
      data-model={modelId}
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        setOk(false);
        const e2 = await send("/api/admin/prices", "POST", { modelId, label, vendor, usd: nums, enabled, sortOrder: Number(sortOrder), effectiveAt: isoOrNow(at) });
        if (e2) return setErr(e2);
        setOk(true);
        if (isNew) {
          setModelId("");
          setLabel("");
          setVendor("");
          setUsd({ input: "", cacheRead: "", cacheWrite: "", output: "" });
        }
        router.refresh();
      }}
    >
      <div className="space-y-2">
        {isNew ? (
          <input className="input w-full font-mono" placeholder="provider/model" value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label={t("modelId")} />
        ) : (
          <div className="font-mono text-xs text-muted">{modelId}</div>
        )}
        <div className="flex gap-2">
          <input className="input min-w-0 flex-1" placeholder={t("label")} value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t("label")} />
          <input className="input w-28" placeholder={t("vendor")} value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label={t("vendor")} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5"><input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t("enabled")}</label>
          <label className="flex items-center gap-1.5 text-muted">{t("sort")} <input className="input w-20" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {KINDS.map((k) => (
          <label key={k} className="space-y-1">
            <span className="block text-xs text-muted">{t(`k.${k}`)} (USD)</span>
            <input className="input w-full font-mono" inputMode="decimal" value={usd[k]} name={k} onChange={(e) => setUsd({ ...usd, [k]: e.target.value })} />
            <span className="block font-mono text-xs" data-published={k}>
              NT$ {Number.isFinite(nums[k]) && usd[k] !== "" ? formatPrice(publishedTwd(nums[k], fx, buffer)) : "—"}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-col items-start gap-2">
        <label className="text-xs text-muted">
          {t("effective")}
          <input className="input mt-1 block" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        <button className="btn-primary" disabled={!valid || !changed}>{isNew ? t("add") : t("save")}</button>
        {ok && <span className="text-xs text-ok">✓ {t("saved")}</span>}
        {err && <span className="text-xs text-err" role="alert">{err}</span>}
      </div>
    </form>
  );
}

// ───────────── plans ─────────────

export type PlanProps = {
  id?: string;
  code: string;
  name: string;
  nameEn: string;
  feeTwd: number;
  multiplier: number;
  concurrency: number;
  active: boolean;
  sortOrder: number;
};

/** `blended`: TWD per 1M tokens of the cheapest model (3:1), for the token preview; `buffer`: current price buffer */
export function PlanEditor({ plan, blended, blendedLabel, buffer }: { plan?: PlanProps; blended: number; blendedLabel: string; buffer: number }) {
  const t = useTranslations("admin.plans");
  const [v, setV] = useState({
    code: plan?.code ?? "",
    name: plan?.name ?? "",
    nameEn: plan?.nameEn ?? "",
    feeTwd: String(plan?.feeTwd ?? ""),
    multiplier: String(plan?.multiplier ?? "1.5"),
    concurrency: String(plan?.concurrency ?? 2),
    sortOrder: String(plan?.sortOrder ?? 100),
  });
  const [active, setActive] = useState(plan?.active ?? true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const router = useRouter();
  const fee = Number(v.feeTwd);
  const mult = Number(v.multiplier);
  const lim = planLimits(fee, mult);
  const badMult = !(mult > 0 && mult <= MAX_MULTIPLIER);
  const margin = planMargin(mult, buffer);
  const marginTone = margin < 1 ? "text-err" : margin < HEALTHY_MARGIN ? "text-warn" : "text-ok";
  const tok = (twd: number) => (blended > 0 ? Math.round((twd / blended) * 1e6).toLocaleString("en-US") : "—");
  const field = (k: keyof typeof v, label: string, cls = "w-28", mono = true) => (
    <label className="space-y-1 text-sm">
      <span className="block text-xs text-muted">{label}</span>
      <input className={`input ${cls} ${mono ? "font-mono" : ""}`} name={k} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </label>
  );
  return (
    <form
      className="card space-y-4 p-5"
      data-plan={plan?.code ?? "new"}
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        setOk(false);
        const e2 = await send("/api/admin/plans", "POST", {
          id: plan?.id, code: v.code, name: v.name, nameEn: v.nameEn, feeTwd: fee, multiplier: mult,
          concurrency: Number(v.concurrency), active, sortOrder: Number(v.sortOrder),
        });
        if (e2) return setErr(e2);
        setOk(true);
        router.refresh();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {field("code", t("code"), "w-24")}
        {field("name", t("name"), "w-32", false)}
        {field("nameEn", t("nameEn"), "w-32", false)}
        {field("feeTwd", t("fee"))}
        {field("multiplier", t("multiplier"), "w-24")}
        {field("concurrency", t("concurrency"), "w-20")}
        {field("sortOrder", t("sort"), "w-20")}
        <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" role="switch" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t("active")}</label>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
        <div className="rounded-xl bg-panel-2 p-3"><div className="text-xs text-muted">{t("maxCost")}</div><div className="font-mono" data-calc="max">NT$ {lim.maxCostTwd.toLocaleString("en-US")}</div><div className="text-xs text-muted">{t("vendorCost", { twd: (buffer > 0 ? lim.maxCostTwd / buffer : 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) })}</div></div>
        <div className="rounded-xl bg-panel-2 p-3"><div className="text-xs text-muted">L6</div><div className="font-mono" data-calc="l6">NT$ {lim.l6Twd.toLocaleString("en-US")}</div><div className="text-xs text-muted">≈ {tok(lim.l6Twd)} tokens</div></div>
        <div className="rounded-xl bg-panel-2 p-3"><div className="text-xs text-muted">L168</div><div className="font-mono" data-calc="l168">NT$ {lim.l168Twd.toLocaleString("en-US")}</div><div className="text-xs text-muted">≈ {tok(lim.l168Twd)} tokens</div></div>
        <div className="rounded-xl bg-panel-2 p-3">
          <div className="text-xs text-muted">{t("margin")}</div>
          <div className={`font-mono font-semibold ${marginTone}`} data-calc="margin">{badMult ? "—" : `${margin.toFixed(2)}×`}</div>
          <div className="text-xs text-muted">{t("marginHow", { buffer, mult: badMult ? "—" : mult })}</div>
        </div>
      </div>
      <p className="text-xs text-muted">{t("formula", { model: blendedLabel })}</p>
      {badMult && <p className="text-sm text-err" role="alert">{t("badMult", { max: MAX_MULTIPLIER })}</p>}
      {!badMult && margin < 1 && <p className="text-sm text-err" role="alert">{t("loss", { need: Math.round(mult * 100) / 100, healthy: Math.round(mult * HEALTHY_MARGIN * 100) / 100 })}</p>}
      {!badMult && margin >= 1 && margin < HEALTHY_MARGIN && <p className="text-sm text-warn">{t("thin", { healthy: Math.round(mult * HEALTHY_MARGIN * 100) / 100 })}</p>}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={badMult || !(fee > 0) || !v.code || !v.name || !v.nameEn}>{plan ? t("save") : t("add")}</button>
        {ok && <span className="text-sm text-ok">✓ {t("saved")}</span>}
        {err && <span className="text-sm text-err" role="alert">{err}</span>}
      </div>
    </form>
  );
}

// ───────────── payments ─────────────

export function PaymentActions({ id, refundable, provider, status }: { id: string; refundable: number; provider: string; status: string }) {
  const t = useTranslations("admin.payments");
  const [amount, setAmount] = useState(String(refundable));
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {provider === "OEN" && status === "PENDING" && (
        <button className="btn-ghost !py-1 text-xs" onClick={async () => { setErr((await send(`/api/admin/payments/${id}/sync`, "POST", {})) ?? ""); router.refresh(); }}>{t("sync")}</button>
      )}
      {refundable > 0 && !open && <button className="btn-ghost !py-1 text-xs" onClick={() => setOpen(true)}>{t("refund")}</button>}
      {open && (
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <input className="input !w-20 !py-1 font-mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} aria-label={t("amount")} />
          <input className="input !w-48 !py-1" placeholder={t("reason")} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("reason")} />
          <button
            className="btn-danger !py-1"
            disabled={!(Number(amount) >= 1 && Number(amount) <= refundable)}
            onClick={async () => {
              if (!confirm(t("confirm", { amount }))) return;
              const e = await send(`/api/admin/payments/${id}/refund`, "POST", { amount: Number(amount), reason: reason || undefined });
              if (e) return setErr(e);
              setOpen(false);
              router.refresh();
            }}
          >
            {t("refundGo")}
          </button>
          <button className="btn-ghost !py-1" onClick={() => setOpen(false)}>{t("cancel")}</button>
        </span>
      )}
      {err && <span className="text-xs text-err" role="alert">{err}</span>}
    </div>
  );
}
