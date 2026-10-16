import { SETTING } from "./registry";

/**
 * In-memory view of the settings, shared by every module copy in the process (globalThis). Filled by
 * loadSettings() at start-up (instrumentation, worker, scripts) and refreshed periodically; reading never touches
 * the database, so config getters stay synchronous.
 */
type Cache = { values: Map<string, string>; loadedAt: number };
const g = globalThis as unknown as { __sbSettings?: Cache };

export const settingsCache = (): Cache => (g.__sbSettings ??= { values: new Map(), loadedAt: 0 });

export type Source = "env" | "db" | "default" | "unset";

/** Effective value: process environment (locked) → database → default */
export function sv(key: string): string {
  return resolve(key).value;
}

export function resolve(key: string): { value: string; source: Source } {
  const def = SETTING[key];
  if (!def) throw new Error(`unknown setting ${key}`);
  const env = def.env ? process.env[def.env] : undefined;
  if (env !== undefined && env !== "") return { value: env, source: "env" };
  const db = settingsCache().values.get(key);
  if (db !== undefined && db !== "") return { value: db, source: "db" };
  if (def.default !== undefined) return { value: def.default, source: "default" };
  return { value: "", source: "unset" };
}

export const svNum = (key: string) => {
  const n = Number(sv(key));
  return Number.isFinite(n) ? n : Number(SETTING[key].default ?? 0);
};
export const svBool = (key: string) => ["1", "true", "yes", "on"].includes(sv(key).toLowerCase());
export const svList = (key: string) => sv(key).split(",").map((s) => s.trim()).filter(Boolean);
