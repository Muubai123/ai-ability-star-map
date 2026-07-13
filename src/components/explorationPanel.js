import { getAiConfigIssue } from "../aiProviders.js";
import { clearCurrentExploration, setCurrentExploration } from "../exploration/explorationState.js";
import { deleteExplorationSession, getSessionsByNodeId } from "../exploration/explorationStorage.js";
import {
  buildExplorationNodeContext,
  createExplorationId,
  createExplorationSession,
  findNodeById,
  findNodePath,
  formatExplorationDuration,
  getExplorationDuration,
} from "../exploration/explorationUtils.js";
import {
  assessExplorationCompletion,
  confirmExplorationGoal,
  generateCompletionChecklist,
  requestExplorationAssistance,
} from "../exploration/explorationApi.js";
import { saveActiveSession, setActiveMap, setPage } from "../state.js";
import { escapeHtml } from "../utils/jsonUtils.js";
import { getDisplayMastery } from "../utils/mapUtils.js";
import { addLearningRecord } from "../records/learningRecordStore.js";
import { bindGrowthPanelEvents, renderGrowthPanel } from "../growth/ui/GrowthPanel.js";
import { applyGrowthProposals } from "../growth/applyGrowthProposals.js";
import { normalizeGrowthProposal } from "../growth/growthProposal.js";

export function renderExplorationPanel(state) {
  const exploration = state.exploration;
  if (!exploration.panelOpen) return "";

  return `
    <aside class="exploration-panel">
      <header class="exploration-panel-header">
        <div><span>${getStatusLabel(exploration.status)}</span><h2>${escapeHtml(exploration.currentSession?.nodeTitle || state.selectedNode?.title || "节点探索")}</h2></div>
        <div class="exploration-header-actions">
          <button id="openExplorationWorkspaceButton" class="icon-text-button" type="button">打开完整界面</button>
          <button id="closeExplorationPanelButton" class="icon-text-button" type="button">收起</button>
        </div>
      </header>
      ${renderNotice(exploration)}
      <div class="exploration-panel-body">${renderPanelBody(state)}</div>
    </aside>`;
}

export function bindExplorationPanelEvents(state, renderApp) {
  window.clearInterval(state.explorationElapsedTimer);
  if (state.exploration.status === "active") {
    state.explorationElapsedTimer = window.setInterval(() => {
      const target = document.querySelector("#explorationElapsed");
      if (target && state.exploration.currentSession) target.textContent = formatExplorationDuration(getExplorationDuration(state.exploration.currentSession));
    }, 1000);
  }

  bindClick("#openExplorationPanelButton", () => { state.exploration.panelOpen = true; if (state.mapSettings) state.mapSettings.open = false; renderApp(); });
  bindClick("#closeExplorationPanelButton", () => { state.exploration.panelOpen = false; renderApp(); });
  bindClick("#openExplorationWorkspaceButton", () => { setPage("exploration_workspace"); renderApp(); });
  bindClick("#openExplorationConfigButton", () => { state.configReturnPage = state.currentPage; setPage("config"); renderApp(); });
  bindClick("#continueActiveExplorationButton", () => continueOnSessionMap(state, renderApp));
  document.querySelectorAll("[data-start-exploration]").forEach((button) => button.addEventListener("click", () => startExploration(state, renderApp)));
  bindClick("#submitExplorationGoalButton", () => submitGoal(state, renderApp));
  bindClick("#manualGoalConfirmationButton", () => makeManualGoalConfirmation(state, renderApp));
  bindClick("#confirmExplorationGoalButton", () => activateExploration(state, renderApp));
  bindClick("#editExplorationGoalButton", () => setStatus(state, "defining_goal", renderApp));
  bindClick("#cancelExplorationButton", () => cancelExploration(state, renderApp));
  bindClick("#sendExplorationMessageButton", () => askAssistant(state, renderApp));
  document.querySelector("#explorationChatInput")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    await askAssistant(state, renderApp);
  });
  bindClick("#finishExplorationButton", () => enterCompletionCheck(state, renderApp));
  bindClick("#retryCompletionChecklistButton", () => enterCompletionCheck(state, renderApp));
  bindClick("#returnToActiveExplorationButton", () => setStatus(state, "active", renderApp));
  bindClick("#submitExplorationAssessmentButton", () => submitAssessment(state, renderApp));
  bindClick("#retryExplorationAssessmentButton", () => submitAssessment(state, renderApp));
  bindClick("#applyExplorationAssessmentButton", () => finishExploration(state, true, renderApp));
  bindClick("#saveExplorationOnlyButton", () => finishExploration(state, false, renderApp));
  bindClick("#closeCompletedExplorationButton", () => { clearCurrentExploration(state.exploration); state.exploration.panelOpen = false; renderApp(); });
  document.querySelectorAll("[data-accept-exploration-suggestion]").forEach((button) => button.addEventListener("click", () => acceptSuggestedAction(state, button.dataset.acceptExplorationSuggestion, renderApp)));
  bindGrowthPanelEvents(state, renderApp);
}

function bindClick(selector, handler) { document.querySelector(selector)?.addEventListener("click", handler); }

function renderPanelBody(state) {
  const session = state.exploration.currentSession;
  const status = state.exploration.status;
  if (session && isActiveStatus(status) && session.mapId !== state.activeMapId) {
    return `<section class="exploration-complete-state"><span>另一份星图有进行中的探索</span><h3>${escapeHtml(session.nodeTitle)}</h3><button id="continueActiveExplorationButton" class="exploration-primary-button">切换并继续探索</button></section>`;
  }
  if (status === "defining_goal") return renderGoalDefinition(state);
  if (status === "goal_confirmation") return renderGoalConfirmation(state);
  if (status === "active") return renderActiveExploration(state);
  if (status === "completion_check") return renderCompletionCheck(state);
  if (status === "assessment") return renderAssessment(state);
  if (status === "completed") return renderCompleted(state);
  return renderIdle(state);
}

function renderIdle(state) {
  const node = state.selectedNode;
  if (!node) return `<p class="exploration-empty">请先在星图中选择一个节点。</p>`;
  return `${renderNodeContext(state, node)}<section class="exploration-card"><div class="exploration-card-heading"><strong>从一个小目标开始</strong><span>目标确认后再进入学习中</span></div><p>探索会记录目标、证据和最终确认的变化；AI 只在你主动提问或结束学习时介入。</p>${renderConfigHint(state)}<button data-start-exploration class="exploration-primary-button">开始探索</button></section>`;
}

function renderGoalDefinition(state) {
  const session = state.exploration.currentSession;
  const node = getExplorationNode(state, session);
  return `${renderNodeContext(state, node)}<section class="exploration-card exploration-goal-form"><div class="exploration-card-heading"><strong>这次想完成什么？</strong><span>一句自然语言目标即可</span></div><p>例如：用 30 分钟理解导数定义，并独立完成一道基础题。</p><label class="exploration-input-block"><span>本次学习目标</span><textarea id="explorationGoalInput" placeholder="描述想学什么、达到什么程度或完成什么练习。">${escapeHtml(session?.goalInput || "")}</textarea></label>${renderConfigHint(state)}<div class="exploration-button-grid"><button id="cancelExplorationButton">取消探索</button><button id="submitExplorationGoalButton" class="primary-action" ${state.exploration.isRequesting ? "disabled" : ""}>${state.exploration.isRequesting ? "正在确认…" : "提交目标确认"}</button></div><button id="manualGoalConfirmationButton" class="icon-text-button" type="button">暂不调用 AI，按此目标继续</button></section>`;
}

function renderGoalConfirmation(state) {
  const session = state.exploration.currentSession;
  const confirmation = session?.goalConfirmation || {};
  return `<section class="exploration-card goal-confirmation"><div class="exploration-card-heading"><strong>确认本次探索范围</strong><span>${confirmation.isGoalClear ? "目标清晰" : "已整理"}</span></div><p>${escapeHtml(confirmation.reply || "已根据你的描述整理出本次学习范围。")}</p><div class="exploration-goal-statement"><span>本次目标</span><strong>${escapeHtml(confirmation.refinedGoal || session?.goalInput || "")}</strong></div>${renderSuggestionList(confirmation.suggestions, "学习建议", { compact: true })}<div class="exploration-button-grid"><button id="editExplorationGoalButton">继续修改</button><button id="confirmExplorationGoalButton" class="primary-action">确认并开始学习</button></div></section>`;
}

function renderActiveExploration(state) {
  const session = state.exploration.currentSession;
  const messages = renderMessages(session.messages?.length ? session.messages : [createExplorationGreeting()]);
  return `<section class="exploration-card active-exploration-sticky"><div class="active-exploration-goal"><span>学习中</span><strong title="${escapeHtml(session.refinedGoal || session.goalInput)}">${escapeHtml(session.refinedGoal || session.goalInput)}</strong></div><time id="explorationElapsed" class="exploration-elapsed">${formatExplorationDuration(getExplorationDuration(session))}</time></section>${renderGrowthPanel(state)}${renderSuggestionList(session.aiSuggestions, "本次建议", { compact: true })}<section class="exploration-card active-exploration-chat"><header class="active-exploration-chat-heading"><strong>AI 答疑</strong></header><div class="exploration-chat-history">${messages}</div><div class="exploration-chat-composer"><textarea id="explorationChatInput" rows="1" aria-label="向 AI 提问" placeholder="向 AI 提问…"></textarea><button id="sendExplorationMessageButton" class="exploration-chat-send-button" type="button" aria-label="发送问题" title="发送问题" ${state.exploration.isRequesting ? "disabled" : ""}><span aria-hidden="true">↑</span></button></div></section><button id="finishExplorationButton" class="exploration-primary-button">结束探索</button>`;
}

function renderCompletionCheck(state) {
  const session = state.exploration.currentSession;
  const checklist = session?.completionChecklist || [];
  if (state.exploration.isRequesting && !checklist.length) {
    return `<section class="exploration-card completion-preparing"><span>正在整理</span><strong>AI 正在根据本次目标和答疑记录生成完成清单</strong><p>清单生成后会在这里展示，再由你逐项确认。</p><button id="returnToActiveExplorationButton" class="icon-text-button" type="button">返回继续学习</button></section>`;
  }
  if (!checklist.length) {
    return `<section class="exploration-card completion-preparing"><span>尚未生成完成清单</span><strong>暂时没有可供确认的清单</strong><p>你可以重新整理，或返回继续学习。</p><div class="exploration-button-grid"><button id="returnToActiveExplorationButton" type="button">返回继续学习</button><button id="retryCompletionChecklistButton" class="primary-action" type="button">重新整理清单</button></div></section>`;
  }
  return `<section class="exploration-card"><div class="exploration-card-heading"><strong>完成清单</strong><span>先如实勾选，再进行证据评估</span></div><p>${escapeHtml(session?.completionSummary || "请根据真实完成情况检查本次学习。")}</p><div class="completion-checklist">${checklist.map((item) => `<label><input type="checkbox" data-completion-check-id="${escapeHtml(item.id)}" ${item.checked ? "checked" : ""}><span>${escapeHtml(item.label)}</span></label>`).join("")}</div><label class="exploration-input-block"><span>补充说明（可选）</span><textarea id="completionNoteInput" placeholder="哪些题完成了？哪里仍不确定？">${escapeHtml(session?.completionNote || "")}</textarea></label><div class="exploration-button-grid"><button id="returnToActiveExplorationButton">返回继续学习</button><button id="submitExplorationAssessmentButton" class="primary-action" ${state.exploration.isRequesting ? "disabled" : ""}>${state.exploration.isRequesting ? "正在整理证据…" : "提交证据评估"}</button></div></section>`;
}

function renderAssessment(state) {
  const session = state.exploration.currentSession;
  const assessment = session?.assessment;
  if (!assessment && state.exploration.isRequesting) return `<section class="exploration-card assessment-pending"><span>正在整理</span><strong>AI 正在生成本次探索评估</strong><p>评估完成后会在这里展示熟练度建议和下一步方向。</p></section>`;
  if (!assessment) return `<section class="exploration-card assessment-pending"><span>暂未生成评估</span><strong>本次探索还没有可用的评估结果</strong><p>可以重新生成评估，或返回继续学习。</p><button id="retryExplorationAssessmentButton" class="assessment-retry-button" type="button">重新生成评估</button></section>`;
  const node = getExplorationNode(state, session);
  const isParent = Boolean(node?.children?.length);
  const suggestion = assessment.masterySuggestion || {};
  return `<section class="exploration-card assessment-summary"><div class="exploration-card-heading"><strong>证据驱动评估</strong><span>AI 只提出建议，修改需你确认</span></div><p>${escapeHtml(assessment.summary || "本次证据不足以给出明确结论。")}</p>${renderBulletList("本次证据", assessment.evidenceSummary)}${isParent ? renderChildAssessments(assessment.childNodeAssessments) : `<div class="mastery-suggestion"><div><span>熟练度建议</span><strong>${Number(suggestion.before ?? session.masteryBefore)} → ${Number(suggestion.after ?? session.masteryBefore)}</strong></div><p>置信度 ${Math.round(Number(suggestion.confidence || 0) * 100)}% · ${escapeHtml(suggestion.reason || "")}</p><label>确认后的熟练度 <select id="assessmentMasterySelect">${[0,1,2,3,4].map((level) => `<option value="${level}" ${level === Number(suggestion.after) ? "selected" : ""}>${level}</option>`).join("")}</select></label></div>`}${renderBulletList("仍待解决", assessment.remainingProblems)}${renderNewNodeSuggestions(assessment.newNodeSuggestions)}${assessment.nextSuggestion ? `<p class="next-exploration-suggestion">下一步：${escapeHtml(assessment.nextSuggestion)}</p>` : ""}<div class="exploration-button-grid"><button id="returnToActiveExplorationButton">返回继续学习</button><button id="applyExplorationAssessmentButton" class="primary-action">确认并应用</button></div><button id="saveExplorationOnlyButton" class="icon-text-button">仅保存记录，不修改星图</button></section>`;
}

function renderCompleted(state) {
  const session = state.exploration.currentSession;
  return `<section class="exploration-complete-state"><span>探索已保存</span><h3>${escapeHtml(session?.nodeTitle || "本次探索")}</h3><p>${escapeHtml(session?.review?.summary || "学习记录、目标和完成证据已保存到本地。")}</p><button id="closeCompletedExplorationButton" class="exploration-primary-button">返回星图</button></section>`;
}

function renderNodeContext(state, node) {
  if (!node) return "";
  const path = findNodePath(state.starMap, node.id).map((item) => item.title).join(" › ");
  const recent = getSessionsByNodeId(node.id, state.activeMapId).filter((item) => item.status === "completed").length;
  return `<section class="exploration-node-context"><div><span>当前节点</span><strong>${escapeHtml(node.title)}</strong></div><div><span>路径</span><strong>${escapeHtml(path)}</strong></div><div><span>当前熟练度</span><strong>${getDisplayMastery(node)} / 4</strong></div>${node.description ? `<div><span>节点说明</span><strong>${escapeHtml(node.description)}</strong></div>` : ""}<div><span>近期探索</span><strong>${recent ? `已完成 ${recent} 次` : "暂无记录"}</strong></div></section>`;
}

function renderMessages(messages = []) {
  if (!messages.length) return "";
  return `<section class="exploration-messages">${messages.slice(-8).map((message) => `<article class="exploration-message ${message.role === "user" ? "user" : "assistant"}"><span>${message.role === "user" ? "你" : "AI"}</span><p>${escapeHtml(message.content)}</p></article>`).join("")}</section>`;
}

function renderSuggestionList(items = [], heading = "学习建议", { compact = false } = {}) {
  if (!items?.length) return "";
  return `<section class="exploration-suggestions ${compact ? "compact" : ""}"><span>${heading}</span><div class="exploration-suggestion-list">${items.map((item) => `<article class="exploration-suggestion-card"><div class="exploration-suggestion-copy"><strong>${escapeHtml(item.title || "建议")}</strong><p>${escapeHtml(item.description || item.content || "")}</p></div>${item.id ? `<button data-accept-exploration-suggestion="${escapeHtml(item.id)}" ${item.accepted ? "disabled" : ""}>${item.accepted ? "已记录" : "记录"}</button>` : ""}</article>`).join("")}</div></section>`;
}

function renderBulletList(title, items = []) {
  return items?.length ? `<div class="exploration-evidence-list"><span>${title}</span><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : "";
}

function renderChildAssessments(items = []) {
  if (!items.length) return `<p>这是父节点，熟练度将继续由子节点计算；本次没有可应用的子节点建议。</p>`;
  return `<div class="assessment-child-list"><span>建议更新的子节点</span>${items.map((item) => `<label><input type="checkbox" data-child-assessment-id="${escapeHtml(item.nodeId)}" checked><div><strong>${escapeHtml(item.nodeTitle || item.nodeId)}：${item.before} → ${item.after}</strong><small>${escapeHtml(item.reason || "")}</small></div></label>`).join("")}</div>`;
}

function renderNewNodeSuggestions(items = []) {
  if (!items?.length) return "";
  return `<div class="assessment-child-list"><span>可选新节点建议</span>${items.map((item, index) => `<label><input type="checkbox" data-new-node-index="${index}"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description || "")}</small></div></label>`).join("")}</div>`;
}

function renderNotice(exploration) {
  if (!exploration.error && !exploration.notice) return "";
  return `<div class="exploration-notice ${exploration.error ? "error" : ""}">${escapeHtml(exploration.error || exploration.notice)}${exploration.rawOutput ? `<details><summary>查看模型原始输出</summary><pre>${escapeHtml(exploration.rawOutput)}</pre></details>` : ""}</div>`;
}

function renderConfigHint(state) {
  return getAiConfigIssue(state.aiConfig) ? `<button id="openExplorationConfigButton" class="exploration-config-link">配置模型后使用 AI 确认与评估</button>` : "";
}

function startExploration(state, renderApp) {
  const current = state.exploration.currentSession;
  if (current && isActiveStatus(current.status)) { state.exploration.panelOpen = true; renderApp(); return; }
  const targetNode = state.selectedNode || state.currentNode;
  if (!targetNode) { state.exploration.error = "请先选择一个要探索的节点。"; renderApp(); return; }
  state.selectedNode = targetNode;
  state.exploration.selectedNodeId = targetNode.id;
  const session = createExplorationSession(state, targetNode);
  state.exploration.panelOpen = true;
  if (state.mapSettings) state.mapSettings.open = false;
  state.exploration.error = "";
  persistExploration(state, session);
  renderApp();
}

async function submitGoal(state, renderApp) {
  const session = state.exploration.currentSession;
  const goal = document.querySelector("#explorationGoalInput")?.value.trim() || "";
  if (!session || !goal) { state.exploration.error = "请先写下这次想完成的学习目标。"; renderApp(); return; }
  session.goalInput = goal;
  session.refinedGoal = "";
  if (getAiConfigIssue(state.aiConfig)) { state.exploration.error = "尚未配置模型。你可以选择按当前目标继续，或先配置模型。"; persistExploration(state, session); renderApp(); return; }
  state.exploration.isRequesting = true; state.exploration.error = ""; state.exploration.notice = "AI 正在确认目标范围…"; persistExploration(state, session); renderApp();
  try {
    const result = await confirmExplorationGoal(session, buildExplorationNodeContext(state, getExplorationNode(state, session)), state.aiConfig);
    if (!result.value) { state.exploration.error = result.parseError; state.exploration.rawOutput = result.rawOutput; }
    else { session.goalConfirmation = result.value; session.status = "goal_confirmation"; state.exploration.notice = ""; state.exploration.rawOutput = ""; }
    persistExploration(state, session);
  } catch (error) { state.exploration.error = `目标确认失败：${error.message}`; persistExploration(state, session); }
  finally { state.exploration.isRequesting = false; renderApp(); }
}

function makeManualGoalConfirmation(state, renderApp) {
  const session = state.exploration.currentSession;
  const goal = document.querySelector("#explorationGoalInput")?.value.trim() || session?.goalInput || "";
  if (!session || !goal) { state.exploration.error = "请先写下学习目标。"; renderApp(); return; }
  session.goalInput = goal;
  session.goalConfirmation = { reply: "将按这个目标开始。学习中 AI 会保持待命，结束时可再进行完成检查。", isGoalClear: true, isScopeReasonable: true, refinedGoal: goal, suggestions: [], followUpQuestion: "" };
  session.status = "goal_confirmation";
  state.exploration.error = "";
  persistExploration(state, session); renderApp();
}

function activateExploration(state, renderApp) {
  const session = state.exploration.currentSession;
  if (!session) return;
  const confirmation = session.goalConfirmation || {};
  session.refinedGoal = confirmation.refinedGoal || session.goalInput;
  session.aiSuggestions = confirmation.suggestions || [];
  session.plan.goal = session.refinedGoal;
  session.startedAt ||= Date.now();
  if (!session.messages?.length) session.messages = [createExplorationGreeting()];
  session.status = "active";
  state.exploration.notice = "已进入学习中，AI 会在你主动提问时响应。";
  state.exploration.error = "";
  persistExploration(state, session); renderApp();
}

async function askAssistant(state, renderApp) {
  const session = state.exploration.currentSession;
  const input = document.querySelector("#explorationChatInput")?.value.trim() || "";
  const node = getExplorationNode(state, session);
  if (!session || !node || !input || state.exploration.isRequesting) return;
  if (getAiConfigIssue(state.aiConfig)) { state.exploration.error = "请先配置模型后再向 AI 提问。"; renderApp(); return; }
  if (!session.messages?.length) session.messages = [createExplorationGreeting()];
  session.messages.push({ role: "user", content: input, createdAt: Date.now() });
  state.exploration.isRequesting = true; state.exploration.error = ""; state.exploration.notice = "AI 正在待命回复…"; persistExploration(state, session); renderApp();
  try {
    const result = await requestExplorationAssistance(session, buildExplorationNodeContext(state, node), input, state.aiConfig);
    session.messages.push({ role: "assistant", content: result.reply, createdAt: Date.now() });
    session.suggestedActions.push(...result.suggestedActions);
    state.exploration.error = result.parseError; state.exploration.rawOutput = result.parseError ? result.rawOutput : ""; state.exploration.notice = "";
    persistExploration(state, session);
  } catch (error) { state.exploration.error = `AI 回复失败：${error.message}`; persistExploration(state, session); }
  finally { state.exploration.isRequesting = false; renderApp(); }
}

function createExplorationGreeting() {
  return {
    role: "assistant",
    content: "学习已经开始。遇到卡点时，把你的理解、步骤或题目发给我，我会陪你一起拆解。",
    createdAt: Date.now(),
    isGreeting: true,
  };
}

function acceptSuggestedAction(state, actionId, renderApp) {
  const session = state.exploration.currentSession;
  const action = session?.suggestedActions?.find((item) => item.id === actionId);
  if (!action || action.accepted) return;
  if (action.type === "add_note" && action.content) session.notes.push({ id: createExplorationId("note"), content: action.content, createdAt: Date.now(), source: "ai_suggestion" });
  if (action.type === "add_evidence" && action.content) session.evidence.push({ id: createExplorationId("evidence"), content: action.content, type: action.evidenceType || "self_report", createdAt: Date.now() });
  if (action.type === "suggest_new_node" && action.title) session.suggestedMapChanges.push({ id: createExplorationId("change"), type: "add_child", parentId: action.parentId || session.nodeId, title: action.title, description: action.content || "AI 探索建议" });
  if (action.type === "suggest_prerequisite" && action.nodeTitle) session.suggestedMapChanges.push({ id: createExplorationId("change"), type: "add_prerequisite", parentId: session.nodeId, title: action.nodeTitle, description: action.content || "" });
  action.accepted = true; state.exploration.notice = "建议已记录到本次探索。"; persistExploration(state, session); renderApp();
}

async function enterCompletionCheck(state, renderApp) {
  const session = state.exploration.currentSession;
  const node = getExplorationNode(state, session);
  if (!session || !node) return;
  session.status = "completion_check";
  session.completionChecklist = [];
  session.completionSummary = "";
  state.exploration.error = "";
  if (getAiConfigIssue(state.aiConfig)) { state.exploration.error = "尚未配置模型，无法生成完成清单。"; session.status = "active"; persistExploration(state, session); renderApp(); return; }
  state.exploration.isRequesting = true; state.exploration.notice = "AI 正在整理完成清单…"; persistExploration(state, session); renderApp();
  try {
    const history = getSessionsByNodeId(session.nodeId, session.mapId).slice(0, 3);
    const result = await generateCompletionChecklist(session, buildExplorationNodeContext(state, node), history, state.aiConfig);
    if (result.value?.checklist?.length) { session.completionChecklist = result.value.checklist; session.completionSummary = result.value.summary; state.exploration.rawOutput = ""; }
    else { state.exploration.error = result.parseError || "AI 未返回可用完成清单，请重新整理。"; state.exploration.rawOutput = result.rawOutput || ""; }
    state.exploration.notice = ""; persistExploration(state, session);
  } catch (error) { state.exploration.error = `完成清单生成失败：${error.message}`; persistExploration(state, session); }
  finally { state.exploration.isRequesting = false; renderApp(); }
}

async function submitAssessment(state, renderApp) {
  const session = state.exploration.currentSession;
  const node = getExplorationNode(state, session);
  if (!session || !node || state.exploration.isRequesting) return;
  session.completionChecklist = (session.completionChecklist || []).map((item) => ({ ...item, checked: Boolean(document.querySelector(`[data-completion-check-id="${cssEscape(item.id)}"]`)?.checked) }));
  session.completionNote = document.querySelector("#completionNoteInput")?.value.trim() || session.completionNote || "";
  session.status = "assessment";
  if (getAiConfigIssue(state.aiConfig)) { state.exploration.error = "尚未配置模型，无法生成 AI 评估；你可以返回继续学习，或稍后重试。"; persistExploration(state, session); renderApp(); return; }
  state.exploration.isRequesting = true; state.exploration.error = ""; state.exploration.notice = "AI 正在基于完成清单、笔记和对话整理评估…"; persistExploration(state, session); renderApp();
  try {
    const history = getSessionsByNodeId(session.nodeId, session.mapId).slice(0, 3);
    const result = await assessExplorationCompletion(session, buildExplorationNodeContext(state, node), history, state.aiConfig);
    if (!result.value) { state.exploration.error = result.parseError; state.exploration.rawOutput = result.rawOutput; }
    else { session.assessment = result.value; session.review = toLegacyReview(result.value); state.exploration.rawOutput = ""; }
    state.exploration.notice = ""; persistExploration(state, session);
  } catch (error) { state.exploration.error = `证据评估失败：${error.message}`; persistExploration(state, session); }
  finally { state.exploration.isRequesting = false; renderApp(); }
}

function finishExploration(state, applyChanges, renderApp) {
  const session = state.exploration.currentSession;
  const node = getExplorationNode(state, session);
  if (!session || !node) return;
  const assessment = session.assessment || {};
  const acceptedChanges = [];
  if (applyChanges) {
    if (!node.children?.length) {
      const proposed = Number(document.querySelector("#assessmentMasterySelect")?.value);
      if (Number.isFinite(proposed)) { node.mastery = Math.max(0, Math.min(4, proposed)); session.masteryAccepted = node.mastery; }
    } else {
      document.querySelectorAll("[data-child-assessment-id]:checked").forEach((input) => {
        const result = (assessment.childNodeAssessments || []).find((item) => item.nodeId === input.dataset.childAssessmentId);
        const child = findNodeById(state.starMap, result?.nodeId);
        if (result && child && !(child.children || []).length) { child.mastery = result.after; acceptedChanges.push({ type: "mastery", nodeId: child.id, before: result.before, after: result.after }); }
      });
    }
    const legacyGrowthProposals = [...document.querySelectorAll("[data-new-node-index]:checked")]
      .map((input) => assessment.newNodeSuggestions?.[Number(input.dataset.newNodeIndex)])
      .filter(Boolean)
      .map((suggestion) => normalizeGrowthProposal({
        action: "create_child",
        title: suggestion.title,
        description: suggestion.description,
        parentNodeId: suggestion.parentId || session.nodeId,
        status: "accepted",
        sourceTypes: ["conversation"],
        createdBy: "ai_proposal",
      }));
    if (legacyGrowthProposals.length) {
      const growth = applyGrowthProposals(state.appData, {
        mapId: session.mapId,
        proposals: legacyGrowthProposals,
        triggerType: "exploration",
        sourceNodeId: session.nodeId,
        sourceSessionId: session.id,
        sourceRecordId: `exploration-assessment-growth-${session.id}`,
      });
      if (growth.success) {
        state.starMap = state.appData.maps.find((map) => map.id === session.mapId)?.rootNode || state.starMap;
        acceptedChanges.push(...growth.createdNodeIds.map((nodeId) => ({ type: "add_child", nodeId })));
      } else {
        state.exploration.error = growth.errors.join(" ") || "新增节点失败，已保留探索记录。";
      }
    }
  }
  session.masteryAccepted ??= session.masteryBefore;
  session.acceptedChanges = acceptedChanges;
  session.status = "completed";
  session.endedAt = Date.now();
  session.review = toLegacyReview(assessment);
  addLearningRecord(state.appData, buildExplorationLearningRecord(session, node));
  saveActiveSession();
  persistExploration(state, session);
  state.exploration.feedback = { nodeId: node.id, branchId: getNodeBranchId(state.starMap, node.id), message: applyChanges ? "探索已保存，并已应用你确认的更新。" : "探索记录已保存，星图未修改。" };
  state.exploration.notice = state.exploration.feedback.message; state.exploration.error = ""; renderApp();
}

function toLegacyReview(assessment = {}) {
  return { summary: assessment.summary || "本次探索已保存。", evidence: assessment.evidenceSummary || [], masterySuggestion: assessment.masterySuggestion || {}, mapChanges: [], nextSuggestion: assessment.nextSuggestion || "" };
}

function buildExplorationLearningRecord(session, node) {
  const checklistEvidence = (session.completionChecklist || [])
    .filter((item) => item.checked)
    .map((item) => ({
      type: item.category === "application" ? "exercise" : item.category === "independence" ? "independent_practice" : item.category === "explanation" ? "explanation" : item.category === "difficulty" ? "difficulty" : item.category === "unresolved" ? "unresolved" : "understanding",
      content: item.label,
    }));
  const userEvidence = (session.evidence || []).map((item) => ({ type: item.type || item.evidenceType || "exposure", content: item.content || "" }));
  const masteryChanges = [
    ...(session.masteryAccepted !== null && session.masteryAccepted !== undefined ? [{ nodeId: session.nodeId, before: session.masteryBefore, suggested: session.assessment?.masterySuggestion?.after ?? null, accepted: session.masteryAccepted, reason: session.assessment?.masterySuggestion?.reason || "" }] : []),
    ...(session.acceptedChanges || []).filter((item) => item.type === "mastery").map((item) => ({ nodeId: item.nodeId, before: item.before, suggested: item.after, accepted: item.after, reason: "探索评估确认" })),
  ];
  const createdNodeIds = (session.acceptedChanges || [])
    .filter((item) => item.type === "add_child" && item.nodeId)
    .map((item) => item.nodeId);
  const activityOccurredAt = new Date(session.endedAt || Date.now()).toISOString();
  const affectedNodeIds = [...new Set([session.nodeId, ...masteryChanges.map((item) => item.nodeId), ...createdNodeIds])];
  return {
    id: `exploration-record-${session.id}`,
    sourceKind: "exploration_session",
    sourceSessionId: session.id,
    type: "exploration",
    mapId: session.mapId,
    nodeIds: affectedNodeIds,
    affectedNodeIds,
    createdNodeIds,
    nodeId: session.nodeId,
    nodeTitle: node.title,
    nodePath: session.nodePath,
    createdAt: new Date(session.createdAt || Date.now()).toISOString(),
    startedAt: session.startedAt ? new Date(session.startedAt).toISOString() : null,
    endedAt: activityOccurredAt,
    activityOccurredAt,
    summary: session.review?.summary || session.refinedGoal || session.goalInput || "探索已完成。",
    rawInput: session.completionNote || session.goalInput || "",
    evidence: [...userEvidence, ...checklistEvidence],
    masteryChanges,
    remainingProblems: session.assessment?.remainingProblems || [],
    nextSuggestions: [session.assessment?.nextSuggestion].filter(Boolean),
  };
}

function cancelExploration(state, renderApp) {
  const sessionId = state.exploration.currentSession?.id;
  if (sessionId) deleteExplorationSession(sessionId);
  clearCurrentExploration(state.exploration);
  state.exploration.panelOpen = false;
  state.exploration.notice = "已取消未开始的探索。";
  renderApp();
}
function setStatus(state, status, renderApp) { const session = state.exploration.currentSession; if (!session) return; session.status = status; state.exploration.error = ""; persistExploration(state, session); renderApp(); }
function continueOnSessionMap(state, renderApp) { const session = state.exploration.currentSession; if (!session) return; if (session.mapId !== state.activeMapId) setActiveMap(session.mapId); state.selectedNode = findNodeById(state.starMap, session.nodeId) || state.selectedNode; state.exploration.panelOpen = true; renderApp(); }
function persistExploration(state, session) { try { setCurrentExploration(state.exploration, session); return true; } catch (error) { state.exploration.error = error.message; return false; } }
function getExplorationNode(state, session) { if (!session) return null; return session.mapId === state.activeMapId ? findNodeById(state.starMap, session.nodeId) : findNodeById(state.appData.maps.find((map) => map.id === session.mapId)?.rootNode, session.nodeId); }
function isActiveStatus(status) { return ["planning", "defining_goal", "goal_confirmation", "active", "reviewing", "completion_check", "assessment"].includes(status); }
function getStatusLabel(status) { return ({ idle: "节点探索", defining_goal: "确认学习目标", goal_confirmation: "确认探索范围", active: "学习中待命", completion_check: "完成检查", assessment: "证据评估", completed: "探索完成" })[status] || "节点探索"; }
function getNodeBranchId(root, nodeId) { const path = findNodePath(root, nodeId); return path[1]?.id || path[0]?.id || ""; }
function cssEscape(value) { return String(value).replace(/(["\\])/g, "\\$1"); }
