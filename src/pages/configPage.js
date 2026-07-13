import {
  configForProvider,
  getAiConfigIssue,
  getProviderModelDescription,
  getProviderPreset,
  providerPresets,
} from "../aiProviders.js";
import { callOpenAICompatibleChat } from "../aiApi.js";
import { saveAiConfig } from "../storage.js";
import { setPage } from "../state.js";
import { escapeHtml } from "../utils/jsonUtils.js";

export function renderConfigPage(state) {
  const ai = state.ai;
  const statusClass = ai.error ? "error" : "success";
  const isBusy = ai.isTesting || ai.isSending || ai.isGenerating;

  return `
    <main class="config-page">
      <section class="config-shell">
        ${renderConfigPanel(state, isBusy)}
        ${renderStatusPanel(ai, statusClass)}
      </section>
    </main>
  `;
}

export function bindConfigPageEvents(state, renderApp) {
  document.querySelector("#providerSelect")?.addEventListener("change", (event) => {
    state.aiConfig = configForProvider(event.target.value, state.aiConfig);
    state.ai.status = "";
    state.ai.error = "";
    renderApp();
  });

  document.querySelector("#modelSelect")?.addEventListener("change", (event) => {
    state.aiConfig.model = event.target.value;
    state.aiConfig.useCustomModel = false;
    renderApp();
  });

  document.querySelector("#useCustomModelButton")?.addEventListener("click", () => {
    state.aiConfig.useCustomModel = true;
    renderApp();
  });

  document.querySelector("#usePresetModelButton")?.addEventListener("click", () => {
    const provider = getProviderPreset(state.aiConfig.providerId);
    state.aiConfig.useCustomModel = false;
    state.aiConfig.model = provider.defaultModel || provider.models[0] || "";
    renderApp();
  });

  document.querySelector("#toggleApiKeyButton")?.addEventListener("click", () => {
    state.aiConfig = readAiConfigFromForm(state);
    state.ai.showApiKey = !state.ai.showApiKey;
    renderApp();
  });

  document.querySelector("#clearApiKeyButton")?.addEventListener("click", () => {
    state.aiConfig = readAiConfigFromForm(state);
    state.aiConfig.apiKey = "";
    renderApp();
  });

  document.querySelector("#saveAiConfigButton")?.addEventListener("click", () => {
    state.aiConfig = readAiConfigFromForm(state);
    saveAiConfig(state.aiConfig);
    state.ai.status = "配置已保存";
    state.ai.error = "";
    renderApp();
  });

  document.querySelector("#testAiButton")?.addEventListener("click", async () => {
    await testAiConnection(state, renderApp);
  });

  document.querySelector("#backToAiButton")?.addEventListener("click", () => {
    state.aiConfig = readAiConfigFromForm(state);
    saveAiConfig(state.aiConfig);

    const issue = getAiConfigIssue(state.aiConfig);

    if (issue) {
      state.ai.status = "";
      state.ai.error = issue;
      renderApp();
      return;
    }

    setPage(state.configReturnPage || "ai");
    state.configReturnPage = null;
    renderApp();
  });
}

function renderConfigPanel(state, isBusy) {
  const config = state.aiConfig;
  const provider = getProviderPreset(config.providerId);
  const hasPresetModels = provider.models.length > 0;
  const showCustomModel = config.useCustomModel || !hasPresetModels;
  const advancedOpen = provider.id === "custom" || !config.baseUrl;

  return `
    <section class="ai-card ai-config-card config-card-large">
      <div class="panel-heading config-heading">
        <div>
          <h2>模型配置</h2>
          <p>选择服务商、填入 Key，并确认模型名。聊天和生成星图都会使用这里的配置。</p>
        </div>
        <button id="backToAiButton" type="button" ${isBusy ? "disabled" : ""}>
          ${getConfigReturnLabel(state.configReturnPage)}
        </button>
      </div>

      <div class="provider-select-block">
        <label>
          <span>服务商</span>
          <select id="providerSelect" class="provider-select" ${isBusy ? "disabled" : ""}>
            ${providerPresets
              .map(
                (item) => `
                  <option value="${item.id}" ${
                    item.id === config.providerId ? "selected" : ""
                  }>
                    ${escapeHtml(item.name)}
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
      </div>

      <div class="provider-note">
        <strong>${escapeHtml(provider.description || provider.name)}</strong>
        <p>${escapeHtml(provider.notes || "")}</p>
        <p>模型名和可用性以服务商控制台为准。</p>
        <p>浏览器直连某些服务商可能遇到 CORS，测试失败不一定代表 Key 错误。</p>
      </div>

      <div class="ai-config">
        <label>
          <span>API Key</span>
          <input
            id="aiApiKey"
            type="${state.ai.showApiKey ? "text" : "password"}"
            value="${escapeHtml(config.apiKey)}"
            placeholder="sk-..."
            autocomplete="off"
          />
        </label>

        <div class="key-actions">
          <button id="toggleApiKeyButton" type="button" ${isBusy ? "disabled" : ""}>
            ${state.ai.showApiKey ? "隐藏" : "显示"}
          </button>
          <button id="clearApiKeyButton" type="button" ${isBusy ? "disabled" : ""}>
            清空 Key
          </button>
        </div>

        <p class="api-key-note">
          API Key 仅保存在当前浏览器 localStorage 中，请使用可控额度的 Key。
        </p>

        ${renderModelPicker(config, provider, showCustomModel, isBusy)}

        <details class="advanced-settings" ${advancedOpen ? "open" : ""}>
          <summary>高级设置</summary>
          <label>
            <span>Base URL</span>
            <input
              id="aiBaseUrl"
              type="text"
              value="${escapeHtml(config.baseUrl)}"
              placeholder="${escapeHtml(provider.baseUrl || "https://example.com/v1")}"
            />
          </label>
          <p class="endpoint-note">
            当前请求会自动拼接 <code>/chat/completions</code>，末尾斜杠会自动处理。
          </p>
        </details>

        <div class="ai-actions">
          <button id="saveAiConfigButton" type="button" ${isBusy ? "disabled" : ""}>
            保存配置
          </button>
          <button id="testAiButton" type="button" ${isBusy ? "disabled" : ""}>
            ${state.ai.isTesting ? "测试中..." : "测试连接"}
          </button>
        </div>
      </div>
    </section>
  `;
}

function getConfigReturnLabel(returnPage) {
  if (returnPage === "map") return "返回星图";
  if (returnPage === "exploration_workspace") return "返回探索";
  return "返回创建星图";
}

function renderModelPicker(config, provider, showCustomModel, isBusy) {
  if (showCustomModel) {
    return `
      <label>
        <span>模型名</span>
        <input
          id="aiModel"
          type="text"
          value="${escapeHtml(config.model)}"
          placeholder="${escapeHtml(provider.defaultModel || "model-name")}"
        />
      </label>
      ${
        provider.models.length > 0
          ? `
            <button id="usePresetModelButton" type="button" ${isBusy ? "disabled" : ""}>
              使用预设模型
            </button>
          `
          : ""
      }
    `;
  }

  return `
    <label>
      <span>模型</span>
      <select id="modelSelect" ${isBusy ? "disabled" : ""}>
        ${provider.models
          .map(
            (model) => `
              <option value="${model}" ${model === config.model ? "selected" : ""}>
                ${escapeHtml(model)}${getProviderModelDescription(provider.id, model) ? ` - ${escapeHtml(getProviderModelDescription(provider.id, model))}` : ""}
              </option>
            `
          )
          .join("")}
      </select>
    </label>
    <button id="useCustomModelButton" type="button" ${isBusy ? "disabled" : ""}>
      使用自定义模型名
    </button>
  `;
}

function renderStatusPanel(ai, statusClass) {
  if (!ai.status && !ai.error && !ai.rawOutput) return "";

  return `
    <section class="ai-card config-status-card">
      ${
        ai.status || ai.error
          ? `<div class="ai-status ${statusClass}">${escapeHtml(
              ai.error || ai.status
            )}</div>`
          : ""
      }
      ${
        ai.rawOutput
          ? `
            <details class="raw-output" open>
              <summary>模型原始输出</summary>
              <pre>${escapeHtml(ai.rawOutput)}</pre>
            </details>
          `
          : ""
      }
    </section>
  `;
}

function readAiConfigFromForm(state) {
  const provider = getProviderPreset(
    document.querySelector("#providerSelect")?.value || state.aiConfig.providerId
  );
  const useCustomModel =
    provider.id === "custom" ||
    provider.models.length === 0 ||
    state.aiConfig.useCustomModel;
  const model = useCustomModel
    ? document.querySelector("#aiModel")?.value.trim() || ""
    : document.querySelector("#modelSelect")?.value || provider.defaultModel || "";

  return {
    providerId: provider.id,
    baseUrl: document.querySelector("#aiBaseUrl")?.value.trim() || provider.baseUrl,
    apiKey: document.querySelector("#aiApiKey")?.value.trim() || "",
    model,
    useCustomModel,
  };
}

async function testAiConnection(state, renderApp) {
  state.aiConfig = readAiConfigFromForm(state);
  saveAiConfig(state.aiConfig);
  state.ai.status = "正在测试连接...";
  state.ai.error = "";
  state.ai.rawOutput = "";
  state.ai.isTesting = true;
  renderApp();

  try {
    const content = await callOpenAICompatibleChat(
      [
        { role: "system", content: "你是一个简洁的测试助手。" },
        { role: "user", content: "请只回复：连接成功" },
      ],
      state.aiConfig
    );

    state.ai.status = content.includes("连接成功")
      ? "连接成功"
      : `连接成功，模型回复：${content}`;
    state.ai.error = "";
  } catch (error) {
    state.ai.status = "";
    state.ai.error = error.message;
  } finally {
    state.ai.isTesting = false;
    renderApp();
  }
}
