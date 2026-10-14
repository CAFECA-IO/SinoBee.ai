"use client";

import { useEffect, useRef } from "react";

/** Renders ```mermaid code blocks inside its children (mermaid is loaded only when one is present) */
export function MermaidBlocks({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const blocks = ref.current ? Array.from(ref.current.querySelectorAll("code.language-mermaid")) : [];
    if (!blocks.length) return;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (!w.mermaid) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("mermaid"));
          document.head.appendChild(s);
        });
      }
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      w.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
      let n = 0;
      for (const code of blocks) {
        if (cancelled) return;
        try {
          const { svg } = await w.mermaid.render(`mmd-${Date.now()}-${n++}`, code.textContent ?? "");
          const div = document.createElement("div");
          div.className = "my-3 overflow-x-auto";
          div.innerHTML = svg;
          (code.closest("pre") ?? code).replaceWith(div);
        } catch {
          /* leave the source visible */
        }
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return <div ref={ref}>{children}</div>;
}
