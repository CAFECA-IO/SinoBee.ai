import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export const LEGAL_DOCS = ["terms", "privacy", "refunds"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

/** Policy text from src/content/legal/<doc>.<locale>.md with the site's details filled in */
export async function legalText(doc: LegalDoc, locale: string): Promise<string> {
  const loc = locale.startsWith("zh") ? "zh-TW" : "en";
  const raw = await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "src/content/legal", `${doc}.${loc}.md`), "utf8");
  const L = config.legal;
  const zh = loc === "zh-TW";
  const contact = [
    `- ${zh ? "公司" : "Company"}：${L.entity}${L.taxId ? `（${zh ? "統一編號" : "tax ID"} ${L.taxId}）` : ""}`,
    L.address ? `- ${zh ? "地址" : "Address"}：${L.address}` : "",
    `- Email：${L.email ? `[${L.email}](mailto:${L.email})` : zh ? "（客服信箱待公告）" : "(support email to be announced)"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const vars: Record<string, string> = {
    site: "SinoBee.ai",
    entity: L.entity,
    contact,
    graceDays: String(config.subscription.graceDays),
    freeDays: String(config.retention.freeDays),
  };
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}
