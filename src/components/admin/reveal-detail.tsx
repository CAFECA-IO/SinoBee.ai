"use client";

import { useEffect } from "react";

/**
 * Below 1280px the detail panel sits under the list, often off screen; when one opens
 * (its key changes), bring it into view. Wide screens show it beside the list already.
 */
export function RevealDetail({ id, k }: { id: string; k: string }) {
  useEffect(() => {
    if (window.matchMedia("(min-width: 1280px)").matches) return;
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.6 || top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [id, k]);
  return null;
}
