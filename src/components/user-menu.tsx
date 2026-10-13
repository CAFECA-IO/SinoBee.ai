"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useCafeca } from "./cafeca-provider";

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function UserMenu() {
  const t = useTranslations("nav");
  const { ready, me, logout } = useCafeca();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!me) return;
    const load = () => fetch("/api/notifications").then((r) => (r.ok ? r.json() : { unread: 0 })).then((j) => setUnread(j.unread ?? 0)).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [me]);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (!ready) return <div className="h-9 w-24 animate-pulse rounded-xl bg-panel-2" />;
  if (!me)
    return (
      <Link href="/login" className="btn-primary whitespace-nowrap !py-2">
        <span className="hidden sm:inline">{t("login")}</span>
        <span className="sm:hidden">{t("loginShort")}</span>
      </Link>
    );
  return (
    <div className="relative flex items-center gap-1" ref={ref}>
      <Link href="/notifications" className="relative rounded-lg p-2 text-muted hover:text-accent" aria-label={t("notifications")}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-err px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
      </Link>
      <button onClick={() => setOpen(!open)} className="btn-ghost !px-3 !py-2 font-mono text-xs">
        {me.handle ? `@${me.handle}` : short(me.account)}
      </button>
      {open && (
        <div className="card absolute right-0 top-11 z-50 w-52 p-1.5 shadow-xl">
          {[
            ["/account", t("account")],
            ["/tasks?mine=1", t("myTasks")],
            ["/notifications", t("notifications")],
            ...(me.isAdmin ? [["/admin", t("admin")]] : []),
          ].map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-panel-2">
              {label}
            </Link>
          ))}
          <button
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-err hover:bg-panel-2"
            onClick={async () => {
              await logout();
              setOpen(false);
              router.refresh();
            }}
          >
            {t("logout")}
          </button>
        </div>
      )}
    </div>
  );
}
