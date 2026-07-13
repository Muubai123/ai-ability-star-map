// 新首页：学习简报页（文档 §3-14）。
// 进入产品的落地页，回答「最近学得怎样 / 有什么值得复习 / 今天做什么」。
// 本地数据先行，不依赖 AI；「开始学习」永远是自由出口。

import { escapeHtml } from "../utils/jsonUtils.js";
import { buildHomeBriefing } from "../home/homeBriefing.js";
import {
  hasPlayedWelcomeAnimation,
  markWelcomeAnimationPlayed,
} from "../home/homeBriefingState.js";

const STATUS_LABELS = {
  priority: "优先复习",
  due: "建议复习",
  watch: "值得关注",
};

function greeting(displayName) {
  return displayName ? `Hi，${escapeHtml(displayName)}，欢迎回来。` : "欢迎回来。";
}

function formatCnDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

// 整体学习状态区：自然语言，无压力文案（文档 §6）。
function renderStatusLines(summary) {
  const lines = [`今天是 ${formatCnDate(summary.today)}。`];
  // 「今天已经开始学习了」按需求移除；仅在确有间隔天数时提示。
  if (summary.daysSinceLastLearning !== null && summary.daysSinceLastLearning > 0) {
    lines.push(`距离上次学习已经 ${summary.daysSinceLastLearning} 天。`);
  }
  lines.push(`过去 7 天，你学习了 ${summary.learningDaysLast7Days} 天。`);
  if (summary.recordCountThisMonth > 0) {
    lines.push(`本月已经留下 ${summary.recordCountThisMonth} 条学习记录。`);
  }
  const secondary = summary.currentStreak >= 2
    ? `<p class="home-status-secondary">你已经连续学习了 ${summary.currentStreak} 天。</p>`
    : "";
  return `<div class="home-status" data-brief-group>
    ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    ${secondary}
  </div>`;
}

// 最近一次学习区（文档 §7）。
function renderLastActivity(lastActivity, hasMaps) {
  if (!lastActivity) {
    const copy = hasMaps
      ? "你的星图已经准备好了。<br>完成一次探索或复盘后，这里会开始记录最近学习和复习建议。"
      : "你还没有留下学习记录。<br>完成一次探索或复盘后，这里会显示最近学习内容和需要重新关注的知识点。";
    return `<div class="home-last-activity empty" data-brief-group><p>${copy}</p></div>`;
  }
  const label = lastActivity.type === "exploration" ? "你上次学习的是" : "你上次记录的学习内容是";
  // 按需求：只显示节点名字，去掉路径/总结/遗留问题等详细介绍。
  // 节点名取路径末端（当前学习节点），没有路径时回退到星图标题。
  const nodePath = lastActivity.nodePath || [];
  const nodeName = nodePath.length ? nodePath[nodePath.length - 1] : (lastActivity.mapTitle || "");
  return `<div class="home-last-activity" data-brief-group>
    <p class="home-section-eyebrow">${label}</p>
    <p class="home-last-map">${escapeHtml(nodeName)}</p>
    ${lastActivity.nodeId ? `<button class="home-secondary-link" data-home-continue-node="${escapeHtml(lastActivity.nodeId)}" data-map-id="${escapeHtml(lastActivity.mapId || "")}" type="button">继续这个节点</button>` : ""}
  </div>`;
}

function renderCandidate(candidate) {
  const meta = [];
  if (candidate.daysSincePractice !== null && candidate.daysSincePractice !== undefined) {
    meta.push(`上次练习 ${candidate.daysSincePractice} 天前`);
  }
  return `<li class="home-review-node status-${candidate.reviewStatus}">
    <p class="home-review-node-title">${escapeHtml(candidate.nodeTitle)}</p>
    ${meta.length ? `<p class="home-review-node-meta">${escapeHtml(meta.join(" · "))}</p>` : ""}
    ${candidate.reasonText ? `<p class="home-review-node-reason">${escapeHtml(candidate.reasonText)}</p>` : ""}
  </li>`;
}

// 复习建议区（文档 §8-9）。
function renderReviewGroups(vm) {
  if (!vm.reviewSummary.totalCandidateCount) {
    const copy = !vm.emptyState.hasMaps
      ? "创建第一张星图后，这里会逐渐形成学习与复习建议。"
      : !vm.emptyState.hasLearningRecords
        ? "完成一次探索或复盘后，这里会开始记录需要重新关注的内容。"
        : "目前没有需要优先复习的内容，你的近期学习状态比较稳定。";
    return `<div class="home-review empty" data-brief-group>
      <p>${copy}</p>
    </div>`;
  }
  const groups = vm.reviewGroups.map((group) => `
    <div class="home-review-group">
      <p class="home-review-group-title">${escapeHtml(group.mapTitle)}</p>
      <ul class="home-review-nodes">${group.candidates.map(renderCandidate).join("")}</ul>
    </div>`).join("");
  const hidden = vm.reviewSummary.totalCandidateCount - vm.reviewSummary.displayedCandidateCount;
  const more = hidden > 0
    ? `<p class="home-review-more">还有另外 ${hidden} 个节点可复习</p>`
    : "";
  return `<div class="home-review" data-brief-group>${groups}${more}</div>`;
}

// 复习行动按钮（文档 §10）。
function renderReviewActions(vm) {
  if (!vm.reviewSummary.totalCandidateCount) return "";
  return `<div class="home-review-actions" data-brief-group>
    <button class="home-action-primary" data-home-action="start-suggested-review" type="button">开始建议复习</button>
    <button class="home-action-secondary" data-home-action="choose-review" type="button">选择复习内容</button>
    <button class="home-action-tertiary" data-home-action="dismiss-review" type="button">今天暂不复习</button>
  </div>`;
}

export function renderHomePage(state) {
  const vm = buildHomeBriefing(state.appData);
  state.homeBriefing = vm; // 缓存给事件绑定使用
  const skipAnimation = hasPlayedWelcomeAnimation();
  const animClass = skipAnimation ? "no-anim" : "play-anim";

  const greetingText = greeting(vm.user.displayName);

  return `<main class="home-briefing ${animClass}" aria-label="学习简报">
    <div class="home-briefing-bg" aria-hidden="true"></div>
    <div class="home-hero" aria-hidden="true"><span class="home-hero-text">${greetingText}</span></div>
    <section class="home-briefing-inner">
      <header class="home-welcome" data-brief-group>
        <h1>${greetingText}</h1>
        <p class="home-welcome-sub">这是你目前的学习状态。</p>
      </header>
      <div class="home-dashboard-grid">
        <section class="home-overview-panel">
          ${renderStatusLines(vm.learningSummary)}
          ${renderLastActivity(vm.lastActivity, vm.emptyState.hasMaps)}
        </section>
        <section class="home-review-panel">
          ${renderReviewGroups(vm)}
          ${renderReviewActions(vm)}
        </section>
      </div>
      <div class="home-start" data-brief-group>
        <button class="home-start-button" data-home-action="start-learning" type="button">开始学习</button>
        <button class="home-skip-link" data-home-action="skip-briefing" type="button">跳过简报</button>
      </div>
    </section>
  </main>`;
}

export function bindHomePageEvents(state, renderApp) {
  const goModes = () => {
    state.currentPage = "learning_modes";
    renderApp();
  };

  const action = (name) => {
    switch (name) {
      case "start-learning":
      case "skip-briefing":
        goModes();
        break;
      case "start-suggested-review":
      case "choose-review":
        // 复习流程接线在后续阶段：先进入模式页的复盘侧，避免死按钮。
        state.currentMode = "review";
        state.currentPage = "map_selection_review";
        renderApp();
        break;
      case "dismiss-review": {
        const el = document.querySelector(".home-review-actions");
        if (el) el.style.opacity = "0.4";
        break;
      }
      default:
        break;
    }
  };

  document.querySelectorAll("[data-home-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      action(button.dataset.homeAction);
    });
  });

  // 继续最近节点：进入对应星图（若存在）。
  document.querySelector("[data-home-continue-node]")?.addEventListener("click", (event) => {
    const mapId = event.currentTarget.dataset.mapId;
    if (mapId && state.appData.maps.some((map) => map.id === mapId)) {
      state.activeMapId = mapId;
      state.appData.activeMapId = mapId;
      const map = state.appData.maps.find((m) => m.id === mapId);
      state.starMap = map.rootNode;
      state.currentNode = map.rootNode;
      state.path = [map.rootNode];
      state.selectedNode = map.rootNode;
      state.currentMode = "exploration";
      state.mapEntryContext = {
        sourceView: "map_selection_exploration",
        mode: "exploration",
      };
      state.currentPage = "map";
      renderApp();
    } else {
      goModes();
    }
  });

  // 键盘：Enter 进入学习，Escape 跳过简报。
  const keyHandler = (event) => {
    if (event.key === "Enter") { event.preventDefault(); goModes(); }
    else if (event.key === "Escape") { event.preventDefault(); goModes(); }
  };
  document.addEventListener("keydown", keyHandler, { once: true });

  // 标记动画已播放，同一会话再回首页不重复完整入场。
  if (!hasPlayedWelcomeAnimation()) {
    markWelcomeAnimationPlayed();
  }
}
