// 学习模式选择页（原首页）：开始探索 / 开始复盘。
// 现在位于新首页「学习简报」之后，由简报页的「开始学习」进入。

export function renderLearningModesPage() {
  return `<main class="home-mode-page" aria-label="选择学习模式">
    <div class="home-brand" aria-hidden="true">能力星图</div>
    <section class="home-mode-split">
      ${renderModeEntry({
        mode: "exploration",
        eyebrow: "学习前与学习中",
        title: "开始探索",
        description: "选择一张能力星图，进入具体区域，明确目标并逐步点亮地图。",
        action: "选择星图",
      })}
      ${renderModeEntry({
        mode: "review",
        eyebrow: "学习后整理",
        title: "开始复盘",
        description: "总结已经发生的学习，由 AI 帮助识别内容、映射节点并整理掌握变化。",
        action: "开始复盘",
      })}
    </section>
  </main>`;
}

function renderModeEntry({ mode, eyebrow, title, description, action }) {
  return `<article class="home-mode-entry ${mode}-entry" data-home-mode="${mode}" role="button" tabindex="0" aria-label="${action}">
    <div class="home-mode-atmosphere" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="home-mode-copy"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div>
    <button data-home-action="${mode}" type="button">${action}</button>
  </article>`;
}

export function bindLearningModesPageEvents(state, renderApp) {
  const enterMode = (mode) => {
    state.currentMode = mode;
    state.currentPage = mode === "exploration" ? "map_selection_exploration" : "map_selection_review";
    renderApp();
  };

  document.querySelectorAll("[data-home-action]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    enterMode(button.dataset.homeAction);
  }));
  document.querySelectorAll("[data-home-mode]").forEach((entry) => {
    entry.addEventListener("click", () => enterMode(entry.dataset.homeMode));
    entry.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); enterMode(entry.dataset.homeMode); }
    });
  });
}
