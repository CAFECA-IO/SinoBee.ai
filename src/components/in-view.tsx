"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Sets data-on once the block scrolls into view, so CSS can play its entrance animation once. */
export function InView({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setOn(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={className} data-on={on ? "" : undefined}>{children}</div>;
}
