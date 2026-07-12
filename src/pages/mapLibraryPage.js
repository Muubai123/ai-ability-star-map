import { renderMapCard } from "../components/mapCard.js";
import { duplicateMap, getMapById } from "../appData.js";
import { getLearningRecordStatsByMap } from "../records/learningRecordStore.js";
import { deleteMapAndAssociatedAiSession, openMapPage } from "../state.js";

export function renderMapLibraryPage(state) {
  const maps = state.appData.maps.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return `<main class="collection-page"><header class="collection-header"><div><p class="eyebrow">我的星图</p><h1>管理你的能力地图</h1><p>每张星图都是独立保存的学习领域。</p></div><button data-library-action="create" type="button">创建星图</button></header>${maps.length ? `<section class="map-library-grid">${maps.map((map) => renderMapCard(map, { showMore: true, activity: getLearningRecordStatsByMap(state.appData, map.id) })).join("")}</section>` : `<section class="empty-collection"><h2>还没有星图</h2><p>创建第一张能力星图，开始组织你的学习地图。</p><button data-library-action="create" type="button">创建第一张星图</button></section>`}</main>`;
}

export function bindMapLibraryPageEvents(state, renderApp) {
  document.querySelectorAll("[data-library-action='create']").forEach((button) => button.addEventListener("click", () => { state.returnContext = { sourceView: "map_library", mode: null }; state.currentPage = "ai"; renderApp(); }));
  document.querySelectorAll("[data-map-action]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.mapId;
    if (button.dataset.mapAction === "open") openMapPage(id, { sourceView: "map_library" });
    if (button.dataset.mapAction === "more") showMapMenu(state, id);
    renderApp();
  }));
}

function showMapMenu(state, mapId) {
  const map = getMapById(state.appData, mapId);
  if (!map) return;
  const action = window.prompt("输入操作：rename、duplicate、export、delete", "");
  if (action === "rename") {
    const title = window.prompt("新的星图名称", map.title);
    if (title?.trim()) { map.title = title.trim(); map.updatedAt = new Date().toISOString(); }
  } else if (action === "duplicate") {
    duplicateMap(state.appData, mapId);
  } else if (action === "export") {
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `${map.title || "star-map"}.json`; link.click(); URL.revokeObjectURL(url);
  } else if (action === "delete" && window.confirm(`删除“${map.title}”会同时删除关联的 AI 对话，星图修改无法恢复。确定继续吗？`) && window.confirm("请再次确认删除这张星图及其关联 AI 对话。")) {
    deleteMapAndAssociatedAiSession(mapId);
  }
}
