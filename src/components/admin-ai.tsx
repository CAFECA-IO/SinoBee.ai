"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/** /admin → 模型與定價: vendor model lists, tiers and jobs, AI price lookup */

type Tier = "high" | "standard" | "light";
type Job = "spec" | "screening" | "checklist" | "pricing";
const TIERS: Tier[] = ["high", "standard", "light"];
const JOBS: Job[] = ["spec", "screening", "checklist", "pricing"];
const SLOTS = 4;

type Catalog = Record<string, { at: string; models: { id: string; label: string }[]; error?: string }>;
type Usd = { input: number; cacheRead: number; cacheWrite: number; output: number };
type Added = { modelId: string; label: string; usd: Usd; note?: string };

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error === "invalid_request" ? (j.issues?.[0]?.message ?? "invalid") : (j.error ?? `HTTP ${r.status}`));
  return j;
}

/** "從供應商同步": refresh every keyed vendor's model list */
export function CatalogSync({ disabled }: { disabled: boolean }) {
  const t = useTranslations("admin.ai");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className="btn-ghost !py-1.5"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setMsg({});
          try {
            await call("/api/admin/ai/sync", "POST");
            setMsg({ ok: t("synced") });
            router.refresh();
          } catch (e) {
            setMsg({ err: (e as Error).message });
          }
          setBusy(false);
        }}
      >
        {busy ? t("syncing") : t("sync")}
      </button>
      {msg.ok && <span className="text-xs text-ok">{msg.ok}</span>}
      {msg.err && <span className="text-xs text-err" role="alert">{msg.err}</span>}
    </span>
  );
}

/** Tier chains (primary, then fallbacks) and which tier each platform job uses */
export function TierEditor(props: { tiers: Record<Tier, string[]>; jobs: Record<Job, Tier>; catalog: Catalog; priced: Record<string, boolean> }) {
  const t = useTranslations("admin.ai");
  const router = useRouter();
  const [tiers, setTiers] = useState(() => Object.fromEntries(TIERS.map((k) => [k, Array.from({ length: SLOTS }, (_, i) => props.tiers[k][i] ?? "")])) as Record<Tier, string[]>);
  const [jobs, setJobs] = useState(props.jobs);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [missing, setMissing] = useState<string[]>([]);
  const known = useMemo(() => new Set(Object.entries(props.catalog).flatMap(([p, c]) => c.models.map((m) => `${p}/${m.id}`))), [props.catalog]);
  return (
    <div className="space-y-4">
      {!known.size && <p className="text-sm text-warn">{t("syncFirst")}</p>}
      <div className="grid gap-3 lg:grid-cols-3">
        {TIERS.map((k) => (
          <fieldset key={k} className="space-y-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-semibold">{t(`tier.${k}`)}</legend>
            {tiers[k].map((v, i) => (
              <label key={i} className="block text-xs text-muted">
                {i === 0 ? t("primary") : t("fallback", { n: i })}
                <select className="input mt-1 !py-2 font-mono text-[13px]" value={v} onChange={(e) => setTiers({ ...tiers, [k]: tiers[k].map((x, j) => (j === i ? e.target.value : x)) })}>
                  <option value="">{i === 0 ? t("auto") : t("none")}</option>
                  {v && !known.has(v) && <option value={v}>{v} {t("notListed")}</option>}
                  {Object.entries(props.catalog).map(([p, c]) => (
                    <optgroup key={p} label={p}>
                      {c.models.map((m) => {
                        const id = `${p}/${m.id}`;
                        return <option key={id} value={id}>{m.id}{id in props.priced ? "" : ` ${t("unpricedMark")}`}</option>;
                      })}
                    </optgroup>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{t("jobsTitle")}</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {JOBS.map((j) => (
            <label key={j} className="flex items-center gap-3 text-sm">
              <span className="flex-1">{t(`job.${j}`)}</span>
              <select className="input max-w-40 !py-2" value={jobs[j]} onChange={(e) => setJobs({ ...jobs, [j]: e.target.value as Tier })}>
                {TIERS.map((k) => <option key={k} value={k}>{t(`tier.${k}`)}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg({});
            try {
              const r = await call("/api/admin/ai", "PUT", { tiers: Object.fromEntries(TIERS.map((k) => [k, tiers[k].filter(Boolean)])), jobs });
              setMissing(r.missingPrices ?? []);
              setMsg({ ok: t("saved") });
              router.refresh();
            } catch (e) {
              setMsg({ err: (e as Error).message });
            }
            setBusy(false);
          }}
        >
          {t("save")}
        </button>
        {msg.ok && <span className="text-sm text-ok">{msg.ok}</span>}
        {msg.err && <span className="text-sm text-err" role="alert">{msg.err}</span>}
      </div>
      {missing.length > 0 && <p className="rounded-xl border border-warn p-3 text-sm">{t("missingPrices", { models: missing.join(", ") })}</p>}
    </div>
  );
}

/** Add synced but unpriced models with prices an AI looked up (they arrive withdrawn, for an admin to check) */
export function PriceLookup({ catalog, priced }: { catalog: Catalog; priced: Record<string, boolean> }) {
  const t = useTranslations("admin.ai");
  const router = useRouter();
  const [pick, setPick] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [lookup, setLookup] = useState<{ state: string; result?: Added[]; error?: string; models?: string[] } | null>(null);
  const options = useMemo(() => Object.entries(catalog).flatMap(([p, c]) => c.models.map((m) => ({ id: `${p}/${m.id}`, label: m.label }))), [catalog]);
  const unpriced = options.filter((o) => !(o.id in priced));

  // the lookup runs on the server; poll it (also one still running after a reload)
  const alive = useRef(true);
  const poll = useCallback(async () => {
    let sawRunning = false;
    for (;;) {
      const s = await call("/api/admin/ai/prices", "GET").catch(() => null);
      if (!alive.current) return;
      if (s) {
        setLookup(s.state === "idle" ? null : s);
        if (s.state !== "running") {
          if (sawRunning && s.state === "done") router.refresh();
          return;
        }
        sawRunning = true;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }, [router]);
  useEffect(() => {
    alive.current = true;
    void poll();
    return () => {
      alive.current = false;
    };
  }, [poll]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("addHelp")}</p>
      {lookup?.state === "running" && <p className="text-sm">{t("lookingUp", { models: (lookup.models ?? []).join(", ") })}</p>}
      {lookup?.state === "error" && <p className="text-sm text-err" role="alert">{lookup.error}</p>}
      {lookup?.state === "done" && lookup.result && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1">{t("model")}</th><th>{t("usd")}</th><th>{t("note")}</th></tr></thead>
            <tbody>
              {lookup.result.map((a) => (
                <tr key={a.modelId} className="border-t border-line">
                  <td className="py-1 font-mono text-xs">{a.modelId}</td>
                  <td className="font-mono text-xs">{a.usd.input} / {a.usd.cacheRead} / {a.usd.cacheWrite} / {a.usd.output}</td>
                  <td className={a.note === "price not found" ? "text-warn" : "text-muted"}>{a.note === "price not found" ? t("notFound") : a.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted">{t("checkPrices")}</p>
        </div>
      )}
      {unpriced.length === 0 ? (
        <p className="text-sm text-muted">{options.length ? t("allPriced") : t("syncFirst")}</p>
      ) : (
        <>
          <div className="max-h-60 overflow-y-auto rounded-xl border border-line p-3">
            {unpriced.map((o) => (
              <label key={o.id} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" checked={pick.includes(o.id)} onChange={(e) => setPick(e.target.checked ? [...pick, o.id].slice(0, 20) : pick.filter((x) => x !== o.id))} />
                <span className="font-mono text-xs">{o.id}</span>
                {o.label !== o.id.split("/").slice(1).join("/") && <span className="text-muted">{o.label}</span>}
              </label>
            ))}
          </div>
          <button
            className="btn-primary"
            disabled={!pick.length || lookup?.state === "running"}
            onClick={async () => {
              setErr("");
              try {
                const s = await call("/api/admin/ai/prices", "POST", { models: pick });
                setLookup({ ...s, models: pick });
                setPick([]);
                void poll();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            {t("lookUp", { n: pick.length })}
          </button>
          {err && <p className="text-sm text-err" role="alert">{err}</p>}
        </>
      )}
    </div>
  );
}
