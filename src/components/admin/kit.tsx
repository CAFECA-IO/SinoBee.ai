import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Icon } from "@/components/icon";

/** Small building blocks shared by the /admin pages (server components) */

export type Tone = "ok" | "warn" | "err" | "info" | "muted" | "accent";
const TONE: Record<Tone, string> = {
  ok: "bg-accent-soft text-ok",
  warn: "bg-warn-soft text-warn",
  err: "bg-err-soft text-err",
  info: "bg-[#e6eefc] text-[#2a4fa3] dark:bg-[#16264a] dark:text-[#9db8ff]",
  muted: "bg-panel-2 text-muted",
  accent: "bg-accent-soft text-accent",
};

export function Tag({ tone = "muted", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`badge whitespace-nowrap ${TONE[tone]} ${className}`}>{children}</span>;
}

/** Page title row: title, an optional line beside it, actions on the right */
export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="h2">{title}</h1>
      {sub && <div className="text-sm text-muted">{sub}</div>}
      <span className="flex-1" />
      {children}
    </div>
  );
}

/** A filter as a link; `on` is the current one */
export function FilterLink({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "true" : undefined} className={`chip !py-1 text-[13px] ${on ? "!border-accent bg-accent-soft font-semibold !text-ink" : "hover:border-accent"}`}>
      {children}
    </Link>
  );
}

/** A banner across the page: err blocks something, warn wants attention */
export function Banner({ tone, title, children, action }: { tone: "err" | "warn" | "info"; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const cls = tone === "err" ? "border-err/40 bg-err-soft/40" : tone === "warn" ? "border-warn/40 bg-warn-soft/50" : "border-line bg-panel-2";
  const head = tone === "err" ? "text-err" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <section className={`card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${cls}`} role={tone === "info" ? undefined : "status"}>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${head}`}>{title}</div>
        {children && <div className="mt-0.5 text-sm text-muted">{children}</div>}
      </div>
      {action}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

/** List + detail: the list takes the room, the detail sits beside it (below it on a phone) */
export function Split({ list, detail }: { list: ReactNode; detail?: ReactNode }) {
  if (!detail) return <>{list}</>;
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">{list}</div>
      {detail}
    </div>
  );
}

/** The detail panel: a title, a close link back to the list, then sections */
export function DetailPanel({ title, sub, closeHref, closeLabel, children, id }: { title: ReactNode; sub?: ReactNode; closeHref: string; closeLabel: string; children: ReactNode; id?: string }) {
  return (
    <aside className="card min-w-0 overflow-hidden xl:sticky xl:top-20" aria-labelledby={id ?? "detail-title"} id="detail">
      <div className="flex items-start gap-2 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id={id ?? "detail-title"} className="h3 break-words">{title}</h2>
          {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
        </div>
        <Link href={closeHref} className="icon-btn" aria-label={closeLabel} data-tip={closeLabel}>
          <Icon name="x" />
        </Link>
      </div>
      <div className="divide-y divide-line">{children}</div>
    </aside>
  );
}

export function PanelSection({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2 px-5 py-4 text-sm">
      {(title || action) && (
        <div className="flex items-center gap-2">
          {title && <h3 className="flex-1 font-semibold">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Label / value rows */
export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(90px,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Previous / next page links */
export function Pager({ page, pages, href, label }: { page: number; pages: number; href: (p: number) => string; label: { prev: string; next: string; of: string } }) {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm" aria-label={label.of}>
      <span className="text-muted">{label.of}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link className="btn-ghost !py-1.5" href={href(page - 1)}>{label.prev}</Link> : <span />}
        {page < pages ? <Link className="btn-ghost !py-1.5" href={href(page + 1)}>{label.next}</Link> : <span />}
      </span>
    </nav>
  );
}

/** A metric tile: label, the number, one line of context */
export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" | "err" }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "err" ? "text-err" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** "3 小時" / "2 天" from a duration */
export function waited(ms: number, t: (k: string, v: { n: number }) => string) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return t("min", { n: Math.max(1, m) });
  const h = Math.round(m / 60);
  if (h < 48) return t("hour", { n: h });
  return t("day", { n: Math.round(h / 24) });
}

/** Build an /admin href from the current params, changing some (undefined or "" removes a param) */
export function adminHref(base: Record<string, string | undefined>, change: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...change })) if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `/admin?${s}` : "/admin";
}

export const twd = (n: number, digits = 0) => `NT$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
