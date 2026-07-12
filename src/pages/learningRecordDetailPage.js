import { escapeHtml } from "../utils/jsonUtils.js";
import { deleteLearningRecord, getLearningRecordById, getLearningRecords } from "../records/learningRecordStore.js";
import { exportLearningRecords } from "../records/recordExport.js";
import { openRecordOnMap } from "../records/recordNavigation.js";
import { saveAppData } from "../appData.js";
import { deleteExplorationSession } from "../exploration/explorationStorage.js";

function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString("zh-CN"); }
function list(items, empty = "暂无") { return items?.length ? `<ul>${items.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item.content || item.title || JSON.stringify(item))}</li>`).join("")}</ul>` : `<p class="record-empty">${empty}</p>`; }

export function renderLearningRecordDetailPage(state) {
  const record = getLearningRecordById(state.appData, state.selectedLearningRecordId);
  if (!record) return `<main class="learning-record-detail-page"><section class="empty-collection"><h2>找不到这条学习记录</h2><button data-record-detail="back" type="button">返回学习记录</button></section></main>`;
  const all = getLearningRecords(state.appData);
  const children = record.childRecordIds.map((id) => all.find((item) => item.id === id)).filter(Boolean);
  const parent = all.find((item) => item.childRecordIds.includes(record.id));
  return `<main class="learning-record-detail-page"><header class="record-detail-header"><div><button class="back-link" data-record-detail="back" type="button">返回学习记录</button><p class="eyebrow">${escapeHtml(record.typeLabel)}</p><h1>${escapeHtml(record.title)}</h1><p>${escapeHtml(record.mapTitle)} · ${formatDate(record.endedAt || record.createdAt)}</p></div><div class="record-detail-actions"><button data-record-detail="map" type="button" ${record.mapExists ? "" : "disabled"}>在地图中查看</button><button class="quiet-button" data-record-detail="export" type="button">导出 JSON</button><button class="quiet-button danger-action" data-record-detail="delete" type="button">删除记录</button></div></header>${record.isOrphaned ? `<section class="record-orphan-notice">原星图或部分节点已不存在；以下内容保留的是当时的历史快照。</section>` : ""}
  <section class="record-detail-grid"><article><h2>基本信息</h2><dl class="record-detail-meta"><div><dt>星图</dt><dd>${escapeHtml(record.mapTitle)}</dd></div><div><dt>持续时间</dt><dd>${record.durationMinutes === null ? "未记录" : `${record.durationMinutes} 分钟`}</dd></div><div><dt>关联节点</dt><dd>${record.nodeSnapshots.length ? record.nodeSnapshots.map((node) => escapeHtml(node.path.join(" > ") || node.title)).join("<br>") : "未定位到节点"}</dd></div><div><dt>状态</dt><dd>${record.status === "completed" ? "已完成" : record.status === "partial" ? "部分完成" : record.status}</dd></div></dl></article><article><h2>原始输入</h2><p>${escapeHtml(record.rawInput || "未保留原始输入")}</p><h2>AI / 学习总结</h2><p>${escapeHtml(record.summary || "暂无总结")}</p></article>
  ${record.tasks.length ? `<article><h2>探索任务</h2>${list(record.tasks.map((task) => `${task.title}（${task.status || "未记录"}）`))}</article>` : ""}
  <article><h2>掌握证据</h2>${list(record.evidence)}</article><article><h2>熟练度变化</h2>${record.masteryChanges.length ? `<div class="mastery-change-list">${record.masteryChanges.map((change) => `<p><strong>${escapeHtml(record.nodeSnapshots.find((node) => node.nodeId === change.nodeId)?.title || change.nodeId || "节点")}</strong>：${change.before ?? "-"} → ${change.accepted ?? "未应用"}${change.reason ? `<small>${escapeHtml(change.reason)}</small>` : ""}</p>`).join("")}</div>` : `<p class="record-empty">本次没有熟练度调整。</p>`}</article><article><h2>新增节点</h2>${list(record.newNodes)}</article><article><h2>尚未解决</h2>${list(record.remainingProblems, "本次没有记录待解决问题。")}</article><article><h2>下一步建议</h2>${list(record.nextSuggestions)}</article>
  ${children.length || parent ? `<article class="record-related"><h2>关联记录</h2>${parent ? `<p>来自 <button class="text-button" data-related-record="${parent.id}" type="button">${escapeHtml(parent.title)}</button></p>` : ""}${children.length ? `<div>${children.map((child) => `<button class="related-record-button" data-related-record="${child.id}" type="button">${escapeHtml(child.mapTitle)} · ${escapeHtml(child.summary || child.title)}</button>`).join("")}</div>` : ""}</article>` : ""}</section><p class="record-delete-note">删除记录只会删除历史记录，不会撤销当时对星图的修改。</p></main>`;
}

export function bindLearningRecordDetailPageEvents(state, renderApp) {
  document.querySelectorAll("[data-record-detail]").forEach((button) => button.addEventListener("click", () => {
    const record = getLearningRecordById(state.appData, state.selectedLearningRecordId);
    const action = button.dataset.recordDetail;
    if (action === "back") { state.currentPage = "learning_records"; renderApp(); }
    else if (action === "map") openRecordOnMap(state, record.id, renderApp);
    else if (action === "export") exportLearningRecords([record], `learning-record-${record.id}.json`);
    else if (action === "delete") {
      if (!window.confirm("删除记录只会删除历史记录，不会撤销当时对星图的修改。确定继续吗？")) return;
      if (!window.confirm("请再次确认：删除后无法恢复这条学习记录。")) return;
      if (record.sourceKind === "exploration_session") deleteExplorationSession(record.sourceSessionId || record.id);
      else deleteLearningRecord(state.appData, record.id);
      saveAppData(state.appData);
      state.selectedLearningRecordId = "";
      state.currentPage = "learning_records";
      renderApp();
    }
  }));
  document.querySelectorAll("[data-related-record]").forEach((button) => button.addEventListener("click", () => { state.selectedLearningRecordId = button.dataset.relatedRecord; renderApp(); }));
}
