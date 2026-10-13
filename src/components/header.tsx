"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";

const NAV = [
  { href: "/download", key: "download" },
  { href: "/skills", key: "skills" },
  { href: "/tasks", key: "tasks" },
  { href: "/benchmarks", key: "benchmarks" },
  { href: "/pricing", key: "pricing" },
] as const;

export function Header() {
  const t = useTranslations("nav");
  const path = usePathname();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const active = (h: string) => path === h || path.startsWith(h + "/");
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="container-x flex h-16 items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-accent">
          <Logo />
          <span className="text-lg tracking-tight">SinoBee<span className="text-muted">.ai</span></span>
        </Link>
        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition hover:text-accent ${active(n.href) ? "text-accent" : "text-ink/80"}`}
            >
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href={path} locale={locale === "zh-TW" ? "en" : "zh-TW"} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted hover:text-accent" aria-label="language">
            {locale === "zh-TW" ? "EN" : "中文"}
          </Link>
          <UserMenu />
          <button className="rounded-lg p-2 md:hidden" onClick={() => setOpen(!open)} aria-label="menu">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="container-x flex flex-col pb-3 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-lg px-2 py-2 text-sm">
              {t(n.key)}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
