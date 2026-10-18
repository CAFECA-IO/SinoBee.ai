"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** Starts the user's SinoBee container, then moves to the agent gateway */
export function AgentLauncher() {
  const t = useTranslations("agent");
  const [err, setErr] = useState("");
  const [round, setRound] = useState(0);
  const started = useRef(-1);
  useEffect(() => {
    if (started.current === round) return; // once per attempt (React may run effects twice in development)
    started.current = round;
    setErr("");
    void (async () => {
      try {
        const r = await fetch("/api/agent/start", { method: "POST" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        window.location.href = j.url;
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [round]);
  if (err)
    return (
      <div className="space-y-3">
        <p className="text-sm text-err" role="alert">
          {err}
        </p>
        <button className="btn-primary w-full" onClick={() => setRound((n) => n + 1)}>
          {t("retry")}
        </button>
      </div>
    );
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-accent-soft border-t-accent" aria-hidden="true" />
      <p className="text-sm text-muted">{t("starting")}</p>
    </div>
  );
}
