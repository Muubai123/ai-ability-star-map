import { getDefaultAiConfig, normalizeAiConfig, normalizeBaseUrl } from "./aiProviders.js";
import { loadAiConfig } from "./storage.js";

const DEFAULT_TIMEOUT_MS = 120000;

export async function callOpenAICompatibleChat(messages, options = {}) {
  const config = normalizeAiConfig({
    ...loadAiConfig(getDefaultAiConfig()),
    ...options,
  });
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const apiKey = config.apiKey;
  const model = config.model;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

  if (!apiKey) {
    throw new Error("请先填写 API Key。");
  }

  if (!model) {
    throw new Error("请先选择或填写模型名。");
  }

  if (!baseUrl) {
    throw new Error("请先填写 Base URL。");
  }

  let response;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error.message || "";

    if (error.name === "AbortError") {
      throw new Error("请求超时：模型生成时间过长，请稍后重试，或减少知识库参考内容后再生成。");
    }

    if (message.includes("Failed to fetch")) {
      throw new Error("请求失败：可能是浏览器跨域限制、网络问题，或服务商不允许浏览器直连。");
    }

    throw new Error(`网络请求失败：${message}`);
  } finally {
    window.clearTimeout(timeoutId);
  }

  let rawText = "";
  let data;

  try {
    rawText = await response.text();
  } catch (error) {
    const message = error.message || "";

    if (message.includes("Failed to fetch")) {
      throw new Error("响应读取失败：请求可能被浏览器中断、网络断开，或服务商的跨域响应不完整。");
    }

    throw new Error(`响应读取失败：${message}`);
  }

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    const preview = rawText.slice(0, 300).trim();
    throw new Error(
      `接口返回不是有效 JSON。响应片段：${preview || error.message}`
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      rawText.slice(0, 300).trim() ||
      `HTTP ${response.status}`;

    if (response.status === 401) {
      throw new Error(`API Key 可能错误或无权限：${message}`);
    }

    if (response.status === 429) {
      throw new Error(`额度不足或请求过多：${message}`);
    }

    if (response.status === 404) {
      throw new Error(`Base URL 或模型名可能错误：${message}`);
    }

    throw new Error(`模型接口错误：${message}`);
  }

  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("模型返回格式异常：缺少 choices[0].message.content。");
  }

  return content;
}
