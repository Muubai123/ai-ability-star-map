import { getAiConfigIssue } from "../aiProviders.js";
import { getMapById, saveAppData } from "../appData.js";
import { analyzeSingleMapReview, assessSingleMapReview, buildNodeIndex } from "../review/reviewApi.js";
import { createReviewState } from "../review/reviewState.js";
import { findNodeById } from "../exploration/explorationUtils.js";
import { escapeHtml } from "../utils/jsonUtils.js";
import { saveActiveSession } from "../state.js";
import { completeReviewQueueItem } from "../review/globalReviewStore.js";
import { getReviewQueueById, pauseReviewQueue, saveReviewQueue } from "../review/globalReviewStore.js";
import { addLearningRecord } from "../records/learningRecordStore.js";
import { findRelevantKnowledge, buildKnowledgeContext } from "../utils/knowledgeUtils.js";
import { applyGrowthProposals } from "../growth/applyGrowthProposals.js";
import { normalizeGrowthProposal } from "../growth/growthProposal.js";
import { renderGrowthProposalCard } from "../growth/ui/GrowthPanel.js";

const stateFor = (state) => state.review || (state.review = createReviewState());

export function renderReviewWorkspacePage(state) {
  const review = stateFor(state);
  const map = getMapById(state.appData, state.activeMapId);
  if (!map) return `<main class="review-workspace"><section class="empty-collection"><h2>找不到这张星图</h2><button data-review-workspace="back" type="button">返回复盘选择</button></section></main>`;
  const isGlobalItem = review.entryContext?.entryType === "global_review_item";
  return `<main class="review-workspace"><header class="review-workspace-header"><div><p class="eyebrow">${isGlobalItem ? "全局复盘 · 单科处理" : "单星图复盘"}</p><h1>复盘：${escapeHtml(map.title)}</h1><p>${isGlobalItem ? "已带入 AI 整理出的本学科内容；完成后会回到全局复盘列表。" : "先确认学习内容与证据；结构缺口会作为候选提案，仍需你确认后才写入地图。"}</p></div><div>${isGlobalItem ? `<button data-review-workspace="global-pause" type="button">暂停全局复盘</button>` : ""}<button data-review-workspace="back" type="button">${isGlobalItem ? "返回全局复盘" : "返回复盘选择"}</button></div></header>${review.error ? `<section class="review-error"><strong>${escapeHtml(review.error)}</strong>${review.rawOutput ? `<details><summary>查看模型原始输出</summary><pre>${escapeHtml(review.rawOutput)}</pre></details>` : ""}</section>` : ""}${review.status === "input" ? renderInput(review) : review.status === "mapping" ? renderMapping(map, review) : renderAssessment(map, review)}</main>`;
}

function renderInput(review) {
  return `<section class="review-stage-card"><h2>说说这次学习</h2><p>用几句话说说今天学了什么、做了什么，以及哪些地方还不确定。</p><textarea id="reviewRawInput" rows="9" placeholder="例如：今天复习了导数定义，做了 8 道求导题，其中 6 道能独立完成；复合函数求导还容易漏掉链式法则。">${escapeHtml(review.rawInput)}</textarea><div class="review-stage-actions"><button data-review-workspace="analyze" type="button" ${review.isRequesting ? "disabled" : ""}>${review.isRequesting ? "正在分析..." : "分析学习内容"}</button><button class="quiet-button" data-review-workspace="save-only" type="button">仅保存文字记录</button></div></section>`;
}

function renderMapping(map, review) {
  const analysis = review.analysis || {};
  const index = buildNodeIndex(map.rootNode);
  const matches = (analysis.matchedNodes || []).map((item) => `<article><label><input type="checkbox" data-review-match="${escapeHtml(item.nodeId)}" ${item.accepted ? "checked" : ""}><strong>${escapeHtml(item.nodeTitle)}</strong></label><small>${escapeHtml((item.nodePath || []).join(" > "))}</small><p>${escapeHtml(item.reason || "")}</p><ul>${(item.evidence || []).map((e) => `<li>${escapeHtml(e.content || "")}</li>`).join("")}</ul></article>`).join("") || "<p>暂未可靠匹配到节点。</p>";
  const possible = (analysis.contentMatches || []).filter((item) => item?.matchType === "possible_match");
  const possibleMatches = possible.length ? `<section class="review-possible-matches"><strong>可能匹配</strong>${possible.map((item) => `<p>${escapeHtml(item.reason || "这部分内容可能对应已有节点。")}<small>${escapeHtml((item.matchedNodeIds || []).map((id) => index.find((node) => node.nodeId === id)?.nodeTitle || id).join(" · "))}</small></p>`).join("")}<span>可在下方“手动补充节点”中选择已有节点，避免重复创建。</span></section>` : "";
  const unmatched = analysis.unmatchedTopics?.length ? `<div class="unmatched-topics"><strong>无法确定</strong>${analysis.unmatchedTopics.map((item) => `<p>${escapeHtml(item.title)}：${escapeHtml(item.reason || "")}</p>`).join("")}</div>` : "";
  const followups = analysis.followUpQuestions?.length ? `<div class="review-followups"><strong>需要补充的信息</strong>${analysis.followUpQuestions.map((question, index) => `<label>${escapeHtml(question)}<input data-review-followup="${index}" value="${escapeHtml(review.followUpAnswers[index] || "")}"></label>`).join("")}</div>` : "";
  return `<section class="review-stage-card"><h2>确认学习内容</h2><p>${escapeHtml(analysis.summary || analysis.reply || "请确认 AI 匹配到的学习节点。")}</p><div class="review-match-list">${matches}</div>${possibleMatches}${renderGrowthSection(map, review, index)}${unmatched}${followups}<label class="review-manual-node">手动补充节点<select id="reviewManualNode"><option value="">选择节点</option>${index.map((node) => `<option value="${escapeHtml(node.nodeId)}">${escapeHtml(node.nodePath.join(" > "))}</option>`).join("")}</select></label><div class="review-stage-actions"><button data-review-workspace="assess" type="button" ${review.isRequesting ? "disabled" : ""}>${review.isRequesting ? "正在生成建议..." : "确认并评估熟练度"}</button><button class="quiet-button" data-review-workspace="reanalyze" type="button">重新分析</button><button class="quiet-button" data-review-workspace="save-only" type="button">仅保存复盘</button></div></section>`;
}

function renderGrowthSection(map, review, index) {
  const proposals = review.growthProposals || [];
  if (!proposals.length) return "";
  const options = index.map((node) => `<option value="${escapeHtml(node.nodeId)}">${escapeHtml(node.nodePath.join(" › "))}</option>`).join("");
  return `<section class="review-growth-section"><header><div><span>星图生长建议</span><strong>发现 ${proposals.length} 个结构缺口</strong><p>仅勾选并确认的候选会写入星图，也可以改为映射已有节点。</p></div><small>复盘辅助</small></header><div class="review-growth-proposal-grid">${proposals.map((proposal) => renderGrowthProposalCard(proposal, options, map.rootNode, map.rootNode)).join("")}</div></section>`;
}

function renderAssessment(map, review) {
  const result = review.assessment || {};
  return `<section class="review-stage-card"><h2>确认地图更新</h2><p>${escapeHtml(result.overallSummary || result.recordSummary || "请确认本次复盘建议。")}</p><div class="review-assessment-list">${(result.nodeAssessments || []).map((item) => `<article><label><input type="checkbox" data-review-assessment="${escapeHtml(item.nodeId)}" ${item.accepted ? "checked" : ""}><strong>${escapeHtml(item.nodeTitle)}</strong></label><p>熟练度 ${item.masteryBefore} → <select data-review-mastery="${escapeHtml(item.nodeId)}">${[0, 1, 2, 3, 4].map((level) => `<option value="${level}" ${level === item.masterySuggested ? "selected" : ""}>${level}</option>`).join("")}</select> <small>置信度 ${Math.round((Number(item.confidence) || 0) * 100)}%</small></p><p>${escapeHtml(item.reason || "")}</p></article>`).join("") || "<p>证据不足，暂不建议修改熟练度。</p>"}</div>${(review.growthProposals || []).length ? `<p class="review-growth-reminder">确认保存时，会先应用你勾选的生长提案，再写入本次复盘记录。</p>` : ""}<div class="review-stage-actions"><button data-review-workspace="apply" type="button">接受选中更新</button><button class="quiet-button" data-review-workspace="save-only" type="button">仅保存复盘</button><button class="quiet-button" data-review-workspace="back-mapping" type="button">返回补充</button></div></section>`;
}

export function bindReviewWorkspacePageEvents(state, renderApp) {
  document.querySelectorAll("[data-review-workspace]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.reviewWorkspace;
    const review = stateFor(state);
    if (action === "back") {
      if (review.entryContext?.entryType === "global_review_item") {
        persistReviewDraft(state, review);
        state.activeReviewQueueId = review.entryContext.sourceQueueId;
        state.currentMode = "review";
        state.currentPage = "global_review_workspace";
      } else {
        state.currentPage = "map_selection_review";
      }
      renderApp();
      return;
    }
    if (action === "global-pause") {
      persistReviewDraft(state, review);
      pauseReviewQueue(state.appData, review.entryContext.sourceQueueId);
      state.currentMode = "review";
      state.currentPage = "map_selection_review";
      renderApp();
      return;
    }
    if (action === "analyze" || action === "reanalyze") { await analyze(state, review, renderApp); return; }
    if (action === "assess") { await assess(state, review, renderApp); return; }
    if (action === "back-mapping") { review.status = "mapping"; renderApp(); return; }
    if (action === "save-only") { const record = saveRecord(state, review, false); clearReviewDraft(state, review); finishReviewEntry(state, review, record, null); renderApp(); return; }
    if (action === "apply") { applyReview(state, review, renderApp); }
  }));
}

export function persistReviewWorkspaceDraft(state) {
  const review = stateFor(state);
  persistReviewDraft(state, review);
}

async function analyze(state, review, renderApp) {
  const rawInput = document.querySelector("#reviewRawInput")?.value.trim() || review.rawInput;
  if (!rawInput) { review.error = "请先写下本次学习总结。"; renderApp(); return; }
  const issue = getAiConfigIssue(state.aiConfig);
  if (issue) { review.error = issue; renderApp(); return; }
  review.rawInput = rawInput; review.error = ""; review.isRequesting = true; renderApp();
  try {
    const map = getMapById(state.appData, state.activeMapId);
    const relevant = findRelevantKnowledge({ title: map.title, goal: rawInput }, [{ role: "user", content: rawInput }], { knowledgeBases: state.appData.knowledgeBases || [], limit: 2 });
    review.analysis = await analyzeSingleMapReview(map, rawInput, state.appData.learningRecords.filter((record) => record.mapId === map.id), state.aiConfig, buildKnowledgeContext(relevant, { maxChars: 2600, maxDocumentChars: 700 }));
    review.growthProposals = review.analysis.growthProposals || [];
    review.status = "mapping"; review.rawOutput = "";
  } catch (error) { review.error = error.message; review.rawOutput = error.message; }
  finally { review.isRequesting = false; persistReviewDraft(state, review); renderApp(); }
}

async function assess(state, review, renderApp) {
  syncReviewInputs(review);
  const map = getMapById(state.appData, state.activeMapId);
  review.analysis.matchedNodes.forEach((item) => { const input = document.querySelector(`[data-review-match='${item.nodeId}']`); item.accepted = Boolean(input?.checked); });
  const manual = document.querySelector("#reviewManualNode")?.value;
  if (manual && !review.analysis.matchedNodes.some((item) => item.nodeId === manual)) { const node = buildNodeIndex(map.rootNode).find((item) => item.nodeId === manual); if (node) review.analysis.matchedNodes.push({ ...node, reason: "用户手动补充", evidence: [], accepted: true }); }
  review.followUpAnswers = (review.analysis.followUpQuestions || []).map((_, index) => document.querySelector(`[data-review-followup='${index}']`)?.value.trim() || "");
  review.isRequesting = true; review.error = ""; renderApp();
  try { review.assessment = await assessSingleMapReview(map, review, state.aiConfig); review.status = "assessment"; review.rawOutput = ""; }
  catch (error) { review.error = error.message; review.rawOutput = error.message; }
  finally { review.isRequesting = false; persistReviewDraft(state, review); renderApp(); }
}

function syncReviewInputs(review) {
  document.querySelectorAll("[data-growth-accept]").forEach((input) => { const proposal = review.growthProposals.find((item) => item.proposalId === input.dataset.growthAccept); if (proposal) proposal.status = input.checked ? "accepted" : "pending"; });
  document.querySelectorAll("[data-growth-field]").forEach((input) => { const proposal = review.growthProposals.find((item) => item.proposalId === input.dataset.proposalId); if (proposal) Object.assign(proposal, normalizeGrowthProposal({ ...proposal, [input.dataset.growthField]: input.value, status: proposal.status === "accepted" ? "edited" : proposal.status })); });
  document.querySelectorAll("[data-growth-mastery-apply]").forEach((input) => { const proposal = review.growthProposals.find((item) => item.proposalId === input.dataset.growthMasteryApply); if (proposal) proposal.applySuggestedMastery = input.checked; });
}

function applyReview(state, review, renderApp) {
  syncReviewInputs(review);
  const root = state.starMap;
  const growth = applyGrowthProposals(state.appData, { mapId: state.activeMapId, proposals: review.growthProposals, triggerType: review.entryContext?.entryType === "global_review_item" ? "global_review_item" : "single_review", sourceNodeId: null, sourceRecordId: review.growthSourceRecordId || (review.growthSourceRecordId = `review-growth-${Date.now().toString(36)}`), knowledgeBaseIds: [] });
  if (!growth.success) { review.error = growth.errors.join(" ") || "新增节点失败。"; persistReviewDraft(state, review); renderApp(); return; }
  state.starMap = getMapById(state.appData, state.activeMapId).rootNode;
  const changed = [];
  (review.assessment?.nodeAssessments || []).forEach((item) => { const checked = document.querySelector(`[data-review-assessment='${item.nodeId}']`)?.checked; const node = findNodeById(state.starMap, item.nodeId); if (checked && node && !(node.children || []).length) { node.mastery = Number(document.querySelector(`[data-review-mastery='${item.nodeId}']`)?.value ?? item.masterySuggested); changed.push(node.id); } });
  const createdNodes = growth.createdNodeIds.map((id) => findNodeById(state.starMap, id)).filter(Boolean).map((node) => ({ id: node.id, title: node.title, description: node.description || "" }));
  createdNodes.forEach((node) => { if (!review.analysis.matchedNodes.some((item) => item.nodeId === node.id)) review.analysis.matchedNodes.push({ nodeId: node.id, nodeTitle: node.title, nodePath: [], reason: "复盘生长节点", evidence: [], accepted: true }); });
  const feedback = { mapId: state.activeMapId, source: "review", highlightNodeIds: [...changed, ...growth.createdNodeIds], masteryChangedNodeIds: changed, newNodeIds: growth.createdNodeIds, message: `复盘完成，更新了 ${changed.length} 个节点，新增了 ${growth.createdNodeIds.length} 个节点。` };
  const record = saveRecord(state, review, true, createdNodes, growth);
  state.pendingMapFeedback = feedback;
  clearReviewDraft(state, review);
  saveActiveSession();
  finishReviewEntry(state, review, record, feedback);
  renderApp();
}

function saveRecord(state, review, apply, newNodes = [], growth = null) {
  const assessment = review.assessment || {};
  const accepted = apply ? (assessment.nodeAssessments || []).filter((item) => item.accepted) : [];
  const entry = review.entryContext;
  const createdIds = growth?.createdNodeIds || [];
  const mappedIds = growth?.mappedNodeIds || [];
  const activityOccurredAt = new Date().toISOString();
  const affectedNodeIds = [...new Set([...(review.analysis?.matchedNodes || []).filter((item) => item.accepted).map((item) => item.nodeId), ...createdIds, ...mappedIds])];
  const record = { id: `review-${Date.now().toString(36)}`, type: entry?.entryType === "global_review_item" ? "global_review_item" : "single_review", mapId: state.activeMapId, sourceQueueId: entry?.sourceQueueId || null, sourceQueueItemId: entry?.sourceQueueItemId || null, sourceGrowthRecordId: growth?.growthRecordId || null, createdNodeIds: createdIds, nodeIds: affectedNodeIds, affectedNodeIds, createdAt: activityOccurredAt, endedAt: activityOccurredAt, activityOccurredAt, rawInput: review.rawInput, summary: assessment.recordSummary || review.analysis?.summary || "", evidence: (review.analysis?.matchedNodes || []).flatMap((item) => item.evidence || []), masteryChanges: [...(assessment.nodeAssessments || []).map((item) => ({ nodeId: item.nodeId, before: item.masteryBefore, suggested: item.masterySuggested, accepted: accepted.some((result) => result.nodeId === item.nodeId) ? item.masterySuggested : item.masteryBefore })), ...createdIds.map((nodeId) => { const node = findNodeById(state.starMap, nodeId); return { nodeId, before: 0, suggested: node?.mastery || 0, accepted: node?.mastery || 0, reason: "复盘新增节点" }; })], newNodes, remainingProblems: accepted.flatMap((item) => item.remainingProblems || []), nextSuggestions: assessment.nextSuggestions || [] };
  addLearningRecord(state.appData, record); saveAppData(state.appData); return record;
}

function finishReviewEntry(state, review, record, feedback) {
  const entry = review.entryContext;
  if (entry?.entryType === "global_review_item") { completeReviewQueueItem(state.appData, entry.sourceQueueId, entry.sourceQueueItemId, record, feedback); state.activeReviewQueueId = entry.sourceQueueId; state.activeReviewItemMapId = null; state.currentMode = "review"; state.currentPage = "global_review_workspace"; }
  else { state.currentMode = "review"; state.mapEntryContext = { sourceView: "map_selection_review", mode: "review" }; state.currentPage = "map"; }
}

function persistReviewDraft(state, review) {
  const entry = review.entryContext;
  if (entry?.entryType === "global_review_item") {
    const queue = getReviewQueueById(state.appData, entry.sourceQueueId);
    const item = queue?.items.find((candidate) => candidate.id === entry.sourceQueueItemId);
    if (!item) return;
    item.reviewDraft = structuredClone(review); saveReviewQueue(state.appData, queue);
    return;
  }
  state.appData.reviewDrafts = state.appData.reviewDrafts || {};
  state.appData.reviewDrafts[state.activeMapId] = structuredClone(review);
  saveAppData(state.appData);
}

function clearReviewDraft(state, review) {
  if (review.entryContext?.entryType === "global_review_item") return;
  if (state.appData.reviewDrafts?.[state.activeMapId]) {
    delete state.appData.reviewDrafts[state.activeMapId];
    saveAppData(state.appData);
  }
}
