import { db } from "../db";
import { audit } from "../roles";

/**
 * "暫停此供應商" (2026-10-21): an admin pauses every model of one vendor at once without touching the models' own
 * 提供 switches (resuming brings back exactly what was offered before). While paused the relay answers at once with
 * code "vendor_down" (SinoBee asks the allocation for another model), /route leaves the vendor out and the model
 * list marks its models unavailable. The admin page shows how long the current pause has lasted and the total.
 *
 * Kept in SiteSetting "llm.vendorPause": {vendor: {since: ISO | null, totalMs, by}}.
 */

const KEY = "llm.vendorPause";
export type PauseState = { since: string | null; totalMs: number; by?: string | null };

let cache: { at: number; value: Record<string, PauseState> } | null = null;

export async function pauses(fresh = false): Promise<Record<string, PauseState>> {
  if (!fresh && cache && Date.now() - cache.at < 5_000) return cache.value;
  const row = await db.siteSetting.findUnique({ where: { key: KEY } });
  let value: Record<string, PauseState> = {};
  try {
    value = row ? JSON.parse(row.value) : {};
  } catch {
    value = {};
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function pausedVendors(): Promise<Set<string>> {
  const p = await pauses();
  return new Set(Object.entries(p).filter(([, v]) => v.since).map(([k]) => k));
}

export async function isPaused(vendor: string) {
  return (await pausedVendors()).has(vendor);
}

/** Paused time so far: the current pause (ms) and the total over all pauses (ms) */
export function durations(s: PauseState | undefined, now = Date.now()) {
  const current = s?.since ? Math.max(0, now - new Date(s.since).getTime()) : 0;
  return { current, total: (s?.totalMs ?? 0) + current };
}

export async function setPaused(actorId: string, vendor: string, paused: boolean) {
  const all = await pauses(true);
  const s: PauseState = all[vendor] ?? { since: null, totalMs: 0 };
  const now = new Date();
  if (paused && !s.since) {
    s.since = now.toISOString();
    s.by = actorId;
  } else if (!paused && s.since) {
    s.totalMs += Math.max(0, now.getTime() - new Date(s.since).getTime());
    s.since = null;
    s.by = actorId;
  }
  all[vendor] = s;
  await db.siteSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(all) }, update: { value: JSON.stringify(all) } });
  cache = null;
  await audit(actorId, paused ? "llm.vendor.pause" : "llm.vendor.resume", { type: "vendor", id: vendor }, { totalMs: s.totalMs });
  return s;
}
