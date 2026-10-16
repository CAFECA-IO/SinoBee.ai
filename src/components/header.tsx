"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";
import { Icon, type IconName } from "./icon";
import { AGENT_URL } from "@/lib/links";

const NAV: { href: string; key: string; icon: IconName }[] = [
  { href: "/download", key: "download", icon: "download" },
  { href: "/skills", key: "skills", icon: "hub" },
  { href: "/tools", key: "tools", icon: "tool" },
  { href: "/shares", key: "shares", icon: "share" },
  { href: "/tasks", key: "tasks", icon: "task" },
  { href: "/benchmarks", key: "benchmarks", icon: "bench" },
  { href: "/pricing", key: "pricing", icon: "pricing" },
];

export function Header() {
  const t = useTranslations("nav");
  const path = usePathname();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const active = (h: string) => path === h || path.startsWith(h + "/");
  const other = locale === "zh-TW" ? "en" : "zh-TW";
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="container-x flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-accent">
          <Logo />
          <span className="text-lg tracking-tight">SinoBee<span className="text-muted">.ai</span></span>
        </Link>
        {/* icon menu: the label shows on hover / focus */}
        <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-label={t(n.key)} data-tip={t(n.key)}
              aria-current={active(n.href) ? "page" : undefined} className={`icon-btn ${active(n.href) ? "on" : ""}`}>
              <Icon name={n.icon} />
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <a href={AGENT_URL} target="_blank" rel="noopener" aria-label={t("tryAgent")} data-tip={t("tryAgent")} className="icon-btn solid">
            <Icon name="rocket" />
          </a>
          <Link href={path} locale={other} aria-label={other === "en" ? "English" : "中文"} data-tip={other === "en" ? "English" : "中文"} className="icon-btn">
            <Icon name="globe" />
          </Link>
          <UserMenu />
          <button className="icon-btn md:hidden" onClick={() => setOpen(!open)} aria-label={t("menu")} aria-expanded={open}>
            <Icon name="menu" />
          </button>
        </div>
      </div>
      {open && (
        /* touch screens have no hover, so the drawer shows icon + label */
        <nav className="container-x grid grid-cols-2 gap-1 pb-3 md:hidden">
          <a href={AGENT_URL} target="_blank" rel="noopener" className="col-span-2 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-sm font-semibold text-accent">
            <Icon name="rocket" /> {t("tryAgent")}
          </a>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
              className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${active(n.href) ? "bg-panel-2 text-accent" : ""}`}>
              <Icon name={n.icon} /> {t(n.key)}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
