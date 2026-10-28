import { NextResponse } from "next/server";
import { HttpError } from "./errors";
import { ZodError } from "zod";
import { isDbDown, noteDbDown } from "./db-health";

export const json = (v: unknown, init?: number | ResponseInit) =>
  NextResponse.json(v, typeof init === "number" ? { status: init } : init);

/** Wrap a route handler: maps HttpError/ZodError to JSON errors */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof ZodError) return json({ error: "invalid_request", issues: e.issues }, 400);
      if (isDbDown(e)) {
        noteDbDown(e);
        return json({ error: "db_unavailable" }, { status: 503, headers: { "retry-after": "30" } });
      }
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  };
}
