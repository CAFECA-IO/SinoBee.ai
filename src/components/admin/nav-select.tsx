"use client";

import { useRouter } from "@/i18n/navigation";

/** The admin sections as one menu on a phone (the side list does not fit there) */
export function AdminNavSelect({ groups, current, label }: { groups: { label: string; items: { id: string; label: string; href: string; count?: number }[] }[]; current: string; label: string }) {
  const router = useRouter();
  const all = groups.flatMap((g) => g.items);
  return (
    <label className="block lg:hidden">
      <span className="sr-only">{label}</span>
      <select
        className="input font-semibold"
        value={current}
        onChange={(e) => {
          const it = all.find((i) => i.id === e.target.value);
          if (it) router.push(it.href);
        }}
      >
        {groups.map((g, gi) => (
          <optgroup key={gi} label={g.label || label}>
            {g.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
                {i.count ? ` (${i.count})` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
