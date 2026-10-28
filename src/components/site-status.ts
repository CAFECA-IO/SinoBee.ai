"use client";

export type DbStatus = { ok: boolean; admin?: boolean; since?: number | null; code?: string | null; kind?: string; target?: string };
export type SiteStatus = { testMode?: boolean; db?: DbStatus };

let pending: Promise<SiteStatus | null> | null = null;

/** GET /api/site, shared by the components that need it (requests made within a second share one fetch) */
export function fetchSiteStatus(): Promise<SiteStatus | null> {
  if (pending) return pending;
  const p = fetch("/api/site", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<SiteStatus>) : null))
    .catch(() => null);
  pending = p;
  setTimeout(() => {
    if (pending === p) pending = null;
  }, 1_000);
  return p;
}
