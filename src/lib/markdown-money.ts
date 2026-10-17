/** NT$500, US$5: a $ glued to a word is money, not the start of a formula (code is left alone) */
export function escapeMoney(md: string): string {
  return md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/(?<=[A-Za-z0-9])\$(?=\d)/g, "\\$")))
    .join("");
}
