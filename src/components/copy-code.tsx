"use client";

import { useState } from "react";

export function CopyCode({ code, lang }: { code: string; lang?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="group relative">
      <pre className="codeblock pr-12" data-lang={lang}>
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(code).then(() => (setOk(true), setTimeout(() => setOk(false), 1500)))}
        className="absolute right-2 top-2 rounded-lg border border-line bg-panel px-2 py-1 text-xs text-muted hover:text-accent"
        aria-label="copy"
      >
        {ok ? "✓" : "Copy"}
      </button>
    </div>
  );
}
