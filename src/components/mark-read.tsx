"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function MarkAllRead() {
  const t = useTranslations("notifications");
  const router = useRouter();
  return (
    <button
      className="btn-ghost !py-2"
      onClick={async () => {
        await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }) });
        router.refresh();
      }}
    >
      {t("markAll")}
    </button>
  );
}
