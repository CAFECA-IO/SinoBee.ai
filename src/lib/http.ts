import { NextResponse } from "next/server";
import { HttpError, errText, reqLang } from "./errors";
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
      if (e instanceof HttpError) return json({ error: errText(e, reqLang(a[0])) }, e.status);
      if (e instanceof ZodError) {
        // the pages show issues[0].message; Zod writes English, so Chinese readers get the field name and a plain sentence
        const zh = reqLang(a[0]) === "zh";
        const issues = zh ? e.issues.map((i) => ({ ...i, detail: i.message, message: i.path.length ? `「${i.path.join(".")}」的值不正確` : "送出的資料格式不正確" })) : e.issues;
        return json({ error: "invalid_request", issues }, 400);
      }
      if (isDbDown(e)) {
        noteDbDown(e);
        return json({ error: "db_unavailable" }, { status: 503, headers: { "retry-after": "30" } });
      }
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  };
}
