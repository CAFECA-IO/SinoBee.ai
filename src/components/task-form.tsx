"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Toggle } from "./toggle";
import { AgreeTerms, BuyerFields, emptyBuyer, postJson, useCheckout, type Buyer } from "./checkout";

/** published prices, TWD per 1M tokens */
type Model = { id: string; label: string; vendor: string; input: number; cacheRead?: number; output: number };
/** all prices in TWD (final): model prices per 1M tokens, VM per hour, storage per GB-month, requests per 1,000 */
type Pricing = { vmHourly: number; storageGbMonth: number; writesPer1k: number; readsPer1k: number; retentionDays: number; minBudget: number };
type SkillOpt = { id: string; label: string } | null;

export function TaskForm({
  kind,
  models,
  pricing,
  skill,
  evalMethods,
  buyer: savedBuyer,
}: {
  kind: "TASK" | "EVALUATION";
  models: Model[];
  pricing: Pricing;
  skill: SkillOpt;
  evalMethods?: readonly string[];
  buyer?: Partial<Buyer> | null;
}) {
  const t = useTranslations("taskForm");
  const router = useRouter();
  const { go, busy, err } = useCheckout();
  const [buyer, setBuyer] = useState(() => emptyBuyer(savedBuyer));
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
    const token = mtok * m.input + mtok * 0.1 * m.output; // assume output ≈ 10% of input
    const vm = (minutes / 60) * pricing.vmHourly;
    // ~50 MB of results kept for the retention window, 1 write + 3 reads
    const s3 = (50 / 1024) * pricing.storageGbMonth * (pricing.retentionDays / 30) + (1 / 1000) * pricing.writesPer1k + (3 / 1000) * pricing.readsPer1k;
    return { token, vm, s3, total: token + vm + s3 };
  }, [m, minutes, mtok, pricing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr("");
    await go(async () => {
      const r = await postJson<{ task: { id: string }; payment: { checkoutUrl?: string; error?: string } }>("/api/tasks", {
        kind,
        title,
        prompt,
        model,
        skillVersionId: useSkill && skill ? skill.id : null,
        isPublic,
        budget: Number(budget),
        buyer,
        ...(kind === "EVALUATION" ? { evalMethod, evalCriteria: criteria } : {}),
      });
      if (r.payment.checkoutUrl) return r.payment.checkoutUrl;
      // task saved but the checkout could not start: pay from the task page
      router.push(`/tasks/${r.task.id}?unpaid=1`);
      return null;
    });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
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
                {x.label} — {x.vendor}（{t("modelPrice", { input: x.input, output: x.output })}）
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
              <dd className="font-mono">≈ {est.total.toFixed(2)} TWD</dd>
            </div>
          </dl>
          <p className="text-xs text-muted">{t("estNote")}</p>
        </div>
        <div className="card space-y-3 p-5">
          <label className="label">{t("budget")}</label>
          <div className="flex items-center gap-2">
            <input className="input font-mono" type="number" min={pricing.minBudget} step="1" value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, ""))} required />
            <span className="text-sm font-semibold">TWD</span>
          </div>
          <p className="text-xs text-muted">{t("budgetHint", { min: pricing.minBudget, days: pricing.retentionDays })}</p>
          <BuyerFields value={buyer} onChange={setBuyer} />
          <AgreeTerms />
          {(formErr || err) && <p className="text-sm text-err" role="alert">{formErr || err}</p>}
          <button className="btn-primary w-full !py-3" disabled={busy}>
            {busy ? t("paying") : t("submit", { amount: budget })}
          </button>
          <p className="text-xs text-muted">{t("oenNote")}</p>
        </div>
      </aside>
    </form>
  );
}
