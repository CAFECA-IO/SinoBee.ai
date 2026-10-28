import { db, dbKind } from "./db";
import { dbTarget } from "./db-target";

/**
 * Database availability. When the database cannot be reached the site keeps rendering: pages that can do without
 * data show what they can, the rest show a short maintenance notice, and admins (recognized by the signed role
 * hint cookie, see role-hint.ts) get the error code and connection target so they know to fix it.
 */

type Health = { down: boolean; since: number | null; code: string | null; checkedAt: number; loggedAt: number };
const g = globalThis as unknown as { __sbDbHealth?: Health; __sbDbPing?: Promise<boolean> };
const health = (): Health => (g.__sbDbHealth ??= { down: false, since: null, code: null, checkedAt: 0, loggedAt: 0 });

const DOWN_CODES = new Set(["P1000", "P1001", "P1002", "P1003", "P1008", "P1010", "P1011", "P1017", "P2024"]);
/** driver adapter error kinds (Prisma 7) that mean the database cannot be used, whatever the query */
const DOWN_KINDS = new Set(["DatabaseNotReachable", "ConnectionClosed", "SocketTimeout", "TooManyConnections", "DatabaseDoesNotExist", "AuthenticationFailed", "TlsConnectionError", "DatabaseAccessDenied"]);
const adapterKind = (e: unknown): string | null => {
  const k = (e as { meta?: { driverAdapterError?: { cause?: { kind?: unknown } } } })?.meta?.driverAdapterError?.cause?.kind;
  return typeof k === "string" ? k : null;
};
const DOWN_TEXT = /can't reach database|server has closed the connection|connectionclosed|connection terminated|connection refused|econnrefused|econnreset|etimedout|enotfound|eai_again|timeout exceeded when trying to connect|too many clients|database system is (starting up|shutting down)|sqlite_cantopen|unable to open database/i;

/** Is this error "the database is unreachable" (as opposed to a bug or a bad query)? */
export function isDbDown(e: unknown, depth = 0): boolean {
  if (!e || typeof e !== "object" || depth > 4) return false;
  const x = e as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown; meta?: { driverAdapterError?: unknown } };
  if (typeof x.code === "string" && DOWN_CODES.has(x.code)) return true;
  const kind = adapterKind(e);
  if (kind && DOWN_KINDS.has(kind)) return true;
  if (x.name === "PrismaClientInitializationError") return true;
  if (typeof x.message === "string" && DOWN_TEXT.test(x.message)) return true;
  return isDbDown(x.cause, depth + 1) || isDbDown(x.meta?.driverAdapterError, depth + 1);
}

/** e.g. "P1001 DatabaseNotReachable" (Prisma code + driver adapter kind, which is more telling for raw queries) */
const codeOf = (e: unknown): string => {
  const x = e as { code?: unknown; name?: unknown };
  const code = typeof x?.code === "string" ? x.code : typeof x?.name === "string" ? x.name : "unknown";
  const kind = adapterKind(e);
  return kind ? `${code} ${kind}` : code;
};

/** Record a database-unreachable error (logged at most once a minute so an outage does not flood the log) */
export function noteDbDown(e: unknown) {
  const h = health();
  const now = Date.now();
  if (!h.down) h.since = now;
  h.down = true;
  h.code = codeOf(e);
  h.checkedAt = now;
  if (now - h.loggedAt > 60_000) {
    h.loggedAt = now;
    console.error(`⚠ database unavailable (${h.code}, ${dbKind} ${safeTarget()}): pages show a maintenance notice until it recovers. ${e instanceof Error ? e.message.trim().split("\n").pop() : ""}`);
  }
}

function noteDbUp() {
  const h = health();
  if (h.down) console.log(`✓ database reachable again (was down since ${new Date(h.since ?? Date.now()).toISOString()})`);
  h.down = false;
  h.since = null;
  h.code = null;
  h.checkedAt = Date.now();
}

/** Run a query; if the database is unreachable, return `fallback` instead of failing the page */
export async function withDbFallback<T, F>(fn: () => Promise<T>, fallback: F): Promise<{ value: T | F; dbDown: boolean }> {
  try {
    const value = await fn();
    return { value, dbDown: false };
  } catch (e) {
    if (!isDbDown(e)) throw e;
    noteDbDown(e);
    return { value: fallback, dbDown: true };
  }
}

/** Connection target without credentials, for admins: "postgres db.example.com:5432/sinobee" or the SQLite file */
export function safeTarget(): string {
  try {
    const t = dbTarget();
    if (t.kind === "sqlite") return t.file;
    const u = new URL(t.url);
    return `${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`;
  } catch {
    return "(invalid DATABASE_URL)";
  }
}

/** Cheap availability check (cached 5 s while up, 2 s while down; one ping in flight at a time; 3 s timeout) */
export async function dbAvailable(): Promise<boolean> {
  const h = health();
  if (Date.now() - h.checkedAt < (h.down ? 2_000 : 5_000)) return !h.down;
  g.__sbDbPing ??= (async () => {
    try {
      await Promise.race([
        db.$queryRawUnsafe("SELECT 1"),
        new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("Timeout exceeded when trying to connect"), { code: "P1001" })), 3_000).unref?.()),
      ]);
      noteDbUp();
      return true;
    } catch (e) {
      noteDbDown(isDbDown(e) ? e : Object.assign(new Error(String((e as Error)?.message ?? e)), { code: codeOf(e) }));
      return false;
    } finally {
      g.__sbDbPing = undefined;
    }
  })();
  return g.__sbDbPing;
}

/** Details shown to admins only */
export function dbOutage() {
  const h = health();
  return { since: h.since, code: h.code, kind: dbKind, target: safeTarget() };
}
