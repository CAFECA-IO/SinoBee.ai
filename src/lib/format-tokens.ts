/** Approximate token counts for quota displays: 83 萬 / 7,271 萬 / 1.2 億 (zh) or 830K / 72.7M (en) */
export function formatTokens(n: number, locale: string): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (locale.startsWith("zh")) {
    if (n >= 1e8) return `${(n / 1e8).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 億`;
    if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString("zh-TW")} 萬`;
    return Math.round(n).toLocaleString("zh-TW");
  }
  if (n >= 1e9) return `${(n / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("en-US")}K`;
  return Math.round(n).toLocaleString("en-US");
}

/** TWD of quota → tokens of a model whose blended price is `blendedTwdPer1M` */
export const quotaTokens = (twd: number, blendedTwdPer1M: number) => (blendedTwdPer1M > 0 ? (twd / blendedTwdPer1M) * 1e6 : 0);
