/** margin (fee ÷ vendor cost) as a markup on cost, the way /admin words it: 1.5 → "獲利 50%", 0.72 → "虧損 28%" */
export const marginText = (m: number, t: (k: string, v: { p: number }) => string) =>
  !Number.isFinite(m) ? t("noCost", { p: 0 }) : m >= 1 ? t("profit", { p: Math.round((m - 1) * 100) }) : t("loss", { p: Math.round((1 - m) * 100) });
