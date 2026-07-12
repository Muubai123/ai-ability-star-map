// 首页简报的 UI 状态（文档 §25）。
// animationPlayedThisSession 用 sessionStorage：同一浏览器会话不重复播放完整入场动画。
// 其余为纯内存状态，随 appState 生命周期存在，不落 localStorage。

const ANIMATION_KEY = "aiAbilityStarMap.homeAnimationPlayed";

export function createHomeBriefingState() {
  return {
    expandedMapIds: [],
    selectedReviewNodeIds: [],
    reviewSuggestionDismissedAt: null,
  };
}

// 本次会话是否已播放过完整入场动画。
export function hasPlayedWelcomeAnimation() {
  try {
    return sessionStorage.getItem(ANIMATION_KEY) === "true";
  } catch {
    return false;
  }
}

export function markWelcomeAnimationPlayed() {
  try {
    sessionStorage.setItem(ANIMATION_KEY, "true");
  } catch {
    // sessionStorage 不可用时静默降级：动画每次都播，不影响功能。
  }
}

// 「今天暂不复习」：仅记录本次会话已忽略，不修改任何节点状态（文档 §10.3 / §25）。
export function dismissReviewSuggestion(state) {
  if (state) state.reviewSuggestionDismissedAt = new Date().toISOString();
}

export function toggleExpandedMap(state, mapId) {
  if (!state) return;
  const set = new Set(state.expandedMapIds);
  if (set.has(mapId)) set.delete(mapId);
  else set.add(mapId);
  state.expandedMapIds = [...set];
}

export function toggleSelectedReviewNode(state, nodeId) {
  if (!state) return;
  const set = new Set(state.selectedReviewNodeIds);
  if (set.has(nodeId)) set.delete(nodeId);
  else set.add(nodeId);
  state.selectedReviewNodeIds = [...set];
}
