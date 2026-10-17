"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Toggle } from "./toggle";
import { Link } from "@/i18n/navigation";
import { BuyerFields, PayForm, emptyBuyer, postJson, type Buyer } from "./checkout";

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
    <label className="flex items-start gap-2 text-xs text-muted">
      <input type="checkbox" className="mt-0.5" required name="agreeCrowd" />
      <span>
        {t.rich("agreeTerms", {
          terms: (c) => (
            <Link href="/crowd-terms" target="_blank" className="text-accent underline">
              {c}
            </Link>
          ),
        })}
      </span>
    </label>
  );
}

// ───────────── new proposal ─────────────

export function CrowdNewForm({ models, skill, categories }: { models: ModelOpt[]; skill: { id: string; label: string } | null; categories: readonly string[] }) {
  const t = useTranslations("crowd.form");
  const tc = useTranslations("crowd.categories");
  const [category, setCategory] = useState(categories[0] ?? "other");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState(models[1]?.id ?? models[0]?.id ?? "");
  const [useSkill, setUseSkill] = useState(!!skill);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <form
      className="card max-w-3xl space-y-5 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        try {
          const r = await postJson<{ task: { id: string } }>("/api/crowd", { title, description, model, category, skillVersionId: useSkill && skill ? skill.id : null, agreeTerms: true });
          router.push(`/crowd/${r.task.id}/edit`);
        } catch (e) {
          setErr((e as Error).message);
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="label">{t("title")}</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={120} required />
      </div>
      <div>
        <label className="label">{t("description")}</label>
        <textarea className="input min-h-40" value={description} onChange={(e) => setDescription(e.target.value)} minLength={10} maxLength={20000} required />
        <p className="mt-1 text-xs text-muted">{t("descriptionHint")}</p>
      </div>
      <div>
        <label className="label">{t("category")}</label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>{tc(c as "other")}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">{t("model")}</label>
        <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.vendor}
            </option>
          ))}
        </select>
      </div>
      {skill && <Toggle checked={useSkill} onChange={setUseSkill} label={t("useSkill", { skill: skill.label })} />}
      <AgreeCrowdTerms />
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? t("creating") : t("create")}</button>
    </form>
  );
}

// ───────────── proposal fee ─────────────

export function ProposalFee({ taskId, fee, paid, buyer }: { taskId: string; fee: number; paid: boolean; buyer?: Partial<Buyer> | null }) {
  const t = useTranslations("crowd.edit");
  return (
    <PayForm
      buyer={buyer}
      label={paid ? t("buyMore", { fee }) : t("buyFee", { fee })}
      onPay={async (b) => (await postJson<{ payment: { checkoutUrl: string } }>(`/api/crowd/${taskId}/proposal-fee`, { buyer: b })).payment.checkoutUrl}
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
  const [cost, setCost] = useState<number | null>(null);
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
            const r = await send(`/api/crowd/${taskId}/spec`, "POST", { message: text });
            setChat((c) => [...c, { role: "assistant", content: r.reply || "…" }]);
            setCost(r.costTwd);
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
      {cost !== null && <p className="text-xs text-muted">{t("cost", { cost: cost.toFixed(2) })}</p>}
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
  const [days, setDays] = useState(durations[0]?.days ?? 7);
  const rate = durations.find((d) => d.days === days)?.rate ?? 0;
  const min = useMemo(() => Math.max(price, Math.ceil(p90 / (1 - rate) / price - 1e-9) * price), [p90, rate, price]);
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
            <button type="button" key={d.days} onClick={() => setDays(d.days)} className={`rounded-xl border p-3 text-left text-sm ${d.days === days ? "border-accent bg-accent-soft" : "border-line"}`}>
              <div className="font-semibold">{t("days", { days: d.days })}</div>
              <div className="text-xs text-muted">{d.rate === 0 ? t("free") : t("fee", { rate: +(d.rate * 100).toFixed(2) })}</div>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label">{t("goal")}</label>
        <input className="input font-mono" inputMode="numeric" placeholder={String(min)} value={goal} onChange={(e) => setGoal(e.target.value.replace(/\D/g, ""))} />
        <p className="mt-1 text-xs text-muted">{t("minGoal", { min, price })}</p>
      </div>
      <Toggle checked={early} onChange={setEarly} label={t("startEarly")} description={t("startEarlyHint")} />
      <AgreeCrowdTerms />
      {!paid && <p className="text-sm text-warn">{t("needFee")}</p>}
      {gaps.length > 0 && <p className="text-sm text-warn">{t("missing", { list: gaps.map((g) => (g === "spec" ? ts("title") : g === "estimate" ? ts("estimate") : ts(g as "summary"))).join("、") })}</p>}
      {err && <p className="text-sm text-err" role="alert">{err}</p>}
      <button className="btn-primary w-full" disabled={!ready || busy}>{t("submit")}</button>
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
}: {
  taskId: string;
  status: string;
  price: number;
  cards: { id: string; last4: string | null }[];
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const amount = shares * price;
  const open = ["FUNDING", "CHARGING", "QUEUED", "RUNNING", "NEEDS_FUNDING"].includes(status);
  const addCard = async () => {
    setErr("");
    try {
      const r = await send("/api/cards", "POST", { returnTo: `/tasks/${taskId}`, email: buyer.email || undefined });
      window.location.href = r.url;
    } catch (e) {
      setErr((e as Error).message);
    }
  };
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
              await send(`/api/crowd/${taskId}/pledges`, "POST", { shares, source, agreeTerms: true, ...(source === "CARD" ? { buyer, usePoints } : {}) });
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
              {cards.length ? t("cardLast4", { last4: cards[0].last4 ?? "????" }) : t("card")}
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
              {cards.length === 0 ? (
                <div className="space-y-2 rounded-xl border border-line p-3 text-sm">
                  <p className="text-muted">{t("noCard")}</p>
                  <button type="button" className="btn-ghost w-full" onClick={addCard}>{t("addCard")}</button>
                </div>
              ) : (
                <BuyerFields value={buyer} onChange={setBuyer} />
              )}
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
          <button className="btn-primary w-full" disabled={busy || (source === "CARD" && cards.length === 0) || (source === "POINTS" && points < amount)}>
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

export function ShareButton({ title }: { title: string }) {
  const t = useTranslations("crowd.share");
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-ghost !py-1.5 text-sm"
      onClick={async () => {
        const url = window.location.href.split("?")[0];
        if (navigator.share) {
          await navigator.share({ title, url }).catch(() => undefined);
          return;
        }
        await navigator.clipboard.writeText(url).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? t("copied") : t("share")}
    </button>
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

export function ScreeningActions({ taskId }: { taskId: string }) {
  const t = useTranslations("crowd.screening");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className="btn-ghost !py-2"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await send(`/api/admin/crowd/${taskId}/screening`, "POST", {});
            router.refresh();
          } catch (e) {
            setErr((e as Error).message);
          }
          setBusy(false);
        }}
      >
        {t("rerun")}
      </button>
      {err && <p className="w-full text-sm text-err">{err}</p>}
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
