"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Toggle } from "./toggle";
import { Link } from "@/i18n/navigation";
import { AgreeCheck, AgreeTerms, BuyerFields, CardPicker, PayForm, emptyBuyer, postJson, useCheckout, type Buyer, type CardOpt } from "./checkout";

type ModelOpt = { id: string; label: string; vendor: string };

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? (j.issues ? j.issues.map((i: { message: string }) => i.message).join("; ") : `HTTP ${r.status}`));
  return j;
}

/** Required consent to the crowdfunding terms (which list every screening item) */
export function AgreeCrowdTerms() {
  const t = useTranslations("crowd");
  return (
    <AgreeCheck name="agreeCrowd">
      {t.rich("agreeTerms", {
        terms: (c) => (
          <Link href="/crowd-terms" target="_blank" className="text-accent underline">
            {c}
          </Link>
        ),
      })}
    </AgreeCheck>
  );
}

// ───────────── new proposal ─────────────

export function CrowdNewForm({
  models,
  skill,
  kind: initialKind,
  evalMethods,
  fee,
  buyer: initialBuyer,
  cards,
  pendingCard = false,
  test = false,
}: {
  models: ModelOpt[];
  skill: { id: string; label: string } | null;
  kind: "TASK" | "EVALUATION";
  evalMethods: readonly string[];
  fee: number;
  buyer?: Partial<Buyer> | null;
  cards: CardOpt[];
  pendingCard?: boolean;
  test?: boolean;
}) {
  const t = useTranslations("crowd.form");
  const tm = useTranslations("taskForm.methods");
  const tk = useTranslations("checkout");
  const router = useRouter();
  const [kind, setKind] = useState(initialKind);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState(models[1]?.id ?? models[0]?.id ?? "");
  const [useSkill, setUseSkill] = useState(!!skill);
  const [method, setMethod] = useState("");
  const [buyer, setBuyer] = useState(() => emptyBuyer(initialBuyer));
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const { go, busy, err } = useCheckout();
  return (
    <form
      className="card max-w-3xl space-y-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void go(async () => {
          const r = await postJson<{ task: { id: string }; payment: { status?: string; error?: string } | null }>("/api/crowd", {
            title: title.trim() || null,
            description,
            model,
            kind,
            skillVersionId: useSkill && skill ? skill.id : null,
            evalMethod: kind === "EVALUATION" && method ? method : null,
            agreeTerms: true,
            buyer,
            cardId,
          });
          // paid: the proposal page drafts the spec; declined: the fee can be paid there with another card
          router.push(`/crowd/${r.task.id}/edit${r.payment?.error ? `?fee=${encodeURIComponent(r.payment.error)}` : ""}`);
        });
      }}
    >
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("kind")}>
        {(["TASK", "EVALUATION"] as const).map((k) => (
          <button type="button" role="radio" aria-checked={kind === k} key={k} onClick={() => setKind(k)} className={`rounded-xl border px-4 py-2 text-sm ${kind === k ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>
            {t(`kinds.${k}`)}
          </button>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="crowd-desc">{kind === "EVALUATION" ? t("descriptionEval") : t("description")}</label>
        <textarea
          id="crowd-desc"
          className="input min-h-48 text-base"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          minLength={10}
          maxLength={20000}
          required
          placeholder={kind === "EVALUATION" ? t("placeholderEval") : t("placeholder")}
        />
        <p className="mt-1 text-xs text-muted">{t("descriptionHint")}</p>
      </div>
      {kind === "EVALUATION" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{t("method")}</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">{t("methodAuto")}</option>
              {evalMethods.map((m) => (
                <option key={m} value={m}>{tm(m as "rubric")}</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-muted sm:pt-7">{skill && useSkill ? t("subjectSkill", { skill: skill.label }) : t("subjectModel")}</div>
        </div>
      )}
      {skill && <Toggle checked={useSkill} onChange={setUseSkill} label={t("useSkill", { skill: skill.label })} />}
      <details className="rounded-xl border border-line p-4 text-sm">
        <summary className="cursor-pointer font-medium">{t("advanced")}</summary>
        <div className="mt-4 space-y-4">
          <div>
            <label className="label">{t("title")}</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t("titleAuto")} />
          </div>
          <div>
            <label className="label">{kind === "EVALUATION" ? t("modelEval") : t("model")}</label>
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.vendor}
                </option>
              ))}
            </select>
          </div>
        </div>
      </details>
      <div className="space-y-3 rounded-xl bg-panel-2 p-4">
        <p className="text-sm">{t("feeLine", { fee })}</p>
        <CardPicker cards={cards} value={cardId} onChange={setCardId} pending={pendingCard} returnTo="/crowd/new" email={buyer.email} test={test} />
        <BuyerFields value={buyer} onChange={setBuyer} />
        <AgreeTerms />
        <AgreeCrowdTerms />
      </div>
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
      <button className="btn-primary w-full !py-3 text-base" disabled={busy || !cardId}>{busy ? tk("charging") : t("create", { fee })}</button>
      <p className="text-center text-xs text-muted">{t("after")}</p>
    </form>
  );
}

// ───────────── proposal fee ─────────────

export function ProposalFee({ taskId, fee, paid, buyer, cards, pendingCard = false, test = false }: { taskId: string; fee: number; paid: boolean; buyer?: Partial<Buyer> | null; cards: CardOpt[]; pendingCard?: boolean; test?: boolean }) {
  const t = useTranslations("crowd.edit");
  const router = useRouter();
  return (
    <PayForm
      buyer={buyer}
      cards={cards}
      pendingCard={pendingCard}
      test={test}
      returnTo={`/crowd/${taskId}/edit`}
      label={paid ? t("buyMore", { fee }) : t("buyFee", { fee })}
      onPay={async (b, cardId) => {
        await postJson(`/api/crowd/${taskId}/proposal-fee`, { buyer: b, cardId });
        router.refresh();
      }}
    />
  );
}

export function DiscardProposal({ taskId }: { taskId: string }) {
  const t = useTranslations("crowd.edit");
  const router = useRouter();
  return (
    <button
      className="btn-ghost w-full text-err"
      onClick={async () => {
        if (!confirm(t("confirmDiscard"))) return;
        await fetch(`/api/tasks/${taskId}/close`, { method: "POST" });
        router.push("/tasks?mine=1");
      }}
    >
      {t("discard")}
    </button>
  );
}

// ───────────── spec dialogue ─────────────

type Turn = { role: "user" | "assistant"; content: string };

export function SpecChat({ taskId, chat: initial, canChat, outOfCredit }: { taskId: string; chat: Turn[]; canChat: boolean; outOfCredit: boolean }) {
  const t = useTranslations("crowd.chat");
  const router = useRouter();
  const [chat, setChat] = useState(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // the server's dialogue (after router.refresh) replaces the local copy
  useEffect(() => setChat(initial), [initial]);
  return (
    <div className="space-y-3">
      <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-xl border border-line p-4">
        {chat.length === 0 && <p className="text-sm text-muted">{t("empty")}</p>}
        {chat.map((c, i) => (
          <div key={i} className={c.role === "user" ? "ml-8 rounded-xl bg-accent-soft p-3 text-sm" : "mr-8 rounded-xl bg-panel-2 p-3 text-sm"}>
            <p className="whitespace-pre-wrap">{c.content}</p>
          </div>
        ))}
        {busy && <p className="text-sm text-muted">{t("sending")}</p>}
      </div>
      {!canChat && <p className="text-sm text-warn">{outOfCredit ? t("outOfCredit") : t("needFee")}</p>}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const text = msg.trim();
          if (!text) return;
          setBusy(true);
          setErr("");
          setChat((c) => [...c, { role: "user", content: text }]);
          setMsg("");
          try {
            await send(`/api/crowd/${taskId}/spec`, "POST", { message: text });
            // the reply is written in the background; wait for the job to finish, then reload the draft
            for (;;) {
              await new Promise((r) => setTimeout(r, 2000));
              const p = await send(`/api/crowd/${taskId}/generate`, "GET").catch(() => null);
              if (!p || p.state === "running") continue;
              if (p.state === "error") throw new Error(p.error || t("failed"));
              break;
            }
            router.refresh();
          } catch (e) {
            setErr((e as Error).message);
            setChat((c) => c.slice(0, -1));
            setMsg(text);
          }
          setBusy(false);
        }}
      >
        <textarea className="input min-h-16 flex-1" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("placeholder")} disabled={!canChat || busy} maxLength={8000} />
        <button className="btn-primary self-end" disabled={!canChat || busy || !msg.trim()}>{t("send")}</button>
      </form>
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </div>
  );
}

// ───────────── spec editor ─────────────

export type SpecView = {
  summary: string;
  scope?: string;
  outOfScope?: string;
  deliverables: string[];
  method: string[];
  acceptance: string[];
  estimate: { p50Twd: number; p90Twd: number; basis?: string };
  stretch?: { title: string; twd: number }[];
  risks?: string[];
};

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function SpecEditor({ taskId, spec, revise = false }: { taskId: string; spec: SpecView | null; revise?: boolean }) {
  const t = useTranslations("crowd.spec");
  const tr = useTranslations("crowd.revise");
  const [note, setNote] = useState("");
  const router = useRouter();
  const s = spec ?? { summary: "", deliverables: [], method: [], acceptance: [], estimate: { p50Twd: 0, p90Twd: 0 } };
  const [f, setF] = useState({
    summary: s.summary,
    scope: s.scope ?? "",
    outOfScope: s.outOfScope ?? "",
    deliverables: s.deliverables.join("\n"),
    method: s.method.join("\n"),
    acceptance: s.acceptance.join("\n"),
    p50: String(s.estimate.p50Twd || ""),
    p90: String(s.estimate.p90Twd || ""),
    basis: s.estimate.basis ?? "",
    stretch: (s.stretch ?? []).map((x) => `${x.title} | ${x.twd}`).join("\n"),
    risks: (s.risks ?? []).join("\n"),
  });
  const [state, setState] = useState<"" | "busy" | "saved">("");
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const area = (k: keyof typeof f, label: string, hint?: string) => (
    <div>
      <label className="label">{label}</label>
      <textarea className="input min-h-20" value={f[k]} onChange={set(k)} />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        setErr("");
        try {
          await send(revise ? `/api/crowd/${taskId}/revisions` : `/api/crowd/${taskId}/spec`, revise ? "POST" : "PUT", {
            ...(revise ? { note } : {}),
            spec: {
              summary: f.summary,
              scope: f.scope,
              outOfScope: f.outOfScope,
              deliverables: lines(f.deliverables),
              method: lines(f.method),
              acceptance: lines(f.acceptance),
              estimate: { p50Twd: Number(f.p50) || 0, p90Twd: Number(f.p90) || 0, basis: f.basis },
              stretch: lines(f.stretch).map((l) => {
                const [title, twd] = l.split("|").map((x) => x.trim());
                return { title, twd: Number(twd) || 0 };
              }),
              risks: lines(f.risks),
            },
          });
          setState("saved");
          router.refresh();
        } catch (e) {
          setErr((e as Error).message);
          setState("");
        }
      }}
    >
      {area("summary", t("summary"))}
      <div className="grid gap-4 sm:grid-cols-2">
        {area("scope", t("scope"))}
        {area("outOfScope", t("outOfScope"))}
      </div>
      {area("deliverables", t("deliverables"), t("onePerLine"))}
      {area("method", t("method"), t("onePerLine"))}
      {area("acceptance", t("acceptance"), t("onePerLine"))}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">{t("p50")}</label>
          <input className="input font-mono" inputMode="numeric" value={f.p50} onChange={(e) => setF({ ...f, p50: e.target.value.replace(/\D/g, "") })} />
        </div>
        <div>
          <label className="label">{t("p90")}</label>
          <input className="input font-mono" inputMode="numeric" value={f.p90} onChange={(e) => setF({ ...f, p90: e.target.value.replace(/\D/g, "") })} />
        </div>
        <div>
          <label className="label">{t("basis")}</label>
          <input className="input" value={f.basis} onChange={set("basis")} />
        </div>
      </div>
      {area("stretch", t("stretch"), t("stretchHint"))}
      {area("risks", t("risks"), t("onePerLine"))}
      {revise && (
        <div>
          <label className="label">{tr("note")}</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} required maxLength={2000} />
        </div>
      )}
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
      <button className="btn-primary" disabled={state === "busy"}>{revise ? tr("submit") : state === "saved" ? t("saved") : t("save")}</button>
    </form>
  );
}

// ───────────── generated spec document ─────────────

/** Right after the proposal fee: the model drafts the spec from the description */
export function AutoDraft({ taskId }: { taskId: string }) {
  const t = useTranslations("crowd.draft");
  const router = useRouter();
  const [err, setErr] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setErr("");
    (async () => {
      try {
        // the model runs in the background; the page asks how it is going until the spec is there
        const start = await send(`/api/crowd/${taskId}/generate`, "POST", {});
        if (start.state === "done") return alive && router.refresh();
        let restarts = 0;
        while (alive) {
          await new Promise((r) => setTimeout(r, 2500));
          if (!alive) return;
          const p = await send(`/api/crowd/${taskId}/generate`, "GET").catch(() => null);
          if (!p) continue; // a dropped poll is retried
          if (p.hasSpec) return router.refresh();
          if (p.state === "error") return setErr(p.error || t("failed"));
          if (p.state === "idle") {
            // the job is gone without a spec (e.g. the server restarted): start it again once
            if (restarts++ > 0) return setErr(t("failed"));
            await send(`/api/crowd/${taskId}/generate`, "POST", {});
          }
        }
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [taskId, router, n, t]);
  return (
    <div className="card space-y-3 p-8 text-center" aria-live="polite">
      {err ? (
        <>
          <p className="text-err">{err}</p>
          <button className="btn-primary" onClick={() => setN(n + 1)}>{t("retry")}</button>
        </>
      ) : (
        <>
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-accent-soft border-t-accent" />
          <p className="font-semibold">{t("working")}</p>
          <p className="text-sm text-muted">{t("workingHint")}</p>
        </>
      )}
    </div>
  );
}

/** One line of the document: click to edit, Enter or leaving the field saves, Esc cancels */
function DocLine({ value, onSave, onDelete, placeholder, multiline = false }: { value: string; onSave: (v: string) => void; onDelete?: () => void; placeholder: string; multiline?: boolean }) {
  const t = useTranslations("crowd.doc");
  const [editing, setEditing] = useState(!value);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    setEditing(false);
    const next = v.trim();
    if (!next && onDelete) return onDelete();
    if (next !== value) onSave(next);
  };
  if (!editing)
    return (
      <div className="group flex items-start gap-2">
        <button type="button" className="min-w-0 flex-1 cursor-text whitespace-pre-wrap rounded-lg px-2 py-1 text-left hover:bg-panel-2" onClick={() => setEditing(true)} title={t("clickToEdit")}>
          {value || <span className="text-muted">{placeholder}</span>}
        </button>
        {onDelete && (
          <button type="button" className="px-1 text-muted opacity-0 hover:text-err group-hover:opacity-100 focus:opacity-100" onClick={onDelete} aria-label={t("remove")}>
            ✕
          </button>
        )}
      </div>
    );
  return (
    <textarea
      autoFocus
      className="input w-full"
      rows={multiline ? 4 : Math.min(4, Math.max(1, Math.ceil(v.length / 60)))}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setV(value);
          setEditing(false);
        } else if (e.key === "Enter" && !e.shiftKey && !multiline) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

type DocState = { summary: string; scope: string; outOfScope: string; deliverables: string[]; method: string[]; acceptance: string[]; risks: string[] };

/** The spec as a document: every line can be edited, removed or added by hand; the estimate is the model's */
export function SpecDoc({ taskId, spec, evaluation }: { taskId: string; spec: SpecView; evaluation?: { method: string | null; criteria: string | null } }) {
  const t = useTranslations("crowd.doc");
  const ts = useTranslations("crowd.spec");
  const tm = useTranslations("taskForm.methods");
  const router = useRouter();
  const [doc, setDoc] = useState<DocState>({
    summary: spec.summary,
    scope: spec.scope ?? "",
    outOfScope: spec.outOfScope ?? "",
    deliverables: spec.deliverables,
    method: spec.method,
    acceptance: spec.acceptance,
    risks: spec.risks ?? [],
  });
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const save = async (next: DocState) => {
    setDoc(next);
    setState("saving");
    try {
      await send(`/api/crowd/${taskId}/spec`, "PUT", { spec: { ...next, deliverables: next.deliverables.filter(Boolean), method: next.method.filter(Boolean), acceptance: next.acceptance.filter(Boolean), risks: next.risks.filter(Boolean) } });
      setState("saved");
      router.refresh();
    } catch {
      setState("error");
    }
  };
  const text = (k: "summary" | "scope" | "outOfScope", multiline = false) => (
    <section className="space-y-1">
      <h3 className="text-sm font-semibold text-muted">{ts(k)}</h3>
      <DocLine value={doc[k]} placeholder={t("empty")} multiline={multiline} onSave={(v) => save({ ...doc, [k]: v })} />
    </section>
  );
  const items = (k: "deliverables" | "method" | "acceptance" | "risks", numbered = false) => (
    <section className="space-y-1">
      <h3 className="text-sm font-semibold text-muted">{ts(k)}</h3>
      <ol className="space-y-0.5">
        {doc[k].map((line, i) => (
          <li key={`${k}-${i}-${doc[k].length}`} className="flex items-start gap-1">
            <span className="w-6 shrink-0 pt-1 text-right font-mono text-xs text-muted">{numbered ? `${i + 1}.` : "•"}</span>
            <div className="min-w-0 flex-1">
              <DocLine
                value={line}
                placeholder={t("newLine")}
                onSave={(v) => save({ ...doc, [k]: doc[k].map((x, j) => (j === i ? v : x)) })}
                onDelete={() => save({ ...doc, [k]: doc[k].filter((_, j) => j !== i) })}
              />
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="ml-7 text-xs text-accent" onClick={() => setDoc({ ...doc, [k]: [...doc[k], ""] })}>
        + {t("add")}
      </button>
    </section>
  );
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>{t("hint")}</span>
        <span aria-live="polite" className={state === "error" ? "text-err" : ""}>{state === "saving" ? t("saving") : state === "saved" ? t("saved") : state === "error" ? t("saveError") : ""}</span>
      </div>
      {text("summary", true)}
      {evaluation && (
        <section className="space-y-1 rounded-xl border border-line p-3">
          <h3 className="text-sm font-semibold text-muted">{t("evaluation")}</h3>
          <p className="text-sm">{evaluation.method ? tm(evaluation.method as "rubric") : t("methodPending")}</p>
          {evaluation.criteria && <p className="whitespace-pre-wrap text-sm text-muted">{evaluation.criteria}</p>}
          <p className="text-xs text-muted">{t("askAi")}</p>
        </section>
      )}
      {items("deliverables")}
      {items("method", true)}
      {items("acceptance", true)}
      <div className="grid gap-5 sm:grid-cols-2">
        {text("scope")}
        {text("outOfScope")}
      </div>
      {items("risks")}
      <section className="space-y-2 rounded-xl bg-panel-2 p-4">
        <h3 className="text-sm font-semibold">{t("estimate")}</h3>
        <p className="text-sm">{t("estimateLine", { p50: spec.estimate.p50Twd.toLocaleString("en-US"), p90: spec.estimate.p90Twd.toLocaleString("en-US") })}</p>
        {spec.estimate.basis && <p className="text-xs text-muted">{spec.estimate.basis}</p>}
        {(spec.stretch ?? []).length > 0 && (
          <div className="pt-1">
            <div className="text-xs font-semibold text-muted">{ts("stretch")}</div>
            <ul className="mt-1 space-y-0.5 text-sm">
              {(spec.stretch ?? []).map((x, i) => (
                <li key={i}>
                  {x.title} <span className="font-mono text-xs text-muted">+NT${x.twd.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted">{t("askAi")}</p>
      </section>
    </div>
  );
}

/** The proposal title, edited in place */
export function TitleEdit({ taskId, title }: { taskId: string; title: string }) {
  const t = useTranslations("crowd.doc");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(title);
  useEffect(() => setV(title), [title]);
  const commit = async () => {
    setEditing(false);
    const next = v.trim();
    if (next.length < 3 || next === title) return setV(title);
    await send(`/api/crowd/${taskId}/draft`, "PATCH", { title: next }).catch(() => setV(title));
    router.refresh();
  };
  return editing ? (
    <input autoFocus className="input text-2xl font-bold" value={v} maxLength={120} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => (e.key === "Enter" ? commit() : e.key === "Escape" ? (setV(title), setEditing(false)) : undefined)} />
  ) : (
    <button type="button" className="text-left text-2xl font-bold hover:text-accent sm:text-3xl" onClick={() => setEditing(true)} title={t("clickToEdit")}>
      {title}
    </button>
  );
}

// ───────────── reference files ─────────────

type FileRow = { id: string; filename: string; sizeBytes: number; visibility: string };

export function InputFiles({ taskId, files, editable }: { taskId: string; files: FileRow[]; editable: boolean }) {
  const t = useTranslations("crowd.files");
  const router = useRouter();
  const [vis, setVis] = useState("BACKERS");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const used = files.reduce((a, f) => a + f.sizeBytes, 0) / 1048576;
  return (
    <div className="space-y-3">
      {files.length === 0 && <p className="text-sm text-muted">{t("empty")}</p>}
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-sm">
            <a className="min-w-0 flex-1 truncate font-mono text-xs text-accent" href={`/api/crowd/${taskId}/files/${f.id}`}>{f.filename}</a>
            <span className="text-xs text-muted">{(f.sizeBytes / 1048576).toFixed(2)} MB</span>
            <span className="chip">{t(`vis.${f.visibility}`)}</span>
            {editable && (
              <button
                className="text-xs text-err"
                onClick={async () => {
                  await fetch(`/api/crowd/${taskId}/files/${f.id}`, { method: "DELETE" });
                  router.refresh();
                }}
              >
                {t("remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const input = (e.currentTarget.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0];
            if (!input) return;
            setBusy(true);
            setErr("");
            const fd = new FormData();
            fd.append("file", input);
            fd.append("visibility", vis);
            const r = await fetch(`/api/crowd/${taskId}/files`, { method: "POST", body: fd });
            setBusy(false);
            if (!r.ok) return setErr((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
            (e.target as HTMLFormElement).reset();
            router.refresh();
          }}
        >
          <input type="file" name="file" className="input flex-1" required />
          <select className="input w-auto" value={vis} onChange={(e) => setVis(e.target.value)}>
            {["PUBLIC", "BACKERS", "AGENT"].map((v) => (
              <option key={v} value={v}>{t(`vis.${v}`)}</option>
            ))}
          </select>
          <button className="btn-primary !py-2" disabled={busy}>{busy ? t("uploading") : t("upload")}</button>
        </form>
      )}
      <p className="text-xs text-muted">{t("used", { used: used.toFixed(1) })}</p>
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </div>
  );
}

// ───────────── open the campaign ─────────────

export function OpenFunding({ taskId, durations, p90, price, gaps, paid }: { taskId: string; durations: { days: number; rate: number }[]; p90: number; price: number; gaps: string[]; paid: boolean }) {
  const t = useTranslations("crowd.open");
  const ts = useTranslations("crowd.spec");
  const router = useRouter();
  const goalFor = (rate: number) => Math.max(price, Math.ceil(p90 / (1 - rate) / price - 1e-9) * price);
  const [days, setDays] = useState(durations[0]?.days ?? 7);
  const rate = durations.find((d) => d.days === days)?.rate ?? 0;
  const min = useMemo(() => goalFor(rate), [p90, rate, price]); // eslint-disable-line react-hooks/exhaustive-deps
  const [goal, setGoal] = useState("");
  const [early, setEarly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ready = paid && gaps.length === 0;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!confirm(t("confirm"))) return;
        setBusy(true);
        setErr("");
        try {
          await send(`/api/crowd/${taskId}/open`, "POST", { durationDays: days, goalTwd: goal ? Number(goal) : undefined, startEarly: early, agreeTerms: true });
          router.push(`/tasks/${taskId}`);
        } catch (e) {
          setErr((e as Error).message);
          setBusy(false);
        }
      }}
    >
      <fieldset className="space-y-2">
        <legend className="label">{t("duration")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {durations.map((d) => (
            <button type="button" key={d.days} onClick={() => setDays(d.days)} className={`rounded-xl border p-3 text-left text-sm ${d.days === days ? "border-accent bg-accent-soft" : "border-line"}`} aria-pressed={d.days === days}>
              <div className="font-semibold">{t("days", { days: d.days })}</div>
              <div className="font-mono text-xs">{p90 > 0 ? `NT$${goalFor(d.rate).toLocaleString("en-US")}` : "—"}</div>
              <div className="text-xs text-muted">{d.rate === 0 ? t("free") : t("fee", { rate: +(d.rate * 100).toFixed(2) })}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{t("goalAuto", { goal: (Number(goal) || min).toLocaleString("en-US") })}</p>
      </fieldset>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">{t("more")}</summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="label">{t("goal")}</label>
            <input className="input font-mono" inputMode="numeric" placeholder={String(min)} value={goal} onChange={(e) => setGoal(e.target.value.replace(/\D/g, ""))} />
            <p className="mt-1 text-xs text-muted">{t("minGoal", { min, price })}</p>
          </div>
          <Toggle checked={early} onChange={setEarly} label={t("startEarly")} description={t("startEarlyHint")} />
        </div>
      </details>
      <AgreeCrowdTerms />
      {!paid && <p className="text-sm text-warn">{t("needFee")}</p>}
      {gaps.length > 0 && <p className="text-sm text-warn">{t("missing", { list: gaps.map((g) => (g === "spec" ? ts("title") : g === "estimate" ? ts("estimate") : ts(g as "summary"))).join("、") })}</p>}
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
      <button className="btn-primary w-full !py-3" disabled={!ready || busy}>{t("submit")}</button>
      <p className="text-xs text-muted">{t("afterSubmit")}</p>
    </form>
  );
}

// ───────────── pledges ─────────────

type MyPledge = { id: string; shares: number; amountTwd: number; source: string; status: string; returnedTwd: number };

export function PledgePanel({
  taskId,
  status,
  price,
  cards,
  points,
  hasQuota,
  buyer: savedBuyer,
  mine,
  pendingCard = false,
  test = false,
}: {
  taskId: string;
  status: string;
  price: number;
  pendingCard?: boolean;
  test?: boolean;
  cards: CardOpt[];
  points: number;
  hasQuota: boolean;
  buyer?: Partial<Buyer> | null;
  mine: MyPledge[];
}) {
  const t = useTranslations("crowd.panel");
  const router = useRouter();
  const [shares, setShares] = useState(1);
  const [source, setSource] = useState<"CARD" | "POINTS" | "QUOTA">(cards.length ? "CARD" : points >= price ? "POINTS" : hasQuota ? "QUOTA" : "CARD");
  const [buyer, setBuyer] = useState(() => emptyBuyer(savedBuyer));
  const [usePoints, setUsePoints] = useState(false);
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const amount = shares * price;
  const open = ["FUNDING", "CHARGING", "QUEUED", "RUNNING", "NEEDS_FUNDING"].includes(status);
  return (
    <div className="space-y-4">
      {open && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr("");
            try {
              await send(`/api/crowd/${taskId}/pledges`, "POST", { shares, source, agreeTerms: true, ...(source === "CARD" ? { buyer, usePoints, cardId } : {}) });
              router.refresh();
            } catch (e) {
              setErr((e as Error).message);
            }
            setBusy(false);
          }}
        >
          <div className="grid grid-cols-3 gap-2">
            {[1, 5, 20].map((n) => (
              <button type="button" key={n} onClick={() => setShares(n)} className={`rounded-xl border p-2 text-center text-sm ${n === shares ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>
                {t("shares", { n })}
                <div className="text-xs text-muted">NT${n * price}</div>
              </button>
            ))}
          </div>
          <fieldset className="space-y-1 text-sm">
            <legend className="label">{t("source")}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={source === "CARD"} onChange={() => setSource("CARD")} />
              {t("card")}
            </label>
            <label className={`flex items-center gap-2 ${points < price ? "opacity-50" : ""}`}>
              <input type="radio" checked={source === "POINTS"} disabled={points < price} onChange={() => setSource("POINTS")} />
              {t("points", { n: points })}
            </label>
            {hasQuota && (
              <label className="flex items-center gap-2">
                <input type="radio" checked={source === "QUOTA"} onChange={() => setSource("QUOTA")} />
                {t("quota")}
              </label>
            )}
          </fieldset>
          {source === "CARD" && (
            <>
              <CardPicker cards={cards} value={cardId} onChange={setCardId} pending={pendingCard} returnTo={`/tasks/${taskId}`} email={buyer.email} test={test} />
              {cards.length > 0 && <BuyerFields value={buyer} onChange={setBuyer} />}
              {cards.length > 0 && points > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} />
                  {t("usePoints", { n: points })}
                </label>
              )}
              <p className="text-xs text-muted">{t("cardNote")}</p>
            </>
          )}
          {source === "POINTS" && <p className="text-xs text-muted">{t("pointsNote")}</p>}
          {source === "QUOTA" && <p className="text-xs text-muted">{t("quotaNote")}</p>}
          <AgreeCrowdTerms />
          <button className="btn-primary w-full" disabled={busy || (source === "CARD" && !cardId) || (source === "POINTS" && points < amount)}>
            {busy ? t("pledging") : t("pledge", { amount })}
          </button>
          {err && <p className="text-sm text-err" role="alert">{err}</p>}
        </form>
      )}
      {!open && <p className="text-sm text-muted">{t("closed")}</p>}
      {mine.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">{t("mine")}</div>
          {mine.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2 text-sm">
              <span className="flex-1">
                {t("shares", { n: p.shares })} · NT${p.amountTwd} · {p.source === "CARD" ? t("card") : p.source === "POINTS" ? t("pointsShort") : t("quota")}
              </span>
              <span className="chip">{t(`p.${p.status}`)}</span>
              {p.returnedTwd > 0 && <span className="text-xs text-ok">{t("returned", { n: p.returnedTwd })}</span>}
              {status === "FUNDING" && p.status === "ACTIVE" && (
                <button
                  className="text-xs text-err"
                  onClick={async () => {
                    if (!confirm(t("confirmWithdraw"))) return;
                    await fetch(`/api/crowd/pledges/${p.id}`, { method: "DELETE" });
                    router.refresh();
                  }}
                >
                  {t("withdraw")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────── saved cards (account) ─────────────

export function CardManager({ cards }: { cards: { id: string; last4: string | null }[] }) {
  const t = useTranslations("crowd.account");
  const router = useRouter();
  const [err, setErr] = useState("");
  return (
    <div className="space-y-3">
      {cards.length === 0 && <p className="text-sm text-muted">{t("noCards")}</p>}
      {cards.map((c) => (
        <div key={c.id} className="flex items-center justify-between rounded-xl border border-line p-3 text-sm">
          <span className="font-mono">•••• {c.last4 ?? "????"}</span>
          <button
            className="text-xs text-err"
            onClick={async () => {
              if (!confirm(t("confirmRemove"))) return;
              setErr("");
              try {
                await send(`/api/cards/${c.id}`, "DELETE");
                router.refresh();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            {t("remove")}
          </button>
        </div>
      ))}
      <button
        className="btn-ghost"
        onClick={async () => {
          setErr("");
          try {
            const r = await send("/api/cards", "POST", { returnTo: "/account#cards" });
            window.location.href = r.url;
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        {t("addCard")}
      </button>
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </div>
  );
}

export function MockCardBinding({ cardId, back }: { cardId: string; back: string }) {
  const t = useTranslations("crowd.mock");
  const done = async (ok: boolean, decline = false) => {
    await send(`/api/cards/${cardId}/mock`, "POST", { ok, decline });
    window.location.href = back;
  };
  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn-primary" onClick={() => done(true)}>{t("ok")}</button>
      <button className="btn-ghost" onClick={() => done(true, true)}>{t("decline")}</button>
      <button className="btn-ghost text-err" onClick={() => done(false)}>{t("fail")}</button>
    </div>
  );
}

/** The proposer closes a crowdfunded task whose budget ran out (results so far are kept, leftover settles) */
export function CloseCrowdTask({ taskId }: { taskId: string }) {
  const t = useTranslations("task");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-ghost w-full"
      disabled={busy}
      onClick={async () => {
        if (!confirm(t("confirmClose"))) return;
        setBusy(true);
        await fetch(`/api/tasks/${taskId}/close`, { method: "POST" });
        router.refresh();
      }}
    >
      {t("close")}
    </button>
  );
}

// ───────────── acceptance review ─────────────

export function ReviewVote({ taskId, mine }: { taskId: string; mine: { approve: boolean; reason: string | null } | null }) {
  const t = useTranslations("crowd.review");
  const router = useRouter();
  const [approve, setApprove] = useState(mine?.approve ?? true);
  const [reason, setReason] = useState(mine?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        try {
          await send(`/api/crowd/${taskId}/votes`, "POST", { approve, reason: reason || undefined });
          router.refresh();
        } catch (e) {
          setErr((e as Error).message);
        }
        setBusy(false);
      }}
    >
      {mine && <p className="text-sm text-muted">{t("voted", { choice: mine.approve ? t("approve") : t("reject") })}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setApprove(true)} className={`rounded-xl border p-2 text-sm ${approve ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>{t("approve")}</button>
        <button type="button" onClick={() => setApprove(false)} className={`rounded-xl border p-2 text-sm ${!approve ? "border-err bg-err-soft font-semibold text-err" : "border-line"}`}>{t("reject")}</button>
      </div>
      {!approve && <textarea className="input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reason")} required maxLength={2000} />}
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
      <button className="btn-primary w-full" disabled={busy}>{t("submit")}</button>
    </form>
  );
}

export function DisputeActions({ taskId }: { taskId: string }) {
  const t = useTranslations("crowd.admin");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const decide = async (decision: "accept" | "refund") => {
    if (!confirm(t("confirm"))) return;
    setErr("");
    try {
      await send(`/api/admin/crowd/${taskId}/resolve`, "POST", { decision, note: note || undefined });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="space-y-2">
      <input className="input" placeholder={t("note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      <button className="btn-primary w-full" onClick={() => decide("accept")}>{t("accept")}</button>
      <button className="btn-ghost w-full text-err" onClick={() => decide("refund")}>{t("refund")}</button>
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
    </div>
  );
}

export function TopupForm({ taskId, price }: { taskId: string; price: number }) {
  const t = useTranslations("crowd.topup");
  const router = useRouter();
  const [goal, setGoal] = useState(String(price * 5));
  const [err, setErr] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        try {
          await send(`/api/crowd/${taskId}/topup`, "POST", { goalTwd: Number(goal) });
          router.refresh();
        } catch (e) {
          setErr((e as Error).message);
        }
      }}
    >
      <label className="label">{t("goal")}</label>
      <input className="input font-mono" inputMode="numeric" step={price} value={goal} onChange={(e) => setGoal(e.target.value.replace(/\D/g, ""))} required />
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
      <button className="btn-primary w-full">{t("open")}</button>
    </form>
  );
}

// ───────────── P2: sharing, reports, screening, categories ─────────────

export type ShareInfo = { url: string; title: string; description: string; imageUrl: string; imageAlt: string };

/** Where each platform takes a link (they read the picture, title and summary from the page's Open Graph tags) */
const SHARE_TARGETS: { key: string; label: string; href: (s: ShareInfo) => string }[] = [
  { key: "facebook", label: "Facebook", href: (s) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(s.url)}` },
  { key: "x", label: "X", href: (s) => `https://x.com/intent/post?text=${encodeURIComponent(s.title)}&url=${encodeURIComponent(s.url)}` },
  { key: "line", label: "LINE", href: (s) => `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(s.url)}` },
  { key: "threads", label: "Threads", href: (s) => `https://www.threads.net/intent/post?text=${encodeURIComponent(`${s.title}\n${s.url}`)}` },
  { key: "linkedin", label: "LinkedIn", href: (s) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(s.url)}` },
  { key: "telegram", label: "Telegram", href: (s) => `https://t.me/share/url?url=${encodeURIComponent(s.url)}&text=${encodeURIComponent(s.title)}` },
  { key: "whatsapp", label: "WhatsApp", href: (s) => `https://wa.me/?text=${encodeURIComponent(`${s.title} ${s.url}`)}` },
];

export function ShareButton({ share }: { share: ShareInfo }) {
  const t = useTranslations("crowd.share");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"" | "link" | "text">("");
  const [canNative, setCanNative] = useState(false);
  useEffect(() => setCanNative(typeof navigator !== "undefined" && !!navigator.share), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const copy = async (what: "link" | "text") => {
    await navigator.clipboard.writeText(what === "link" ? share.url : `${share.title}\n${share.description}\n${share.url}`).catch(() => undefined);
    setCopied(what);
    setTimeout(() => setCopied(""), 2000);
  };
  const host = (() => {
    try {
      return new URL(share.url).host;
    } catch {
      return "";
    }
  })();
  return (
    <>
      <button className="btn-ghost !py-1.5 text-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {t("share")}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={t("title")} className="card w-full max-w-lg space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="h3">{t("title")}</h2>
              <button className="text-muted hover:text-ink" onClick={() => setOpen(false)} aria-label={t("close")}>✕</button>
            </div>
            <div className="overflow-hidden rounded-xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={share.imageUrl} alt={share.imageAlt} width={1200} height={630} className="aspect-[1200/630] w-full bg-surface object-cover" />
              <div className="space-y-1 p-3">
                <div className="text-xs uppercase text-muted">{host}</div>
                <div className="line-clamp-2 font-semibold">{share.title}</div>
                <div className="line-clamp-2 text-sm text-muted">{share.description}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SHARE_TARGETS.map((p) => (
                <a key={p.key} href={p.href(share)} target="_blank" rel="noopener noreferrer" className="btn-ghost justify-center !py-2 text-sm" data-share={p.key}>
                  {p.label}
                </a>
              ))}
              {canNative && (
                <button className="btn-ghost justify-center !py-2 text-sm" onClick={() => navigator.share({ title: share.title, text: share.description, url: share.url }).catch(() => undefined)}>
                  {t("more")}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono text-xs" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} aria-label={t("link")} />
              <button className="btn-primary !py-2 text-sm" onClick={() => copy("link")}>{copied === "link" ? t("copied") : t("copy")}</button>
            </div>
            <button className="text-xs text-accent underline" onClick={() => copy("text")}>{copied === "text" ? t("copiedText") : t("copyText")}</button>
            <p className="text-xs text-muted">{t("hint")}</p>
          </div>
        </div>
      )}
    </>
  );
}

export function ReportButton({ taskId }: { taskId: string }) {
  const t = useTranslations("crowd.report");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"" | "busy" | "done">("");
  const [err, setErr] = useState("");
  if (state === "done") return <p className="text-xs text-muted">{t("done")}</p>;
  if (!open) return <button className="text-xs text-muted hover:text-err" onClick={() => setOpen(true)}>{t("report")}</button>;
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        setErr("");
        try {
          await send("/api/reports", "POST", { targetType: "task", targetId: taskId, reason });
          setState("done");
        } catch (e) {
          setErr((e as Error).message);
          setState("");
        }
      }}
    >
      <textarea className="input min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reason")} minLength={3} maxLength={2000} required />
      {err && <p className="text-sm text-err">{err}</p>}
      <button className="btn-ghost w-full !py-1.5 text-sm text-err" disabled={state === "busy"}>{t("submit")}</button>
    </form>
  );
}

/** Admin: re-review only (the AI decides), optionally with a note the model reads as context */
export function ScreeningActions({ taskId }: { taskId: string }) {
  const t = useTranslations("crowd.screening");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        {t("note")}
        <textarea className="input mt-1 h-20" maxLength={2000} value={note} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary !py-2"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              await send(`/api/admin/crowd/${taskId}/screening`, "POST", note.trim() ? { note: note.trim() } : {});
              setNote("");
              setDone(true);
              router.refresh();
            } catch (e) {
              setErr((e as Error).message);
            }
            setBusy(false);
          }}
        >
          {t("rerun")}
        </button>
        {done && <span className="text-xs text-ok">{t("requested")}</span>}
      </div>
      <p className="text-xs text-muted">{t("rerunHelp")}</p>
      {err && <p className="text-sm text-err">{err}</p>}
    </div>
  );
}

/** The latest screening result: counts, items not met, platform notes */
export function ScreeningResult({ screening }: { screening: { decision: string; passed?: number; failedCount?: number; total?: number; checklistVersion?: number; reasons: string[]; failed?: unknown[]; notes?: { text: string; at: string }[] } }) {
  const t = useTranslations("crowd.screening");
  const failed = screening.failedCount ?? screening.failed?.length ?? 0;
  return (
    <div className="space-y-2 text-sm">
      {screening.total ? <p className="font-semibold">{t("result", { passed: screening.passed ?? 0, failed, total: screening.total, v: screening.checklistVersion ?? 0 })}</p> : null}
      {screening.decision === "rejected" && screening.reasons.length > 0 && (
        <details open={screening.reasons.length <= 5}>
          <summary className="cursor-pointer text-err">{t("reasons")}（{screening.reasons.length}）</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-err">
            {screening.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      )}
      {screening.notes && screening.notes.length > 0 && (
        <div>
          <div className="text-xs text-muted">{t("notes")}</div>
          <ul className="list-disc space-y-1 pl-5">
            {screening.notes.map((n, i) => (
              <li key={i} className="whitespace-pre-wrap">{n.text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CategorySelect({ taskId, value, categories }: { taskId: string; value: string | null; categories: readonly string[] }) {
  const t = useTranslations("crowd");
  const router = useRouter();
  return (
    <select
      className="input w-auto"
      value={value ?? ""}
      onChange={async (e) => {
        await send(`/api/crowd/${taskId}/draft`, "PATCH", { category: e.target.value || null });
        router.refresh();
      }}
    >
      <option value="">—</option>
      {categories.map((c) => (
        <option key={c} value={c}>{t(`categories.${c}` as "categories.other")}</option>
      ))}
    </select>
  );
}
