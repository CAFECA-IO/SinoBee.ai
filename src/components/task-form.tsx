"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { usePay, postJson } from "./use-pay";
import { PayStatus } from "./pay-status";
import { Toggle } from "./toggle";
import type { PaymentIntent } from "./cafeca-provider";

type Model = { id: string; label: string; vendor: string; input: number; output: number };
type Pricing = { markup: number; usdTwd: number; vmHourlyUsd: number; s3GbMonthUsd: number; s3PutPer1kUsd: number; s3GetPer1kUsd: number; retentionDays: number; minBudget: number };
type SkillOpt = { id: string; label: string } | null;

export function TaskForm({
  kind,
  models,
  pricing,
  skill,
  evalMethods,
}: {
  kind: "TASK" | "EVALUATION";
  models: Model[];
  pricing: Pricing;
  skill: SkillOpt;
  evalMethods?: readonly string[];
}) {
  const t = useTranslations("taskForm");
  const router = useRouter();
  const { run, busy, error, pendingLink } = usePay();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(models[1]?.id ?? models[0].id);
  const [useSkill, setUseSkill] = useState(!!skill);
  const [isPublic, setIsPublic] = useState(false);
  const [budget, setBudget] = useState(String(Math.max(pricing.minBudget, 100)));
  const [evalMethod, setEvalMethod] = useState(evalMethods?.[0] ?? "");
  const [criteria, setCriteria] = useState("");
  // estimator inputs
  const [minutes, setMinutes] = useState(20);
  const [mtok, setMtok] = useState(1.5); // million input tokens
  const [formErr, setFormErr] = useState("");

  const m = models.find((x) => x.id === model)!;
  const est = useMemo(() => {
    const tokenUsd = mtok * m.input + mtok * 0.1 * m.output; // assume output ≈ 10% of input
    const vmUsd = (minutes / 60) * pricing.vmHourlyUsd;
    const s3Usd = (50 / 1024) * pricing.s3GbMonthUsd * (pricing.retentionDays / 30) + (1 / 1000) * pricing.s3PutPer1kUsd + (3 / 1000) * pricing.s3GetPer1kUsd;
    const toTwdc = (usd: number) => usd * pricing.markup * pricing.usdTwd;
    return { token: toTwdc(tokenUsd), vm: toTwdc(vmUsd), s3: toTwdc(s3Usd), total: toTwdc(tokenUsd + vmUsd + s3Usd) };
  }, [m, minutes, mtok, pricing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr("");
    let taskId = "";
    const ok = await run(
      async () => {
        const r = await postJson<{ task: { id: string }; payment: PaymentIntent }>("/api/tasks", {
          kind,
          title,
          prompt,
          model,
          skillVersionId: useSkill && skill ? skill.id : null,
          isPublic,
          budget: Number(budget),
          ...(kind === "EVALUATION" ? { evalMethod, evalCriteria: criteria } : {}),
        });
        taskId = r.task.id;
        return r.payment;
      },
      { title: t("payTitle", { amount: budget }), detail: `${title} · ${m.label}` },
    );
    if (taskId) router.push(`/tasks/${taskId}${ok ? "" : "?unpaid=1"}`);
  };

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <div>
          <label className="label">{t("title")}</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={120} required placeholder={kind === "EVALUATION" ? t("evalTitlePh") : t("titlePh")} />
        </div>
        <div>
          <label className="label">{kind === "EVALUATION" ? t("evalPrompt") : t("prompt")}</label>
          <textarea className="input min-h-48" value={prompt} onChange={(e) => setPrompt(e.target.value)} minLength={10} maxLength={20000} required placeholder={kind === "EVALUATION" ? t("evalPromptPh") : t("promptPh")} />
          <p className="mt-1 text-xs text-muted">{t("promptHint")}</p>
        </div>
        {kind === "EVALUATION" && (
          <>
            <div>
              <label className="label">{t("method")}</label>
              <select className="input" value={evalMethod} onChange={(e) => setEvalMethod(e.target.value)}>
                {evalMethods!.map((x) => (
                  <option key={x} value={x}>
                    {t(`methods.${x}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("criteria")}</label>
              <textarea className="input min-h-32" value={criteria} onChange={(e) => setCriteria(e.target.value)} maxLength={10000} placeholder={t("criteriaPh")} />
            </div>
          </>
        )}
        <div>
          <label className="label">{t("model")}</label>
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label} — {x.vendor} (${x.input}/${x.output} per 1M)
              </option>
            ))}
          </select>
        </div>
        {skill && (
          <Toggle
            checked={useSkill}
            onChange={setUseSkill}
            label={
              <>
                {t("useSkill")} <span className="font-mono text-accent">{skill.label}</span>
              </>
            }
          />
        )}
        {kind === "TASK" ? (
          <Toggle checked={isPublic} onChange={setIsPublic} label={t("public")} description={t("publicHint")} />
        ) : (
          <p className="text-sm text-muted">{t("evalPublic")}</p>
        )}
      </div>

      <aside className="space-y-4">
        <div className="card space-y-3 p-5">
          <div className="font-semibold">{t("estimate")}</div>
          <label className="block text-xs text-muted">
            {t("estMinutes")}: <b className="text-ink">{minutes}</b>
            <input type="range" min={5} max={240} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </label>
          <label className="block text-xs text-muted">
            {t("estTokens")}: <b className="text-ink">{mtok.toFixed(1)}M</b>
            <input type="range" min={0.1} max={20} step={0.1} value={mtok} onChange={(e) => setMtok(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </label>
          <dl className="space-y-1 text-sm">
            {(
              [
                ["tokens", est.token],
                ["vm", est.vm],
                ["s3", est.s3],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-muted">{t(`est.${k}`)}</dt>
                <dd className="font-mono">{v.toFixed(2)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-1 font-semibold">
              <dt>{t("estTotal")}</dt>
              <dd className="font-mono">≈ {est.total.toFixed(2)} TWDC</dd>
            </div>
          </dl>
          <p className="text-xs text-muted">{t("estNote", { markup: pricing.markup, rate: pricing.usdTwd })}</p>
        </div>
        <div className="card space-y-3 p-5">
          <label className="label">{t("budget")}</label>
          <div className="flex items-center gap-2">
            <input className="input font-mono" type="number" min={pricing.minBudget} step="1" value={budget} onChange={(e) => setBudget(e.target.value)} required />
            <span className="text-sm font-semibold">TWDC</span>
          </div>
          <p className="text-xs text-muted">{t("budgetHint", { min: pricing.minBudget, days: pricing.retentionDays })}</p>
          <PayStatus busy={busy} error={error} pendingLink={pendingLink} />
          {formErr && <p className="text-sm text-err">{formErr}</p>}
          <button className="btn-primary w-full !py-3" disabled={busy}>
            {busy ? t("paying") : t("submit", { amount: budget })}
          </button>
        </div>
      </aside>
    </form>
  );
}
