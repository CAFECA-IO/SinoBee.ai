import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["zh-TW", "en"],
  defaultLocale: "zh-TW",
  localePrefix: "as-needed",
  // the site is Traditional Chinese first; English is opt-in via /en
  localeDetection: false,
});
