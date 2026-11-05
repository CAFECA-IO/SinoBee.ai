/**
 * The model vendors the relay can call with a platform API key: one place for their names, default API addresses
 * and where an admin gets a key. Every vendor here speaks the OpenAI chat-completions format except Anthropic.
 * Used by the settings registry (apiKeys.* and llm.base.*), config.llm.providers, the catalog sync and /admin.
 * Checked 2026-11-05 against each vendor's documentation.
 *
 * Pure data: nothing here may import config or settings (the registry imports this file).
 */

export type Vendor = {
  /** the "vendor/" prefix of model ids, the apiKeys.<id> and llm.base.<id> settings */
  id: string;
  /** shown in /admin */
  name: string;
  kind: "openai" | "anthropic";
  /** environment variable that overrides the key (and is passed into task containers) */
  env: string;
  /** default API address (llm.base.<id>); the relay adds /chat/completions, /models (or /v1/messages for Anthropic) */
  base: string;
  /** where an admin creates an API key */
  keyUrl: string;
  /** one line on getting the key (the console's path when the page has no direct link; regions) */
  keyHelp: { zh: string; en: string };
};

const L = (zh: string, en: string) => ({ zh, en });

export const VENDORS: Vendor[] = [
  { id: "anthropic", name: "Anthropic", kind: "anthropic", env: "ANTHROPIC_API_KEY", base: "https://api.anthropic.com", keyUrl: "https://platform.claude.com/settings/keys", keyHelp: L("Claude Console → API keys → Create key", "Claude Console → API keys → Create key") },
  { id: "openai", name: "OpenAI", kind: "openai", env: "OPENAI_API_KEY", base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", keyHelp: L("OpenAI Platform → API keys → Create new secret key", "OpenAI Platform → API keys → Create new secret key") },
  { id: "gemini", name: "Google Gemini", kind: "openai", env: "GEMINI_API_KEY", base: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/app/apikey", keyHelp: L("Google AI Studio → Get API key", "Google AI Studio → Get API key") },
  { id: "deepseek", name: "DeepSeek", kind: "openai", env: "DEEPSEEK_API_KEY", base: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys", keyHelp: L("DeepSeek 開放平台 → API keys → 建立", "DeepSeek Platform → API keys → Create") },
  { id: "xai", name: "xAI Grok", kind: "openai", env: "XAI_API_KEY", base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai/team/default/api-keys", keyHelp: L("xAI Console → API Keys → Create API Key", "xAI Console → API Keys → Create API Key") },
  { id: "mistral", name: "Mistral AI", kind: "openai", env: "MISTRAL_API_KEY", base: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/", keyHelp: L("Mistral Studio（console.mistral.ai）左側 API Keys → Create API Key", "Mistral Studio (console.mistral.ai): API Keys in the sidebar → Create API Key") },
  { id: "qwen", name: "Qwen（阿里雲 Model Studio）", kind: "openai", env: "DASHSCOPE_API_KEY", base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyUrl: "https://www.qwencloud.com/", keyHelp: L("國際版 QwenCloud／Model Studio 的 API Keys 頁建立；中國大陸帳號的金鑰要把網址改成 https://dashscope.aliyuncs.com/compatible-mode/v1，兩區金鑰不通用", "Create it on the API Keys page of QwenCloud / Model Studio (international). Mainland China keys need https://dashscope.aliyuncs.com/compatible-mode/v1; keys do not work across regions") },
  { id: "moonshot", name: "Moonshot Kimi", kind: "openai", env: "MOONSHOT_API_KEY", base: "https://api.moonshot.ai/v1", keyUrl: "https://platform.moonshot.ai/", keyHelp: L("Kimi 開放平台（國際版）左側 API Keys 建立；中國大陸帳號的金鑰要把網址改成 https://api.moonshot.cn/v1，兩區金鑰不通用", "Kimi Platform (international): API Keys in the sidebar. Mainland China keys need https://api.moonshot.cn/v1; keys do not work across regions") },
  { id: "zai", name: "Z.ai GLM（智譜）", kind: "openai", env: "ZAI_API_KEY", base: "https://api.z.ai/api/paas/v4", keyUrl: "https://z.ai/", keyHelp: L("登入 z.ai → 右上角個人選單 → API Keys；中國大陸（BigModel）帳號的金鑰要把網址改成 https://open.bigmodel.cn/api/paas/v4", "Sign in at z.ai → profile menu (top right) → API Keys. Mainland China (BigModel) keys need https://open.bigmodel.cn/api/paas/v4") },
  { id: "openrouter", name: "OpenRouter", kind: "openai", env: "OPENROUTER_API_KEY", base: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", keyHelp: L("一把金鑰可呼叫多家模型（模型代號如 openrouter/anthropic/claude-…）；同一把也會傳進任務容器", "One key for many vendors' models (ids like openrouter/anthropic/claude-…); the same key is also passed into task containers") },
];

export const VENDOR_IDS = VENDORS.map((v) => v.id);
export const vendorById = (id: string) => VENDORS.find((v) => v.id === id);
