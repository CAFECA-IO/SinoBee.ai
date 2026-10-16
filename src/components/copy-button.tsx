"use client";

import { useState } from "react";
import { Icon } from "./icon";

/** Icon-only copy button; the label shows as a tooltip. */
export function CopyButton({ text, label, done, className = "" }: { text: string; label: string; done: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={ok ? done : label}
      className={`icon-btn !h-8 !w-8 ${className}`}
      onClick={() => navigator.clipboard.writeText(text).then(() => (setOk(true), setTimeout(() => setOk(false), 1500)))}
    >
      <Icon name={ok ? "check" : "copy"} className="h-4 w-4" />
    </button>
  );
}
