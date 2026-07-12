import { escapeHtml } from "../utils/jsonUtils.js";
import { defaultLearningRecordFilters, filterLearningRecords } from "../records/learningRecordFilters.js";
import { exportLearningRecords } from "../records/recordExport.js";
import { getLearningRecords } from "../records/learningRecordStore.js";
import { openRecordOnMap } from "../records/recordNavigation.js";

const PAGE_SIZE = 20;

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function recordTitle(record) {
  return record.nodeSnapshots[0]?.title || record.title;
}

function renderRecordCard(record, nested = false) {
  const changes = record.masteryChanges.filter((change) => change.accepted !== null && change.accepted !== undefined && change.accepted !== change.before);
  return `<article class="learning-record-card ${nested ? "nested-record" : ""}">
    <div class="record-card-type">${escapeHtml(record.typeLabel)}</div>
    <div class="record-card-main"><div><p class="record-card-meta">${escapeHtml(record.mapTitle)} · ${formatDate(record.endedAt || record.createdAt)}${record.durationMinutes !== null ? ` · ${record.durationMinutes} 分钟` : ""}</p><h3>${escapeHtml(recordTitle(record))}</h3><p>${escapeHtml(record.summary || record.rawInput || "已留下这次学习轨迹。")}</p><div class="record-card-signals"><span>涉及 ${record.nodeIds.length} 个节点</span><span>熟练度变化 ${changes.length}</span>${record.newNodes.length ? `<span>新增节点 ${record.newNodes.length}</span>` : ""}${record.remainingProblems.length ? `<span>待解决 ${record.remainingProblems.length}</span>` : ""}${record.isOrphaned ? `<span class="record-orphaned">关联内容已变更</span>` : ""}</div></div><div class="record-card-actions"><button data-record-action="detail" data-record-id="${record.id}" type="button">查看详情</button><button class="quiet-button" data-record-action="map" data-record-id="${record.id}" type="button" ${record.mapExists ? "" : "disabled"}>在地图中查看</button></div></div></article>`;
}

function renderGlobalChildren(record, allRecords, expanded) {
  if (!record.childRecordIds.length) return "";
  const children = record.childRecordIds.map((id) => allRecords.find((item) => item.id === id)).filter(Boolean);
  if (!children.length) return "";
  return `<section class="global-record-children"><button class="quiet-button" data-record-action="toggle-children" data-record-id="${record.id}" type="button">${expanded ? "收起" : "展开"} ${children.length} 条子记录</button>${expanded ? `<div class="global-child-list">${children.map((child) => renderRecordCard(child, true)).join("")}</div>` : ""}</section>`;
}

export function renderLearningRecordsPage(state) {
  const filters = { ...defaultLearningRecordFilters, ...(state.learningRecordFilters || {}) };
  const allRecords = getLearningRecords(state.appData);
  const filtered = filterLearningRecords(allRecords, filters);
  const linkedChildIds = new Set(allRecords.filter((record) => record.type === "global_review").flatMap((record) => record.childRecordIds));
  const display = filters.type === "all" ? filtered.filter((record) => !linkedChildIds.has(record.id)) : filtered;
  const shown = display.slice(0, filters.page * PAGE_SIZE);
  const maps = state.appData.maps || [];
  return `<main class="learning-records-page"><header class="learning-records-header"><div><p class="eyebrow">学习记录</p><h1>学习记录与历史轨迹</h1><p>查看探索、复盘和地图变化留下的历史轨迹。</p></div><button data-record-action="export-filtered" type="button" ${filtered.length ? "" : "disabled"}>导出当前结果</button></header>
  <section class="record-filter-bar"><input id="recordSearch" value="${escapeHtml(filters.query)}" placeholder="搜索星图、节点、摘要或问题"><select id="recordMapFilter"><option value="">全部星图</option>${maps.map((map) => `<option value="${map.id}" ${filters.mapId === map.id ? "selected" : ""}>${escapeHtml(map.title)}</option>`).join("")}</select><select id="recordTypeFilter">${[["all", "全部类型"], ["exploration", "探索"], ["single_review", "单图复盘"], ["global_review_item", "全局复盘子项"], ["global_review", "全局复盘总结"], ["manual_mastery_adjustment", "手动校正"]].map(([id, label]) => `<option value="${id}" ${filters.type === id ? "selected" : ""}>${label}</option>`).join("")}</select><select id="recordDateFilter">${[["all", "全部时间"], ["today", "今天"], ["7d", "最近 7 天"], ["30d", "最近 30 天"], ["custom", "自定义日期"]].map(([id, label]) => `<option value="${id}" ${filters.dateRange === id ? "selected" : ""}>${label}</option>`).join("")}</select><label><input id="recordOnlyChanges" type="checkbox" ${filters.onlyMasteryChanges ? "checked" : ""}> 有熟练度变化</label><label><input id="recordOnlyUnresolved" type="checkbox" ${filters.onlyUnresolved ? "checked" : ""}> 有待解决问题</label><button class="quiet-button" data-record-action="reset-filters" type="button">清除筛选</button><span>${filtered.length} 条记录</span></section>
  ${filters.dateRange === "custom" ? `<section class="record-custom-date"><label>开始 <input id="recordStartDate" type="date" value="${filters.startDate}"></label><label>结束 <input id="recordEndDate" type="date" value="${filters.endDate}"></label></section>` : ""}
  <section class="learning-record-list">${shown.length ? shown.map((record) => `${renderRecordCard(record)}${record.type === "global_review" ? renderGlobalChildren(record, allRecords, state.expandedGlobalRecordId === record.id) : ""}`).join("") : `<section class="empty-collection"><h2>没有匹配的学习记录</h2><p>调整筛选条件，或完成一次探索、复盘后再回来看看。</p></section>`}</section>${shown.length < display.length ? `<div class="record-load-more"><button data-record-action="more" type="button">加载更多</button></div>` : ""}</main>`;
}

export function bindLearningRecordsPageEvents(state, renderApp) {
  const updateFilters = () => {
    state.learningRecordFilters = { ...(state.learningRecordFilters || defaultLearningRecordFilters), query: document.querySelector("#recordSearch")?.value.trim() || "", mapId: document.querySelector("#recordMapFilter")?.value || "", type: document.querySelector("#recordTypeFilter")?.value || "all", dateRange: document.querySelector("#recordDateFilter")?.value || "all", startDate: document.querySelector("#recordStartDate")?.value || "", endDate: document.querySelector("#recordEndDate")?.value || "", onlyMasteryChanges: Boolean(document.querySelector("#recordOnlyChanges")?.checked), onlyUnresolved: Boolean(document.querySelector("#recordOnlyUnresolved")?.checked), page: 1 };
    renderApp();
  };
  ["#recordSearch", "#recordMapFilter", "#recordTypeFilter", "#recordDateFilter", "#recordStartDate", "#recordEndDate", "#recordOnlyChanges", "#recordOnlyUnresolved"].forEach((selector) => document.querySelector(selector)?.addEventListener("change", updateFilters));
  document.querySelectorAll("[data-record-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.recordAction; const id = button.dataset.recordId;
    if (action === "detail") { state.selectedLearningRecordId = id; state.currentPage = "learning_record_detail"; renderApp(); }
    else if (action === "map") openRecordOnMap(state, id, renderApp);
    else if (action === "toggle-children") { state.expandedGlobalRecordId = state.expandedGlobalRecordId === id ? "" : id; renderApp(); }
    else if (action === "more") { state.learningRecordFilters = { ...(state.learningRecordFilters || defaultLearningRecordFilters), page: (state.learningRecordFilters?.page || 1) + 1 }; renderApp(); }
    else if (action === "reset-filters") { state.learningRecordFilters = { ...defaultLearningRecordFilters }; renderApp(); }
    else if (action === "export-filtered") exportLearningRecords(filterLearningRecords(getLearningRecords(state.appData), state.learningRecordFilters), "learning-records.json");
  }));
}
