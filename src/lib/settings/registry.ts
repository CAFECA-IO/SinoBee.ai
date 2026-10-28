/**
 * Every runtime setting the site has. Values live in the database (SiteSetting "cfg.<key>"); secrets are encrypted
 * there (see box.ts). Precedence: a variable set in the real process environment (docker -e, shell) wins and is
 * shown as locked in /admin → Settings; then the database; then the default.
 *
 * Only bootstrap values stay in .env: DATABASE_URL / SQLITE_PATH, PUBLIC_ORIGIN, OWNER_ACCOUNT, DEV_LOGIN,
 * SWARM_PORT, BOLT_NODE_* (local node container) and optionally SECRETS_KEY.
 */

export type SettingType = "text" | "url" | "number" | "secret" | "select" | "bool" | "list";

export type SettingDef = {
  key: string;
  /** legacy / override environment variable */
  env?: string;
  type: SettingType;
  group: SettingGroup;
  /** payment provider the field belongs to (fields differ per provider) */
  provider?: string;
  default?: string;
  options?: string[];
  label: { zh: string; en: string };
  help?: { zh: string; en: string };
  /** generated automatically when empty (keys, passwords) */
  generate?: "ed25519-pkcs8" | "hex32" | "evm-key";
  /** only takes effect after a restart */
  restart?: boolean;
  /** should be filled before going live (shown as "needs attention" in /admin) */
  required?: boolean;
};

export const GROUPS = ["site", "payments", "apiKeys", "llm", "cafeca", "legal", "pricing", "retention", "storage", "boltchain", "hub", "runner", "crowd"] as const;
export type SettingGroup = (typeof GROUPS)[number];

/** payment providers offered in /admin → Settings → Payments; each lists its own fields below */
export const PAYMENT_PROVIDERS = [{ id: "oen", name: "Oen 應援科技（oen.tw）" }] as const;

const L = (zh: string, en: string) => ({ zh, en });

export const SETTINGS: SettingDef[] = [
  { key: "site.agentOnline", env: "AGENT_ONLINE", type: "bool", group: "site", default: "0", label: L("線上使用", "Use online"), help: L("開啟後首頁顯示「線上使用」按鈕，/agent 可以開始使用。關閉時一般用戶看到 Coming soon，管理者仍可照常進入 /agent 測試", "When on, the home page shows the Use online button and /agent can be used. When off, visitors see Coming soon; admins can still open /agent to test") },
  { key: "site.testMode", env: "SITE_TEST_MODE", type: "bool", group: "payments", default: "0", label: L("測試模式", "Test mode"), help: L("開啟後首頁與管理後台顯示「測試版」緞帶，所有付款與綁卡改走 Oen 測試環境，測試期間的款項不計入營收", "Shows a TEST ribbon on the home page and in the admin, and sends every payment and card binding to Oen's testing environment; test payments are left out of revenue") },
  // ───── payments ─────
  { key: "payments.provider", env: "PAYMENT_PROVIDER", type: "select", group: "payments", default: "oen", options: ["oen"], label: L("金流服務", "Payment provider") },
  { key: "payments.mode", env: "PAYMENT_MODE", type: "select", group: "payments", default: "oen", options: ["oen", "mock"], label: L("模式", "Mode"), help: L("mock：本機模擬結帳頁，只在開發環境有效", "mock: local fake checkout, development only") },
  { key: "oen.env", env: "OEN_ENV", type: "select", group: "payments", provider: "oen", default: "testing", options: ["testing", "production"], label: L("環境", "Environment"), help: L("正式環境需先向 Oen 申請伺服器固定 IP 白名單", "production needs the server IP on Oen's allowlist") },
  { key: "oen.merchantId", env: "OEN_MERCHANT_ID", type: "text", group: "payments", provider: "oen", required: true, label: L("網域名稱（merchantId）", "Domain (merchantId)"), help: L("例如應援頁 https://sinobee.oen.tw 就填 sinobee", "e.g. sinobee for https://sinobee.oen.tw") },
  { key: "oen.token", env: "OEN_API_TOKEN", type: "secret", group: "payments", provider: "oen", required: true, label: L("API Token", "API token"), help: L("CRM「總設定 → 開發者 → 應援金流設定 → 存取 Token」產生", "Generated in the Oen CRM: Settings → Developer → Access token") },
  { key: "oen.testMerchantId", env: "OEN_TEST_MERCHANT_ID", type: "text", group: "payments", provider: "oen", label: L("測試模式網域名稱（留空沿用正式）", "Test mode domain (empty = same)"), help: L("測試模式一律使用 Oen 測試環境（testing.oen.tw）", "Test mode always uses Oen's testing environment (testing.oen.tw)") },
  { key: "oen.testToken", env: "OEN_TEST_API_TOKEN", type: "secret", group: "payments", provider: "oen", label: L("測試模式 API Token（留空沿用正式）", "Test mode API token (empty = same)") },
  { key: "oen.apiBase", env: "OEN_API_BASE", type: "url", group: "payments", provider: "oen", label: L("API 網址（留空用預設）", "API URL (empty = default)") },
  { key: "oen.checkoutBase", env: "OEN_CHECKOUT_BASE", type: "url", group: "payments", provider: "oen", label: L("結帳頁網址（留空用預設）", "Checkout URL (empty = default)") },

  // ───── platform API keys (relay + task containers) ─────
  { key: "apiKeys.anthropic", env: "ANTHROPIC_API_KEY", type: "secret", group: "apiKeys", label: L("Anthropic", "Anthropic") },
  { key: "apiKeys.openai", env: "OPENAI_API_KEY", type: "secret", group: "apiKeys", label: L("OpenAI", "OpenAI") },
  { key: "apiKeys.gemini", env: "GEMINI_API_KEY", type: "secret", group: "apiKeys", label: L("Google Gemini", "Google Gemini") },
  { key: "apiKeys.deepseek", env: "DEEPSEEK_API_KEY", type: "secret", group: "apiKeys", label: L("DeepSeek", "DeepSeek") },
  { key: "apiKeys.openrouter", env: "OPENROUTER_API_KEY", type: "secret", group: "apiKeys", label: L("OpenRouter（任務容器）", "OpenRouter (task containers)") },
  { key: "apiKeys.brave", env: "BRAVE_API_KEY", type: "secret", group: "apiKeys", label: L("Brave Search（任務容器）", "Brave Search (task containers)") },
  { key: "apiKeys.tavily", env: "TAVILY_API_KEY", type: "secret", group: "apiKeys", label: L("Tavily（任務容器）", "Tavily (task containers)") },

  // ───── model relay ─────
  { key: "llm.rpm", env: "LLM_RPM", type: "number", group: "llm", default: "60", label: L("每用戶每分鐘請求數", "Requests per minute per user") },
  { key: "llm.maxOutputTokens", env: "LLM_MAX_OUTPUT_TOKENS", type: "number", group: "llm", default: "32000", label: L("單次 max_tokens 上限", "Max max_tokens per request") },
  { key: "llm.defaultOutputTokens", env: "LLM_DEFAULT_OUTPUT_TOKENS", type: "number", group: "llm", default: "8192", label: L("非串流預設 max_tokens", "Default max_tokens (non-stream)") },
  { key: "llm.defaultAvgOutput", env: "LLM_DEFAULT_AVG_OUTPUT", type: "number", group: "llm", default: "800", label: L("首次預估輸出 tokens", "First-hold output estimate") },
  { key: "llm.topUpTokens", env: "LLM_TOPUP_TOKENS", type: "number", group: "llm", default: "256", label: L("串流追加預扣 tokens", "Stream top-up tokens") },
  { key: "llm.holdTimeoutS", env: "LLM_HOLD_TIMEOUT_S", type: "number", group: "llm", default: "600", label: L("預扣逾時（秒）", "Hold timeout (s)") },
  { key: "llm.dailyLimitTwd", env: "LLM_DAILY_LIMIT_TWD", type: "number", group: "llm", default: "0", label: L("每家供應商每日支出上限（TWD，0 = 不限）", "Daily spend cap per provider (TWD, 0 = off)") },
  { key: "llm.requireSignature", env: "LLM_REQUIRE_SIGNATURE", type: "bool", group: "llm", default: "0", label: L("要求裝置簽章", "Require device signatures"), help: L("開啟後只接受 SinoBee 以裝置金鑰簽章的請求（舊版用戶端需更新）", "Only accept requests signed with a device key (older clients must update)") },
  { key: "llm.base.anthropic", env: "LLM_BASE_ANTHROPIC", type: "url", group: "llm", default: "https://api.anthropic.com", label: L("Anthropic API 網址", "Anthropic API URL") },
  { key: "llm.base.openai", env: "LLM_BASE_OPENAI", type: "url", group: "llm", default: "https://api.openai.com/v1", label: L("OpenAI API 網址", "OpenAI API URL") },
  { key: "llm.base.gemini", env: "LLM_BASE_GEMINI", type: "url", group: "llm", default: "https://generativelanguage.googleapis.com/v1beta/openai", label: L("Gemini API 網址", "Gemini API URL") },
  { key: "llm.base.deepseek", env: "LLM_BASE_DEEPSEEK", type: "url", group: "llm", default: "https://api.deepseek.com/v1", label: L("DeepSeek API 網址", "DeepSeek API URL") },
  { key: "llm.base.ollama", env: "LLM_BASE_OLLAMA", type: "url", group: "llm", label: L("Ollama 網址（選填）", "Ollama URL (optional)"), help: L("留空時使用 .env 的 OLLAMA_URL（npm run swarm 啟動的 Ollama 容器會自動寫入）", "Empty: OLLAMA_URL from .env (written by npm run swarm for its Ollama container)") },

  // ───── CAFECA ─────
  { key: "cafeca.wallet", env: "CAFECA_WALLET", type: "url", group: "cafeca", default: "https://cafeca.io", label: L("CAFECA 錢包網址", "CAFECA wallet URL"), restart: true },
  { key: "cafeca.rpcUrl", env: "CAFECA_RPC_URL", type: "url", group: "cafeca", label: L("CAFECA 鏈 RPC（選填）", "CAFECA chain RPC (optional)") },
  { key: "cafeca.notifyUrl", env: "CAFECA_NOTIFY_URL", type: "url", group: "cafeca", label: L("通知 Webhook", "Notification webhook") },
  { key: "cafeca.notifyToken", env: "CAFECA_NOTIFY_TOKEN", type: "secret", group: "cafeca", label: L("通知 Webhook Token", "Notification webhook token") },
  { key: "admins.initial", env: "ADMIN_ACCOUNTS", type: "list", group: "cafeca", label: L("首次登入即為管理者的帳號", "Accounts that start as admin") },

  // ───── legal ─────
  { key: "legal.entity", env: "LEGAL_ENTITY", type: "text", group: "legal", default: "卡菲卡金融科技股份有限公司", label: L("公司名稱", "Company name") },
  { key: "legal.website", env: "LEGAL_WEBSITE", type: "url", group: "legal", default: "https://cafeca.com.tw", label: L("公司網站", "Company website") },
  { key: "legal.taxId", env: "LEGAL_TAX_ID", type: "text", group: "legal", required: true, label: L("統一編號", "Tax ID") },
  { key: "legal.address", env: "LEGAL_ADDRESS", type: "text", group: "legal", required: true, label: L("地址", "Address") },
  { key: "legal.email", env: "LEGAL_EMAIL", type: "text", group: "legal", default: "contact@cafeca.com.tw", label: L("客服信箱", "Support email") },
  { key: "legal.effective", env: "LEGAL_EFFECTIVE", type: "text", group: "legal", default: "2026-10-16", label: L("條款生效日", "Policies effective date") },

  // ───── pricing (VM and storage; model prices are in /admin → Model prices) ─────
  { key: "pricing.markup", env: "PRICE_MARKUP", type: "number", group: "pricing", default: "1.5", label: L("VM 與儲存加成", "VM and storage markup") },
  { key: "pricing.vmHourlyUsd", env: "AWS_VM_HOURLY_USD", type: "number", group: "pricing", default: "0.2604", label: L("VM 每小時（USD）", "VM per hour (USD)") },
  { key: "pricing.s3GbMonthUsd", env: "AWS_S3_GB_MONTH_USD", type: "number", group: "pricing", default: "0.025", label: L("S3 每 GB 月（USD）", "S3 per GB-month (USD)") },
  { key: "pricing.s3PutPer1kUsd", env: "AWS_S3_PUT_PER_1K_USD", type: "number", group: "pricing", default: "0.0047", label: L("S3 每千次寫入（USD）", "S3 per 1k writes (USD)") },
  { key: "pricing.s3GetPer1kUsd", env: "AWS_S3_GET_PER_1K_USD", type: "number", group: "pricing", default: "0.00037", label: L("S3 每千次讀取（USD）", "S3 per 1k reads (USD)") },

  // ───── retention / subscription ─────
  { key: "retention.freeDays", env: "RETENTION_FREE_DAYS", type: "number", group: "retention", default: "7", label: L("未訂閱成果保留天數", "Free results kept (days)") },
  { key: "retention.subscriberDays", env: "RETENTION_SUBSCRIBER_DAYS", type: "number", group: "retention", default: "90", label: L("訂閱者成果最少保留天數", "Subscriber minimum (days)") },
  { key: "retention.delete", env: "RETENTION_DELETE", type: "bool", group: "retention", default: "0", label: L("刪除到期成果與容器", "Delete expired results and containers"), help: L("關閉時只標記到期（暫緩刪除）", "Off: only mark expired") },
  { key: "subscription.autoRenewEnabled", env: "SUBSCRIPTION_AUTO_RENEW", type: "bool", group: "payments", default: "1", label: L("自動續訂", "Automatic renewal"), help: L("總開關：關閉後不再自動扣款（用戶的設定保留）", "Master switch: off stops every automatic renewal charge (users keep their setting)") },
  { key: "subscription.graceDays", env: "SUBSCRIPTION_GRACE_DAYS", type: "number", group: "retention", default: "30", label: L("到期寬限天數", "Grace period (days)") },

  // ───── storage ─────
  { key: "storage.driver", env: "STORAGE_DRIVER", type: "select", group: "storage", default: "local", options: ["local", "s3"], label: L("鏡像儲存", "Mirror storage"), restart: true },
  { key: "storage.localDir", env: "STORAGE_LOCAL_DIR", type: "text", group: "storage", default: "./data/storage", label: L("本機目錄", "Local directory"), restart: true },
  { key: "storage.s3Bucket", env: "S3_BUCKET", type: "text", group: "storage", label: L("S3 Bucket", "S3 bucket") },
  { key: "storage.s3Region", env: "AWS_REGION", type: "text", group: "storage", default: "ap-northeast-1", label: L("AWS 區域", "AWS region"), restart: true },
  { key: "storage.s3AccessKeyId", env: "AWS_ACCESS_KEY_ID", type: "secret", group: "storage", label: L("AWS Access Key ID（留空用主機角色）", "AWS access key ID (empty = instance role)"), restart: true },
  { key: "storage.s3SecretAccessKey", env: "AWS_SECRET_ACCESS_KEY", type: "secret", group: "storage", label: L("AWS Secret Access Key", "AWS secret access key"), restart: true },

  // ───── Boltchain ─────
  { key: "boltchain.rpcUrl", env: "BOLT_RPC_URL", type: "url", group: "boltchain", label: L("節點 RPC", "Node RPC"), help: L("npm run swarm 會自動啟動本機節點並帶入", "npm run swarm starts a local node and sets it") },
  { key: "boltchain.chainId", env: "BOLT_CHAIN_ID", type: "number", group: "boltchain", default: "8018", label: L("Chain ID", "Chain ID") },
  { key: "boltchain.walletKey", env: "BOLT_WALLET_KEY", type: "secret", group: "boltchain", generate: "evm-key", label: L("網站錢包私鑰（自動產生）", "Site wallet key (generated)") },
  { key: "boltchain.masterKey", env: "BOLT_MASTER_KEY", type: "secret", group: "boltchain", generate: "hex32", label: L("物件金鑰主密鑰（自動產生）", "Object master key (generated)") },
  { key: "boltchain.certificates", env: "BOLT_CERTIFICATES", type: "text", group: "boltchain", label: L("Certificates 合約（留空不存證）", "Certificates contract (empty = no notarization)") },
  { key: "boltchain.explorer", env: "BOLT_EXPLORER_URL", type: "url", group: "boltchain", default: "https://boltchain.cafeca.io", label: L("區塊瀏覽器", "Explorer") },
  { key: "boltchain.replicas", env: "BOLT_REPLICAS", type: "number", group: "boltchain", default: "3", label: L("副本數", "Replicas") },
  { key: "boltchain.epochs", env: "BOLT_DEAL_EPOCHS", type: "number", group: "boltchain", default: "720", label: L("每次購買 epoch 數", "Epochs per deal") },
  { key: "boltchain.epochSeconds", env: "BOLT_EPOCH_SECONDS", type: "number", group: "boltchain", default: "3600", label: L("每 epoch 秒數", "Seconds per epoch") },
  { key: "boltchain.lowBalanceWei", env: "BOLT_LOW_BALANCE_WEI", type: "text", group: "boltchain", default: "10000000000000000000", label: L("低餘額警示（wei）", "Low balance alert (wei)") },
  { key: "boltchain.renewBelow", env: "BOLT_RENEW_BELOW_EPOCHS", type: "number", group: "boltchain", default: "48", label: L("剩餘 epoch 低於此值時續約", "Renew below (epochs)") },
  { key: "boltchain.maxPriceWei", env: "BOLT_MAX_PRICE_WEI", type: "text", group: "boltchain", label: L("最高價格（wei / GiB / epoch）", "Max price (wei / GiB / epoch)") },
  { key: "boltchain.mirror", env: "BOLT_MIRROR", type: "bool", group: "boltchain", default: "1", label: L("保留鏡像副本", "Keep a mirror copy") },

  // ───── Skill Hub ─────
  { key: "hub.signingKey", env: "HUB_SIGNING_KEY", type: "secret", group: "hub", generate: "ed25519-pkcs8", label: L("技能簽章私鑰（自動產生）", "Skill signing key (generated)") },
  { key: "hub.previousKeys", type: "list", group: "hub", label: L("舊公鑰（仍可驗證）", "Previous public keys (still accepted)") },

  // ───── runner ─────
  { key: "runner.mode", env: "RUNNER_MODE", type: "select", group: "runner", default: "docker", options: ["docker", "mock"], label: L("執行方式", "Runner"), restart: true },
  { key: "runner.image", env: "SINOBEE_IMAGE", type: "text", group: "runner", default: "sinobee:latest", label: L("SinoBee 映像檔", "SinoBee image") },
  { key: "runner.concurrency", env: "RUNNER_CONCURRENCY", type: "number", group: "runner", default: "2", label: L("同時執行任務數", "Concurrent tasks"), restart: true },
  { key: "runner.cpus", env: "RUNNER_CPUS", type: "number", group: "runner", default: "2", label: L("每任務 vCPU", "vCPU per task") },
  { key: "runner.memoryMb", env: "RUNNER_MEMORY_MB", type: "number", group: "runner", default: "4096", label: L("每任務記憶體（MB）", "Memory per task (MB)") },
  { key: "runner.network", env: "RUNNER_NETWORK", type: "text", group: "runner", label: L("容器網路", "Container network") },
  { key: "runner.pollSeconds", env: "RUNNER_POLL_SECONDS", type: "number", group: "runner", default: "10", label: L("輪詢秒數", "Poll seconds"), restart: true },
  { key: "runner.maxTaskHours", env: "RUNNER_MAX_TASK_HOURS", type: "number", group: "runner", default: "12", label: L("任務最長時數", "Max task hours") },

  // ───── crowdfunding ─────
  { key: "crowd.sharePrice", env: "CROWD_SHARE_PRICE_TWD", type: "number", group: "crowd", default: "30", label: L("每份金額（TWD）", "Share price (TWD)") },
  { key: "crowd.proposalFee", env: "CROWD_PROPOSAL_FEE_TWD", type: "number", group: "crowd", default: "30", label: L("眾籌提案費（TWD）", "Proposal fee (TWD)"), help: L("不可退還；換算為規格對話 token 與儲存空間額度", "Non-refundable; becomes credit for the spec dialogue and storage") },
  { key: "crowd.feeRates", env: "CROWD_FEE_RATES", type: "text", group: "crowd", default: "7:0,30:0.03,90:0.06", label: L("眾籌期與服務費率", "Durations and service fee rates"), help: L("天數:費率，以逗號分隔", "days:rate, comma separated") },
  { key: "crowd.freeFileMb", env: "CROWD_FREE_FILE_MB", type: "number", group: "crowd", default: "50", label: L("免費參考檔案（MB）", "Free reference files (MB)") },
  { key: "crowd.blockMb", env: "CROWD_FILE_BLOCK_MB", type: "number", group: "crowd", default: "50", label: L("超額計費單位（MB）", "Extra space block (MB)"), help: L("每個單位扣 1 份提案額度", "Each block uses one share of proposal credit") },
  { key: "crowd.maxFileMb", env: "CROWD_MAX_FILE_MB", type: "number", group: "crowd", default: "500", label: L("參考檔案上限（MB）", "Reference files limit (MB)") },
  { key: "crowd.chargeGraceDays", env: "CROWD_CHARGE_GRACE_DAYS", type: "number", group: "crowd", default: "3", label: L("扣款失敗寬限天數", "Failed charge grace (days)") },
  { key: "crowd.reviewDays", env: "CROWD_REVIEW_DAYS", type: "number", group: "crowd", default: "7", label: L("驗收投票天數", "Acceptance vote (days)") },
  { key: "crowd.approveShare", env: "CROWD_APPROVE_SHARE", type: "number", group: "crowd", default: "0.5", label: L("驗收通過門檻（贊成份數比例）", "Acceptance threshold (share of voted shares)"), help: L("沒有人投票視為通過", "No votes counts as accepted") },
  { key: "crowd.maxReworks", env: "CROWD_MAX_REWORKS", type: "number", group: "crowd", default: "1", label: L("驗收未通過時最多重做次數", "Reworks after a rejected review") },
  { key: "crowd.exitHours", env: "CROWD_EXIT_HOURS", type: "number", group: "crowd", default: "72", label: L("規格修訂後的撤回期（小時）", "Withdrawal window after a spec revision (hours)") },
  { key: "crowd.topupDays", env: "CROWD_TOPUP_DAYS", type: "number", group: "crowd", default: "7", label: L("追加眾籌天數", "Top-up round (days)") },
  { key: "crowd.screening", env: "CROWD_SCREENING", type: "select", group: "crowd", default: "ai", options: ["ai", "off"], label: L("提案審核", "Proposal screening"), help: L("ai：AI 依公開的審核清單逐題審核，管理員覆核確認後通知提案者，全部符合才開放；off：不審核（僅限開發）", "ai: a model checks every item of the public checklist, an admin confirms the result and the proposer is told; it opens only if all pass; off: none (development only)") },
  { key: "crowd.pledgeMinKyc", env: "CROWD_PLEDGE_MIN_KYC", type: "number", group: "crowd", default: "0", label: L("出資最低實名等級", "Minimum KYC level to pledge"), help: L("0 = 不限制", "0 = no limit") },
  { key: "crowd.voteMinKyc", env: "CROWD_VOTE_MIN_KYC", type: "number", group: "crowd", default: "0", label: L("驗收投票最低實名等級", "Minimum KYC level to vote"), help: L("0 = 不限制", "0 = no limit") },
  { key: "crowd.facebookAppId", env: "FACEBOOK_APP_ID", type: "text", group: "crowd", label: L("Facebook App ID（分享）", "Facebook App ID (sharing)"), help: L("填入後分享頁會加上 fb:app_id，可用 Facebook 分享偵錯工具檢查", "Adds fb:app_id to shared pages (checked by Facebook's Sharing Debugger)") },
  { key: "crowd.xSite", env: "X_SITE", type: "text", group: "crowd", label: L("X 帳號（分享）", "X account (sharing)"), help: L("例如 @SinoBeeAI，加在 twitter:site", "For example @SinoBeeAI, used as twitter:site") },
  { key: "crowd.ogFontUrl", env: "OG_FONT_URL", type: "url", group: "crowd", default: "https://fonts.googleapis.com/css2?family=Noto+Sans+TC", label: L("預覽圖中文字型來源", "Preview image CJK font source"), help: L("Google Fonts 相容的 CSS 網址，只下載預覽圖用到的字；也可設 OG_FONT_PATH 指向本機 TTF/OTF", "A Google Fonts-style CSS URL (only the characters used are fetched); or set OG_FONT_PATH to a local TTF/OTF") },
  { key: "crowd.resultsDays", env: "CROWD_RESULTS_DAYS", type: "number", group: "crowd", default: "90", label: L("眾籌成果保存天數", "Crowdfunded results kept (days)") },
];

export const SETTING = Object.fromEntries(SETTINGS.map((d) => [d.key, d])) as Record<string, SettingDef>;
