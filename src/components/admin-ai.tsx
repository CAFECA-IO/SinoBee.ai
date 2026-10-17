"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

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

export function AiModelsAdmin(props: {
  tiers: Record<Tier, string[]>;
  jobs: Record<Job, Tier>;
  catalog: Catalog;
  /** providers with an API key */
  keyed: string[];
  providers: string[];
  /** model ids with a price row → offered to users? */
  priced: Record<string, boolean>;
}) {
  const t = useTranslations("admin.ai");
  const router = useRouter();
  const [tiers, setTiers] = useState(() => Object.fromEntries(TIERS.map((k) => [k, Array.from({ length: SLOTS }, (_, i) => props.tiers[k][i] ?? "")])) as Record<Tier, string[]>);
  const [jobs, setJobs] = useState(props.jobs);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [pick, setPick] = useState<string[]>([]);
  const [lookup, setLookup] = useState<{ state: string; result?: Added[]; error?: string; models?: string[] } | null>(null);

  const options = useMemo(() => {
    const all = Object.entries(props.catalog).flatMap(([p, c]) => c.models.map((m) => ({ id: `${p}/${m.id}`, label: m.label, provider: p })));
    return all;
  }, [props.catalog]);
  const known = useMemo(() => new Set(options.map((o) => o.id)), [options]);
  const unpriced = options.filter((o) => !(o.id in props.priced));

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
          if (sawRunning && s.state === "done") {
            setMissing([]);
            router.refresh();
          }
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

  const run = async (name: string, f: () => Promise<void>) => {
    setBusy(name);
    setMsg({});
    try {
      await f();
    } catch (e) {
      setMsg({ err: (e as Error).message });
    }
    setBusy("");
  };

  const startLookup = (models: string[]) =>
    run("prices", async () => {
      const s = await call("/api/admin/ai/prices", "POST", { models });
      setLookup({ ...s, models });
      setPick([]);
      void poll();
    });

  return (
    <div className="space-y-6">
      {/* provider model lists */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="h3 flex-1">{t("catalogTitle")}</h2>
          <button className="btn-primary" disabled={!!busy || !props.keyed.length} onClick={() => run("sync", async () => {
            await call("/api/admin/ai/sync", "POST");
            setMsg({ ok: t("synced") });
            router.refresh();
          })}>{busy === "sync" ? t("syncing") : t("sync")}</button>
        </div>
        <p className="text-sm text-muted">{t("catalogHelp")}</p>
        <ul className="divide-y divide-line text-sm">
          {props.providers.map((p) => {
            const c = props.catalog[p];
            return (
              <li key={p} className="flex flex-wrap items-baseline gap-3 py-2">
                <span className="w-24 font-mono">{p}</span>
                {!props.keyed.includes(p) ? (
                  <span className="text-muted">{t("noKey")}</span>
                ) : !c ? (
                  <span className="text-warn">{t("notSynced")}</span>
                ) : (
                  <>
                    <span>{t("modelCount", { n: c.models.length })}</span>
                    <span className="text-xs text-muted">{new Date(c.at).toLocaleString()}</span>
                    {c.error && <span className="text-err">{c.error}</span>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* tiers and jobs */}
      <section className="card space-y-4 p-5">
        <h2 className="h3">{t("tiersTitle")}</h2>
        <p className="text-sm text-muted">{t("tiersHelp")}</p>
        {!options.length && <p className="text-sm text-warn">{t("syncFirst")}</p>}
        <div className="grid gap-4 lg:grid-cols-3">
          {TIERS.map((k) => (
            <div key={k} className="space-y-2 rounded-xl border border-line p-4">
              <h3 className="font-semibold">{t(`tier.${k}`)}</h3>
              {tiers[k].map((v, i) => (
                <label key={i} className="block text-xs text-muted">
                  {i === 0 ? t("primary") : t("fallback", { n: i })}
                  <select
                    className="input mt-1 font-mono text-[13px]"
                    value={v}
                    onChange={(e) => setTiers({ ...tiers, [k]: tiers[k].map((x, j) => (j === i ? e.target.value : x)) })}
                  >
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
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">{t("jobsTitle")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {JOBS.map((j) => (
              <label key={j} className="flex items-center gap-3 text-sm">
                <span className="flex-1">{t(`job.${j}`)}</span>
                <select className="input max-w-40" value={jobs[j]} onChange={(e) => setJobs({ ...jobs, [j]: e.target.value as Tier })}>
                  {TIERS.map((k) => <option key={k} value={k}>{t(`tier.${k}`)}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!!busy} onClick={() => run("save", async () => {
            const r = await call("/api/admin/ai", "PUT", { tiers: Object.fromEntries(TIERS.map((k) => [k, tiers[k].filter(Boolean)])), jobs });
            setMissing(r.missingPrices ?? []);
            setMsg({ ok: t("saved") });
            router.refresh();
          })}>{t("save")}</button>
          {msg.ok && <span className="text-sm text-ok">{msg.ok}</span>}
          {msg.err && <span className="text-sm text-err" role="alert">{msg.err}</span>}
        </div>
        {missing.length > 0 && (
          <div className="rounded-xl border border-warn p-3 text-sm">
            <p>{t("missingPrices", { models: missing.join(", ") })}</p>
            <button className="btn-ghost mt-2" disabled={!!busy || lookup?.state === "running"} onClick={() => startLookup(missing)}>{t("lookUpThese")}</button>
          </div>
        )}
      </section>

      {/* add synced models to Model prices with AI-looked-up prices */}
      <section className="card space-y-3 p-5">
        <h2 className="h3">{t("addTitle")}</h2>
        <p className="text-sm text-muted">{t("addHelp")}</p>
        {lookup?.state === "running" && <p className="text-sm">{t("lookingUp", { models: (lookup.models ?? []).join(", ") })}</p>}
        {lookup?.state === "error" && <p className="text-sm text-err" role="alert">{lookup.error}</p>}
        {lookup?.state === "done" && lookup.result && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted"><th>{t("model")}</th><th>{t("usd")}</th><th>{t("note")}</th></tr></thead>
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
        )}
        {lookup?.state === "done" && <p className="text-xs text-muted">{t("checkPrices")}</p>}
        {unpriced.length === 0 ? (
          <p className="text-sm text-muted">{options.length ? t("allPriced") : t("syncFirst")}</p>
        ) : (
          <>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-line p-3">
              {unpriced.map((o) => (
                <label key={o.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={pick.includes(o.id)} onChange={(e) => setPick(e.target.checked ? [...pick, o.id].slice(0, 20) : pick.filter((x) => x !== o.id))} />
                  <span className="font-mono text-xs">{o.id}</span>
                  {o.label !== o.id.split("/").slice(1).join("/") && <span className="text-muted">{o.label}</span>}
                </label>
              ))}
            </div>
            <button className="btn-primary" disabled={!!busy || !pick.length || lookup?.state === "running"} onClick={() => startLookup(pick)}>{t("lookUp", { n: pick.length })}</button>
          </>
        )}
      </section>
    </div>
  );
}
