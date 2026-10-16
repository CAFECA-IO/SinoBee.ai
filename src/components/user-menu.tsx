"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useCafeca } from "./cafeca-provider";
import { Icon, type IconName } from "./icon";

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

  if (!ready) return <div className="h-9 w-9 animate-pulse rounded-xl bg-panel-2" />;
  if (!me)
    return (
      <Link href="/login" aria-label={t("login")} data-tip={t("login")} className="icon-btn outline tip-end">
        <Icon name="login" />
      </Link>
    );
  const who = me.handle ? `@${me.handle}` : short(me.account);
  return (
    <div className="relative flex items-center gap-1" ref={ref}>
      <Link href="/notifications" className="icon-btn" aria-label={t("notifications")} data-tip={t("notifications")}>
        <Icon name="bell" />
        {unread > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-err px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
      </Link>
      <button onClick={() => setOpen(!open)} className={`icon-btn outline tip-end ${open ? "on" : ""}`} aria-label={who} data-tip={open ? undefined : who} aria-expanded={open}>
        <Icon name="user" />
      </button>
      {open && (
        <div className="card absolute right-0 top-11 z-50 w-56 p-1.5 shadow-xl">
          <div className="truncate px-3 pb-1.5 pt-1 font-mono text-xs text-muted">{who}</div>
          {([
            ["/account", t("account"), "user"],
            ["/tasks?mine=1", t("myTasks"), "task"],
            ["/notifications", t("notifications"), "bell"],
            ...(me.isAdmin ? [["/admin", t("admin"), "shield"]] : []),
          ] as [string, string, IconName][]).map(([href, label, icon]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-panel-2">
              <Icon name={icon} className="h-4 w-4 text-muted" /> {label}
            </Link>
          ))}
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-err hover:bg-panel-2"
            onClick={async () => {
              await logout();
              setOpen(false);
              router.refresh();
            }}
          >
            <Icon name="logout" className="h-4 w-4" /> {t("logout")}
          </button>
        </div>
      )}
    </div>
  );
}
