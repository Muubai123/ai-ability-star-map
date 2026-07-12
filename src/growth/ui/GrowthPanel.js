import { getAiConfigIssue } from "../../aiProviders.js";
import { setCurrentExploration } from "../../exploration/explorationState.js";
import { findNodeById, findNodePath } from "../../exploration/explorationUtils.js";
import { escapeHtml } from "../../utils/jsonUtils.js";
import { collectNodes, findPossibleDuplicateNodes } from "../duplicateNodeDetector.js";
import { applyGrowthProposals } from "../applyGrowthProposals.js";
import { buildGrowthContext } from "../growthContextBuilder.js";
import { generateExplorationGrowthProposals } from "../growthService.js";
import { KNOWLEDGE_TYPE_LABELS, makeManualGrowthProposal, normalizeGrowthProposal } from "../growthProposal.js";

const QUICK_INTENTS = ["缺少基础概念", "缺少具体方法", "缺少题型或应用", "当前节点范围太大", "正在学习的内容没有对应节点"];

export function ensureGrowthDraft(session, state) {
  if (session.growthDraft) return session.growthDraft;
  const node = findNodeById(state.starMap, session.nodeId);
  session.growthDraft = {
    panelOpen: false,
    status: "idle",
    userIntent: "",
    summary: "",
    proposals: [],
    generatedAt: null,
    lastError: "",
    result: null,
  };
  if (node) session.growthDraft.parentNodeId = node.id;
  return session.growthDraft;
}

export function renderGrowthPanel(state) {
  const session = state.exploration.currentSession;
  if (!session || session.mapId !== state.activeMapId) return "";
  const draft = ensureGrowthDraft(session, state);
  if (!draft.panelOpen) return `<button class="growth-open-button" data-growth-action="open" type="button">扩展星图</button>`;
  const node = findNodeById(state.starMap, session.nodeId);
  if (!node) return "";
  const nodes = collectNodes(state.starMap);
  const options = nodes.map(({ node: item, path }) => `<option value="${escapeHtml(item.id)}">${escapeHtml(path.map((part) => part.title).join(" › "))}</option>`).join("");
  const proposals = draft.proposals || [];
  return `<section class="growth-panel"><header class="growth-panel-header"><div><span>星图生长</span><h3>扩展当前节点</h3><p>${escapeHtml(node.title)}</p></div><button data-growth-action="close" type="button" aria-label="收起星图生长">×</button></header>${draft.status === "completed" ? renderCompleted(draft) : renderDraft(draft, options, node, state.starMap)}</section>`;
}

function renderDraft(draft, nodeOptions, node, root) {
  const busy = draft.status === "generating" || draft.status === "applying";
  const status = draft.lastError ? `<p class="growth-error">${escapeHtml(draft.lastError)}</p>` : "";
  const proposalCards = draft.proposals.map((proposal) => renderGrowthProposalCard(proposal, nodeOptions, node, root)).join("");
  return `${status}<section class="growth-intent"><p>你觉得当前节点哪里不够详细？可以描述缺少的概念、方法、题型或能力。</p><div class="growth-quick-intents">${QUICK_INTENTS.map((item) => `<button data-growth-intent="${escapeHtml(item)}" type="button">${escapeHtml(item)}</button>`).join("")}</div><textarea id="growthIntentInput" placeholder="例如：链式法则下面还缺少多层复合函数和隐函数求导。" ${busy ? "disabled" : ""}>${escapeHtml(draft.userIntent || "")}</textarea><p class="growth-local-note">当前未启用外部搜索，将基于星图和知识库生成。</p><div class="growth-actions"><button data-growth-action="generate" class="primary-action" type="button" ${busy ? "disabled" : ""}>${busy && draft.status === "generating" ? "正在分析…" : "生成候选"}</button><button data-growth-action="manual" type="button" ${busy ? "disabled" : ""}>＋ 自己添加节点</button></div></section>${draft.summary ? `<p class="growth-summary">${escapeHtml(draft.summary)}</p>` : ""}${draft.proposals.length ? `<section class="growth-proposal-list"><header><strong>候选节点</strong><div><button data-growth-action="select-all" type="button">全选合理项</button><button data-growth-action="select-none" type="button">全部取消</button><button data-growth-action="regenerate" type="button" ${busy ? "disabled" : ""}>重新生成</button></div></header>${proposalCards}<div class="growth-confirm-row"><button data-growth-action="apply" class="primary-action" type="button" ${busy ? "disabled" : ""}>${busy && draft.status === "applying" ? "正在写入…" : "确认生长"}</button></div></section>` : ""}`;
}

export function renderGrowthProposalCard(proposal, nodeOptions, node, root) {
  const duplicates = findPossibleDuplicateNodes(root, proposal.title);
  const checked = ["accepted", "edited"].includes(proposal.status);
  const duplicateIds = [...new Set([...(proposal.possibleDuplicateNodeIds || []), ...duplicates.map((item) => item.nodeId)])];
  return `<article class="growth-proposal-card ${duplicateIds.length ? "has-duplicate" : ""}" data-growth-proposal="${escapeHtml(proposal.proposalId)}"><header><label><input data-growth-accept="${escapeHtml(proposal.proposalId)}" type="checkbox" ${checked ? "checked" : ""}><strong>${escapeHtml(proposal.title || "手动新增节点")}</strong></label><span>${Math.round((Number(proposal.confidence) || 0) * 100)}%</span></header><label>名称<input data-growth-field="title" data-proposal-id="${escapeHtml(proposal.proposalId)}" value="${escapeHtml(proposal.title)}" placeholder="节点名称"></label><label>说明<textarea data-growth-field="description" data-proposal-id="${escapeHtml(proposal.proposalId)}" rows="2" placeholder="节点追踪的具体能力">${escapeHtml(proposal.description)}</textarea></label><div class="growth-field-grid"><label>动作<select data-growth-field="action" data-proposal-id="${escapeHtml(proposal.proposalId)}">${["create_child", "create_sibling", "map_existing", "add_note"].map((action) => `<option value="${action}" ${proposal.action === action ? "selected" : ""}>${growthActionLabel(action)}</option>`).join("")}</select></label><label>位置<select data-growth-field="parentNodeId" data-proposal-id="${escapeHtml(proposal.proposalId)}">${nodeOptions.replace(`value="${escapeHtml(proposal.parentNodeId || node.id)}"`, `value="${escapeHtml(proposal.parentNodeId || node.id)}" selected`)}</select></label><label>类型<select data-growth-field="knowledgeType" data-proposal-id="${escapeHtml(proposal.proposalId)}">${Object.entries(KNOWLEDGE_TYPE_LABELS).map(([type, label]) => `<option value="${type}" ${proposal.knowledgeType === type ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>权重<input data-growth-field="weight" data-proposal-id="${escapeHtml(proposal.proposalId)}" type="number" min="0.5" max="4" step="0.5" value="${proposal.weight}"></label></div><label>映射到已有节点<select data-growth-field="mappedNodeId" data-proposal-id="${escapeHtml(proposal.proposalId)}"><option value="">选择已有节点</option>${nodeOptions.replace(`value="${escapeHtml(proposal.mappedNodeId)}"`, `value="${escapeHtml(proposal.mappedNodeId)}" selected`)}</select></label>${proposal.suggestedMastery > 0 ? `<label class="growth-mastery-field"><input data-growth-mastery-apply="${escapeHtml(proposal.proposalId)}" type="checkbox" ${proposal.applySuggestedMastery ? "checked" : ""}> 同时采用熟练度建议 ${proposal.suggestedMastery} / 4</label>` : ""}${proposal.reason ? `<p class="growth-reason">${escapeHtml(proposal.reason)}</p>` : ""}${proposal.sourceTypes?.length ? `<p class="growth-sources">依据：${escapeHtml(proposal.sourceTypes.join(" · "))}</p>` : ""}${duplicateIds.length ? `<p class="growth-duplicate">发现可能相同的已有节点，默认不会选中。</p>` : ""}</article>`;
}

function renderCompleted(draft) {
  const result = draft.result || {};
  return `<section class="growth-completed"><strong>星图已扩展。</strong><p>新增 ${result.createdNodeIds?.length || 0} 个节点，映射 ${result.mappedNodeIds?.length || 0} 个已有节点，保存 ${result.noteResults?.length || 0} 条备注。</p><button data-growth-action="continue" class="primary-action" type="button">继续探索</button></section>`;
}

export function bindGrowthPanelEvents(state, renderApp) {
  document.querySelectorAll("[data-growth-action]").forEach((button) => button.addEventListener("click", async () => {
    const session = state.exploration.currentSession;
    if (!session) return;
    const draft = ensureGrowthDraft(session, state);
    const action = button.dataset.growthAction;
    if (action === "open") { draft.panelOpen = true; persist(state, session); renderApp(); return; }
    if (action === "close") { draft.panelOpen = false; persist(state, session); renderApp(); return; }
    if (action === "continue") { draft.panelOpen = false; draft.status = "idle"; draft.sourceRecordId = null; draft.result = null; persist(state, session); renderApp(); return; }
    if (action === "manual") { syncInputs(state); draft.proposals.push(makeManualGrowthProposal(defaultsFor(state, session))); draft.status = "reviewing"; persist(state, session); renderApp(); return; }
    if (action === "select-all" || action === "select-none") { syncInputs(state); draft.proposals.forEach((proposal) => { proposal.status = action === "select-all" && !(proposal.possibleDuplicateNodeIds || []).length ? "accepted" : "pending"; }); persist(state, session); renderApp(); return; }
    if (action === "generate" || action === "regenerate") { if (action === "regenerate" && draft.proposals.length && !window.confirm("重新生成会替换当前候选。确定继续吗？")) return; await generate(state, session, renderApp); return; }
    if (action === "apply") { apply(state, session, renderApp); }
  }));
  document.querySelectorAll("[data-growth-intent]").forEach((button) => button.addEventListener("click", () => { const input = document.querySelector("#growthIntentInput"); if (input) input.value = button.dataset.growthIntent; }));
}

async function generate(state, session, renderApp) {
  const draft = ensureGrowthDraft(session, state);
  const intent = document.querySelector("#growthIntentInput")?.value.trim() || draft.userIntent || "";
  if (!intent) { draft.lastError = "请先描述当前节点缺少什么。"; renderApp(); return; }
  if (getAiConfigIssue(state.aiConfig)) { draft.lastError = "尚未配置模型。你仍可以手动添加节点。"; persist(state, session); renderApp(); return; }
  draft.userIntent = intent; draft.status = "generating"; draft.lastError = ""; persist(state, session); renderApp();
  try {
    const context = buildGrowthContext(state.appData, state.activeMapId, session.nodeId, session, intent);
    const result = await generateExplorationGrowthProposals(context, state.aiConfig);
    if (!result.value) throw new Error(result.parseError || "模型没有返回可用候选。");
    draft.summary = result.value.summary;
    draft.proposals = result.value.proposals.map((proposal) => ({ ...proposal, status: (proposal.possibleDuplicateNodeIds || []).length ? "pending" : "accepted" }));
    draft.knowledgeBaseIds = context.knowledgeBaseIds;
    draft.generatedAt = Date.now(); draft.status = "reviewing"; draft.lastError = "";
  } catch (error) { draft.status = "error"; draft.lastError = `生成候选失败：${error.message}`; }
  persist(state, session); renderApp();
}

function apply(state, session, renderApp) {
  const draft = ensureGrowthDraft(session, state);
  syncInputs(state);
  draft.status = "applying"; draft.lastError = ""; persist(state, session); renderApp();
  const result = applyGrowthProposals(state.appData, {
    mapId: state.activeMapId,
    proposals: draft.proposals,
    triggerType: "exploration",
    sourceNodeId: session.nodeId,
    sourceSessionId: session.id,
    sourceRecordId: draft.sourceRecordId || (draft.sourceRecordId = `exploration-growth-${session.id}-${draft.generatedAt || Date.now()}`),
    knowledgeBaseIds: draft.knowledgeBaseIds || [],
  });
  if (!result.success) { draft.status = "reviewing"; draft.lastError = result.errors.join(" ") || "生长失败，请检查候选。"; persist(state, session); renderApp(); return; }
  state.starMap = state.appData.maps.find((map) => map.id === state.activeMapId)?.rootNode || state.starMap;
  state.currentNode = findNodeById(state.starMap, state.currentNode?.id) || state.currentNode;
  state.selectedNode = findNodeById(state.starMap, state.selectedNode?.id) || state.selectedNode;
  draft.status = "completed"; draft.result = result; draft.proposals = []; draft.lastError = "";
  state.pendingMapFeedback = { mapId: state.activeMapId, highlightNodeIds: result.createdNodeIds, message: "星图已扩展。" };
  persist(state, session); renderApp();
}

function syncInputs(state) {
  const session = state.exploration.currentSession;
  if (!session) return;
  const draft = ensureGrowthDraft(session, state);
  document.querySelectorAll("[data-growth-accept]").forEach((input) => { const proposal = draft.proposals.find((item) => item.proposalId === input.dataset.growthAccept); if (proposal) proposal.status = input.checked ? "accepted" : "pending"; });
  document.querySelectorAll("[data-growth-field]").forEach((input) => { const proposal = draft.proposals.find((item) => item.proposalId === input.dataset.proposalId); if (proposal) Object.assign(proposal, normalizeGrowthProposal({ ...proposal, [input.dataset.growthField]: input.value, status: proposal.status === "accepted" ? "edited" : proposal.status })); });
  document.querySelectorAll("[data-growth-mastery-apply]").forEach((input) => { const proposal = draft.proposals.find((item) => item.proposalId === input.dataset.growthMasteryApply); if (proposal) proposal.applySuggestedMastery = input.checked; });
  draft.userIntent = document.querySelector("#growthIntentInput")?.value.trim() || draft.userIntent;
}

function defaultsFor(state, session) {
  const node = findNodeById(state.starMap, session.nodeId);
  return { parentNodeId: node?.id || session.nodeId, parentPath: findNodePath(state.starMap, session.nodeId).map((item) => item.title), knowledgeType: node?.reviewMetadata?.knowledgeType || "mixed" };
}

function persist(state, session) { setCurrentExploration(state.exploration, session); }
function growthActionLabel(action) { return ({ create_child: "新增子节点", create_sibling: "新增同级", map_existing: "映射已有", add_note: "保存备注" })[action] || action; }
