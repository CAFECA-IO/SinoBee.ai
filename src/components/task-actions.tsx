"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function AutoRefresh({ taskId, status }: { taskId: string; status: string }) {
  const router = useRouter();
  useEffect(() => {
    let last = "";
    const id = setInterval(async () => {
      const j = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (!j) return;
      const sig = `${j.status}|${j.charged}|${j.updatedAt}`;
      if (last && sig !== last) router.refresh();
      last = sig;
      if (j.status !== status && !["SCREENING", "QUEUED", "RUNNING", "CHARGING"].includes(j.status)) router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [taskId, status, router]);
  return null;
}

export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return <span>…</span>;
  const ms = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return <span className="font-mono">{d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`}</span>;
}
