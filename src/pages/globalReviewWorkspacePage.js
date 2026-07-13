import { getAiConfigIssue } from "../aiProviders.js";
import { getMapById } from "../appData.js";
import { renderMapThumbnail } from "../components/mapThumbnail.js";
import { analyzeGlobalReview } from "../review/globalReviewApi.js";
import {
  activateQueueItem,
  completeReviewQueue,
  createGlobalReviewQueue,
  getActiveGlobalReviewQueue,
  getNextQueueItem,
  getReviewQueueById,
  moveQueueItem,
  pauseReviewQueue,
  resumeReviewQueue,
  saveReviewQueue,
  setQueueItemStatus,
} from "../review/globalReviewStore.js";
import { createReviewState } from "../review/reviewState.js";
import { escapeHtml } from "../utils/jsonUtils.js";
import { setActiveMap } from "../state.js";

export function renderGlobalReviewWorkspacePage(state) {
  const queue = getReviewQueueById(state.appData, state.activeReviewQueueId)
    || getActiveGlobalReviewQueue(state.appData);
  if (!queue || queue.status === "draft" || queue.status === "analyzing") {
    return renderInput(queue);
  }
  if (queue.status === "completed") return renderCompleted(queue);
  return renderQueue(state, queue);
}

function renderInput(queue) {
  const raw = queue?.rawInput || "";
  return `<main class="global-review-page">
    <header class="review-workspace-header">
      <div>
        <p class="eyebrow">跨星图复盘</p>
        <h1>全局复盘</h1>
        <p>写下今天各科的学习内容，AI 会按学科整理知识点，再匹配到已有星图。</p>
      </div>
      <button data-global-review="back" type="button">返回复盘选择</button>
    </header>
    ${queue?.error ? `<section class="review-error"><strong>${escapeHtml(queue.error)}</strong></section>` : ""}
    <section class="review-stage-card global-review-input-card">
      <div class="global-review-input-heading">
        <div><span>01</span><h2>记录今天学了什么</h2></div>
        <p>可以在同一段话中写多个学科，尽量带上具体知识点。</p>
      </div>
      <textarea id="globalReviewInput" rows="9" placeholder="例如：今天学了数学的极限和导数，英语复习了长难句；还看了化学的官能团。">${escapeHtml(raw)}</textarea>
      <div class="review-stage-actions">
        <button data-global-review="analyze" type="button" ${queue?.status === "analyzing" ? "disabled" : ""}>
          ${queue?.status === "analyzing" ? "正在按学科整理..." : "整理并匹配星图"}
        </button>
        ${queue?.error ? `<button class="quiet-button" data-global-review="manual" type="button">手动选择星图</button>` : ""}
      </div>
    </section>
  </main>`;
}

function renderQueue(state, queue) {
  const items = queue.items.slice().sort((a, b) => a.order - b.order);
  const completedCount = items.filter((item) => item.status === "completed").length;
  const nextItem = getNextQueueItem(queue);
  return `<main class="global-review-page">
    <header class="review-workspace-header global-review-queue-header">
      <div>
        <p class="eyebrow">全局复盘 · ${completedCount}/${items.length}</p>
        <h1>选择一个学科开始复盘</h1>
        <p>${escapeHtml(queue.analysisSummary || "AI 已按学科整理完成，点击卡片进入对应星图复盘。")}</p>
      </div>
      <div class="queue-header-actions">
        <button data-global-review="pause" type="button">稍后继续</button>
        <button data-global-review="finish" type="button">完成全局复盘</button>
      </div>
    </header>
    ${renderSubjectDigest(queue)}
    ${queue.status === "paused" ? `<section class="queue-resume-notice">本次全局复盘已暂停。<button data-global-review="resume" type="button">继续复盘</button></section>` : ""}
    <section class="queue-layout">
      <section class="queue-list" aria-label="已识别的学科星图">
        ${items.map((item) => renderQueueItem(state, queue, item)).join("") || `<div class="queue-empty"><strong>没有识别到可复盘的星图</strong><p>可以从右侧手动补充，或返回修改学习总结。</p></div>`}
      </section>
      ${renderUnmatchedPanel(state, queue)}
    </section>
    <div class="global-review-bottom-actions">
      <span>${completedCount ? `已完成 ${completedCount} 个学科` : "蓝色底光表示待复盘，绿色底光表示已完成。"}</span>
      <button data-global-review="start-next" type="button" ${queue.status === "paused" || !nextItem ? "disabled" : ""}>
        ${nextItem?.status === "active" ? "继续当前复盘" : "复盘下一科"}
      </button>
    </div>
  </main>`;
}

function renderSubjectDigest(queue) {
  const groups = Array.isArray(queue.subjectGroups) ? queue.subjectGroups : [];
  if (!groups.length) return "";
  return `<section class="global-subject-digest">
    <div class="global-subject-digest-heading"><span>AI 已整理</span><strong>${groups.length} 个学科</strong></div>
    <div class="global-subject-chips">
      ${groups.map((group) => `<div class="subject-chip ${group.mapId ? "matched" : "missing"}">
        <strong>${escapeHtml(group.subject)}</strong>
        <span>${escapeHtml((group.topics || []).join("、") || "未提取到具体知识点")}</span>
        <small>${group.mapId ? "已匹配星图" : "缺少星图"}</small>
      </div>`).join("")}
    </div>
  </section>`;
}

function renderQueueItem(state, queue, item) {
  const map = getMapById(state.appData, item.mapId);
  const invalid = !map;
  const completed = item.status === "completed";
  const ignored = item.status === "ignored";
  const disabled = invalid || ignored || queue.status === "paused";
  const cardAction = completed ? "view" : "start";
  const topics = (item.matchedTopics || []).map((topic) => topic.title).filter(Boolean);
  const actionLabel = completed ? "查看更新后的星图" : item.status === "active" ? "继续复盘" : "进入复盘";

  return `<article class="queue-card queue-${invalid ? "invalid" : item.status}" data-queue-card-status="${invalid ? "invalid" : item.status}">
    <button class="queue-card-open" data-queue-action="${cardAction}" data-item-id="${item.id}" type="button" ${disabled ? "disabled" : ""}>
      <div class="queue-thumbnail">${map ? renderMapThumbnail(map) : "星图已不存在"}</div>
      <div class="queue-card-copy">
        <div class="queue-card-title-row">
          <div><p class="eyebrow">${statusLabel(invalid ? "invalid" : item.status)}</p><h3>${escapeHtml(item.mapTitle)}</h3></div>
          <span class="queue-card-state-dot" aria-hidden="true"></span>
        </div>
        ${topics.length ? `<div class="queue-topic-list">${topics.slice(0, 6).map((topic) => `<span>${escapeHtml(topic)}</span>`).join("")}</div>` : ""}
        <p>${escapeHtml(item.extractedSummary || item.reason || "已识别为相关学科。")}</p>
        ${completed ? `<p class="queue-result">${escapeHtml(item.resultSummary?.recordSummary || "已完成本学科复盘")}</p>` : ""}
        <strong class="queue-card-enter">${actionLabel}<span aria-hidden="true">→</span></strong>
      </div>
    </button>
    ${renderQueueItemActions(item, invalid)}
  </article>`;
}

function renderQueueItemActions(item, invalid) {
  if (invalid) return `<div class="queue-item-actions"><button data-queue-action="remove" data-item-id="${item.id}" type="button">移除失效项</button></div>`;
  if (item.status === "completed") return "";
  if (item.status === "ignored") return `<div class="queue-item-actions"><button data-queue-action="restore" data-item-id="${item.id}" type="button">恢复到待复盘</button></div>`;
  if (item.status === "deferred") return `<div class="queue-item-actions"><button data-queue-action="priority" data-item-id="${item.id}" type="button">加入本次复盘</button><button data-queue-action="ignored" data-item-id="${item.id}" type="button">本次忽略</button></div>`;
  return `<div class="queue-item-actions">
    <button data-queue-action="deferred" data-item-id="${item.id}" type="button">稍后处理</button>
    <button data-queue-action="ignored" data-item-id="${item.id}" type="button">本次忽略</button>
    ${item.status === "priority" ? `<button data-queue-action="up" data-item-id="${item.id}" type="button" aria-label="上移">↑</button><button data-queue-action="down" data-item-id="${item.id}" type="button" aria-label="下移">↓</button>` : ""}
  </div>`;
}

function renderUnmatchedPanel(state, queue) {
  const unmatched = queue.unmatchedTopics || [];
  const availableMaps = state.appData.maps.filter((map) => !queue.items.some((item) => item.mapId === map.id));
  return `<aside class="unmatched-topics global-unmatched-panel">
    <div><span>缺少星图</span><strong>${unmatched.length}</strong></div>
    ${unmatched.length
      ? unmatched.map((topic) => `<article><strong>${escapeHtml(topic.title)}</strong><p>${escapeHtml(topic.reason || "当前没有对应星图。")}</p></article>`).join("")
      : `<p class="unmatched-empty">所有识别出的学科都有对应星图。</p>`}
    <label class="review-manual-node">手动补充星图
      <select id="globalManualMap"><option value="">选择星图</option>${availableMaps.map((map) => `<option value="${map.id}">${escapeHtml(map.title)}</option>`).join("")}</select>
    </label>
    <button data-global-review="add-manual" type="button">加入复盘列表</button>
  </aside>`;
}

function statusLabel(status) {
  return ({
    priority: "待复盘",
    deferred: "稍后处理",
    ignored: "本次忽略",
    active: "复盘进行中",
    completed: "已完成",
    invalid: "星图已不存在",
  })[status] || status;
}

function renderCompleted(queue) {
  const done = queue.items.filter((item) => item.status === "completed");
  const updated = done.reduce((sum, item) => sum + (item.resultSummary?.masteryUpdates || 0), 0);
  return `<main class="global-review-page"><section class="review-stage-card global-complete">
    <p class="eyebrow">全局复盘完成</p>
    <h1>今天的学习已经整理完毕</h1>
    <p>${escapeHtml(queue.analysisSummary)}</p>
    <dl class="map-metadata">
      <div><dt>识别星图</dt><dd>${queue.items.length}</dd></div>
      <div><dt>完成复盘</dt><dd>${done.length}</dd></div>
      <div><dt>更新节点</dt><dd>${updated}</dd></div>
      <div><dt>稍后处理</dt><dd>${queue.items.filter((item) => item.status === "deferred").length}</dd></div>
    </dl>
    <button data-global-review="back" type="button">返回复盘选择</button>
  </section></main>`;
}

export function bindGlobalReviewWorkspacePageEvents(state, renderApp) {
  document.querySelectorAll("[data-global-review]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.globalReview;
    let queue = getReviewQueueById(state.appData, state.activeReviewQueueId) || getActiveGlobalReviewQueue(state.appData);
    if (action === "back") {
      state.currentMode = "review";
      state.currentPage = "map_selection_review";
      renderApp();
      return;
    }
    if (action === "analyze") {
      const raw = document.querySelector("#globalReviewInput")?.value.trim() || "";
      if (raw) await analyzeQueue(state, queue, raw, renderApp);
      return;
    }
    if (action === "manual") {
      if (!queue) {
        queue = createGlobalReviewQueue("");
        queue.status = "selecting";
        saveReviewQueue(state.appData, queue);
        state.activeReviewQueueId = queue.id;
      }
      renderApp();
      return;
    }
    if (!queue) return;
    if (action === "pause") {
      pauseReviewQueue(state.appData, queue.id);
      state.currentMode = "review";
      state.currentPage = "map_selection_review";
      renderApp();
      return;
    }
    if (action === "resume") {
      resumeReviewQueue(state.appData, queue.id);
      renderApp();
      return;
    }
    if (action === "add-manual") {
      const map = getMapById(state.appData, document.querySelector("#globalManualMap")?.value);
      if (map) {
        queue.items.push(makeItem(map, queue.items.length + 1, "priority", { reason: "用户手动补充", extractedSummary: map.title }));
        saveReviewQueue(state.appData, queue);
      }
      renderApp();
      return;
    }
    if (action === "start-next") {
      startItem(state, queue, "", renderApp);
      return;
    }
    if (action === "finish") {
      const unfinished = queue.items.filter((item) => ["priority", "active"].includes(item.status));
      if (unfinished.length && !window.confirm(`还有 ${unfinished.length} 个学科未完成。仍然结束并设为稍后处理吗？`)) return;
      unfinished.forEach((item) => { item.status = "deferred"; });
      completeReviewQueue(state.appData, queue.id);
      renderApp();
    }
  }));

  document.querySelectorAll("[data-queue-action]").forEach((button) => button.addEventListener("click", () => {
    const queue = getReviewQueueById(state.appData, state.activeReviewQueueId) || getActiveGlobalReviewQueue(state.appData);
    if (!queue) return;
    const action = button.dataset.queueAction;
    const item = queue.items.find((entry) => entry.id === button.dataset.itemId);
    if (!item) return;
    if (action === "start") {
      startItem(state, queue, item.id, renderApp);
      return;
    }
    if (action === "up" || action === "down") {
      moveQueueItem(state.appData, queue.id, item.id, action === "up" ? -1 : 1);
    } else if (action === "remove") {
      queue.items = queue.items.filter((entry) => entry.id !== item.id);
      saveReviewQueue(state.appData, queue);
    } else if (action === "view") {
      setActiveMap(item.mapId);
      const feedback = queue.feedbacks?.find((entry) => entry.mapId === item.mapId);
      if (feedback) state.pendingMapFeedback = feedback;
      state.currentMode = "review";
      state.mapEntryContext = { sourceView: "global_review_workspace", mode: "review" };
      state.currentPage = "map";
    } else {
      setQueueItemStatus(state.appData, queue.id, item.id, action === "restore" ? "priority" : action);
    }
    renderApp();
  }));
}

async function analyzeQueue(state, currentQueue, rawInput, renderApp) {
  const issue = getAiConfigIssue(state.aiConfig);
  const queue = currentQueue || createGlobalReviewQueue(rawInput);
  if (!currentQueue) {
    state.appData.reviewQueues.unshift(queue);
    state.activeReviewQueueId = queue.id;
  }
  queue.rawInput = rawInput;
  queue.status = "analyzing";
  queue.error = "";
  saveReviewQueue(state.appData, queue);
  if (issue) {
    queue.status = "draft";
    queue.error = issue;
    saveReviewQueue(state.appData, queue);
    renderApp();
    return;
  }
  renderApp();
  try {
    const result = await analyzeGlobalReview(rawInput, state.appData.maps, state.appData.learningRecords, state.aiConfig);
    queue.analysisSummary = result.summary;
    queue.subjectGroups = result.subjectGroups;
    queue.unmatchedTopics = result.unmatchedTopics;
    queue.items = result.candidateMaps.map((candidate, index) => {
      const map = getMapById(state.appData, candidate.mapId);
      return map ? makeItem(map, index + 1, "priority", candidate) : null;
    }).filter(Boolean);
    queue.status = "selecting";
    queue.rawOutput = "";
  } catch (error) {
    queue.status = "draft";
    queue.error = error.message;
    queue.rawOutput = error.message;
  }
  saveReviewQueue(state.appData, queue);
  renderApp();
}

function makeItem(map, order, status, candidate = {}) {
  return {
    id: `queue-item-${Date.now().toString(36)}-${order}`,
    mapId: map.id,
    mapTitle: map.title,
    subject: candidate.subject || map.title,
    status,
    order,
    confidence: Number(candidate.confidence) || 0,
    reason: candidate.reason || "",
    matchedTopics: candidate.matchedTopics || [],
    extractedSummary: candidate.extractedSummary || "",
    extractedEvidence: candidate.extractedEvidence || [],
    reviewRecordId: null,
    reviewSessionId: null,
    completedAt: null,
    resultSummary: null,
  };
}

export function buildQueueItemReviewInput(item = {}) {
  if (String(item.extractedSummary || "").trim()) return String(item.extractedSummary).trim();
  const topics = (item.matchedTopics || []).map((topic) => topic.title).filter(Boolean);
  return topics.length ? `${item.subject || item.mapTitle}：${topics.join("、")}` : String(item.subject || item.mapTitle || "").trim();
}

function startItem(state, queue, itemId, renderApp) {
  const activated = activateQueueItem(state.appData, queue.id, itemId);
  if (!activated) {
    renderApp();
    return;
  }
  state.activeReviewQueueId = queue.id;
  state.activeReviewItemMapId = activated.item.mapId;
  setActiveMap(activated.item.mapId);
  state.review = { ...createReviewState(), ...(activated.item.reviewDraft || {}) };
  state.review.entryContext = {
    entryType: "global_review_item",
    sourceQueueId: queue.id,
    sourceQueueItemId: activated.item.id,
    prefilledSummary: activated.item.extractedSummary,
    prefilledTopics: activated.item.matchedTopics,
    prefilledEvidence: activated.item.extractedEvidence,
    globalRawInput: queue.rawInput,
  };
  if (!state.review.rawInput) state.review.rawInput = buildQueueItemReviewInput(activated.item);
  state.currentMode = "review";
  state.currentPage = "review_workspace";
  renderApp();
}
