"use client";

import { useLocale } from "next-intl";

/** Local-time date rendered on the client (avoids server timezone confusion) */
export function LocalDate({ value, withTime = true }: { value: string | Date; withTime?: boolean }) {
  const locale = useLocale();
  const d = new Date(value);
  return (
    <time dateTime={d.toISOString()} suppressHydrationWarning>
      {d.toLocaleString(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" })}
    </time>
  );
}
