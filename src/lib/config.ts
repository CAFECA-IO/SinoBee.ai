/**
 * Central runtime configuration (all values from environment variables).
 * See .env.example for documentation of each variable.
 */
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const config = {
  /** Public origin of this site, e.g. https://sinobee.ai — must match exactly what users sign */
  origin: (process.env.PUBLIC_ORIGIN ?? "http://localhost:3000").replace(/\/$/, ""),
  /** CAFECA wallet origin (Sign in with CAFECA, signing channel, payments) */
  cafecaWallet: (process.env.CAFECA_WALLET ?? "https://cafeca.io").replace(/\/$/, ""),
  cafecaRpcUrl: process.env.CAFECA_RPC_URL || undefined,
  /** Optional webhook used to push notifications to users through CAFECA */
  cafecaNotifyUrl: process.env.CAFECA_NOTIFY_URL || undefined,
  cafecaNotifyToken: process.env.CAFECA_NOTIFY_TOKEN || undefined,
  /** Accounts (lowercase addresses) that get admin rights (skill review, revocations) */
  adminAccounts: list(process.env.ADMIN_ACCOUNTS).map((a) => a.toLowerCase()),

  payments: {
    /** "chain": verify TWDC transfers on the CAFECA chain. "mock": auto-confirm (development only!) */
    mode: (process.env.PAYMENT_MODE ?? "chain") as "chain" | "mock",
    /** Platform treasury that receives TWDC */
    treasury: (process.env.TREASURY_ADDRESS ?? "").toLowerCase(),
    /** Token decimals (TWDC = 6) */
    decimals: num(process.env.TWDC_DECIMALS, 6),
    minTaskBudget: num(process.env.MIN_TASK_BUDGET_TWDC, 30),
    minTopUp: num(process.env.MIN_TOPUP_TWDC, 10),
  },

  pricing: {
    /** Markup applied to every raw cost (tokens, VM, S3) */
    markup: num(process.env.PRICE_MARKUP, 1.5),
    /** USD → TWDC conversion rate used to bill (snapshotted per task) */
    usdTwd: num(process.env.USD_TWD_RATE, 32),
    /** AWS EC2 on-demand price for one task slot (USD/hour). Default: m7i.xlarge ap-northeast-1 reference */
    vmHourlyUsd: num(process.env.AWS_VM_HOURLY_USD, 0.2604),
    /** AWS S3 Standard storage (USD per GB-month) and request prices (USD per 1,000) */
    s3GbMonthUsd: num(process.env.AWS_S3_GB_MONTH_USD, 0.025),
    s3PutPer1kUsd: num(process.env.AWS_S3_PUT_PER_1K_USD, 0.0047),
    s3GetPer1kUsd: num(process.env.AWS_S3_GET_PER_1K_USD, 0.00037),
  },

  retention: {
    /** non-subscribers: containers and results are kept this many days after a task finishes */
    freeDays: num(process.env.RETENTION_FREE_DAYS, 7),
    /** subscribers: results kept this many days (containers kept while subscribed) */
    subscriberDays: num(process.env.RETENTION_SUBSCRIBER_DAYS, 90),
  },

  subscription: {
    priceTwdc: num(process.env.SUBSCRIPTION_PRICE_TWDC, 300),
    days: num(process.env.SUBSCRIPTION_DAYS, 30),
  },

  storage: {
    /** "local" (dev) or "s3" */
    driver: (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3",
    get localDir() {
      return process.env.STORAGE_LOCAL_DIR ?? "./data/storage";
    },
    s3Bucket: process.env.S3_BUCKET ?? "",
    s3Region: process.env.AWS_REGION ?? "ap-northeast-1",
  },

  /**
   * Boltchain storage (SwarmStorage deals) and notarization (Certificates). Every stored object is
   * sealed with bolt-vault and kept by storage providers; the site wallet pays in BOLT.
   * Enabled when BOLT_RPC_URL, BOLT_WALLET_KEY and BOLT_MASTER_KEY are all set (read on use).
   */
  boltchain: {
    get enabled() {
      return !!(process.env.BOLT_RPC_URL && process.env.BOLT_WALLET_KEY && process.env.BOLT_MASTER_KEY);
    },
    /** JSON-RPC of the site's own node, started with --rpc-storage (it serves bolt_hostBlocks / bolt_getBlocks) */
    get rpcUrl() {
      return process.env.BOLT_RPC_URL ?? "http://127.0.0.1:8545";
    },
    get chainId() {
      return num(process.env.BOLT_CHAIN_ID, 8018);
    },
    /** site wallet private key (pays deals and certificates) */
    get walletKey() {
      return process.env.BOLT_WALLET_KEY ?? "";
    },
    /** 32-byte key (hex or base64) that encrypts each object's vault key; destroying an object key crypto-shreds it */
    get masterKey() {
      return process.env.BOLT_MASTER_KEY ?? "";
    },
    /** Certificates contract (ADR 0016); empty → content hashes are not notarized */
    get certificates() {
      return (process.env.BOLT_CERTIFICATES ?? "").toLowerCase();
    },
    get explorer() {
      return (process.env.BOLT_EXPLORER_URL ?? "https://boltchain.cafeca.io").replace(/\/$/, "");
    },
    get replicas() {
      return num(process.env.BOLT_REPLICAS, 3);
    },
    /** epochs bought per deal / per renewal (testnet epoch ≈ 1–2 h) */
    get epochs() {
      return num(process.env.BOLT_DEAL_EPOCHS, 720);
    },
    /** renew when fewer than this many epochs remain */
    get renewBelow() {
      return num(process.env.BOLT_RENEW_BELOW_EPOCHS, 48);
    },
    /** highest price accepted, BOLT per GiB per epoch (wei = BOLT × 1e18); empty → no cap */
    get maxPriceWei() {
      return process.env.BOLT_MAX_PRICE_WEI ?? "";
    },
    /** keep a mirror copy in local/S3 storage for fast reads (Boltchain stays the system of record) */
    mirror: (process.env.BOLT_MIRROR ?? "1") !== "0",
  },

  hub: {
    /** base64 PKCS8 DER ed25519 private key used to sign approved skill versions */
    signingKey: process.env.HUB_SIGNING_KEY ?? "",
    maxBundleBytes: 20 * 1024 * 1024,
    maxFiles: 500,
  },

  runner: {
    /** "docker": real SinoBee containers. "mock": simulated runs (development) */
    mode: (process.env.RUNNER_MODE ?? "docker") as "docker" | "mock",
    image: process.env.SINOBEE_IMAGE ?? "sinobee:latest",
    concurrency: num(process.env.RUNNER_CONCURRENCY, 2),
    cpus: num(process.env.RUNNER_CPUS, 2),
    memoryMb: num(process.env.RUNNER_MEMORY_MB, 4096),
    /** Environment variables passed from the worker into user containers (model API keys, search keys) */
    passEnv: list(process.env.RUNNER_PASS_ENV ?? "OPENAI_API_KEY,ANTHROPIC_API_KEY,GEMINI_API_KEY,DEEPSEEK_API_KEY,OPENROUTER_API_KEY,BRAVE_API_KEY,TAVILY_API_KEY"),
    /** docker network for user containers (create it with egress rules you want) */
    network: process.env.RUNNER_NETWORK || undefined,
    pollSeconds: num(process.env.RUNNER_POLL_SECONDS, 10),
    maxTaskHours: num(process.env.RUNNER_MAX_TASK_HOURS, 12),
  },
};

export type AppConfig = typeof config;
