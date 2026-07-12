import { renderMapCard } from "../components/mapCard.js";
import { renderMapThumbnail } from "../components/mapThumbnail.js";
import { deleteMapAndAssociatedAiSession, openMapPage, setActiveMap } from "../state.js";
import { createReviewState } from "../review/reviewState.js";
import { getActiveGlobalReviewQueue } from "../review/globalReviewStore.js";

export function renderMapSelectionPage(state, mode) {
  const exploration = mode === "exploration";
  const maps = state.appData.maps;
  const activeQueue = getActiveGlobalReviewQueue(state.appData);
  const title = exploration ? "选择要探索的星图" : "选择复盘范围";
  const description = exploration ? "进入一张星图，选择想深入的节点，再开始一次完整探索。" : "选择一张星图进行单领域复盘，或从全局复盘整理跨领域学习。";
  return `<main class="collection-page selection-page"><header class="collection-header selection-header"><div><p class="eyebrow">${exploration ? "探索模式" : "复盘模式"}</p><h1>${title}</h1><p>${description}</p></div></header>${!exploration ? renderGlobalReviewEntry(activeQueue) : ""}<section class="map-library-grid selection-map-grid">${maps.map((map) => renderMapCard(map, { action: exploration ? "explore" : "review", actionLabel: exploration ? "进入地图" : "开始复盘", secondaryAction: exploration ? "" : "open", secondaryActionLabel: "进入星图", showDelete: true })).join("")}${renderAddMapCard()}</section></main>`;
}

function renderGlobalReviewEntry(activeQueue) {
  return `<section class="global-review-placeholder"><div><p class="eyebrow">跨领域</p><h2>${activeQueue ? "继续全局复盘" : "全局复盘"}</h2><p>${activeQueue ? "已保留未完成的队列、总结与处理进度。" : "用一段总体总结识别涉及的星图，再按你的顺序逐张复盘。"}</p></div><button data-selection-action="global-review" type="button">${activeQueue ? "继续全局复盘" : "全局复盘"}</button></section>`;
}

function renderAddMapCard() {
  return `<article class="map-library-card add-map-card" data-selection-action="create" role="button" tabindex="0" aria-label="添加星图"><div class="add-map-card-content"><span class="add-map-symbol" aria-hidden="true">+</span><h2>添加星图</h2><p>创建一张新的能力地图</p></div></article>`;
}

export function renderReviewPlaceholder(state) {
  const map = state.starMap ? state.appData.maps.find((item) => item.id === state.activeMapId) : null;
  return `<main class="review-placeholder-page"><section><p class="eyebrow">复盘模式</p><h1>${map ? map.title : "未选择星图"}</h1>${map ? renderMapThumbnail(map) : ""}<p>下一阶段将在这里接入学习总结、AI 节点匹配和熟练度建议。</p><button data-review-action="back" type="button">返回复盘选择</button></section></main>`;
}

export function bindMapSelectionPageEvents(state, renderApp, mode) {
  const goCreate = () => {
    state.returnContext = { sourceView: state.currentPage, mode };
    state.currentMode = mode;
    state.currentPage = "ai";
    renderApp();
  };
  document.querySelectorAll("[data-selection-action]").forEach((element) => {
    const activate = () => {
      const action = element.dataset.selectionAction;
      if (action === "create") goCreate();
      else if (action === "global-review") { const queue = getActiveGlobalReviewQueue(state.appData); state.activeReviewQueueId = queue?.id || null; state.currentMode = "review"; state.currentPage = "global_review_workspace"; renderApp(); }
    };
    element.addEventListener("click", activate);
    if (element.matches("[role='button']")) element.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } });
  });
  document.querySelectorAll("[data-map-action]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.mapAction === "delete") {
      deleteSelectedMap(state, button.dataset.mapId, renderApp);
      return;
    }
    if (button.dataset.mapAction === "open") {
      openMapPage(button.dataset.mapId, {
        sourceView: "map_selection_review",
        mode: "review",
      });
      renderApp();
      return;
    }
    setActiveMap(button.dataset.mapId);
    state.currentMode = mode;
    if (mode === "review") {
      state.review = structuredClone(
        state.appData.reviewDrafts?.[button.dataset.mapId] || createReviewState()
      );
    }
    if (mode === "review") {
      state.currentPage = "review_workspace";
    } else {
      state.mapEntryContext = {
        sourceView: "map_selection_exploration",
        mode: "exploration",
      };
      state.currentPage = "map";
    }
    renderApp();
  }));
}

function deleteSelectedMap(state, mapId, renderApp) {
  const map = state.appData.maps.find((item) => item.id === mapId);
  if (!map) return;
  if (!window.confirm(`删除“${map.title}”会同时删除关联的 AI 对话，星图修改无法恢复。确定继续吗？`)) return;
  if (!window.confirm("请再次确认删除这张星图及其关联 AI 对话。")) return;
  deleteMapAndAssociatedAiSession(mapId);
  renderApp();
}

export function bindReviewPlaceholderEvents(state, renderApp) {
  document.querySelector("[data-review-action='back']")?.addEventListener("click", () => { state.currentPage = "map_selection_review"; renderApp(); });
}
