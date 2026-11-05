"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { confirmDialog } from "./confirm";

type Model = { modelId: string; label: string; vision: boolean; context: number | null; nodes: string[]; slots: number; priced: boolean; enabled: boolean; usd: { input: number; output: number } };
type Node = { address: string; short: string; label: string; linked: boolean; since: string | null; agent: string | null; slots: number | null; busy: number; served: number; badReceipts: number; models: string[] };
type Waiting = { address: string; short: string; ip: string; agent: string; slots: number; models: { id: string; vision?: boolean; context?: number }[]; first: string; last: string; attempts: number };
type Overview = { enabled: boolean; publicUrl: string; hubError: string | null; nodes: Node[]; pending: Waiting[]; blocked: string[]; models: Model[] };

const badge = (tone: "ok" | "warn" | "muted" | "info" | "err") =>
  `badge whitespace-nowrap ${{ ok: "bg-accent-soft text-ok", warn: "bg-warn-soft text-warn", muted: "bg-panel-2 text-muted", info: "bg-[#e6eefc] text-[#2a4fa3] dark:bg-[#16264a] dark:text-[#9db8ff]", err: "bg-err-soft text-err" }[tone]}`;
const kctx = (n: number | null | undefined) => (n ? `${Math.round(n / 1024)}k` : "—");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function call(method: "GET" | "POST", body?: unknown) {
  const r = await fetch("/api/admin/locutus", { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error === "invalid_request" ? (j.issues?.[0]?.message ?? "invalid") : (j.message ?? j.error ?? `HTTP ${r.status}`));
  return j;
}

/** A name for a waiting node: last part of its IP and its first model, e.g. 146-gemma4-12b */
function suggest(w: Waiting) {
  const ip = w.ip.split(/[.:]/).filter(Boolean).pop() ?? "";
  return [ip, w.models[0]?.id].filter(Boolean).join("-").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || w.address.slice(2, 10);
}

/** /admin → 模型定價 → Locutus: approve waiting nodes, price and offer models, manage the registered nodes */
export function LocutusAdmin() {
  const t = useTranslations("admin.locutus");
  const router = useRouter();
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const v = (await call("GET")) as Overview;
      if (alive.current) setO(v);
    } catch (e) {
      if (alive.current) setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);

  const act = async (key: string, body: Record<string, unknown>, confirm?: string) => {
    if (confirm && !(await confirmDialog(confirm, { danger: body.action === "block" || body.action === "remove" }))) return;
    setErr("");
    setBusy(key);
    try {
      await call("POST", body);
      await load();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (!o) return <p className="px-4 py-3 text-sm text-muted">{err || "…"}</p>;
  const url = o.publicUrl || "wss://…/locutus/link";

  return (
    <div className="divide-y divide-line" data-locutus>
      {!o.enabled && <p className="px-4 py-3 text-sm text-warn">{t("off")}</p>}
      {o.hubError && <p className="px-4 py-3 text-sm text-err">{t("hubDown", { error: o.hubError })}</p>}
      {err && <p className="px-4 py-3 text-sm text-err" role="alert">{err}</p>}

      {o.pending.length > 0 && (
        <section aria-labelledby="loc-pending" className="space-y-3 bg-warn-soft/30 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="loc-pending" className="font-semibold">{t("pending")}</h3>
            <span className={badge("warn")}>{o.pending.length}</span>
            <span className="text-xs text-muted">{t("pendingHelp")}</span>
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
            {o.pending.map((w) => <WaitingCard key={w.address} w={w} busy={busy} act={act} />)}
          </div>
        </section>
      )}

      <div className="overflow-x-auto">
        {o.models.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">{t("noModels")}</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">{t("model")}</th>
                <th className="px-3 py-2 font-medium">{t("servedBy")}</th>
                <th className="px-3 py-2 font-medium">{t("price")}</th>
                <th className="px-4 py-2 font-medium">{t("offer")}</th>
              </tr>
            </thead>
            <tbody>
              {o.models.map((m) => <ModelRow key={m.modelId} m={m} busy={busy} act={act} />)}
            </tbody>
          </table>
        )}
      </div>

      <section aria-labelledby="loc-nodes" className="space-y-3 px-4 py-4">
        <h3 id="loc-nodes" className="font-semibold">{t("nodes")}</h3>
        {o.nodes.length === 0 ? (
          <p className="text-sm text-muted">{t("noNodes")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {o.nodes.map((n) => (
              <li key={n.address} className="inline-flex items-center gap-2 rounded-xl border border-line py-1 pl-3 pr-1 text-[13px]" data-node={n.label}>
                <span className={`h-2 w-2 rounded-full ${n.linked ? "bg-ok" : "bg-muted/40"}`} aria-hidden />
                <span className="font-semibold">{n.label}</span>
                <span className="font-mono text-xs text-muted" title={n.address}>{n.short}</span>
                <span className="text-xs text-muted">
                  {n.linked ? t("linkedInfo", { busy: n.busy, slots: n.slots ?? 1, served: n.served }) : t("offline")}
                  {n.badReceipts > 0 && <span className="text-err"> · {t("badReceipts", { n: n.badReceipts })}</span>}
                </span>
                <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-err" aria-label={t("remove", { name: n.label })} disabled={!!busy}
                  onClick={() => act(`rm:${n.address}`, { action: "remove", address: n.address }, t("confirmRemove", { name: n.label }))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddNode busy={busy} act={act} />
        <p className="text-xs text-muted">
          {t("tomlHint")} <code className="font-mono">[platform] url = &quot;{url}&quot;</code>
          <button type="button" className="ml-2 text-accent underline-offset-2 hover:underline" onClick={() => void navigator.clipboard?.writeText(`[platform]\nurl     = "${url}"\nslots   = 1\nformats = ["openai"]\n`)}>
            {t("copyToml")}
          </button>
        </p>
        {o.blocked.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{t("blocked")}</span>
            {o.blocked.map((a) => (
              <span key={a} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-0.5 font-mono">
                {short(a)}
                <button type="button" className="text-accent hover:underline" disabled={!!busy} onClick={() => act(`ub:${a}`, { action: "unblock", address: a })}>{t("unblock")}</button>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type Act = (key: string, body: Record<string, unknown>, confirm?: string) => Promise<void>;

function WaitingCard({ w, busy, act }: { w: Waiting; busy: string; act: Act }) {
  const t = useTranslations("admin.locutus");
  const [label, setLabel] = useState(() => suggest(w));
  const [offer, setOffer] = useState(true);
  const id = `wl-${w.address}`;
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4 text-sm" data-waiting={w.address}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="break-all font-mono text-xs">{w.address}</span>
        <span className="text-xs text-muted">{t("attempts", { n: w.attempts, at: new Date(w.last).toLocaleTimeString() })}</span>
      </div>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-muted">{t("ip")}</dt><dd className="font-mono text-xs">{w.ip || "—"}</dd>
        <dt className="text-muted">{t("agent")}</dt><dd className="font-mono text-xs">{w.agent || "—"} · {t("slots", { n: w.slots })}</dd>
        <dt className="text-muted">{t("declared")}</dt>
        <dd className="flex flex-wrap gap-1.5">
          {w.models.length === 0 && <span className="text-muted">—</span>}
          {w.models.map((m) => (
            <span key={m.id} className="inline-flex flex-wrap items-center gap-1">
              <span className="rounded-md bg-panel-2 px-1.5 py-0.5 font-mono text-xs">{m.id}</span>
              {m.vision && <span className={badge("info")}>{t("vision")}</span>}
              {m.context ? <span className={badge("muted")}>{kctx(m.context)}</span> : null}
            </span>
          ))}
        </dd>
        <dt className="text-muted">{t("signature")}</dt><dd className="text-ok">{t("signedOk")}</dd>
      </dl>
      <div>
        <label htmlFor={id} className="label">{t("name")}</label>
        <input id={id} className="input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
      </div>
      {w.models.length > 0 && (
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={offer} onChange={(e) => setOffer(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          {t("offerToo", { models: w.models.map((m) => m.id).join("、") })}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary flex-1" disabled={!!busy || !label.trim()} onClick={() => act(`ap:${w.address}`, { action: "register", address: w.address, label: label.trim(), offer })}>
          {busy === `ap:${w.address}` ? "…" : t("approve")}
        </button>
        <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => act(`ig:${w.address}`, { action: "ignore", address: w.address })}>{t("ignore")}</button>
        <button type="button" className="btn-danger" disabled={!!busy} onClick={() => act(`bl:${w.address}`, { action: "block", address: w.address }, t("confirmBlock", { address: w.short }))}>{t("block")}</button>
      </div>
    </article>
  );
}

function ModelRow({ m, busy, act }: { m: Model; busy: string; act: Act }) {
  const t = useTranslations("admin.locutus");
  const [input, setInput] = useState(String(m.usd.input));
  const [output, setOutput] = useState(String(m.usd.output));
  const key = `md:${m.modelId}`;
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const valid = num(input) >= 0 && num(output) >= 0;
  const dirty = !m.priced || num(input) !== m.usd.input || num(output) !== m.usd.output;
  const save = (enabled: boolean) => act(key, { action: "model", modelId: m.modelId, label: m.label, input: num(input), output: num(output), enabled });
  const fresh = !m.priced;
  return (
    <tr className={`border-b border-line last:border-0 align-top ${fresh ? "bg-warn-soft/30" : ""}`} data-model={m.modelId}>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5 font-semibold">
          {m.label}
          {m.vision && <span className={badge("info")}>{t("vision")}</span>}
        </div>
        <div className="font-mono text-[11px] text-muted">{m.modelId}</div>
        {fresh && <div className="mt-1 text-xs text-warn">{t("fresh")}</div>}
      </td>
      <td className="px-3 py-3">
        {m.nodes.length === 0 ? (
          <span className="text-xs text-err">{t("noNode")}</span>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {m.nodes.map((n) => (
                <span key={n} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
                  {n}
                </span>
              ))}
            </div>
            <div className="mt-1 text-xs text-muted">{t("capacity", { slots: m.slots, context: kctx(m.context) })}</div>
          </>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-0.5 text-xs text-muted">
            {t("input")}
            <input className="input !w-24 !py-2 font-mono" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-muted">
            {t("output")}
            <input className="input !w-24 !py-2 font-mono" inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} />
          </label>
          {dirty && m.priced && (
            <button type="button" className="btn-ghost !px-3 !py-2" disabled={!!busy || !valid} onClick={() => save(m.enabled)}>{busy === key ? "…" : t("save")}</button>
          )}
        </div>
        <div className="mt-1 text-[11px] text-muted">{t("usdNote")}</div>
      </td>
      <td className="px-4 py-3">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" role="switch" className="h-4 w-4 accent-[var(--accent)]" checked={m.enabled} disabled={!!busy || !valid}
            onChange={(e) => save(e.target.checked)} />
          {m.enabled ? t("offered") : t("withdrawn")}
        </label>
      </td>
    </tr>
  );
}

function AddNode({ busy, act }: { busy: string; act: Act }) {
  const t = useTranslations("admin.locutus");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const ok = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  return (
    <form className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        void act("add", { action: "register", address: address.trim(), label: label.trim() || address.trim().slice(2, 10) }).then(() => {
          setAddress("");
          setLabel("");
        });
      }}>
      <label className="flex min-w-0 flex-[3_1_22rem] flex-col text-xs text-muted">
        {t("address")}
        <input className="input mt-1 font-mono" placeholder={t("addressPh")} value={address} onChange={(e) => setAddress(e.target.value)} aria-invalid={address !== "" && !ok} />
      </label>
      <label className="flex min-w-0 flex-[1_1_10rem] flex-col text-xs text-muted">
        {t("name")}
        <input className="input mt-1" placeholder={t("namePh")} maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <button type="submit" className="btn-primary" disabled={!!busy || !ok}>{t("add")}</button>
    </form>
  );
}
