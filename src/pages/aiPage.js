import { callOpenAICompatibleChat } from "../aiApi.js";
import { getAiConfigIssue } from "../aiProviders.js";
import {
  createSession,
  deleteSessionAndAssociatedMap,
  resolveSessionMapId,
  saveActiveSession,
  setPage,
  setStarMap,
  switchSession,
} from "../state.js";
import {
  escapeHtml,
  extractJsonFromText,
  parseJsonFromText,
  validateAndNormalizeMap,
} from "../utils/jsonUtils.js";
import {
  buildKnowledgeContext,
  findRelevantKnowledge,
} from "../utils/knowledgeUtils.js";
import { addKnowledgeBase, deleteKnowledgeBase } from "../appData.js";
import { createKnowledgeBaseRecord, scanMarkdownKnowledgeBase } from "../knowledge/knowledgeStore.js";

const requirementSystemPrompt = `
你是能力星图需求访谈助手。
目标：通过多轮对话收集用户需求，不直接生成星图。
你需要判断信息是否足够生成能力星图。
如果信息不足，继续追问最关键的 1-2 个问题。
如果信息足够，给出简洁确认回复，并将 status 设为 ready_to_confirm。

你必须输出严格 JSON，不要 Markdown，不要代码块，不要解释。
JSON 格式：
{
  "reply": "给用户看的自然语言回复",
  "status": "collecting",
  "summary": {
    "title": "",
    "goal": "",
    "currentLevel": "",
    "purpose": "",
    "detailLevel": "",
    "preferences": ""
  }
}
status 只能是 "collecting" 或 "ready_to_confirm"。
summary 字段无法确定时用空字符串。
`.trim();

const mapGenerationSystemPrompt = `
你是能力星图结构生成器。
目标：根据已确认 summary 生成能力星图 JSON。
只能输出严格 JSON，只能是星图数据。
不要 Markdown，不要代码块，不要解释。
`.trim();

const MIN_GENERATED_DEPTH = 5;
const MIN_GENERATED_NODE_COUNT = 30;
const MIN_GENERATED_LEAF_COUNT = 16;

export function renderAiPage(state) {
  const ai = state.ai;
  const statusClass = ai.error ? "error" : "success";
  const isBusy = ai.isTesting || ai.isSending || ai.isGenerating;

  return `
    <main class="ai-page">
      <section class="ai-layout">
        ${renderAiSessionSidebar(state)}
        <section class="ai-workspace">
          <section class="chat-panel">
            <div class="panel-heading chat-heading">
              <div>
                <h2>AI 需求访谈</h2>
                <p>AI 会先在对话中整理目标与范围，确认后才会生成星图。</p>
              </div>
              <button id="openConfigButton" type="button">
                模型配置
              </button>
            </div>

            ${renderInlineStatus(ai, statusClass)}

            <div class="chat-messages" id="chatMessages">
              ${ai.messages.map(renderChatMessage).join("")}
            </div>

            <div class="chat-input-row">
              <textarea
                id="chatInput"
                rows="1"
                placeholder="告诉 AI 你的目标、用途、当前基础，或补充你的偏好。"
                ${isBusy ? "disabled" : ""}
              >${escapeHtml(ai.draft || "")}</textarea>
              <button id="sendChatButton" class="chat-send-button" type="button" aria-label="发送消息" title="发送消息" ${isBusy ? "disabled" : ""}>
                <span aria-hidden="true">↑</span>
              </button>
            </div>
          </section>

          ${renderKnowledgePanel(state, isBusy)}
        </section>
      </section>
    </main>
  `;
}

export function bindAiPageEvents(state, renderApp) {
  document.querySelectorAll("[data-ai-session-id]").forEach((button) => {
    button.addEventListener("click", () => {
      switchSession(button.dataset.aiSessionId);
      state.ai.stickToBottom = true;
      state.ai.restoreFocus = true;
      renderApp();
    });
  });

  document.querySelectorAll("[data-delete-ai-session]").forEach((button) => {
    button.addEventListener("click", () => {
      const session = state.sessions.find((item) => item.id === button.dataset.deleteAiSession);
      if (!session) return;
      const mapId = resolveSessionMapId(session, state.appData.maps);
      const warning = mapId
        ? `删除对话“${session.title}”后，对应星图也会删除。确定继续吗？`
        : `确定删除对话“${session.title}”吗？`;
      if (!window.confirm(warning)) return;
      deleteSessionAndAssociatedMap(session.id);
      renderApp();
    });
  });

  document.querySelector("#newAiSessionButton")?.addEventListener("click", () => {
    createSession("新的能力星图");
    state.ai.restoreFocus = true;
    renderApp();
  });

  document.querySelector("#openConfigButton")?.addEventListener("click", () => {
    state.configReturnPage = "ai";
    setPage("config");
    renderApp();
  });

  document.querySelector("#testAiButton")?.addEventListener("click", async () => {
    await testAiConnection(state, renderApp);
  });

  document.querySelector("#sendChatButton")?.addEventListener("click", async () => {
    await sendChatMessage(state, renderApp);
  });

  const chatInput = document.querySelector("#chatInput");
  chatInput?.addEventListener("input", (event) => {
    state.ai.draft = event.target.value;
  });
  chatInput?.addEventListener("blur", () => saveActiveSession());
  chatInput?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    await sendChatMessage(state, renderApp);
  });

  document.querySelector("#chatMessages")?.addEventListener("scroll", (event) => {
    const element = event.currentTarget;
    state.ai.chatScrollTop = element.scrollTop;
    state.ai.stickToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  });

  document.querySelector("#confirmGenerateButton")?.addEventListener("click", async () => {
    await generateConfirmedMap(state, renderApp);
  });

  document.querySelectorAll("[data-confirm-generate]").forEach((button) => {
    button.addEventListener("click", async () => { await generateConfirmedMap(state, renderApp); });
  });

  document.querySelectorAll("[data-view-generated-map]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mapEntryContext = { sourceView: "ai", mode: state.currentMode };
      setPage("map");
      renderApp();
    });
  });

  document.querySelector("#continueRequirementButton")?.addEventListener("click", () => {
    state.ai.summary = null;
    state.ai.status = "可以继续补充需求。";
    state.ai.error = "";
    state.ai.generationSteps = [];
    saveActiveSession();
    renderApp();
  });

  document.querySelectorAll("[data-continue-requirement]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ai.summary = null;
      state.ai.status = "可以继续补充需求。";
      state.ai.error = "";
      saveActiveSession();
      renderApp();
    });
  });

  document.querySelector("#knowledgeUploadInput")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await uploadKnowledgeFile(state, file, renderApp);
  });

  document.querySelectorAll("[data-delete-knowledge]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteKnowledgeBase(state.appData, button.dataset.deleteKnowledge);
      state.knowledge.selectedId = "";
      renderApp();
    });
  });

  restoreAiChatUi(state);
}

function renderAiSessionSidebar(state) {
  return `
    <section class="ai-session-sidebar">
      <div class="session-sidebar-header">
        <div>
          <h2>对话</h2>
          <p>星图和对话会保存到当前浏览器。</p>
        </div>
        <button id="newAiSessionButton" type="button">新建</button>
      </div>

      <div class="session-list">
        ${state.sessions
          .map((session) => renderSessionButton(session, state.activeSessionId))
          .join("")}
      </div>
    </section>
  `;
}

function renderSessionButton(session, activeSessionId) {
  const userMessageCount = (session.ai?.messages || []).filter(
    (message) => message.role === "user"
  ).length;
  const updatedAt = session.updatedAt
    ? new Date(session.updatedAt).toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
      })
    : "";

  const isBusy = session.ai?.isSending || session.ai?.isGenerating || session.ai?.isTesting;
  return `
    <div class="session-list-row">
      <button
        class="session-list-item ${session.id === activeSessionId ? "active" : ""}"
        data-ai-session-id="${session.id}"
        type="button"
      >
        <strong>${escapeHtml(session.title)}</strong>
        <span>${userMessageCount} 条输入${updatedAt ? ` · ${updatedAt}` : ""}</span>
      </button>
      <button
        class="session-delete-button"
        data-delete-ai-session="${session.id}"
        type="button"
        aria-label="删除对话：${escapeHtml(session.title)}"
        title="删除对话${session.mapId || session.map ? "及对应星图" : ""}"
        ${isBusy ? "disabled" : ""}
      >×</button>
    </div>
  `;
}

function restoreAiChatUi(state) {
  window.requestAnimationFrame(() => {
    const messages = document.querySelector("#chatMessages");
    const input = document.querySelector("#chatInput");
    if (messages) {
      messages.scrollTop = state.ai.stickToBottom !== false
        ? messages.scrollHeight
        : Math.min(Number(state.ai.chatScrollTop) || 0, messages.scrollHeight);
    }
    if (input && state.ai.restoreFocus && !state.ai.isSending && !state.ai.isGenerating) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
      state.ai.restoreFocus = false;
    }
  });
}

function renderInlineStatus(ai, statusClass) {
  if (!ai.status && !ai.error) {
    return "";
  }

  return `
    <div class="chat-status-block">
      ${
        ai.status || ai.error
          ? `<div class="ai-status ${statusClass}">${escapeHtml(
              ai.error || ai.status
            )}</div>`
          : ""
      }
    </div>
  `;
}

function renderGenerationSteps(steps) {
  if (!steps.length) return "";

  return `
    <div class="generation-steps">
      ${steps
        .map(
          (step) => `
            <div class="generation-step ${step.status}">
              <span class="step-dot"></span>
              <div>
                <strong>${escapeHtml(step.label)}</strong>
                ${step.detail ? `<p>${escapeHtml(step.detail)}</p>` : ""}
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderChatMessage(message) {
  if (message.type === "generation") {
    return renderGenerationMessage(message);
  }

  if (message.type === "requirement_summary") {
    return renderRequirementSummaryMessage(message);
  }

  return `
    <div class="chat-message ${message.role}">
      <div class="message-role">${message.role === "user" ? "你" : "AI"}</div>
      <div class="message-content">${escapeHtml(message.content)}</div>
    </div>
  `;
}

function renderRequirementSummaryMessage(message) {
  const rows = [
    ["星图主题", message.summary?.title],
    ["用户目标", message.summary?.goal],
    ["当前基础", message.summary?.currentLevel],
    ["用途", message.summary?.purpose],
    ["详细程度", message.summary?.detailLevel],
    ["特殊偏好", message.summary?.preferences],
  ];
  return `<div class="chat-message assistant requirement-summary-message"><div class="message-role">AI</div><div class="message-content"><strong>需求总结</strong><p>${escapeHtml(message.content || "我已整理好本次星图需求，请确认。")}</p><div class="inline-summary-list">${rows.map(([label, value]) => `<div><span>${label}</span><b>${escapeHtml(value || "未明确")}</b></div>`).join("")}</div><div class="inline-summary-actions"><button data-confirm-generate type="button">确认生成星图</button><button data-continue-requirement type="button">继续补充需求</button></div></div></div>`;
}

function renderGenerationMessage(message) {
  return `
    <div class="chat-message assistant generation-message">
      <div class="message-role">AI</div>
      <div class="message-content generation-content">
        <div class="generation-message-header">
          <strong>生成过程</strong>
          <span>${getGenerationMessageStatus(message)}</span>
        </div>
        ${renderGenerationSteps(message.steps || [])}
        ${
          message.canViewMap
            ? `
              <button
                class="view-generated-map-button"
                data-view-generated-map
                type="button"
              >
                查看星图
              </button>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function getGenerationMessageStatus(message) {
  if (message.status === "error") return "生成失败";
  if (message.status === "done") return "已完成";
  return "进行中";
}

function renderKnowledgePanel(state, isBusy) {
  const knowledgeBases = state.appData.knowledgeBases || [];
  return `<aside class="knowledge-panel"><div class="panel-heading"><div><h2>知识库</h2><p>所有对话共用；删除不会影响已生成的星图。</p></div></div><label class="knowledge-upload-control ${isBusy || state.knowledge.isUploading ? "disabled" : ""}"><input id="knowledgeUploadInput" type="file" accept=".md,text/markdown" ${isBusy || state.knowledge.isUploading ? "disabled" : ""}><span>${state.knowledge.isUploading ? "正在扫描 Markdown…" : "上传 Markdown 资料"}</span></label><div class="knowledge-library-list">${knowledgeBases.length ? knowledgeBases.map((item) => `<article class="knowledge-subject-card" title="${escapeHtml(item.subject || item.name || "未命名学科")}"><strong>${escapeHtml(item.subject || item.name || "未命名学科")}</strong><button data-delete-knowledge="${escapeHtml(item.id)}" type="button" aria-label="删除知识库：${escapeHtml(item.subject || item.name || "未命名学科")}" title="删除">×</button></article>`).join("") : `<p class="knowledge-library-empty">暂无知识库。上传 .md 文件后，AI 会识别资料所属学科。</p>`}</div></aside>`;
}

async function sendChatMessage(state, renderApp) {
  const input = document.querySelector("#chatInput");
  const content = input?.value.trim() || "";

  if (!content) return;

  if (!ensureAiConfigured(state, renderApp)) return;

  state.ai.draft = "";
  state.ai.stickToBottom = true;
  state.ai.restoreFocus = false;
  state.ai.messages.push({ role: "user", content });
  state.ai.summary = null;
  state.ai.status = "AI 正在整理需求...";
  state.ai.error = "";
  state.ai.rawOutput = "";
  state.ai.isSending = true;
  renderApp();

  let rawOutput = "";

  try {
    rawOutput = await callOpenAICompatibleChat(
      buildRequirementMessages(state.ai.messages),
      state.aiConfig
    );
    const parsed = JSON.parse(extractJsonFromText(rawOutput));
    const reply = String(parsed.reply || rawOutput).trim();
    const status =
      parsed.status === "ready_to_confirm" ? "ready_to_confirm" : "collecting";

    state.ai.messages.push({ role: "assistant", content: reply });
    state.ai.summary = status === "ready_to_confirm" ? normalizeSummary(parsed.summary) : null;
    if (state.ai.summary) {
      state.ai.messages.push({
        id: `requirement-summary-${Date.now().toString(36)}`,
        role: "assistant",
        type: "requirement_summary",
        content: "我已整理好本次星图的主题、目标和范围。确认后才会开始生成。",
        summary: state.ai.summary,
      });
    }
    state.ai.status =
      status === "ready_to_confirm" ? "需求已整理，请确认后生成星图。" : "";
    state.ai.error = "";
  } catch (error) {
    state.ai.messages.push({ role: "assistant", content: rawOutput || error.message });
    state.ai.status = "";
    state.ai.error = rawOutput ? "" : `需求访谈失败：${error.message}`;
    state.ai.rawOutput = rawOutput;
  } finally {
    state.ai.isSending = false;
    state.ai.restoreFocus = true;
    saveActiveSession();
    renderApp();
  }
}

function buildRequirementMessages(messages) {
  const transcript = messages
    .map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`)
    .join("\n");

  return [
    { role: "system", content: requirementSystemPrompt },
    {
      role: "user",
      content: `
以下是当前访谈记录。请继续收集需求，或在信息足够时输出 ready_to_confirm。

${transcript}
      `.trim(),
    },
  ];
}

function normalizeSummary(summary = {}) {
  return {
    title: String(summary.title || "").trim(),
    goal: String(summary.goal || "").trim(),
    currentLevel: String(summary.currentLevel || "").trim(),
    purpose: String(summary.purpose || "").trim(),
    detailLevel: String(summary.detailLevel || "").trim(),
    preferences: String(summary.preferences || "").trim(),
  };
}

async function uploadKnowledgeFile(state, file, renderApp) {
  if (!/\.md$/i.test(file.name)) {
    state.ai.error = "目前只支持上传 Markdown（.md）文件。";
    renderApp();
    return;
  }

  state.knowledge.isUploading = true;
  state.ai.error = "";
  state.ai.status = "正在读取并整理知识库资料…";
  renderApp();

  try {
    const content = await file.text();
    if (!content.trim()) throw new Error("文件内容为空。");

    let record;
    if (getAiConfigIssue(state.aiConfig)) {
      record = createKnowledgeBaseRecord({ filename: file.name, content });
      state.ai.status = "模型未配置，已按文件名保存资料；配置模型后上传可自动生成名称与摘要。";
    } else {
      const result = await scanMarkdownKnowledgeBase(file.name, content, state.aiConfig);
      record = result.record;
      state.ai.status = result.parseError
        ? "资料已保存，但 AI 命名结果无法解析，已使用文件名。"
        : `知识库“${record.name}”已保存。`;
    }
    addKnowledgeBase(state.appData, record);
  } catch (error) {
    state.ai.status = "";
    state.ai.error = `知识库上传失败：${error.message}`;
  } finally {
    state.knowledge.isUploading = false;
    saveActiveSession();
    renderApp();
  }
}

async function generateConfirmedMap(state, renderApp) {
  if (!ensureAiConfigured(state, renderApp)) return;

  if (!state.ai.summary) {
    state.ai.error = "请先完成需求总结。";
    state.ai.status = "";
    renderApp();
    return;
  }

  state.ai.status = "正在生成...";
  state.ai.status = "";
  state.ai.error = "";
  state.ai.rawOutput = "";
  const generationMessage = createGenerationMessage();
  state.ai.messages.push(generationMessage);
  state.ai.stickToBottom = true;
  state.ai.isGenerating = true;
  renderApp();

  let rawOutput = "";

  try {
    setGenerationStep(generationMessage, "summary", "active", "正在读取已确认的主题、目标、基础和偏好。");
    renderApp();
    setGenerationStep(generationMessage, "summary", "done", "需求摘要已就绪。");
    setGenerationStep(generationMessage, "knowledge", "active", "正在从本地学科知识库匹配相关章节。");
    renderApp();

    const relevantKnowledge = findRelevantKnowledge(
      state.ai.summary,
      state.ai.messages,
      { limit: 8, knowledgeBases: state.appData.knowledgeBases }
    );
    const generationOptions = getGenerationRequestOptions(relevantKnowledge);
    setGenerationStep(
      generationMessage,
      "knowledge",
      "done",
      relevantKnowledge.length
        ? `已匹配 ${relevantKnowledge.length} 个高相关章节。`
        : "本地资料不足，将直接生成可继续生长的学习骨架。"
    );
    setGenerationStep(
      generationMessage,
      "draft",
      "active",
      "正在让模型构建第一版深层星图结构。"
    );
    renderApp();

    rawOutput = await callOpenAICompatibleChat(
      buildMapGenerationMessages(
        state.ai.summary,
        state.ai.messages,
        relevantKnowledge,
        generationOptions
      ),
      { ...state.aiConfig, ...generationOptions }
    );
    setGenerationStep(generationMessage, "draft", "done", "模型已返回第一版星图。");
    setGenerationStep(generationMessage, "parse", "active", "正在提取并解析 JSON。");
    renderApp();

    const parsed = parseJsonFromText(rawOutput);
    setGenerationStep(generationMessage, "parse", "done", "JSON 解析完成。");
    setGenerationStep(generationMessage, "check", "active", "正在校验字段、层级深度和节点数量。");
    let normalizedMap = validateAndNormalizeMap(parsed);
    const qualityIssue = getGeneratedMapQualityIssue(normalizedMap);

    if (qualityIssue && !generationOptions.shouldAutoExpand) {
      setGenerationStep(
        generationMessage,
        "check",
        "done",
        `资料不足，已保留可继续生长的骨架：${qualityIssue}`
      );
      setGenerationStep(
        generationMessage,
        "expand",
        "done",
        "已跳过自动扩展，后续可在星图内继续生长。"
      );
    } else if (qualityIssue) {
      setGenerationStep(generationMessage, "check", "active", `初稿需要扩展：${qualityIssue}`);
      setGenerationStep(
        generationMessage,
        "expand",
        "active",
        "正在保留原有结构并继续拆分知识点、题型和训练任务。"
      );
      renderApp();

      rawOutput = await callOpenAICompatibleChat(
        buildMapExpansionMessages(
          state.ai.summary,
          normalizedMap,
          qualityIssue,
          relevantKnowledge
        ),
        { ...state.aiConfig, timeoutMs: 90000, disableThinking: true }
      );
      setGenerationStep(generationMessage, "expand", "done", "扩展版星图已返回。");
      setGenerationStep(generationMessage, "parse", "active", "正在重新解析扩展后的 JSON。");
      renderApp();
      try {
        const expandedMap = validateAndNormalizeMap(parseJsonFromText(rawOutput));
        normalizedMap = expandedMap;
        setGenerationStep(generationMessage, "parse", "done", "扩展版 JSON 解析完成。");

        const retryQualityIssue = getGeneratedMapQualityIssue(normalizedMap);
        if (retryQualityIssue) {
          setGenerationStep(generationMessage, "check", "done", `扩展已保存，后续仍可继续生长：${retryQualityIssue}`);
        }
      } catch (expansionError) {
        setGenerationStep(generationMessage, "expand", "done", "扩展输出格式不完整，已保留可用初稿。");
        setGenerationStep(generationMessage, "parse", "done", `扩展版解析失败，已安全回退初稿：${expansionError.message}`);
      }
    }

    setGenerationStep(generationMessage, "check", "done", "星图结构通过校验。");
    setGenerationStep(generationMessage, "save", "active", "正在保存星图。");
    renderApp();
    setStarMap(normalizedMap, state.ai.summary.title || normalizedMap.title);
    if (state.returnContext?.sourceView) {
      state.currentMode = state.returnContext.mode;
      state.currentPage = state.returnContext.sourceView;
      state.returnContext = null;
    }
    setGenerationStep(generationMessage, "save", "done", "生成成功，已保存。");
    generationMessage.status = "done";
    generationMessage.canViewMap = true;
    state.ai.status = "";
    state.ai.error = "";
    state.ai.rawOutput = "";
  } catch (error) {
    markActiveGenerationStepAsError(generationMessage, error.message);
    generationMessage.status = "error";
    state.ai.status = "";
    state.ai.error = "";
    state.ai.rawOutput = "";
  } finally {
    state.ai.isGenerating = false;
    state.ai.restoreFocus = true;
    saveActiveSession();
    renderApp();
  }
}

function createGenerationMessage() {
  return {
    id: `generation-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,
    role: "assistant",
    type: "generation",
    content: "生成过程",
    status: "active",
    canViewMap: false,
    steps: createGenerationSteps(),
  };
}

function createGenerationSteps() {
  return [
    { id: "summary", label: "读取需求总结", status: "pending", detail: "" },
    { id: "knowledge", label: "检索知识库", status: "pending", detail: "" },
    { id: "draft", label: "初步构建星图", status: "pending", detail: "" },
    { id: "parse", label: "解析模型输出", status: "pending", detail: "" },
    { id: "check", label: "检查层级与质量", status: "pending", detail: "" },
    { id: "expand", label: "必要时自动扩展", status: "pending", detail: "" },
    { id: "save", label: "保存并渲染", status: "pending", detail: "" },
  ];
}

function setGenerationStep(message, id, status, detail = "") {
  message.steps = (message.steps || []).map((step) => {
    if (step.id !== id) return step;

    return {
      ...step,
      status,
      detail,
    };
  });
}

function markActiveGenerationStepAsError(message, detail) {
  let marked = false;

  message.steps = (message.steps || []).map((step) => {
    if (!marked && step.status === "active") {
      marked = true;
      return { ...step, status: "error", detail };
    }

    return step;
  });
}

function ensureAiConfigured(state, renderApp) {
  const issue = getAiConfigIssue(state.aiConfig);

  if (!issue) {
    return true;
  }

  state.ai.status = "";
  state.ai.error = issue;
  state.configReturnPage = "ai";
  setPage("config");
  renderApp();
  return false;
}

export function getGenerationRequestOptions(relevantKnowledge = []) {
  const hasLocalKnowledge = Array.isArray(relevantKnowledge) && relevantKnowledge.length > 0;

  return {
    timeoutMs: hasLocalKnowledge ? 90000 : 70000,
    disableThinking: !hasLocalKnowledge,
    shouldAutoExpand: hasLocalKnowledge,
  };
}

export function buildMapGenerationMessages(summary, messages, relevantKnowledge = [], options = {}) {
  const hasLocalKnowledge = Array.isArray(relevantKnowledge) && relevantKnowledge.length > 0;
  const transcript = messages
    .slice(-8)
    .map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`)
    .join("\n");
  const knowledgeContext = buildKnowledgeContext(relevantKnowledge, {
    maxChars: hasLocalKnowledge ? 5200 : 800,
    maxDocumentChars: hasLocalKnowledge ? 1400 : 0,
  });
  const sourcePolicy = hasLocalKnowledge
    ? "仅将上述本地资料作为优先参考；不要联网检索、不要等待外部资料。"
    : "本地资料不足。不要联网检索、不要等待外部资料；直接依据已确认需求和通用知识生成可继续生长的学习骨架。";

  return [
    { role: "system", content: mapGenerationSystemPrompt },
    {
      role: "user",
      content: `
已确认需求总结：
${JSON.stringify(summary, null, 2)}

访谈记录：
${transcript}

本地学科知识库参考：
${knowledgeContext}

资料使用规则：
${sourcePolicy}

请生成能力星图 JSON。格式必须严格符合：
{
  "id": "string",
  "title": "string",
  "mastery": 0,
  "weight": 1,
  "knowledgeType": "memory | understanding | problem_solving | operation | output | mixed",
  "children": [
    {
      "id": "string",
      "title": "string",
      "mastery": 0,
      "weight": 1,
      "description": "string",
      "knowledgeType": "memory | understanding | problem_solving | operation | output | mixed",
      "children": []
    }
  ]
}

生成规则：
1. mastery 初始值全部为 0。
2. weight 范围 0.5 到 4。
3. children 必须是数组。
4. id 必须唯一，使用英文小写短横线风格。
5. description 可选，但建议提供一句话说明。
6. 每个节点必须给出 knowledgeType：memory=记忆、understanding=理解、problem_solving=解题、operation=操作、output=输出、mixed=确实无法归为单一主要学习行为时才使用。按该节点的实际学习行为判断，不要因为学科复杂就滥用 mixed。
7. 必须生成可下钻的深层星图，不要停留在章节目录。
8. 默认至少生成 5 层：总目标 > 阶段/学科 > 模块 > 章节/能力点 > 知识点/题型/训练任务。
9. 总节点数至少 ${MIN_GENERATED_NODE_COUNT} 个，叶子节点至少 ${MIN_GENERATED_LEAF_COUNT} 个，除非用户明确要求极简版。
10. 像“一元函数积分学”“函数与极限”“一元函数微分学”这类章节节点不能作为叶子，必须继续拆成定义、公式、典型题型、训练任务或掌握标准。
11. 每个非叶子节点建议有 3-7 个子节点，叶子节点必须是可以直接学习、练习或检查的最小任务。
12. 如果知识库参考与用户目标相关，优先按知识库章节和知识点组织星图。
13. 不要输出 Markdown。
14. 不要输出代码块。
15. 不要输出解释。
16. 只能输出 JSON。
      `.trim(),
    },
  ];
}

function buildMapExpansionMessages(summary, shallowMap, qualityIssue, relevantKnowledge = []) {
  const knowledgeContext = buildKnowledgeContext(relevantKnowledge, {
    maxChars: 7000,
    maxItemsPerSection: 8,
    maxSections: 12,
  });

  return [
    { role: "system", content: mapGenerationSystemPrompt },
    {
      role: "user",
      content: `
下面这份能力星图 JSON 层级过浅，需要扩展后重新输出完整 JSON。

问题：
${qualityIssue}

已确认需求总结：
${JSON.stringify(summary, null, 2)}

当前过浅星图：
${JSON.stringify(shallowMap, null, 2)}

本地学科知识库参考：
${knowledgeContext}

扩展要求：
1. 保留原有大结构，但必须继续向下拆分。
2. 至少达到 ${MIN_GENERATED_DEPTH} 层，总节点数至少 ${MIN_GENERATED_NODE_COUNT} 个，叶子节点至少 ${MIN_GENERATED_LEAF_COUNT} 个。
3. 章节类节点不能作为叶子，必须拆到知识点、题型、训练任务、掌握标准。
4. mastery 全部为 0。
5. weight 范围 0.5 到 4。
6. id 必须唯一，使用英文小写短横线风格。
7. 保留并补齐每个节点的 knowledgeType，取值只能是 memory、understanding、problem_solving、operation、output、mixed；按主要学习行为判断，mixed 仅用于确实无法归类的节点。
8. 总节点控制在 35-70 个，每个节点最多 5 个直接子节点；不要批量枚举几十道例题、词表或同类任务。
9. title 保持简短，description 只写一句话，避免输出过长导致 JSON 截断。
10. 只能输出完整星图 JSON，不要 Markdown，不要代码块，不要解释。
      `.trim(),
    },
  ];
}

function getGeneratedMapQualityIssue(map) {
  const stats = getMapStats(map);
  const issues = [];

  if (stats.maxDepth < MIN_GENERATED_DEPTH) {
    issues.push(`当前最深 ${stats.maxDepth} 层，至少需要 ${MIN_GENERATED_DEPTH} 层`);
  }

  if (stats.nodeCount < MIN_GENERATED_NODE_COUNT) {
    issues.push(`当前 ${stats.nodeCount} 个节点，至少需要 ${MIN_GENERATED_NODE_COUNT} 个节点`);
  }

  if (stats.leafCount < MIN_GENERATED_LEAF_COUNT) {
    issues.push(`当前 ${stats.leafCount} 个叶子节点，至少需要 ${MIN_GENERATED_LEAF_COUNT} 个叶子节点`);
  }

  if (stats.shallowLeafTitles.length) {
    issues.push(
      `这些节点不应作为最终叶子：${stats.shallowLeafTitles.slice(0, 5).join("、")}`
    );
  }

  return issues.join("；");
}

function getMapStats(root) {
  const stats = {
    maxDepth: 0,
    nodeCount: 0,
    leafCount: 0,
    shallowLeafTitles: [],
  };

  function walk(node, depth) {
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    stats.nodeCount += 1;

    if (!node.children.length) {
      stats.leafCount += 1;

      if (depth < MIN_GENERATED_DEPTH) {
        stats.shallowLeafTitles.push(node.title);
      }

      return;
    }

    node.children.forEach((child) => walk(child, depth + 1));
  }

  walk(root, 1);
  return stats;
}

function resetConversation(state) {
  state.ai.messages = [
    {
      role: "assistant",
      content: "你想构建哪方面的能力星图？可以告诉我目标、用途和当前基础。",
    },
  ];
  state.ai.summary = null;
  state.ai.status = "";
  state.ai.error = "";
  state.ai.rawOutput = "";
  saveActiveSession();
}
