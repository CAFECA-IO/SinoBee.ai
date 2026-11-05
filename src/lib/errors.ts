/** A message in both site languages. `.message` stays English (logs, tests). */
export type L10n = { zh: string; en: string };

export class HttpError extends Error {
  l?: L10n;
  constructor(public status: number, message: string | L10n) {
    super(typeof message === "string" ? message : message.en);
    if (typeof message !== "string") this.l = message;
  }
}

/**
 * Which language the caller reads. A page of this site sends its address as
 * the referer: /en/… → en, any other page → zh (the default locale has no
 * prefix). Without a referer, NEXT_LOCALE decides; with neither it is an API
 * client (the CLI), which gets English.
 */
export function reqLang(req: unknown): "zh" | "en" {
  const h = (req as { headers?: Headers } | undefined)?.headers;
  if (!h || typeof h.get !== "function") return "en";
  const ref = h.get("referer");
  if (ref) {
    try {
      return /^\/en(\/|$)/.test(new URL(ref).pathname) ? "en" : "zh";
    } catch {}
  }
  const m = /(?:^|;\s*)NEXT_LOCALE=([^;]+)/.exec(h.get("cookie") ?? "");
  if (m) return m[1].startsWith("en") ? "en" : "zh";
  return "en";
}

export function errText(e: { message: string; l?: L10n }, lang: "zh" | "en") {
  return e.l ? e.l[lang] : e.message;
}
