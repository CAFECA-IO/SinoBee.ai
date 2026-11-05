/**
 * How each setting is edited (admin settings rework, 2026-11-05; design: the "操作元件" boards). Every setting is
 * edited with exactly one of the 16 controls below, chosen from its type and what is declared here: its unit and
 * range, the Chinese names of its options, what happens when it changes (danger), and the form of list items.
 * tests/settings-controls.test.ts fails when a setting lacks what its control needs.
 *
 * Pure data and functions: imported by the registry, the server-side validation and the browser.
 */

export type L = { zh: string; en: string };
const L = (zh: string, en: string): L => ({ zh, en });

/** The only controls a settings screen may use (numbered as on the design boards) */
export const CONTROLS = [
  "toggle", // 1 開關
  "text", // 2 文字
  "url", // 3 網址
  "number", // 4 數字＋單位
  "percent", // 5 比例
  "money", // 6 金額
  "secret", // 7 機密金鑰
  "readonly", // 8 唯讀值
  "segmented", // 9 分段選擇
  "select", // 10 下拉選單
  "cards", // 11 選項卡
  "chips", // 12 多選標籤
  "list", // 13 清單輸入
  "pairs", // 14 對照表
  "schedule", // 15 生效時間（價格頁）
  "action", // 16 按鈕與確認
] as const;
export type Control = (typeof CONTROLS)[number];

export type Ui = {
  /** overrides the control derived from the type */
  control?: Control;
  /** number, percent, money: shown inside the field (money: the currency) */
  unit?: L;
  /** allowed range, in the units shown (percent: 0–100) */
  min?: number;
  max?: number;
  integer?: boolean;
  /** an integer too large for a JS number (wei), kept as text */
  big?: boolean;
  /** percent: stored value × scale = shown value (0.5 → 50%) */
  scale?: number;
  /** shown under the field: what 0 or empty means, the period of a price */
  note?: L;
  /** select / list options: the name shown instead of the code, and for cards what choosing it does */
  options?: Record<string, { label: L; body?: L }>;
  /** changing it can stop payments, lose data or lock users out: the review asks to confirm this sentence */
  danger?: L;
  /** only these new values are dangerous (default: any change) */
  dangerWhen?: string[];
  /** list: one item's form and the message when it does not match */
  item?: { pattern: string; message: L; placeholder?: L };
  /** pairs ("7:0,30:0.03"): the two columns */
  pairs?: { left: { label: L; unit: L; integer?: boolean }; right: { label: L; unit: L; scale?: number; max?: number } };
  /** shown but never edited here (it has its own action) */
  readOnly?: boolean;
};

const tw = L("NT$", "NT$");
const usd = L("US$", "US$");
const days = L("天", "days");
const hours = L("小時", "hours");
const secs = L("秒", "s");
const mb = L("MB", "MB");
const tokens = L("tokens", "tokens");
const pct = L("%", "%");
const addr = { pattern: "^0x[0-9a-fA-F]{40}$", message: L("要是 0x 加 40 個十六進位字元的地址", "must be 0x followed by 40 hex digits"), placeholder: L("貼上地址，按 Enter 新增", "Paste an address, press Enter") };
const keyMoves = L("更換後，用舊值建立的資料或連線會失效", "after replacing it, data or links made with the old value stop working");

export const UI: Record<string, Ui> = {
  // ───── site & payments
  "site.testMode": { danger: L("付款與綁卡會改走（或離開）Oen 測試環境；測試期間的款項不計入營收", "payments and card binding move to (or leave) Oen's testing environment; test payments are not revenue") },
  "payments.provider": { options: { oen: { label: L("Oen 應援科技", "Oen") } } },
  "payments.mode": { options: { oen: { label: L("Oen 金流", "Oen payments") }, mock: { label: L("模擬結帳（只在開發環境）", "Fake checkout (development only)") } }, danger: L("正式站設為模擬結帳時，用戶無法付款", "on the live site a fake checkout means users cannot pay"), dangerWhen: ["mock"] },
  "oen.env": {
    control: "cards",
    options: {
      testing: { label: L("測試環境", "Testing"), body: L("款項不會真的扣款，適合上線前測試", "nothing is really charged; for testing before going live") },
      production: { label: L("正式環境", "Production"), body: L("付款與綁卡會真的扣款；需先向 Oen 申請伺服器 IP 白名單", "payments and card binding really charge; the server IP must be on Oen's allowlist") },
    },
    danger: L("之後的付款與綁卡會真的扣款", "payments and card binding will really charge from now on"),
    dangerWhen: ["production"],
  },
  // ───── model relay
  "llm.rpm": { unit: L("次／分鐘", "per minute"), min: 1, max: 100000, integer: true },
  "llm.maxOutputTokens": { unit: tokens, min: 1, max: 1000000, integer: true },
  "llm.defaultOutputTokens": { unit: tokens, min: 1, max: 1000000, integer: true },
  "llm.defaultAvgOutput": { unit: tokens, min: 1, max: 1000000, integer: true },
  "llm.topUpTokens": { unit: tokens, min: 1, max: 1000000, integer: true },
  "llm.holdTimeoutS": { unit: secs, min: 10, max: 86400, integer: true },
  "llm.dailyLimitTwd": { control: "money", unit: tw, min: 0, max: 100000000, note: L("0 = 不限；台灣時間每天早上 8 點重置", "0 = no limit; resets daily at 00:00 UTC") },
  "llm.requireSignature": { danger: L("沒有更新的 SinoBee 用戶端會立刻無法使用模型", "SinoBee clients that have not updated lose model access at once"), dangerWhen: ["1"] },
  "locutus.enabled": {},
  "locutus.nodes": { item: { pattern: "^0x[0-9a-fA-F]{40}(=[A-Za-z0-9][A-Za-z0-9._-]{0,39})?$", message: L("要是「地址」或「地址=名稱」（名稱不含空白）", "must be address or address=name (no spaces)"), placeholder: L("0x…=名稱，按 Enter 新增", "0x…=name, press Enter") } },
  "locutus.blocked": { item: addr },
  "locutus.hubPort": { unit: L("埠", "port"), min: 1, max: 65535, integer: true },
  "locutus.hubSecret": { danger: L("更換後要重新啟動 swarm，網站與集線器才會用同一把金鑰", "after replacing it, restart swarm so the site and the hub use the same key") },
  // ───── CAFECA & admins
  "admins.initial": { item: addr },
  // ───── pricing
  "pricing.markup": { unit: L("倍", "×"), min: 1, max: 10 },
  "pricing.vmHourlyUsd": { control: "money", unit: usd, min: 0, max: 1000, note: L("每小時", "per hour") },
  "pricing.s3GbMonthUsd": { control: "money", unit: usd, min: 0, max: 100, note: L("每 GB 每月", "per GB-month") },
  "pricing.s3PutPer1kUsd": { control: "money", unit: usd, min: 0, max: 100, note: L("每千次", "per 1,000") },
  "pricing.s3GetPer1kUsd": { control: "money", unit: usd, min: 0, max: 100, note: L("每千次", "per 1,000") },
  // ───── retention & subscription
  "retention.freeDays": { unit: days, min: 1, max: 3650, integer: true },
  "retention.subscriberDays": { unit: days, min: 1, max: 3650, integer: true },
  "retention.delete": { danger: L("會開始永久刪除到期的成果與容器，刪除後無法復原", "expired results and containers start being deleted for good"), dangerWhen: ["1"] },
  "subscription.graceDays": { unit: days, min: 0, max: 365, integer: true },
  "subscription.autoRenewEnabled": { danger: L("到期的訂閱不會再自動扣款續訂", "expiring subscriptions are no longer renewed automatically"), dangerWhen: ["0"] },
  // ───── storage
  "storage.driver": {
    control: "cards",
    options: {
      local: { label: L("本機磁碟", "Local disk"), body: L("檔案存在伺服器的資料夾，備份要另外處理", "files live in a folder on the server; back them up yourself") },
      s3: { label: L("S3 相容儲存", "S3-compatible"), body: L("檔案存在 bucket，可跨機器、可擴充", "files live in a bucket; works across machines") },
    },
    danger: L("既有檔案不會自動搬移；先執行 npm run storage-migrate，否則舊檔讀不到", "existing files are not moved; run npm run storage-migrate first or old files cannot be read"),
  },
  "storage.localDir": { danger: L("既有檔案不會自動搬到新目錄，舊檔會讀不到", "existing files are not moved to the new folder and cannot be read") },
  // ───── Boltchain
  "boltchain.chainId": { unit: L("ID", "ID"), min: 1, max: 4294967295, integer: true },
  "boltchain.replicas": { unit: L("份", "copies"), min: 1, max: 20, integer: true },
  "boltchain.epochs": { unit: L("epoch", "epochs"), min: 1, max: 1000000, integer: true },
  "boltchain.epochSeconds": { unit: secs, min: 1, max: 31536000, integer: true },
  "boltchain.lowBalanceWei": { control: "number", unit: L("wei", "wei"), big: true },
  "boltchain.renewBelow": { unit: L("epoch", "epochs"), min: 0, max: 1000000, integer: true },
  "boltchain.maxPriceWei": { control: "number", unit: L("wei", "wei"), big: true, note: L("留空 = 不限", "empty = no limit") },
  "boltchain.walletKey": { danger: L("更換等於換一個錢包，舊錢包的餘額不會轉移", "replacing it is a different wallet; the old balance does not move") },
  "boltchain.masterKey": { danger: L("更換後，已加密的成果全部無法解開，這不能復原", "after replacing it, every encrypted result can no longer be opened; this cannot be undone") },
  "boltchain.mirror": { danger: L("不保留鏡像時，Boltchain 讀不到就沒有其他副本", "without the mirror there is no other copy when Boltchain cannot be read"), dangerWhen: ["0"] },
  // ───── Skill Hub signing
  "hub.signingKey": { danger: L("請用「產生新的簽章金鑰」更換；手動貼上會讓已簽章的技能驗證失敗", "use “Rotate signing key”; pasting one makes signed skills fail verification") },
  "hub.previousKeys": { readOnly: true, item: { pattern: "^[A-Za-z0-9+/=]{16,}$", message: L("要是 base64 公鑰", "must be a base64 public key") } },
  // ───── task runner
  "runner.mode": { options: { docker: { label: L("Docker 容器", "Docker containers") }, mock: { label: L("模擬（不執行）", "Simulated (nothing runs)") } }, danger: L("模擬模式下任務不會真的執行", "in simulated mode tasks do not really run"), dangerWhen: ["mock"] },
  "runner.concurrency": { unit: L("個", "tasks"), min: 1, max: 64, integer: true },
  "runner.cpus": { unit: L("vCPU", "vCPU"), min: 1, max: 64 },
  "runner.memoryMb": { unit: mb, min: 256, max: 262144, integer: true },
  "runner.pollSeconds": { unit: secs, min: 1, max: 3600, integer: true },
  "runner.maxTaskHours": { unit: hours, min: 1, max: 720 },
  // ───── crowdfunding
  "crowd.sharePrice": { control: "money", unit: tw, min: 1, max: 1000000 },
  "crowd.proposalFee": { control: "money", unit: tw, min: 0, max: 1000000, note: L("0 = 免費提案", "0 = free") },
  "crowd.feeRates": {
    control: "pairs",
    pairs: { left: { label: L("眾籌期達到", "Campaign of at least"), unit: days, integer: true }, right: { label: L("服務費率", "Service fee"), unit: pct, scale: 100, max: 100 } },
  },
  "crowd.freeFileMb": { unit: mb, min: 0, max: 100000, integer: true },
  "crowd.blockMb": { unit: mb, min: 1, max: 100000, integer: true },
  "crowd.maxFileMb": { unit: mb, min: 1, max: 100000, integer: true },
  "crowd.chargeGraceDays": { unit: days, min: 0, max: 60, integer: true },
  "crowd.reviewDays": { unit: days, min: 1, max: 60, integer: true },
  "crowd.approveShare": { control: "percent", unit: pct, scale: 100, min: 1, max: 100 },
  "crowd.maxReworks": { unit: L("次", "times"), min: 0, max: 10, integer: true },
  "crowd.exitHours": { unit: hours, min: 0, max: 720, integer: true },
  "crowd.topupDays": { unit: days, min: 1, max: 90, integer: true },
  "crowd.screening": {
    control: "cards",
    options: {
      ai: { label: L("AI 審核", "AI screening"), body: L("AI 依公開的審核清單逐題審核，管理員覆核後才開放", "a model checks every checklist item and an admin confirms before it opens") },
      off: { label: L("不審核", "No screening"), body: L("提案直接上架（僅限開發）", "proposals open at once (development only)") },
    },
    danger: L("提案會不經審核直接上架", "proposals open without screening"),
    dangerWhen: ["off"],
  },
  "crowd.pledgeMinKyc": { unit: L("級", "level"), min: 0, max: 5, integer: true, note: L("0 = 不限制", "0 = no limit") },
  "crowd.voteMinKyc": { unit: L("級", "level"), min: 0, max: 5, integer: true, note: L("0 = 不限制", "0 = no limit") },
  "crowd.resultsDays": { unit: days, min: 1, max: 3650, integer: true },
};

/** The minimal shape the control logic needs (a registry entry or the item sent to the browser) */
export type Controlled = { key: string; type: "text" | "url" | "number" | "secret" | "select" | "bool" | "list"; options?: string[]; schemes?: string[]; generated?: boolean; generate?: string; ui?: Ui };

const uiOf = (s: Controlled) => s.ui ?? UI[s.key] ?? {};

/** The control a setting is edited with */
export function controlOf(s: Controlled): Control {
  const u = uiOf(s);
  if (u.control) return u.control;
  if (s.generated || s.generate) return "readonly";
  switch (s.type) {
    case "bool":
      return "toggle";
    case "url":
      return "url";
    case "secret":
      return "secret";
    case "number":
      return "number";
    case "select":
      return (s.options?.length ?? 0) <= 4 ? "segmented" : "select";
    case "list":
      return s.options?.length ? "chips" : "list";
    default:
      return "text";
  }
}

/** Is this change dangerous (asks for confirmation in the review)? */
export function isDanger(s: Controlled, value: string): boolean {
  const u = uiOf(s);
  if (!u.danger) return false;
  return !u.dangerWhen || u.dangerWhen.includes(value);
}

/** Display name of an option value */
export const optionLabel = (s: Controlled, v: string, zh: boolean) => {
  const o = uiOf(s).options?.[v];
  return o ? (zh ? o.label.zh : o.label.en) : v;
};

/** Stored value → the text a person sees in the field (percent 0.5 → "50", pairs → rows) */
export function toShown(s: Controlled, stored: string): string {
  const u = uiOf(s);
  if (controlOf(s) === "percent" && stored !== "" && Number.isFinite(Number(stored))) return String(+(Number(stored) * (u.scale ?? 100)).toFixed(6));
  return stored;
}

/** What a person typed → the stored value (percent "50" → "0.5"); validation comes after */
export function fromShown(s: Controlled, shown: string): string {
  const u = uiOf(s);
  if (controlOf(s) === "percent" && shown.trim() !== "" && Number.isFinite(Number(shown))) return String(+(Number(shown) / (u.scale ?? 100)).toFixed(8));
  return shown;
}

/** Pairs "7:0,30:0.03" ↔ rows [{left:"7", right:"0"}, {left:"30", right:"3"}] (right shown × scale) */
export function parsePairs(s: Controlled, stored: string): { left: string; right: string }[] {
  const scale = uiOf(s).pairs?.right.scale ?? 1;
  return stored
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [a, b] = p.split(":");
      const n = Number(b);
      return { left: (a ?? "").trim(), right: Number.isFinite(n) ? String(+(n * scale).toFixed(6)) : (b ?? "").trim() };
    });
}
export function joinPairs(s: Controlled, rows: { left: string; right: string }[]): string {
  const scale = uiOf(s).pairs?.right.scale ?? 1;
  return rows
    .filter((r) => r.left.trim() !== "" || r.right.trim() !== "")
    .map((r) => `${r.left.trim()}:${Number.isFinite(Number(r.right)) && r.right.trim() !== "" ? +(Number(r.right) / scale).toFixed(8) : r.right.trim()}`)
    .join(",");
}

export type Check = { ok: true; value: string } | { ok: false; error: L };
const bad = (zh: string, en: string): Check => ({ ok: false, error: L(zh, en) });
const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Validate a stored-form value the same way in the browser and on the server, with a message that says how to fix it.
 * Empty clears the setting (back to its default).
 */
export function checkValue(s: Controlled, raw: string): Check {
  const v = raw.trim();
  if (v === "") return { ok: true, value: "" };
  const u = uiOf(s);
  const c = controlOf(s);
  if (s.type === "number" || c === "number" || c === "percent" || c === "money") {
    if (u.big) return /^\d+$/.test(v) ? { ok: true, value: v.replace(/^0+(?=\d)/, "") } : bad("只能填整數（不含小數點與符號）", "whole number only (no decimal point or sign)");
    const n = Number(v);
    if (!Number.isFinite(n)) return bad("要填數字", "must be a number");
    const shown = c === "percent" ? n * (u.scale ?? 100) : n;
    const unit = u.unit ? (c === "money" ? "" : u.unit.zh) : "";
    if (u.integer && !Number.isInteger(n)) return bad("只能填整數", "whole number only");
    if (u.min !== undefined && shown < u.min - 1e-9) return bad(`最少 ${c === "money" ? u.unit?.zh ?? "" : ""}${fmt(u.min)}${unit === "%" ? "%" : unit ? " " + unit : ""}`, `at least ${fmt(u.min)}`);
    if (u.max !== undefined && shown > u.max + 1e-9) return bad(`最多 ${c === "money" ? u.unit?.zh ?? "" : ""}${fmt(u.max)}${unit === "%" ? "%" : unit ? " " + unit : ""}`, `at most ${fmt(u.max)}`);
    return { ok: true, value: String(n) };
  }
  if (c === "pairs" && u.pairs) {
    for (const part of v.split(",").map((p) => p.trim()).filter(Boolean)) {
      const [a, b, extra] = part.split(":");
      const left = Number(a);
      const right = Number(b);
      if (extra !== undefined || !Number.isFinite(left) || !Number.isFinite(right) || a.trim() === "" || (b ?? "").trim() === "") return bad("每一列都要填兩個數字", "every row needs two numbers");
      if (u.pairs.left.integer && !Number.isInteger(left)) return bad(`${u.pairs.left.label.zh}要是整數`, `${u.pairs.left.label.en} must be a whole number`);
      const shownRight = right * (u.pairs.right.scale ?? 1);
      if (shownRight < 0 || (u.pairs.right.max !== undefined && shownRight > u.pairs.right.max)) return bad(`${u.pairs.right.label.zh}要在 0–${u.pairs.right.max ?? "∞"}${u.pairs.right.unit.zh} 之間`, `${u.pairs.right.label.en} must be 0–${u.pairs.right.max ?? "∞"}${u.pairs.right.unit.en}`);
    }
    return { ok: true, value: v.split(",").map((p) => p.trim()).filter(Boolean).join(",") };
  }
  switch (s.type) {
    case "bool":
      return { ok: true, value: ["1", "true", "yes", "on"].includes(v.toLowerCase()) ? "1" : "0" };
    case "url": {
      const schemes = s.schemes ?? ["http:", "https:"];
      try {
        const url = new URL(v);
        if (!schemes.includes(url.protocol)) throw new Error();
      } catch {
        const list = schemes.map((x) => `${x}//`).join(" 或 ");
        return bad(`要以 ${list} 開頭的完整網址`, `must be a full URL starting with ${schemes.map((x) => `${x}//`).join(" or ")}`);
      }
      return { ok: true, value: v.replace(/\/$/, "") };
    }
    case "select":
      if (s.options && !s.options.includes(v)) return bad(`只能選：${s.options.map((o) => u.options?.[o]?.label.zh ?? o).join("、")}`, `must be one of: ${s.options.join(", ")}`);
      return { ok: true, value: v };
    case "list": {
      const items = v.split(/[\s,]+/).filter(Boolean);
      if (s.options) for (const i of items) if (!s.options.includes(i)) return bad(`沒有「${i}」這個選項`, `unknown option ${i}`);
      if (u.item) {
        const re = new RegExp(u.item.pattern);
        const wrong = items.find((i) => !re.test(i));
        if (wrong) return { ok: false, error: L(`「${wrong}」${u.item.message.zh}`, `“${wrong}” ${u.item.message.en}`) };
      }
      return { ok: true, value: [...new Set(items)].join(",") };
    }
    case "secret":
      return v.length > 8192 ? bad("太長了（最多 8192 字元）", "too long (8192 characters at most)") : { ok: true, value: v };
    default:
      return v.length > 2000 ? bad("太長了（最多 2000 字元）", "too long (2000 characters at most)") : { ok: true, value: v };
  }
}
