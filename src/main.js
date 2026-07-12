import "./style.css";
import { bindAiPageEvents, renderAiPage } from "./pages/aiPage.js";
import { bindConfigPageEvents, renderConfigPage } from "./pages/configPage.js";
import { bindHomePageEvents, renderHomePage } from "./pages/homePage.js";
import { bindLearningModesPageEvents, renderLearningModesPage } from "./pages/learningModesPage.js";
import { bindKnowledgePageEvents, renderKnowledgePage } from "./pages/knowledgePage.js";
import { bindMapLibraryPageEvents, renderMapLibraryPage } from "./pages/mapLibraryPage.js";
import { bindMapPageEvents, renderMapPage } from "./pages/mapPage.js";
import { bindExplorationWorkspacePageEvents, renderExplorationWorkspacePage } from "./pages/explorationWorkspacePage.js";
import { bindMapSelectionPageEvents, bindReviewPlaceholderEvents, renderMapSelectionPage, renderReviewPlaceholder } from "./pages/mapSelectionPage.js";
import { bindReviewWorkspacePageEvents, renderReviewWorkspacePage } from "./pages/reviewWorkspacePage.js";
import { bindGlobalReviewWorkspacePageEvents, renderGlobalReviewWorkspacePage } from "./pages/globalReviewWorkspacePage.js";
import { bindLearningRecordsPageEvents, renderLearningRecordsPage } from "./pages/learningRecordsPage.js";
import { bindLearningRecordDetailPageEvents, renderLearningRecordDetailPage } from "./pages/learningRecordDetailPage.js";
import { appState, persistAppState, resetStarMap, setPage } from "./state.js";
import { escapeHtml } from "./utils/jsonUtils.js";

function ensureValidView() {
  if (appState.activeMapId && !appState.appData.maps.some((map) => map.id === appState.activeMapId)) resetStarMap();
  if (appState.currentPage === "map" && !appState.activeMapId) appState.currentPage = "home";
}

function renderApp() {
  ensureValidView();
  persistAppState();
  document.querySelector("#app").innerHTML = `<div class="app">${renderTopBar()}${renderCurrentPage()}</div>`;
  bindTopBarEvents();
  bindCurrentPageEvents();
}

function renderCurrentPage() {
  if (appState.currentPage === "home") return renderHomePage(appState);
  if (appState.currentPage === "learning_modes") return renderLearningModesPage(appState);
  if (appState.currentPage === "map_library") return renderMapLibraryPage(appState);
  if (appState.currentPage === "map_selection_exploration") return renderMapSelectionPage(appState, "exploration");
  if (appState.currentPage === "map_selection_review") return renderMapSelectionPage(appState, "review");
  if (appState.currentPage === "review_placeholder") return renderReviewPlaceholder(appState);
  if (appState.currentPage === "review_workspace") return renderReviewWorkspacePage(appState);
  if (appState.currentPage === "exploration_workspace") return renderExplorationWorkspacePage(appState);
  if (appState.currentPage === "global_review_workspace") return renderGlobalReviewWorkspacePage(appState);
  if (appState.currentPage === "learning_records") return renderLearningRecordsPage(appState);
  if (appState.currentPage === "learning_record_detail") return renderLearningRecordDetailPage(appState);
  if (appState.currentPage === "ai") return renderAiPage(appState);
  if (appState.currentPage === "config") return renderConfigPage(appState);
  if (appState.currentPage === "knowledge") return renderKnowledgePage(appState);
  return renderMapPage(appState);
}

function bindCurrentPageEvents() {
  if (appState.currentPage === "home") bindHomePageEvents(appState, renderApp);
  else if (appState.currentPage === "learning_modes") bindLearningModesPageEvents(appState, renderApp);
  else if (appState.currentPage === "map_library") bindMapLibraryPageEvents(appState, renderApp);
  else if (appState.currentPage === "map_selection_exploration") bindMapSelectionPageEvents(appState, renderApp, "exploration");
  else if (appState.currentPage === "map_selection_review") bindMapSelectionPageEvents(appState, renderApp, "review");
  else if (appState.currentPage === "review_placeholder") bindReviewPlaceholderEvents(appState, renderApp);
  else if (appState.currentPage === "review_workspace") bindReviewWorkspacePageEvents(appState, renderApp);
  else if (appState.currentPage === "exploration_workspace") bindExplorationWorkspacePageEvents(appState, renderApp);
  else if (appState.currentPage === "global_review_workspace") bindGlobalReviewWorkspacePageEvents(appState, renderApp);
  else if (appState.currentPage === "learning_records") bindLearningRecordsPageEvents(appState, renderApp);
  else if (appState.currentPage === "learning_record_detail") bindLearningRecordDetailPageEvents(appState, renderApp);
  else if (appState.currentPage === "ai") bindAiPageEvents(appState, renderApp);
  else if (appState.currentPage === "config") bindConfigPageEvents(appState, renderApp);
  else if (appState.currentPage === "knowledge") bindKnowledgePageEvents(appState, renderApp);
  else bindMapPageEvents(appState, renderApp);
}

function getBackTarget() {
  const context = appState.returnContext;
  if (appState.currentPage === "config") return appState.configReturnPage || "ai";
  if (appState.currentPage === "ai" && context?.sourceView) return context.sourceView;
  if (appState.currentPage === "map") {
    if (appState.mapEntryContext?.sourceView) return appState.mapEntryContext.sourceView;
    if (appState.currentMode === "exploration") return "map_selection_exploration";
    if (appState.currentMode === "review") return "map_selection_review";
    return "map_library";
  }
  if (["review_workspace", "global_review_workspace"].includes(appState.currentPage)) {
    return "map_selection_review";
  }
  // 模式选择页返回学习简报首页；其余中间页返回模式选择页。
  if (appState.currentPage === "learning_modes") return "home";
  if (["map_selection_exploration", "map_selection_review"].includes(appState.currentPage)) return "learning_modes";
  return "home";
}

function renderTopBar() {
  if (appState.currentPage === "home") return "";
  const target = getBackTarget();
  const label = target === "map_selection_exploration" ? "返回探索选择" : target === "map_selection_review" ? "返回复盘选择" : target === "map_library" ? "返回我的星图" : target === "global_review_workspace" ? "返回全局复盘" : target === "ai" ? "返回创建星图" : target === "learning_modes" ? "返回学习模式" : "返回首页";
  const mapTitle = appState.starMap?.title || "能力星图";
  const modeLabel = appState.currentMode === "exploration" ? "探索模式 · " : appState.currentMode === "review" ? "复盘模式 · " : "";
  const context = appState.currentPage === "map" ? `${modeLabel}${mapTitle}` : mapTitle;
  return `<header class="compact-top-bar"><button data-nav="back" type="button">← ${label}</button><span>${escapeHtml(context)}</span></header>`;
}

function bindTopBarEvents() {
  document.querySelector("[data-nav='back']")?.addEventListener("click", () => {
    const target = getBackTarget();
    if (target === "map_selection_exploration" || target === "map_selection_review") {
      appState.currentMode = appState.returnContext?.mode || (target.endsWith("exploration") ? "exploration" : "review");
      appState.returnContext = null;
      appState.mapEntryContext = null;
    } else if (target === "global_review_workspace") {
      appState.currentMode = "review";
      appState.mapEntryContext = null;
    } else if (["ai", "map", "exploration_workspace"].includes(target)) {
      // 保留创建链路、模式和星图来源，方便继续返回上一级。
    } else {
      // 返回学习模式页或首页时清空当前模式。
      appState.currentMode = null;
      appState.returnContext = null;
      appState.mapEntryContext = null;
    }
    if (appState.currentPage === "config") appState.configReturnPage = null;
    setPage(target);
    renderApp();
  });
}

renderApp();
