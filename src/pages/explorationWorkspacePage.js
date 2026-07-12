import { bindExplorationPanelEvents, renderExplorationPanel } from "../components/explorationPanel.js";

export function renderExplorationWorkspacePage(state) {
  return `<main class="exploration-workspace-page"><header class="exploration-workspace-header"><div><p class="eyebrow">节点探索</p><h1>探索：${state.exploration.currentSession?.nodeTitle || state.selectedNode?.title || "未选择节点"}</h1></div><button data-exploration-workspace="back" type="button">返回星图</button></header><section class="exploration-workspace-shell">${renderExplorationPanel(state)}</section></main>`;
}

export function bindExplorationWorkspacePageEvents(state, renderApp) {
  bindExplorationPanelEvents(state, renderApp);
  document.querySelector("[data-exploration-workspace='back']")?.addEventListener("click", () => { state.currentPage = "map"; renderApp(); });
}
