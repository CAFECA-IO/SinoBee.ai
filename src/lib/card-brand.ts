/** Card networks the payment pages can name. */
export const CARD_BRANDS = ["visa", "mastercard", "jcb", "amex", "unionpay", "diners", "discover"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const CARD_BRAND_NAMES: Record<CardBrand, string> = {
  visa: "VISA",
  mastercard: "Mastercard",
  jcb: "JCB",
  amex: "AMEX",
  unionpay: "UnionPay",
  diners: "Diners",
  discover: "Discover",
};

const BY_NAME: [RegExp, CardBrand][] = [
  [/visa/i, "visa"],
  [/master/i, "mastercard"],
  [/jcb/i, "jcb"],
  [/amex|american\s*express/i, "amex"],
  [/union\s*pay|cup|銀聯/i, "unionpay"],
  [/diners/i, "diners"],
  [/discover/i, "discover"],
];

/**
 * The card network from what the payment gateway tells us about a saved card: a network name ("VISA", "MasterCard",
 * "銀聯"…) or a masked number that keeps its first digits ("424242******4242"). Null when it cannot tell (e.g. only
 * the last four digits).
 */
export function cardBrand(...hints: unknown[]): CardBrand | null {
  for (const h of hints) {
    if (typeof h !== "string" || !h.trim()) continue;
    for (const [re, b] of BY_NAME) if (re.test(h)) return b;
    const lead = h.trim().match(/^\d{2,}/)?.[0];
    // a bare 4-digit value is the last four digits, not the start of the number
    if (!lead || (lead.length <= 4 && /^\d+$/.test(h.trim()))) continue;
    const n = (k: number) => Number(lead.slice(0, k));
    if (lead[0] === "4") return "visa";
    if ((n(2) >= 51 && n(2) <= 55) || (lead.length >= 4 && n(4) >= 2221 && n(4) <= 2720)) return "mastercard";
    if (n(2) === 34 || n(2) === 37) return "amex";
    if (lead.length >= 4 && n(4) >= 3528 && n(4) <= 3589) return "jcb";
    if (n(2) === 62) return "unionpay";
    if (n(2) === 36 || n(2) === 38 || n(2) === 39 || (n(2) === 30 && lead.length >= 3 && n(3) <= 305)) return "diners";
    if ((lead.length >= 4 && n(4) === 6011) || n(2) === 65 || (lead.length >= 3 && n(3) >= 644 && n(3) <= 649)) return "discover";
  }
  return null;
}

export const isCardBrand = (s: unknown): s is CardBrand => typeof s === "string" && (CARD_BRANDS as readonly string[]).includes(s);
