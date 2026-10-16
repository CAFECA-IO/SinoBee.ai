/** TWD amounts shown with two decimals */
export function fmtTwd(v: number | string | { toString(): string }, digits = 2): string {
  const n = Number(v.toString());
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtUsd(v: number | string | { toString(): string }, digits = 4): string {
  const n = Number(v.toString());
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
}
