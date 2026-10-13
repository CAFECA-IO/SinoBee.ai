import { config } from "./config";

/** TWDC amounts are handled as strings/decimals with 6 fractional digits. */
export const TWDC_SCALE = 1_000_000n;

export function toBase(amount: string | number, decimals = config.payments.decimals): bigint {
  const s = typeof amount === "number" ? amount.toFixed(decimals) : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("invalid amount");
  const [i, f = ""] = s.split(".");
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function fromBase(base: bigint, decimals = config.payments.decimals): string {
  const d = 10n ** BigInt(decimals);
  const i = base / d;
  const f = (base % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : i.toString();
}

export function fmtTwdc(v: number | string | { toString(): string }, digits = 2): string {
  const n = Number(v.toString());
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtUsd(v: number | string | { toString(): string }, digits = 4): string {
  const n = Number(v.toString());
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
}
