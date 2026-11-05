"use client";

/**
 * The only controls a settings screen may use (design: the "操作元件" boards; src/lib/settings/ui.ts). Pages never put
 * an input, checkbox or select of their own on a settings screen: they render <SettingControl> for a setting, or one
 * of the exported controls for a value outside the registry. tests/settings-controls.test.ts checks this.
 *
 * Every control takes the STORED value and reports the stored value (percent 50 → "0.5"); state colours (draft,
 * error, locked) come from `state`.
 */
import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { controlOf, fromShown, joinPairs, optionLabel, parsePairs, toShown, type Control, type Controlled, type L, type Ui } from "@/lib/settings/ui";

export type ControlState = "default" | "draft" | "error" | "locked";

export type ControlItem = Controlled & {
  label: string;
  ui: Ui;
  control?: Control;
  secretSet?: boolean;
  hint?: string;
  derived?: string;
  defaultValue?: string;
};

const pick = (l: L | undefined, zh: boolean) => (l ? (zh ? l.zh : l.en) : "");

const frame = (state: ControlState) =>
  state === "draft"
    ? "border-2 border-[#b86b00] bg-[#fffaf1] dark:bg-[#2a2010]"
    : state === "error"
      ? "border-2 border-err bg-err-soft/40"
      : state === "locked"
        ? "border border-dashed border-line bg-panel-2 text-muted"
        : "border border-line bg-panel";

/** 1 開關 */
export function Toggle({ on, onChange, label, state = "default", disabled, zh }: { on: boolean; onChange: (on: boolean) => void; label: string; state?: ControlState; disabled?: boolean; zh: boolean }) {
  return (
    <span className="inline-flex min-h-11 items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative inline-block h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed ${state === "locked" ? (on ? "bg-[#8fa7a0]" : "bg-[#c7d4cf]") : on ? "bg-accent" : "bg-[#9fb3ad]"} ${state === "draft" ? "ring-[3px] ring-[#f4c98a]" : ""}`}
      >
        <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${on ? "left-[23px]" : "left-[3px]"}`} />
      </button>
      <span className={`text-sm ${state === "locked" ? "text-muted" : ""}`}>{on ? (zh ? "開啟" : "On") : zh ? "關閉" : "Off"}</span>
    </span>
  );
}

/** 2 文字 · 3 網址 · 4 數字＋單位 · 5 比例 · 6 金額: one framed field with an optional prefix and unit */
export function Field({ value, onChange, label, state = "default", disabled, mono, prefix, suffix, placeholder, inputMode, type = "text", onBlur, id }: { value: string; onChange: (v: string) => void; label: string; state?: ControlState; disabled?: boolean; mono?: boolean; prefix?: string; suffix?: string; placeholder?: string; inputMode?: "decimal" | "numeric" | "url" | "text"; type?: "text" | "password"; onBlur?: () => void; id?: string }) {
  return (
    <span className={`flex min-h-11 w-full items-center overflow-hidden rounded-xl ${frame(state)}`}>
      {prefix && <span className="shrink-0 pl-3 text-sm text-muted">{prefix}</span>}
      <input
        id={id}
        className={`min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed ${mono ? "font-mono text-[13px]" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-label={label}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={inputMode}
        type={type}
        autoComplete="off"
        spellCheck={false}
      />
      {suffix && <span className="shrink-0 whitespace-nowrap pr-3 text-[13px] text-muted">{suffix}</span>}
    </span>
  );
}

/** 9 分段選擇 */
export function Segmented({ value, options, onChange, label, state = "default", disabled }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; label: string; state?: ControlState; disabled?: boolean }) {
  return (
    <span role="radiogroup" aria-label={label} className={`inline-flex flex-wrap gap-1 rounded-xl bg-panel-2 p-1 ${state === "error" ? "ring-2 ring-err" : ""}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(o.value)} title={o.value}
            className={`min-h-10 rounded-[9px] px-4 text-sm disabled:cursor-not-allowed ${on ? `bg-panel font-semibold text-ink shadow-sm ${state === "draft" ? "outline outline-2 outline-[#b86b00]" : ""}` : "text-muted hover:text-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

/** 10 下拉選單 */
export function Select({ value, options, onChange, label, state = "default", disabled }: { value: string; options: { value: string; label: string; note?: string }[]; onChange: (v: string) => void; label: string; state?: ControlState; disabled?: boolean }) {
  return (
    <span className={`flex min-h-11 w-full items-center overflow-hidden rounded-xl ${frame(state)}`}>
      <select className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-ink outline-none disabled:cursor-not-allowed" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={disabled}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}{o.note ? ` · ${o.note}` : ""}</option>
        ))}
      </select>
    </span>
  );
}

/** 11 選項卡 */
export function Cards({ value, options, onChange, label, state = "default", disabled }: { value: string; options: { value: string; label: string; body?: string; warn?: string }[]; onChange: (v: string) => void; label: string; state?: ControlState; disabled?: boolean }) {
  return (
    <span role="radiogroup" aria-label={label} className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(o.value)} title={o.value}
            className={`flex flex-col gap-1 rounded-xl p-3 text-left disabled:cursor-not-allowed ${on ? (state === "draft" ? "border-2 border-[#b86b00] bg-[#fffaf1] dark:bg-[#2a2010]" : "border-2 border-accent bg-accent-soft/40") : "border border-line hover:border-accent"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden className={`inline-block h-4 w-4 shrink-0 rounded-full ${on ? "border-[5px] border-accent" : "border-2 border-[#9fb3ad]"}`} />
              {o.label}
            </span>
            {o.body && <span className="text-xs text-muted">{o.body}</span>}
            {o.warn && <span className="text-xs font-semibold text-err">{o.warn}</span>}
          </button>
        );
      })}
    </span>
  );
}

/** 12 多選標籤 */
export function Chips({ values, options, onChange, label, disabled }: { values: string[]; options: { value: string; label: string }[]; onChange: (v: string[]) => void; label: string; disabled?: boolean }) {
  const set = new Set(values);
  return (
    <span role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = set.has(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} disabled={disabled} title={o.value}
            onClick={() => onChange(options.map((x) => x.value).filter((x) => (x === o.value ? !on : set.has(x))))}
            className={`min-h-10 rounded-full px-4 text-sm disabled:cursor-not-allowed ${on ? "border border-accent bg-accent font-semibold text-accent-ink" : "border border-[#9fb3ad] bg-panel text-muted"}`}>
            {on ? "✓ " : ""}{o.label}
          </button>
        );
      })}
    </span>
  );
}

/** 13 清單輸入: one tag per item, each checked on its own */
export function ListInput({ values, onChange, label, pattern, placeholder, state = "default", disabled, invalidNote }: { values: string[]; onChange: (v: string[]) => void; label: string; pattern?: string; placeholder?: string; state?: ControlState; disabled?: boolean; invalidNote?: (item: string) => string }) {
  const [text, setText] = useState("");
  const re = pattern ? new RegExp(pattern) : null;
  const add = () => {
    const items = text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    onChange([...new Set([...values, ...items])]);
    setText("");
  };
  const wrong = values.filter((v) => re && !re.test(v));
  return (
    <span className="flex w-full flex-col gap-1">
      <span className={`flex min-h-11 w-full flex-wrap items-center gap-2 rounded-xl p-2 ${frame(state)}`}>
        {values.map((v) => {
          const bad = re && !re.test(v);
          return (
            <span key={v} className={`inline-flex max-w-full items-center gap-1 rounded-lg py-1 pl-2.5 pr-1 font-mono text-xs ${bad ? "bg-err-soft text-err" : "bg-panel-2"}`}>
              <span className="truncate">{v.length > 28 ? `${v.slice(0, 10)}…${v.slice(-8)}` : v}</span>
              {!disabled && (
                <button type="button" aria-label={`${label}: ${v} ✕`} onClick={() => onChange(values.filter((x) => x !== v))} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-panel hover:text-err">✕</button>
              )}
            </span>
          );
        })}
        {!disabled && (
          <input className="min-h-9 min-w-[10rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted" value={text} placeholder={placeholder} aria-label={label}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add} spellCheck={false} autoComplete="off" />
        )}
      </span>
      {wrong.length > 0 && invalidNote && <span className="text-xs text-err">{invalidNote(wrong[0])}</span>}
    </span>
  );
}

/** 14 對照表 */
export function Pairs({ rows, onChange, label, left, right, disabled, state = "default" }: { rows: { left: string; right: string }[]; onChange: (rows: { left: string; right: string }[]) => void; label: string; left: { label: string; unit: string }; right: { label: string; unit: string }; disabled?: boolean; state?: ControlState }) {
  const t = useTranslations("admin.ctl");
  const set = (i: number, side: "left" | "right", v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [side]: v } : r)));
  return (
    <span className="flex w-full flex-col gap-2" role="group" aria-label={label}>
      <span className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 text-xs text-muted">
        <span>{left.label}</span>
        <span>{right.label}</span>
        <span />
      </span>
      {rows.map((r, i) => (
        <span key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-2">
          <Field value={r.left} onChange={(v) => set(i, "left", v)} label={`${left.label} ${i + 1}`} suffix={left.unit} inputMode="decimal" disabled={disabled} state={state === "locked" ? "locked" : "default"} />
          <Field value={r.right} onChange={(v) => set(i, "right", v)} label={`${right.label} ${i + 1}`} suffix={right.unit} inputMode="decimal" disabled={disabled} state={state === "locked" ? "locked" : "default"} />
          {!disabled ? (
            <button type="button" className="grid h-11 w-11 place-items-center rounded-xl border border-line text-muted hover:border-err hover:text-err" aria-label={t("removeRow", { n: i + 1 })} onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
          ) : <span />}
        </span>
      ))}
      {!disabled && (
        <button type="button" className="min-h-10 self-start rounded-xl border border-dashed border-[#9fb3ad] px-3 text-sm hover:border-accent" onClick={() => onChange([...rows, { left: "", right: "" }])}>
          ＋ {t("addRow")}
        </button>
      )}
    </span>
  );
}

/** 8 唯讀值 */
export function Readonly({ value, label }: { value: string; label: string }) {
  const t = useTranslations("admin.ctl");
  const [ok, setOk] = useState(false);
  return (
    <span className="flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-xl bg-panel-2 px-3">
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value} aria-label={label}>{value || "—"}</span>
      {value && (
        <button type="button" className="shrink-0 text-xs font-semibold text-accent hover:underline"
          onClick={async () => {
            await navigator.clipboard?.writeText(value);
            setOk(true);
            setTimeout(() => setOk(false), 1500);
          }}>
          {ok ? `✓ ${t("copied")}` : t("copy")}
        </button>
      )}
    </span>
  );
}

/** 16 按鈕: 主要 / 次要 / 危險 / 文字連結 */
export function Action({ kind = "secondary", children, onClick, disabled, type = "button" }: { kind?: "primary" | "secondary" | "danger" | "link"; children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  const cls = kind === "primary" ? "btn-primary" : kind === "danger" ? "btn-danger" : kind === "link" ? "inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline disabled:opacity-50" : "btn-ghost";
  return <button type={type} className={cls} onClick={onClick} disabled={disabled}>{children}</button>;
}

/** 16 危險確認: the consequence as a sentence to tick */
export function DangerConfirm({ text, checked, onChange }: { text: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <span className="flex items-start gap-2 text-sm text-err">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--err)]" />
      <label htmlFor={id}>{text}</label>
    </span>
  );
}

/** A setting's value as people read it (review panel, change log): option names, units, on/off, masked secrets */
export function displayValue(item: ControlItem, stored: string, zh: boolean): string {
  const c = item.control ?? controlOf(item);
  if (stored === "") return zh ? "（預設）" : "(default)";
  if (c === "toggle") return stored === "1" ? (zh ? "開啟" : "On") : zh ? "關閉" : "Off";
  if (c === "secret" || c === "readonly") return item.type === "secret" ? `••••${stored.slice(-4)}` : stored;
  if (c === "segmented" || c === "select" || c === "cards") return optionLabel(item, stored, zh);
  if (c === "chips") return stored.split(",").filter(Boolean).map((v) => optionLabel(item, v, zh)).join("、");
  if (c === "percent") return `${toShown(item, stored)}%`;
  if (c === "money") return `${pick(item.ui.unit, zh)}${Number(stored).toLocaleString("en-US")}`;
  if (c === "number") return `${item.ui.big ? stored : Number(stored).toLocaleString("en-US")} ${pick(item.ui.unit, zh)}`.trim();
  if (c === "pairs" && item.ui.pairs) {
    const p = item.ui.pairs;
    return parsePairs(item, stored).map((r) => `${r.left}${pick(p.left.unit, zh)} → ${r.right}${pick(p.right.unit, zh)}`).join("；");
  }
  return stored;
}

/**
 * The control for one registry setting. `value` is the stored value currently in effect (secrets: "" — the typed
 * replacement is the draft); `draft` is the pending stored value or undefined.
 */
export function SettingControl({ item, value, draft, onChange, state, disabled, zh }: { item: ControlItem; value: string; draft: string | undefined; onChange: (stored: string | undefined) => void; state: ControlState; disabled: boolean; zh: boolean }) {
  const t = useTranslations("admin.ctl");
  const c = item.control ?? controlOf(item);
  const u = item.ui;
  const cur = draft ?? value;
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const opts = (item.options ?? []).map((o) => ({ value: o, label: optionLabel(item, o, zh), body: pick(u.options?.[o]?.body, zh) }));
  switch (c) {
    case "toggle":
      return <Toggle on={cur === "1"} onChange={(on) => onChange(on ? "1" : "0")} label={item.label} state={state} disabled={disabled} zh={zh} />;
    case "segmented":
      return <Segmented value={cur} options={opts} onChange={onChange} label={item.label} state={state} disabled={disabled} />;
    case "select":
      return <Select value={cur} options={opts} onChange={onChange} label={item.label} state={state} disabled={disabled} />;
    case "cards":
      return <Cards value={cur} options={opts} onChange={onChange} label={item.label} state={state} disabled={disabled} />;
    case "chips":
      return <Chips values={cur.split(",").filter(Boolean)} options={opts} onChange={(v) => onChange(v.join(","))} label={item.label} disabled={disabled} />;
    case "list":
      return <ListInput values={cur.split(",").filter(Boolean)} onChange={(v) => onChange(v.join(","))} label={item.label} pattern={u.item?.pattern} placeholder={pick(u.item?.placeholder, zh) || t("addItem")} state={state} disabled={disabled || !!u.readOnly} invalidNote={(x) => `「${x}」${pick(u.item?.message, zh)}`} />;
    case "pairs": {
      const p = u.pairs!;
      return <Pairs rows={parsePairs(item, cur)} onChange={(rows) => onChange(joinPairs(item, rows))} label={item.label} left={{ label: pick(p.left.label, zh), unit: pick(p.left.unit, zh) }} right={{ label: pick(p.right.label, zh), unit: pick(p.right.unit, zh) }} disabled={disabled} state={state} />;
    }
    case "readonly":
      return (
        <span className="flex w-full flex-col gap-1">
          {draft === undefined ? (
            <Readonly value={item.derived ?? (item.secretSet ? t("generatedHidden") : "")} label={item.label} />
          ) : (
            <Field value={draft} onChange={(v) => onChange(v)} label={item.label} state={state} mono type="password" placeholder={t("pasteNew")} />
          )}
          {!disabled && (draft === undefined ? (
            <button type="button" className="self-start text-xs font-semibold text-err hover:underline" onClick={() => onChange("")}>{t("replaceDanger")}</button>
          ) : (
            <button type="button" className="self-start text-xs font-semibold text-accent hover:underline" onClick={() => onChange(undefined)}>{t("keepCurrent")}</button>
          ))}
        </span>
      );
    case "secret":
      return (
        <span className="flex w-full flex-col gap-1">
          {item.secretSet && draft === undefined && !editing ? (
            <span className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 ${frame(state)}`}>
              <span className="min-w-0 flex-1 font-mono text-[13px]">{item.hint ?? "••••"}</span>
              {!disabled && <button type="button" className="shrink-0 text-xs font-semibold text-accent hover:underline" onClick={() => setEditing(true)}>{t("replace")}</button>}
            </span>
          ) : (
            <Field value={draft ?? ""} onChange={(v) => onChange(v === "" && !item.secretSet ? undefined : v)} label={item.label} state={state} disabled={disabled} mono type="password" placeholder={item.secretSet ? t("pasteNew") : t("paste")} />
          )}
          {item.secretSet && (editing || draft !== undefined) && !disabled && (
            <button type="button" className="self-start text-xs font-semibold text-accent hover:underline" onClick={() => { setEditing(false); onChange(undefined); }}>{t("keepCurrent")}</button>
          )}
        </span>
      );
    default: {
      // text, url, number, percent, money: what is typed stays as typed while the field has focus
      const display = shown ?? (c === "percent" ? toShown(item, cur) : cur);
      const placeholder = cur === "" && item.defaultValue ? `${t("defaultIs")} ${c === "percent" ? toShown(item, item.defaultValue) : item.defaultValue}` : undefined;
      return (
        <Field
          value={display}
          onChange={(v) => {
            setShown(v);
            onChange(c === "percent" ? fromShown(item, v) : c === "number" || c === "money" ? v.replace(/,/g, "") : v);
          }}
          onBlur={() => setShown(null)}
          label={item.label}
          state={state}
          disabled={disabled}
          mono={c === "url" || !!u.big}
          prefix={c === "money" ? pick(u.unit, zh) : undefined}
          suffix={c === "number" || c === "percent" ? pick(u.unit, zh) : undefined}
          inputMode={c === "number" || c === "percent" || c === "money" ? "decimal" : c === "url" ? "url" : "text"}
          placeholder={placeholder}
        />
      );
    }
  }
}
