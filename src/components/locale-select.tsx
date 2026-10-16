"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { Icon } from "./icon";

/** Short labels shown in the header; full names for screen readers */
const LOCALES: Record<(typeof routing.locales)[number], { short: string; name: string; lang: string }> = {
  "zh-TW": { short: "繁", name: "繁體中文", lang: "zh-Hant-TW" },
  en: { short: "En", name: "English", lang: "en" },
};

/** Language dropdown: 繁 / En. Keeps the current path and query string. */
export function LocaleSelect() {
  const locale = useLocale() as keyof typeof LOCALES;
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items = routing.locales;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const choose = (l: (typeof items)[number]) => {
    setOpen(false);
    if (l === locale) return;
    router.replace(`${path}${window.location.search}`, { locale: l });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Language: ${LOCALES[locale].name}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex h-9 items-center gap-1 rounded-xl border border-line bg-panel px-2 text-sm sm:px-2.5 font-semibold transition hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent ${open ? "border-accent text-accent" : "text-ink/80"}`}
      >
        <span lang={LOCALES[locale].lang}>{LOCALES[locale].short}</span>
        <svg viewBox="0 0 24 24" aria-hidden className={`hidden h-3.5 w-3.5 transition-transform sm:block duration-200 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul role="listbox" aria-label="Language" className="card absolute right-0 top-11 z-50 w-max min-w-40 p-1 shadow-xl">
          {items.map((l) => (
            <li key={l} role="option" aria-selected={l === locale}>
              <button
                type="button"
                autoFocus={l === locale}
                onClick={() => choose(l)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const btns = ref.current?.querySelectorAll<HTMLButtonElement>("ul button");
                    if (!btns) return;
                    const i = [...btns].indexOf(e.currentTarget);
                    btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
                  }
                }}
                className={`flex w-full items-center justify-between gap-4 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none ${l === locale ? "font-semibold text-accent" : ""}`}
              >
                <span lang={LOCALES[l].lang}>
                  <b className="mr-2 inline-block w-5">{LOCALES[l].short}</b>
                  <span className="text-muted">{LOCALES[l].name}</span>
                </span>
                {l === locale && <Icon name="check" className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
