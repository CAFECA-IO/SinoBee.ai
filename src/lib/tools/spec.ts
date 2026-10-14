import { createHash } from "node:crypto";
import { z } from "zod";
import { NAME_RE, VERSION_RE } from "../skills/spec";

/**
 * TOOL.json — a tool registered from SinoBee (today: database browsers).
 * It describes what to connect to and how, never who: user names, passwords, tokens and DSNs with
 * credentials are rejected. Private tools may keep their credentials in the owner's end-to-end
 * encrypted vault (VaultPack), which the server cannot read.
 */
export const TOOL_SCHEMA = "sinobee.tool/v1";

const column = z.object({ name: z.string().max(128), type: z.string().max(64).optional() });
const table = z.object({ schema: z.string().max(128).optional(), name: z.string().max(128), columns: z.array(column).max(200).optional() });

export const toolManifest = z
  .object({
    schema: z.literal(TOOL_SCHEMA),
    name: z.string().regex(NAME_RE, "lowercase letters, digits and dashes").max(64),
    version: z.string().regex(VERSION_RE, "semver, e.g. 1.0.0"),
    kind: z.literal("database"),
    title: z.string().trim().min(1).max(80),
    description: z.string().max(2000).default(""),
    database: z
      .object({
        engine: z.enum(["postgres", "mysql", "sqlite"]),
        host: z.string().max(253).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        database: z.string().max(128).optional(),
        sslmode: z.enum(["disable", "prefer", "require", "verify-ca", "verify-full"]).optional(),
        /** sqlite: file name only (the path stays on the owner's machine) */
        file: z.string().max(255).optional(),
        readOnly: z.boolean().default(true),
        rowLimit: z.number().int().min(1).max(10000).default(500),
        timeoutS: z.number().int().min(1).max(600).default(30),
      })
      .strict(),
    /** optional schema snapshot so agents know the tables before connecting */
    tables: z.array(table).max(500).optional(),
    /** saved read-only queries */
    queries: z.array(z.object({ title: z.string().max(120), sql: z.string().max(4000) })).max(50).optional(),
    /** notes on tables / columns: {"schema.table": "…", "schema.table.column": "…"} */
    notes: z.record(z.string().max(300), z.string().max(1000)).optional(),
    /** SKILL.md telling an agent how to use this database (Agent Skills format) */
    skill: z.string().max(20000).optional(),
    /** vault pack holding this tool's connection settings + credentials (private tools only) */
    vaultPack: z.string().regex(/^[a-z0-9:_-]{1,80}$/).optional(),
  })
  .strict();

export type ToolManifest = z.infer<typeof toolManifest>;

/** Canonical JSON (sorted keys) so the content hash does not depend on key order */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export const toolHash = (m: ToolManifest) => `sha256:${createHash("sha256").update(canonical(m)).digest("hex")}`;

const SECRET_KEY = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|credential|auth)/i;
const DSN_CRED = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;
const KEYLIKE = /\b(sk-[A-Za-z0-9]{16,}|sbh_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|.*\.local$|.*\.internal$)/i;

export type Finding = { level: "error" | "warning"; path: string; message: string };

/** Rejects anything that looks like a credential; warns about things that make no sense in public */
export function scanTool(m: ToolManifest, visibility: "PRIVATE" | "PUBLIC"): Finding[] {
  const out: Finding[] = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === "string") {
      if (DSN_CRED.test(v)) out.push({ level: "error", path: p, message: "contains a connection string with a password" });
      if (KEYLIKE.test(v)) out.push({ level: "error", path: p, message: "contains something that looks like a key or token" });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (SECRET_KEY.test(k)) out.push({ level: "error", path: `${p}.${k}`, message: "credentials are never part of a tool" });
        walk(x, `${p}.${k}`);
      }
  };
  walk(m, "$");
  if (visibility === "PUBLIC") {
    if (m.vaultPack) out.push({ level: "error", path: "$.vaultPack", message: "public tools cannot reference a private vault" });
    if (m.database.host && PRIVATE_HOST.test(m.database.host)) out.push({ level: "warning", path: "$.database.host", message: "private network address — other users will not be able to reach it" });
    if (m.database.engine === "sqlite") out.push({ level: "warning", path: "$.database.engine", message: "SQLite files stay on your machine; others need their own copy" });
    if (!m.database.readOnly) out.push({ level: "warning", path: "$.database.readOnly", message: "public tools are installed read-only" });
  }
  return out;
}
