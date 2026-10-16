import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../db";
import { HttpError } from "../errors";
import { audit } from "../roles";
import { isSealed, keyFile, keyFingerprint, open, seal } from "./box";
import { resolve, settingsCache } from "./cache";
import { GROUPS, PAYMENT_PROVIDERS, SETTING, SETTINGS, type SettingDef } from "./registry";

const PREFIX = "cfg.";
/** values earlier .env.example files shipped with; importing them would override better defaults */
const STALE_EXAMPLE_VALUES: Record<string, string> = { LEGAL_ENTITY: "CAFECA", PAYMENT_MODE: "chain" };
/** variables from earlier versions that nothing reads any more (TWDC payments, the old subscription, …) */
const OBSOLETE = new Set(["TREASURY_ADDRESS", "TWDC_ADDRESS", "TWDC_DECIMALS", "MIN_TASK_BUDGET_TWDC", "MIN_TOPUP_TWDC", "USD_TWD_RATE", "SUBSCRIPTION_PRICE_TWDC", "SUBSCRIPTION_DAYS", "RUNNER_PASS_ENV"]);
const g = globalThis as unknown as { __sbSettingsTimer?: NodeJS.Timeout };

/** Read every stored setting into the in-memory cache (decrypting secrets). Safe to call repeatedly. */
export async function loadSettings({ refreshEveryMs = 30_000 }: { refreshEveryMs?: number } = {}) {
  const rows = await db.siteSetting.findMany({ where: { key: { startsWith: PREFIX } } });
  const values = new Map<string, string>();
  for (const r of rows) {
    const key = r.key.slice(PREFIX.length);
    if (!SETTING[key]) continue;
    try {
      values.set(key, open(r.value));
    } catch (e) {
      console.error(`setting ${key} could not be decrypted (wrong ${keyFile()} / SECRETS_KEY?): ${(e as Error).message}`);
    }
  }
  const c = settingsCache();
  c.values = values;
  c.loadedAt = Date.now();
  if (refreshEveryMs > 0 && !g.__sbSettingsTimer) {
    g.__sbSettingsTimer = setInterval(() => void loadSettings({ refreshEveryMs: 0 }).catch(() => undefined), refreshEveryMs);
    g.__sbSettingsTimer.unref?.();
  }
  return values.size;
}

function generate(kind: NonNullable<SettingDef["generate"]>): string {
  if (kind === "hex32") return randomBytes(32).toString("hex");
  if (kind === "evm-key") return "0x" + randomBytes(32).toString("hex");
  return generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}

async function write(key: string, value: string) {
  const def = SETTING[key];
  const stored = def.type === "secret" ? seal(value) : value;
  await db.siteSetting.upsert({ where: { key: PREFIX + key }, create: { key: PREFIX + key, value: stored }, update: { value: stored } });
  settingsCache().values.set(key, value);
}

/** Create keys and passwords that are still empty (hub signing key, Boltchain master key and site wallet) */
export async function generateMissing(log: (s: string) => void = console.log) {
  const made: string[] = [];
  for (const d of SETTINGS) {
    if (!d.generate || resolve(d.key).source !== "unset") continue;
    await write(d.key, generate(d.generate));
    made.push(d.key);
  }
  if (made.length) {
    await audit(null, "settings.generated", { type: "site", id: "settings" }, { keys: made });
    log(`generated ${made.join(", ")} (encrypted in the database)`);
  }
  return made;
}

function validate(def: SettingDef, raw: string): string {
  const v = raw.trim();
  if (v === "") return "";
  switch (def.type) {
    case "number":
      if (!Number.isFinite(Number(v))) throw new HttpError(400, `${def.key} must be a number`);
      return String(Number(v));
    case "bool":
      return ["1", "true", "yes", "on"].includes(v.toLowerCase()) ? "1" : "0";
    case "url":
      try {
        const u = new URL(v);
        if (!["http:", "https:"].includes(u.protocol)) throw new Error();
      } catch {
        throw new HttpError(400, `${def.key} must be an http(s) URL`);
      }
      return v.replace(/\/$/, "");
    case "select":
      if (def.options && !def.options.includes(v)) throw new HttpError(400, `${def.key} must be one of ${def.options.join(", ")}`);
      return v;
    case "list": {
      const items = v.split(/[\s,]+/).filter(Boolean);
      if (def.options) for (const i of items) if (!def.options.includes(i)) throw new HttpError(400, `${def.key}: unknown value ${i}`);
      return items.join(",");
    }
    case "secret":
      if (v.length > 8192) throw new HttpError(400, `${def.key} is too long`);
      return v;
    default:
      if (v.length > 2000) throw new HttpError(400, `${def.key} is too long`);
      return v;
  }
}

/** Save (or clear with "") one setting. Values set in the process environment cannot be changed here. */
export async function saveSetting(actorId: string, key: string, raw: string) {
  const def = SETTING[key];
  if (!def) throw new HttpError(404, `unknown setting ${key}`);
  if (resolve(key).source === "env") throw new HttpError(409, `${key} is set by the environment variable ${def.env}; change it there`);
  const value = validate(def, raw);
  if (key === "hub.signingKey" && value) {
    try {
      createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
    } catch {
      throw new HttpError(400, "hub.signingKey must be a base64 PKCS8 DER ed25519 key");
    }
  }
  if (value === "") {
    await db.siteSetting.deleteMany({ where: { key: PREFIX + key } });
    settingsCache().values.delete(key);
  } else await write(key, value);
  await audit(actorId, value === "" ? "settings.clear" : "settings.update", { type: "setting", id: key }, def.type === "secret" ? { secret: true } : { value });
}

/** Rotate the skill signing key; the old public key stays published so existing signatures keep verifying */
export async function rotateHubKey(actorId: string) {
  if (resolve("hub.signingKey").source === "env") throw new HttpError(409, "hub.signingKey is set by HUB_SIGNING_KEY");
  const old = hubPublicKey();
  const prev = new Set(resolve("hub.previousKeys").value.split(",").filter(Boolean));
  if (old) prev.add(old);
  await write("hub.previousKeys", [...prev].join(","));
  await write("hub.signingKey", generate("ed25519-pkcs8"));
  await audit(actorId, "settings.rotate", { type: "setting", id: "hub.signingKey" }, { previous: old, current: hubPublicKey() });
}

export function hubPublicKey(): string | null {
  const k = resolve("hub.signingKey").value;
  if (!k) return null;
  try {
    const spki = createPublicKey(createPrivateKey({ key: Buffer.from(k, "base64"), format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" });
    return Buffer.from(spki.subarray(spki.length - 32)).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Move settings out of a .env file into the database: every registered variable with a value is stored (secrets
 * encrypted) unless the database already has one, then commented out in the file (a backup is kept next to it).
 * Values exported in the shell are left alone. Returns the variables moved.
 */
export async function importEnvFile(file: string, log: (s: string) => void = console.log): Promise<string[]> {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const byEnv = new Map(SETTINGS.filter((d) => d.env).map((d) => [d.env!, d]));
  const moved: string[] = [];
  const out: string[] = [];
  let tidied = 0;
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    const def = m ? byEnv.get(m[1]) : undefined;
    const value = m ? m[2].trim().replace(/^["']|["']$/g, "") : "";
    if (m && OBSOLETE.has(m[1])) {
      out.push(`# ${m[1]} → no longer used`);
      if (process.env[m[1]] === value) delete process.env[m[1]];
      tidied++;
      continue;
    }
    if (!m || !def) {
      out.push(line);
      continue;
    }
    if (value === "") {
      // an empty placeholder: the setting is edited in /admin now
      out.push(`# ${m[1]} → /admin → Settings`);
      tidied++;
      continue;
    }
    // placeholders copied from an old .env.example, and values equal to the default, are not stored
    const skip = STALE_EXAMPLE_VALUES[m[1]] === value || def.default === value;
    if (!skip && !settingsCache().values.has(def.key)) {
      try {
        await write(def.key, validate(def, value));
      } catch (e) {
        log(`${m[1]}: ${(e as Error).message}; left in ${file}`);
        out.push(line);
        continue;
      }
    }
    // dotenv put it into process.env; drop it so the database value is used (and editable) from now on
    if (process.env[m[1]] === value) delete process.env[m[1]];
    out.push(`# ${m[1]} → moved to the database (/admin → Settings)`);
    moved.push(m[1]);
  }
  if (moved.length || tidied) {
    copyFileSync(file, `${file}.bak-${Date.now()}`);
    writeFileSync(file, out.join("\n"), { mode: 0o600 });
    await audit(null, "settings.import-env", { type: "site", id: "settings" }, { variables: moved });
    log(`${file}: moved ${moved.length} settings into the database${moved.length ? ` (${moved.join(", ")})` : ""}, removed ${tidied} empty or obsolete lines; the old file was kept as a backup`);
  }
  return moved;
}

// ───────────── admin view ─────────────

export type SettingView = {
  key: string;
  group: string;
  provider?: string;
  type: SettingDef["type"];
  label: SettingDef["label"];
  help?: SettingDef["help"];
  options?: string[];
  restart?: boolean;
  generated?: boolean;
  env?: string;
  source: "env" | "db" | "default" | "unset";
  /** non-secret value, or "" */
  value: string;
  /** secrets: whether one is set, and its last 4 characters for recognition */
  secretSet?: boolean;
  hint?: string;
  /** shown next to generated keys */
  derived?: string;
  required?: boolean;
};

export function settingsForAdmin(): { groups: typeof GROUPS; providers: typeof PAYMENT_PROVIDERS; items: SettingView[]; keyFile: string; fingerprint: string } {
  const items = SETTINGS.map((d): SettingView => {
    const r = resolve(d.key);
    const secret = d.type === "secret";
    let derived: string | undefined;
    if (d.key === "hub.signingKey") derived = hubPublicKey() ?? undefined;
    if (d.key === "boltchain.walletKey" && /^0x[0-9a-fA-F]{64}$/.test(r.value)) derived = privateKeyToAccount(r.value as `0x${string}`).address;
    return {
      key: d.key, group: d.group, provider: d.provider, type: d.type, label: d.label, help: d.help, options: d.options, restart: d.restart, generated: !!d.generate, env: d.env, required: d.required,
      source: r.source,
      value: secret ? "" : r.value,
      secretSet: secret ? !!r.value : undefined,
      hint: secret && r.value && !d.generate ? `••••${r.value.slice(-4)}` : undefined,
      derived,
    };
  });
  return { groups: GROUPS, providers: PAYMENT_PROVIDERS, items, keyFile: process.env.SECRETS_KEY ? "SECRETS_KEY" : keyFile(), fingerprint: keyFingerprint() };
}

export { isSealed };
