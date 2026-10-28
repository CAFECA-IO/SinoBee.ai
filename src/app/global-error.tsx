"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import "./globals.css";

/**
 * Last-resort error page: replaces the root layout when the layout itself (header, providers) or the client app
 * crashes, so it has no translations or header of its own. Locale comes from the path (/en…), copy is inline.
 * The database status is asked once so an outage still reads as maintenance rather than a crash.
 */
const COPY = {
  "zh-TW": {
    title: "頁面暫時無法顯示",
    body: "我們已記錄這個問題，請重新整理再試一次。",
    dbTitle: "系統維護中",
    dbBody: "部分資料暫時無法載入，我們正在處理，請稍後再試。",
    reload: "重新整理",
    home: "回首頁",
  },
  en: {
    title: "This page can't be shown right now",
    body: "The problem has been logged. Please reload and try again.",
    dbTitle: "Under maintenance",
    dbBody: "Some data can't be loaded right now. We're on it; please try again shortly.",
    reload: "Reload",
    home: "Home",
  },
} as const;

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale, setLocale] = useState<"zh-TW" | "en">("zh-TW");
  const [dbDown, setDbDown] = useState(false);

  useEffect(() => {
    console.error(error);
    if (/^\/en(\/|$)/.test(window.location.pathname)) setLocale("en");
    let alive = true;
    fetch("/api/site", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { db?: { ok?: boolean } } | null) => alive && setDbDown(s?.db?.ok === false))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [error]);

  const t = COPY[locale];
  const home = locale === "en" ? "/en" : "/";
  return (
    <html lang={locale === "en" ? "en" : "zh-Hant-TW"}>
      <body className="min-h-screen">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-line">
            <div className="container-x flex h-16 items-center">
              {/* a full page load, not client navigation: the client app is what failed */}
              <a href={home} className="flex items-center gap-2 font-bold text-accent">
                <Logo />
                <span className="text-lg tracking-tight">SinoBee<span className="text-muted">.ai</span></span>
              </a>
            </div>
          </header>
          <main className="container-x flex flex-1 items-center justify-center py-16">
            <div className="card w-full max-w-lg p-8 text-center">
              <h1 className="text-2xl font-bold tracking-tight">{dbDown ? t.dbTitle : t.title}</h1>
              <p className="mt-3 text-sm leading-relaxed text-muted">{dbDown ? t.dbBody : t.body}</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
                  {t.reload}
                </button>
                <a href={home} className="btn-ghost">
                  {t.home}
                </a>
              </div>
              {!dbDown && error.digest && <p className="mt-4 font-mono text-xs text-muted">{error.digest}</p>}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
