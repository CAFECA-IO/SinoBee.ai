import { sv, svBool, svList, svNum } from "./settings/cache";

/**
 * Central runtime configuration.
 *
 * Bootstrap values come from the environment (.env): DATABASE_URL / SQLITE_PATH, PUBLIC_ORIGIN, OWNER_ACCOUNT,
 * DEV_LOGIN, SECRETS_KEY. Everything else is a setting (src/lib/settings/registry.ts) kept in the database —
 * secrets encrypted — and edited in /admin → Settings; a variable set in the process environment still wins.
 * All getters read an in-memory cache, so they are cheap and synchronous.
 */

export const config = {
  /** Public origin of this site, e.g. https://sinobee.ai — must match exactly what users sign */
  get origin() {
    return (process.env.PUBLIC_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  },
  /** CAFECA wallet origin (Sign in with CAFECA, signing channel) */
  get cafecaWallet() {
    return sv("cafeca.wallet").replace(/\/$/, "");
  },
  get cafecaRpcUrl() {
    return sv("cafeca.rpcUrl") || undefined;
  },
  /** Optional webhook used to push notifications to users through CAFECA */
  get cafecaNotifyUrl() {
    return sv("cafeca.notifyUrl") || undefined;
  },
  get cafecaNotifyToken() {
    return sv("cafeca.notifyToken") || undefined;
  },
  /**
   * Site owner (CAFECA account, lowercase). Its first sign-in makes it SUPERADMIN. When empty, a one-time claim code
   * is printed in the server log at startup instead (see src/lib/roles.ts).
   */
  get ownerAccount() {
    return (process.env.OWNER_ACCOUNT ?? "").trim().toLowerCase() || undefined;
  },
  set ownerAccount(v: string | undefined) {
    // tests switch the owner on and off
    if (v) process.env.OWNER_ACCOUNT = v;
    else delete process.env.OWNER_ACCOUNT;
  },
  /** Shown in the Terms, Privacy and Refund policies (/terms, /privacy, /refunds) */
  legal: {
    get entity() {
      return sv("legal.entity");
    },
    get website() {
      return sv("legal.website");
    },
    get taxId() {
      return sv("legal.taxId");
    },
    get address() {
      return sv("legal.address");
    },
    get email() {
      return sv("legal.email");
    },
    get effective() {
      return sv("legal.effective");
    },
  },
  /** Accounts that start as ADMIN when they first sign in (later role changes in /admin are never overwritten) */
  get adminAccounts() {
    return svList("admins.initial").map((a) => a.toLowerCase());
  },

  payments: {
    /** payment provider in /admin → Settings (only Oen today) */
    get provider() {
      return sv("payments.provider") as "oen";
    },
    /** "oen" = the provider's real checkout; "mock" = local fake checkout (development only) */
    get mode() {
      return (sv("payments.mode") === "mock" ? "mock" : "oen") as "oen" | "mock";
    },
  },

  /** Oen payments (https://developer.oen.tw) */
  /** Test mode (admin switch): TEST ribbon, Oen testing environment for every new payment and card */
  get testMode() {
    return svBool("site.testMode");
  },

  oen: {
    /** environment for new payments and cards: always "testing" in test mode */
    get env() {
      return (svBool("site.testMode") || sv("oen.env") !== "production" ? "testing" : "production") as "production" | "testing";
    },
    /** your Oen domain, e.g. "sinobee" for https://sinobee.oen.tw */
    get merchantId() {
      return this.for(svBool("site.testMode")).merchantId;
    },
    get token() {
      return this.for(svBool("site.testMode")).token;
    },
    get apiBase() {
      return this.for(svBool("site.testMode")).apiBase;
    },
    get checkoutBase() {
      return this.for(svBool("site.testMode")).checkoutBase;
    },
    /** Credentials and URLs for a record made in test mode (sandbox) or not */
    for(sandbox: boolean) {
      const env = sandbox || sv("oen.env") !== "production" ? "testing" : "production";
      const merchantId = (sandbox && sv("oen.testMerchantId")) || sv("oen.merchantId");
      const token = (sandbox && sv("oen.testToken")) || sv("oen.token");
      // an explicit API / checkout URL (tests, proxies) applies to both
      const apiBase = (sv("oen.apiBase") || (env === "production" ? "https://payment-api.oen.tw" : "https://payment-api.testing.oen.tw")).replace(/\/$/, "");
      const checkoutBase = (sv("oen.checkoutBase") || `https://${merchantId}.${env === "production" ? "" : "testing."}oen.tw`).replace(/\/$/, "");
      return { env, merchantId, token, apiBase, checkoutBase };
    },
  },

  pricing: {
    /** Markup on VM and storage costs (model tokens are billed at the published price instead) */
    get markup() {
      return svNum("pricing.markup");
    },
    /** legacy USD→TWD default; the live base FX rate is set in /admin (Model prices) */
    usdTwd: 32.5,
    get vmHourlyUsd() {
      return svNum("pricing.vmHourlyUsd");
    },
    get s3GbMonthUsd() {
      return svNum("pricing.s3GbMonthUsd");
    },
    get s3PutPer1kUsd() {
      return svNum("pricing.s3PutPer1kUsd");
    },
    get s3GetPer1kUsd() {
      return svNum("pricing.s3GetPer1kUsd");
    },
  },

  retention: {
    /** delete expired results and idle containers; off = only mark them expired (deletion paused) */
    get deleteExpired() {
      return svBool("retention.delete");
    },
    get freeDays() {
      return svNum("retention.freeDays");
    },
    get subscriberDays() {
      return svNum("retention.subscriberDays");
    },
  },

  subscription: {
    /** results and containers stay this many days after the last subscription period ends */
    get graceDays() {
      return svNum("subscription.graceDays");
    },
  },

  storage: {
    get driver() {
      return (sv("storage.driver") === "s3" ? "s3" : "local") as "local" | "s3";
    },
    get localDir() {
      return sv("storage.localDir");
    },
    get s3Bucket() {
      return sv("storage.s3Bucket");
    },
    get s3Region() {
      return sv("storage.s3Region");
    },
    /** explicit credentials; empty → the AWS default chain (instance role, ~/.aws) */
    get s3Credentials() {
      const accessKeyId = sv("storage.s3AccessKeyId");
      const secretAccessKey = sv("storage.s3SecretAccessKey");
      return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
    },
  },

  /**
   * Boltchain storage (SwarmStorage deals) and notarization (Certificates). Every stored object is
   * sealed with bolt-vault and kept by storage providers; the site wallet pays in BOLT.
   * Enabled when a node RPC is set (the wallet and master keys are generated automatically).
   */
  boltchain: {
    get enabled() {
      return !!(sv("boltchain.rpcUrl") && sv("boltchain.walletKey") && sv("boltchain.masterKey"));
    },
    /** JSON-RPC of the site's own node, started with --rpc-storage (it serves bolt_hostBlocks / bolt_getBlocks) */
    get rpcUrl() {
      return sv("boltchain.rpcUrl") || "http://127.0.0.1:8545";
    },
    get chainId() {
      return svNum("boltchain.chainId");
    },
    /** site wallet private key (pays deals and certificates) */
    get walletKey() {
      return sv("boltchain.walletKey");
    },
    /** 32-byte key (hex or base64) that encrypts each object's vault key; destroying an object key crypto-shreds it */
    get masterKey() {
      return sv("boltchain.masterKey");
    },
    /** Certificates contract (ADR 0016); empty → content hashes are not notarized */
    get certificates() {
      return sv("boltchain.certificates").toLowerCase();
    },
    get explorer() {
      return sv("boltchain.explorer").replace(/\/$/, "");
    },
    get replicas() {
      return svNum("boltchain.replicas");
    },
    /** epochs bought per deal / per renewal (testnet epoch ≈ 1–2 h) */
    get epochs() {
      return svNum("boltchain.epochs");
    },
    /** seconds per epoch, to turn "keep until" dates into epochs */
    get epochSeconds() {
      return svNum("boltchain.epochSeconds");
    },
    /** alert admins when the site wallet holds less than this (wei); default 10 BOLT */
    get lowBalanceWei() {
      return sv("boltchain.lowBalanceWei");
    },
    /** renew when fewer than this many epochs remain */
    get renewBelow() {
      return svNum("boltchain.renewBelow");
    },
    /** highest price accepted, BOLT per GiB per epoch (wei); empty → no cap */
    get maxPriceWei() {
      return sv("boltchain.maxPriceWei");
    },
    /** keep a mirror copy in local/S3 storage for fast reads (Boltchain stays the system of record) */
    get mirror() {
      return svBool("boltchain.mirror");
    },
  },

  /** Crowdfunded tasks (src/lib/crowd) */
  crowd: {
    get facebookAppId() {
      return sv("crowd.facebookAppId") || "";
    },
    get xSite() {
      const v = (sv("crowd.xSite") || "").trim();
      return v ? (v.startsWith("@") ? v : `@${v}`) : "";
    },
    get ogFontUrl() {
      return sv("crowd.ogFontUrl") || "https://fonts.googleapis.com/css2?family=Noto+Sans+TC";
    },
    get sharePrice() {
      return svNum("crowd.sharePrice");
    },
    get proposalFee() {
      return svNum("crowd.proposalFee");
    },
    /** duration (days) → service fee rate, e.g. {7: 0, 30: 0.03} */
    get feeRates(): Record<number, number> {
      const out: Record<number, number> = {};
      for (const part of sv("crowd.feeRates").split(",")) {
        const [d, r] = part.split(":").map((x) => Number(x.trim()));
        if (Number.isInteger(d) && d > 0 && Number.isFinite(r) && r >= 0 && r < 1) out[d] = r;
      }
      return out;
    },
    get freeFileBytes() {
      return svNum("crowd.freeFileMb") * 1024 * 1024;
    },
    get blockBytes() {
      return Math.max(1, svNum("crowd.blockMb")) * 1024 * 1024;
    },
    get maxFileBytes() {
      return svNum("crowd.maxFileMb") * 1024 * 1024;
    },
    get chargeGraceDays() {
      return svNum("crowd.chargeGraceDays");
    },
    get quotaPeriodShare() {
      return svNum("crowd.quotaPeriodShare");
    },
    get quotaTaskShare() {
      return svNum("crowd.quotaTaskShare");
    },
    get resultsDays() {
      return svNum("crowd.resultsDays");
    },
    get reviewDays() {
      return svNum("crowd.reviewDays");
    },
    get approveShare() {
      return svNum("crowd.approveShare");
    },
    get maxReworks() {
      return svNum("crowd.maxReworks");
    },
    get exitHours() {
      return svNum("crowd.exitHours");
    },
    get topupDays() {
      return svNum("crowd.topupDays");
    },
    get screening() {
      return (sv("crowd.screening") === "off" ? "off" : "ai") as "ai" | "off";
    },
    get pledgeMinKyc() {
      return svNum("crowd.pledgeMinKyc");
    },
    get voteMinKyc() {
      return svNum("crowd.voteMinKyc");
    },
  },

  /** Model relay for subscribers (/api/v1/llm/*); platform keys are settings (apiKeys.*) */
  llm: {
    providers: {
      anthropic: { kind: "anthropic" as const, get base() { return sv("llm.base.anthropic"); }, get key() { return sv("apiKeys.anthropic"); } },
      openai: { kind: "openai" as const, get base() { return sv("llm.base.openai"); }, get key() { return sv("apiKeys.openai"); } },
      gemini: { kind: "openai" as const, get base() { return sv("llm.base.gemini"); }, get key() { return sv("apiKeys.gemini"); } },
      deepseek: { kind: "openai" as const, get base() { return sv("llm.base.deepseek"); }, get key() { return sv("apiKeys.deepseek"); } },
    } as Record<string, { kind: "openai" | "anthropic"; readonly base: string; readonly key: string }>,
    get rpm() {
      return svNum("llm.rpm");
    },
    get maxOutputTokens() {
      return svNum("llm.maxOutputTokens");
    },
    get defaultOutputTokens() {
      return svNum("llm.defaultOutputTokens");
    },
    get defaultAvgOutput() {
      return svNum("llm.defaultAvgOutput");
    },
    get topUpTokens() {
      return svNum("llm.topUpTokens");
    },
    get holdTimeoutMs() {
      return svNum("llm.holdTimeoutS") * 1000;
    },
    /** only accept requests signed with a device key (P5) */
    get requireSignature() {
      return svBool("llm.requireSignature");
    },
    /** per-provider daily spend cap in TWD at published prices (0 = off); LLM_DAILY_LIMIT_TWD_<PROVIDER> overrides */
    dailyLimit(provider: string) {
      const per = Number(process.env[`LLM_DAILY_LIMIT_TWD_${provider.toUpperCase()}`]);
      return Number.isFinite(per) && per > 0 ? per : svNum("llm.dailyLimitTwd");
    },
  },

  hub: {
    /** base64 PKCS8 DER ed25519 private key used to sign approved skill versions (generated automatically) */
    get signingKey() {
      return sv("hub.signingKey");
    },
    /** earlier public keys, still published so existing signatures verify */
    get previousKeys() {
      return svList("hub.previousKeys");
    },
    maxBundleBytes: 20 * 1024 * 1024,
    maxFiles: 500,
  },

  runner: {
    /** "docker": real SinoBee containers. "mock": simulated runs (development) */
    get mode() {
      return (sv("runner.mode") === "mock" ? "mock" : "docker") as "docker" | "mock";
    },
    get image() {
      return sv("runner.image");
    },
    get concurrency() {
      return svNum("runner.concurrency");
    },
    get cpus() {
      return svNum("runner.cpus");
    },
    get memoryMb() {
      return svNum("runner.memoryMb");
    },
    /** API keys passed into user containers: env name → value (only the ones that are set) */
    get containerEnv(): [string, string][] {
      const keys = ["anthropic", "openai", "gemini", "deepseek", "openrouter", "brave", "tavily"];
      const env: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", deepseek: "DEEPSEEK_API_KEY", openrouter: "OPENROUTER_API_KEY", brave: "BRAVE_API_KEY", tavily: "TAVILY_API_KEY" };
      const keyed = keys.map((k) => [env[k], sv(`apiKeys.${k}`)] as [string, string]).filter(([, v]) => !!v);
      // services the swarm runs for tasks (Ollama, ComfyUI with MiniMax H3): "NAME=url,NAME=url"
      const services = (process.env.SINOBEE_TASK_SERVICES ?? "")
        .split(",")
        .map((x) => x.split("=") as [string, string])
        .filter(([k, v]) => /^[A-Z_]+$/.test(k ?? "") && /^https?:\/\//.test(v ?? ""));
      return [...keyed, ...services];
    },
    /** docker network for user containers (create it with the egress rules you want) */
    get network() {
      return sv("runner.network") || undefined;
    },
    get pollSeconds() {
      return svNum("runner.pollSeconds");
    },
    get maxTaskHours() {
      return svNum("runner.maxTaskHours");
    },
  },
};

export type AppConfig = typeof config;
