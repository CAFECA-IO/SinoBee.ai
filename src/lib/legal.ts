import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export const LEGAL_DOCS = ["terms", "privacy", "refunds", "crowd"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

/** Page of each document (/crowd is the crowdfunding directory, so its terms live at /crowd-terms) */
export const legalPath = (d: LegalDoc) => (d === "crowd" ? "/crowd-terms" : `/${d}`);

/** Policy text from src/content/legal/<doc>.<locale>.md with the site's details filled in */
export async function legalText(doc: LegalDoc, locale: string): Promise<string> {
  const loc = locale.startsWith("zh") ? "zh-TW" : "en";
  const raw = await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "src/content/legal", `${doc}.${loc}.md`), "utf8");
  const L = config.legal;
  const zh = loc === "zh-TW";
  const contact = [
    `- ${zh ? "公司" : "Company"}：${L.entity}${L.taxId ? `（${zh ? "統一編號" : "tax ID"} ${L.taxId}）` : ""}`,
    L.website ? `- ${zh ? "網站" : "Website"}：[${L.website.replace(/^https?:\/\//, "")}](${L.website})` : "",
    L.address ? `- ${zh ? "地址" : "Address"}：${L.address}` : "",
    `- Email：${L.email ? `[${L.email}](mailto:${L.email})` : zh ? "（客服信箱待公告）" : "(support email to be announced)"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const vars: Record<string, string> = {
    site: "SinoBee.ai",
    entity: L.website ? `[${L.entity}](${L.website})` : L.entity,
    contact,
    graceDays: String(config.subscription.graceDays),
    freeDays: String(config.retention.freeDays),
    ...(doc === "crowd" ? await crowdVars(loc) : {}),
  };
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

/** The crowdfunding terms embed the published screening checklist and the current crowdfunding numbers */
async function crowdVars(loc: string): Promise<Record<string, string>> {
  const { currentChecklist, checklistMarkdown } = await import("./crowd/checklist");
  const c = await currentChecklist();
  const fees = Object.entries(config.crowd.feeRates)
    .map(([d, r]) => (loc === "zh-TW" ? `${d} 天 ${+(r * 100).toFixed(2)}%` : `${d} days ${+(r * 100).toFixed(2)}%`))
    .join(loc === "zh-TW" ? "、" : ", ");
  return {
    checklist: checklistMarkdown(c, loc),
    checklistVersion: String(c.version),
    checklistCount: String(c.items.length),
    checklistDate: (c.publishedAt ?? new Date()).toISOString().slice(0, 10),
    sharePrice: String(Math.round(config.crowd.sharePrice)),
    proposalFee: String(Math.round(config.crowd.proposalFee)),
    feeRates: fees,
    reviewDays: String(config.crowd.reviewDays),
    exitHours: String(config.crowd.exitHours),
  };
}
