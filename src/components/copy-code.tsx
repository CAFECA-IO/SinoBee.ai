"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "./icon";

export function CopyCode({ code, lang }: { code: string; lang?: string }) {
  const t = useTranslations("common");
  const [ok, setOk] = useState(false);
  return (
    <div className="group relative">
      <pre className="codeblock pr-12" data-lang={lang}>
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(code).then(() => (setOk(true), setTimeout(() => setOk(false), 1500)))}
        className="icon-btn outline tip-end !absolute right-2 top-2 !h-8 !w-8"
        aria-label={t("copy")}
        data-tip={ok ? t("copied") : t("copy")}
      >
        <Icon name={ok ? "check" : "copy"} className="h-4 w-4" />
      </button>
    </div>
  );
}
