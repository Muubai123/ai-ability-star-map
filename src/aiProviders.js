export const providerPresets = [
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek 官方服务",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    notes: "DeepSeek 官方 OpenAI-compatible API。",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI 官方 API",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-4o-mini"],
    notes: "OpenAI 官方 API。",
  },
  {
    id: "dashscope",
    name: "通义千问 / DashScope",
    description: "阿里云 DashScope 兼容模式",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
    notes: "阿里云 DashScope OpenAI-compatible 模式。不同账号可用模型可能不同。",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Google Gemini OpenAI compatibility",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-3.5-flash"],
    notes: "Google Gemini OpenAI compatibility。模型名可能随 Google 更新变化。",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "统一模型路由服务",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    models: [
      "openai/gpt-4o-mini",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat",
      "anthropic/claude-sonnet-4.5",
    ],
    notes: "OpenRouter 统一模型路由。模型名以 OpenRouter 页面为准。",
  },
  {
    id: "siliconflow-global",
    name: "SiliconFlow 国际站",
    description: "SiliconFlow 国际站 API",
    baseUrl: "https://api.siliconflow.com/v1",
    defaultModel: "Qwen/Qwen3-32B",
    models: [
      "Qwen/Qwen3-32B",
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
    ],
    notes: "模型名请以 SiliconFlow 模型页为准。",
  },
  {
    id: "siliconflow-cn",
    name: "SiliconFlow 国内站",
    description: "SiliconFlow 国内站 API",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen3-32B",
    models: [
      "Qwen/Qwen3-32B",
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
    ],
    notes: "模型名请以 SiliconFlow 模型页为准。",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Groq OpenAI-compatible API",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
    notes: "Groq OpenAI-compatible API，模型名可能随平台更新。",
  },
  {
    id: "xai",
    name: "xAI / Grok",
    description: "xAI OpenAI-compatible API",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    models: ["grok-4", "grok-4.3"],
    notes: "xAI OpenAI-compatible API。",
  },
  {
    id: "custom",
    name: "自定义 OpenAI-compatible",
    description: "自定义兼容服务",
    baseUrl: "",
    defaultModel: "",
    models: [],
    notes: "适用于任何兼容 /chat/completions 的服务。",
  },
];

export function getProviderPreset(providerId) {
  return (
    providerPresets.find((provider) => provider.id === providerId) ||
    providerPresets[0]
  );
}

export function getDefaultAiConfig() {
  const provider = getProviderPreset("deepseek");

  return {
    providerId: provider.id,
    baseUrl: provider.baseUrl,
    apiKey: "",
    model: provider.defaultModel,
    useCustomModel: false,
  };
}

export function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

export function normalizeAiConfig(config = {}) {
  const fallback = getDefaultAiConfig();
  const provider = getProviderPreset(config.providerId || fallback.providerId);
  const hasModels = provider.models.length > 0;
  const useCustomModel =
    provider.id === "custom" || !hasModels || Boolean(config.useCustomModel);

  return {
    providerId: provider.id,
    baseUrl:
      typeof config.baseUrl === "string" ? config.baseUrl : provider.baseUrl,
    apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
    model:
      typeof config.model === "string" && config.model
        ? config.model
        : provider.defaultModel || provider.models[0] || "",
    useCustomModel,
  };
}

export function configForProvider(providerId, currentConfig = {}) {
  const provider = getProviderPreset(providerId);
  const hasModels = provider.models.length > 0;

  return normalizeAiConfig({
    providerId: provider.id,
    baseUrl: provider.baseUrl,
    apiKey: currentConfig.apiKey || "",
    model: provider.defaultModel || provider.models[0] || "",
    useCustomModel: provider.id === "custom" || !hasModels,
  });
}

export function getAiConfigIssue(config = {}) {
  const normalized = normalizeAiConfig(config);

  if (!normalized.apiKey) {
    return "请先填写 API Key。";
  }

  if (!normalized.model) {
    return "请先选择或填写模型名。";
  }

  if (!normalizeBaseUrl(normalized.baseUrl)) {
    return "请先填写 Base URL。";
  }

  return "";
}
