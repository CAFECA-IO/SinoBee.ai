import { createHash } from "node:crypto";
import { db } from "./db";
import { config } from "./config";
import { LEGAL_DOCS, legalText, type LegalDoc } from "./legal";

/**
 * Every text of the legal documents (terms, privacy, refunds, crowdfunding terms with the screening checklist) is
 * kept as the exact markdown shown on the site and notarized on Boltchain: a new version is recorded whenever the
 * rendered text changes (settings, a new checklist, a code update), and its SHA-256 is anchored with the
 * Certificates contract. The legal pages show the BOLTCHAIN badge with the certificate link and offer the markdown
 * so anyone can check the hash against the certificate.
 */

export const LEGAL_LOCALES = ["zh-TW", "en"] as const;

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Record (and queue for notarization) the current text of one document; returns its version row */
export async function snapshotLegal(doc: LegalDoc, locale: string) {
  const loc = locale.startsWith("zh") ? "zh-TW" : "en";
  const markdown = await legalText(doc, loc);
  const hash = sha256(markdown);
  let row = await db.legalVersion.findUnique({ where: { doc_locale_sha256: { doc, locale: loc, sha256: hash } } });
  if (!row) {
    const last = await db.legalVersion.findFirst({ where: { doc, locale: loc }, orderBy: { version: "desc" } });
    try {
      row = await db.legalVersion.create({ data: { doc, locale: loc, version: (last?.version ?? 0) + 1, markdown, sha256: hash } });
    } catch {
      row = await db.legalVersion.findUniqueOrThrow({ where: { doc_locale_sha256: { doc, locale: loc, sha256: hash } } });
    }
  }
  if (!row.anchorCode && config.boltchain.enabled) {
    const { requestAnchor } = await import("./boltchain/keeper");
    const { hashFile } = await import("./boltchain/certificates");
    await requestAnchor("legal", row.id, [hashFile(new TextEncoder().encode(markdown))]).catch((e) => console.warn("legal anchor", (e as Error).message));
  }
  return row;
}

export async function snapshotAllLegal() {
  const rows = [];
  for (const doc of LEGAL_DOCS) for (const loc of LEGAL_LOCALES) rows.push(await snapshotLegal(doc, loc));
  return rows;
}

/** Certificate state of a version for the page: issued code, or pending when Boltchain is on */
export async function legalCertificate(versionId: string) {
  const row = await db.legalVersion.findUnique({ where: { id: versionId } });
  if (row?.anchorCode) return { code: row.anchorCode, pending: false };
  const anchor = await db.anchor.findUnique({ where: { targetType_targetId: { targetType: "legal", targetId: versionId } } });
  return { code: anchor?.code ?? null, pending: !!anchor && anchor.status !== "issued" };
}
