"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { LocalDate } from "./date";

type Dev = { id: string; name: string; platform: string | null; createdAt: string; lastSeenAt: string; scopes: string };

export function DeviceList({ devices }: { devices: Dev[] }) {
  const t = useTranslations("account");
  const router = useRouter();
  if (devices.length === 0) return <p className="text-sm text-muted">{t("noDevices")}</p>;
  return (
    <div className="space-y-2">
      {devices.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm">
          <span>
            <b>{d.name}</b> {d.platform && <span className="text-muted">· {d.platform}</span>}
            <span className="block font-mono text-xs text-muted">{d.scopes}</span>
          </span>
          <span className="text-xs text-muted">
            {t("signedIn")} <LocalDate value={d.createdAt} withTime={false} /> · {t("lastSeen")} <LocalDate value={d.lastSeenAt} />
          </span>
          <button
            className="text-xs text-err"
            onClick={async () => {
              await fetch(`/api/account/devices?id=${d.id}`, { method: "DELETE" });
              router.refresh();
            }}
          >
            {t("signOutDevice")}
          </button>
        </div>
      ))}
    </div>
  );
}
