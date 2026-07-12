import { masteryColors } from "../mapData.js";
import { getAiConfigIssue } from "../aiProviders.js";
import { escapeHtml } from "../utils/jsonUtils.js";
import { findNodeById, findNodePath } from "../exploration/explorationUtils.js";
import { suggestGrowthNodeNames } from "../growth/growthService.js";
import { applyGrowthProposals } from "../growth/applyGrowthProposals.js";
import { normalizeGrowthProposal } from "../growth/growthProposal.js";

export function ensureMapSettings(state) {
  if (!state.mapSettings) {
    state.mapSettings = { open: false, growth: createGrowthDraft() };
  }
  if (!state.mapSettings.growth) state.mapSettings.growth = createGrowthDraft();
  return state.mapSettings;
}

function createGrowthDraft() {
  return {
    userIntent: "",
    names: [],
    selected: {},
    status: "idle",
    lastError: "",
    result: null,
  };
}

export function renderMapSettingsPanel(state) {
  const settings = ensureMapSettings(state);
  if (!settings.open) return "";
  const node = state.selectedNode || state.currentNode;
  if (!node) return "";
  const isRoot = node.id === state.starMap.id;
  const hasChildren = Boolean(node.children?.length);
  return `
    <aside class="map-settings-panel">
      <header class="map-settings-header">
        <div><span>设置星图</span><h2>${escapeHtml(node.title)}</h2></div>
        <button id="closeMapSettingsButton" class="icon-text-button" type="button">收起</button>
      </header>
      <div class="map-settings-body">
        ${renderMasterySection(node, hasChildren)}
        ${renderWeightSection(node, isRoot)}
        ${renderManualSection(isRoot)}
        ${renderAutoSection(state, settings.growth)}
      </div>
    </aside>`;
}

function renderMasterySection(node, hasChildren) {
  const buttons = [0, 1, 2, 3, 4].map((level) => `
    <button class="mastery-button ${node.mastery === level ? "active" : ""}" data-mastery="${level}"
      style="border-color: ${masteryColors[level]};" ${hasChildren ? "disabled" : ""}>${level}</button>`).join("");
  return `<section class="map-settings-card">
      <strong>设置节点熟练度</strong>
      <p>${hasChildren ? "父节点熟练度由子节点自动计算。" : "手动设定当前节点的掌握等级。"}</p>
      <div class="mastery-buttons compact">${buttons}</div>
    </section>`;
}

function renderWeightSection(node, isRoot) {
  return `<section class="map-settings-card">
      <strong>设置节点权重</strong>
      <p>${isRoot ? "主节点权重固定。" : `当前权重 ${Number(node.weight).toFixed(1)}`}</p>
      <input class="weight-slider" type="range" min="0.5" max="4" step="0.5"
        value="${node.weight}" data-weight-slider ${isRoot ? "disabled" : ""} />
    </section>`;
}

function renderManualSection(isRoot) {
  return `<section class="map-settings-card">
      <strong>扩展星图（手动）</strong>
      <p>直接新增子节点，或删除当前节点。</p>
      <div class="map-settings-buttons">
        <button id="addNodeButton" class="map-settings-btn" type="button">添加子节点</button>
        <button id="deleteNodeButton" class="map-settings-btn danger" type="button" ${isRoot ? "disabled" : ""}>删除当前节点</button>
      </div>
    </section>`;
}

function renderAutoSection(state, draft) {
  const node = state.selectedNode || state.currentNode;
  if (draft.status === "completed") {
    return `<section class="map-settings-card">
        <strong>扩展星图（自动）</strong>
        <p>已在「${escapeHtml(node?.title || "")}」下新增 ${draft.result?.createdNodeIds?.length || 0} 个子节点。</p>
        <button data-settings-growth="reset" class="map-settings-btn primary" type="button">继续扩展</button>
      </section>`;
  }
  const busy = draft.status === "generating" || draft.status === "applying";
  const error = draft.lastError ? `<p class="map-settings-error">${escapeHtml(draft.lastError)}</p>` : "";
  return `<section class="map-settings-card">
      <strong>扩展星图（自动）</strong>
      <p>描述想补充的内容，AI 会提炼出要新增的节点，确认后加到「${escapeHtml(node?.title || "当前节点")}」下。</p>
      ${error}
      <textarea id="settingsGrowthIntent" class="map-settings-textarea" placeholder="例如：补充复合函数、反函数、函数的单调性。" ${busy ? "disabled" : ""}>${escapeHtml(draft.userIntent || "")}</textarea>
      <button data-settings-growth="generate" class="map-settings-btn primary" type="button" ${busy ? "disabled" : ""}>${draft.status === "generating" ? "AI 提炼中…" : "让 AI 提炼节点"}</button>
      ${renderNameList(draft, busy)}
    </section>`;
}

function renderNameList(draft, busy) {
  if (!draft.names.length) return "";
  const items = draft.names.map((name, index) => `
    <label class="map-settings-name">
      <input type="checkbox" data-name-index="${index}" ${draft.selected[index] === false ? "" : "checked"}>
      <span>${escapeHtml(name)}</span>
    </label>`).join("");
  const count = draft.names.filter((_, index) => draft.selected[index] !== false).length;
  return `<div class="map-settings-namelist">${items}</div>
    <button data-settings-growth="apply" class="map-settings-btn primary" type="button" ${busy || !count ? "disabled" : ""}>${draft.status === "applying" ? "正在新增…" : `确认新增 ${count} 个节点`}</button>`;
}

export function bindMapSettingsPanelEvents(state, renderApp) {
  const settings = ensureMapSettings(state);
  document.querySelector("#closeMapSettingsButton")?.addEventListener("click", () => {
    settings.open = false;
    renderApp();
  });
  document.querySelectorAll("[data-name-index]").forEach((input) => input.addEventListener("change", () => {
    settings.growth.selected[Number(input.dataset.nameIndex)] = input.checked;
    renderApp();
  }));
  document.querySelectorAll("[data-settings-growth]").forEach((button) => button.addEventListener("click", () => {
    handleGrowthAction(state, button.dataset.settingsGrowth, renderApp);
  }));
}

async function handleGrowthAction(state, action, renderApp) {
  syncIntent(state);
  if (action === "reset") { ensureMapSettings(state).growth = createGrowthDraft(); renderApp(); return; }
  if (action === "apply") { applyGrowth(state, renderApp); return; }
  if (action === "generate") { await generateNames(state, renderApp); }
}

async function generateNames(state, renderApp) {
  const draft = ensureMapSettings(state).growth;
  const node = state.selectedNode || state.currentNode;
  if (!draft.userIntent) { draft.lastError = "请先描述想补充的内容。"; renderApp(); return; }
  if (!node) { draft.lastError = "找不到当前节点。"; renderApp(); return; }
  if (getAiConfigIssue(state.aiConfig)) { draft.lastError = "尚未配置模型，可用「添加子节点」手动新增。"; renderApp(); return; }
  draft.status = "generating"; draft.lastError = ""; renderApp();
  try {
    const result = await suggestGrowthNodeNames({
      parentTitle: node.title,
      existingChildren: (node.children || []).map((child) => child.title),
      userIntent: draft.userIntent,
    }, state.aiConfig);
    if (!result.value) throw new Error(result.parseError || "模型未返回节点名称。");
    draft.names = result.value.names;
    draft.selected = {};
    draft.status = "reviewing"; draft.lastError = "";
  } catch (error) { draft.status = "error"; draft.lastError = `提炼节点失败：${error.message}`; }
  renderApp();
}

function applyGrowth(state, renderApp) {
  const draft = ensureMapSettings(state).growth;
  const node = state.selectedNode || state.currentNode;
  const chosen = draft.names.filter((_, index) => draft.selected[index] !== false);
  if (!node || !chosen.length) { draft.lastError = "请至少保留一个节点。"; renderApp(); return; }
  draft.status = "applying"; draft.lastError = ""; renderApp();
  const parentPath = findNodePath(state.starMap, node.id).map((item) => item.title);
  const proposals = chosen.map((title) => normalizeGrowthProposal({
    action: "create_child",
    title,
    parentNodeId: node.id,
    parentPath,
    knowledgeType: node.reviewMetadata?.knowledgeType || "mixed",
    weight: 1,
    suggestedMastery: 0,
    sourceTypes: ["conversation"],
    status: "accepted",
    createdBy: "ai_proposal",
  }));
  const result = applyGrowthProposals(state.appData, {
    mapId: state.activeMapId,
    proposals,
    triggerType: "manual_growth",
    sourceNodeId: node.id,
    sourceRecordId: `manual-growth-${Date.now().toString(36)}`,
  });
  if (!result.success) { draft.status = "reviewing"; draft.lastError = result.errors.join(" ") || "新增失败。"; renderApp(); return; }
  state.starMap = state.appData.maps.find((map) => map.id === state.activeMapId)?.rootNode || state.starMap;
  state.currentNode = findNodeById(state.starMap, state.currentNode?.id) || state.starMap;
  state.selectedNode = findNodeById(state.starMap, state.selectedNode?.id) || state.selectedNode;
  draft.status = "completed"; draft.result = result; draft.names = []; draft.selected = {};
  state.pendingMapFeedback = { mapId: state.activeMapId, highlightNodeIds: result.createdNodeIds, message: "已新增节点。" };
  renderApp();
}

function syncIntent(state) {
  const intent = document.querySelector("#settingsGrowthIntent");
  if (intent) ensureMapSettings(state).growth.userIntent = intent.value.trim();
}
