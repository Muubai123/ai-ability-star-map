export const providerPresets = [
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek 官方服务",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
    modelDescriptions: {
      "deepseek-v4-flash": "快速、低成本，适合日常生成与复盘",
      "deepseek-v4-pro": "更高质量，适合复杂星图与跨学科整理",
      "deepseek-chat": "兼容旧配置，将于 2026-07-24 退役",
      "deepseek-reasoner": "兼容旧配置，将于 2026-07-24 退役",
    },
    notes: "DeepSeek 官方 OpenAI-compatible API。默认使用 V4 Flash；旧别名仅用于兼容已有配置。",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI 官方 API",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5-mini",
    models: ["gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"],
    modelDescriptions: {
      "gpt-5.1": "高质量推理与复杂任务",
      "gpt-5": "通用高质量生成",
      "gpt-5-mini": "速度、成本和质量的平衡选择",
      "gpt-5-nano": "轻量、低成本的短任务",
      "gpt-4.1": "稳定的非推理旗舰模型",
      "gpt-4.1-mini": "快速通用模型",
      "gpt-4.1-nano": "轻量模型",
    },
    notes: "OpenAI 官方 API。",
  },
  {
    id: "dashscope",
    name: "通义千问 / DashScope",
    description: "阿里云 DashScope 兼容模式",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.6-flash",
    models: ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash", "qwen-plus", "qwen-turbo", "qwen-max"],
    modelDescriptions: {
      "qwen3.7-max": "高能力推理与复杂任务",
      "qwen3.7-plus": "通用平衡，支持工具与结构化输出",
      "qwen3.6-flash": "轻量、快速、低成本",
      "qwen-plus": "稳定通用别名",
      "qwen-turbo": "旧版快速别名",
      "qwen-max": "旧版高能力别名",
    },
    notes: "阿里云 DashScope OpenAI-compatible 模式。不同账号可用模型可能不同。",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Google Gemini OpenAI compatibility",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3-flash", "gemini-2.5-flash"],
    modelDescriptions: {
      "gemini-3.5-flash": "当前 OpenAI 兼容示例模型，快速通用",
      "gemini-3.1-flash-lite": "轻量低成本",
      "gemini-3-flash": "支持可控思考的通用模型",
      "gemini-2.5-flash": "兼容旧项目的稳定 Flash 模型",
    },
    notes: "Google Gemini OpenAI compatibility。模型名可能随 Google 更新变化。",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "统一模型路由服务",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-5-mini",
    models: [
      "openai/gpt-5-mini",
      "deepseek/deepseek-v4-flash",
      "google/gemini-3.5-flash",
      "qwen/qwen3.6-flash",
      "~openai/gpt-latest",
    ],
    modelDescriptions: {
      "openai/gpt-5-mini": "OpenAI 轻量旗舰路由",
      "deepseek/deepseek-v4-flash": "DeepSeek V4 快速路由",
      "google/gemini-3.5-flash": "Gemini 快速路由",
      "qwen/qwen3.6-flash": "Qwen 快速路由",
      "~openai/gpt-latest": "自动解析到 OpenAI 最新系列，适合愿意跟随更新的配置",
    },
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
      "Qwen/Qwen2.5-72B-Instruct",
    ],
    modelDescriptions: {
      "Qwen/Qwen3-32B": "通用中文与结构化任务",
      "deepseek-ai/DeepSeek-V3": "通用高质量模型",
      "deepseek-ai/DeepSeek-R1": "深度推理模型，响应通常更慢",
      "Qwen/Qwen2.5-72B-Instruct": "较强的通用指令模型",
    },
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
      "Qwen/Qwen2.5-72B-Instruct",
    ],
    modelDescriptions: {
      "Qwen/Qwen3-32B": "通用中文与结构化任务",
      "deepseek-ai/DeepSeek-V3": "通用高质量模型",
      "deepseek-ai/DeepSeek-R1": "深度推理模型，响应通常更慢",
      "Qwen/Qwen2.5-72B-Instruct": "较强的通用指令模型",
    },
    notes: "模型名请以 SiliconFlow 模型页为准。",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Groq OpenAI-compatible API",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-20b",
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
    modelDescriptions: {
      "openai/gpt-oss-120b": "高能力开源权重模型",
      "openai/gpt-oss-20b": "低延迟通用模型",
      "llama-3.1-8b-instant": "极速低成本模型",
    },
    notes: "Groq OpenAI-compatible API，模型名可能随平台更新。",
  },
  {
    id: "xai",
    name: "xAI / Grok",
    description: "xAI OpenAI-compatible API",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.3",
    models: ["grok-4.5", "grok-4.3", "grok-build-0.1"],
    modelDescriptions: {
      "grok-4.5": "复杂知识工作与推理",
      "grok-4.3": "通用聊天与知识任务",
      "grok-build-0.1": "编程与构建任务",
    },
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

export function getProviderModelDescription(providerId, model) {
  return getProviderPreset(providerId).modelDescriptions?.[model] || "";
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
