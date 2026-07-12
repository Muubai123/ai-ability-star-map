// 首页简报聚合器（文档 §23 的中枢）。
// 首页组件不自己遍历地图/记录，只消费本函数返回的单一 view model。
//
// 设计：核心 buildHomeBriefingViewModel(input) 接收已备好的数据（records/maps/rawByMap），
// 纯逻辑、可在 Node 下单测；便捷包装 buildHomeBriefing(appData) 负责从 appData 取数据。

import { getLearningRecords } from "../records/learningRecordStore.js";
import { getReviewCandidatesForMap } from "../review/reviewActivity.js";
import { buildLearningSummary, getLastLearningActivity } from "./homeStats.js";
import { buildReviewGroups } from "./reviewCandidates.js";

// 开发阶段用户名统一为「绘图师」。
export const DEV_DISPLAY_NAME = "绘图师";

function buildLastActivity(records) {
  const last = getLastLearningActivity(records);
  if (!last) return null;
  const primary = last.nodeSnapshots?.[0] || {};
  return {
    recordId: last.id,
    type: last.type,
    mapId: last.mapId,
    mapTitle: last.mapTitle,
    nodeId: last.nodeIds?.[0] || primary.nodeId || null,
    nodeTitle: primary.title || "",
    nodePath: primary.path || [],
    summary: last.summary || "",
    remainingProblems: last.remainingProblems || [],
    occurredAt: last.endedAt || last.createdAt || "",
  };
}

// 核心聚合：纯数据进、view model 出（文档 §23）。
// input: { records, maps, rawByMap, now, displayName }
export function buildHomeBriefingViewModel(input = {}) {
  const {
    records = [],
    maps = [],
    rawByMap = () => [],
    now = Date.now(),
    displayName = DEV_DISPLAY_NAME,
  } = input;

  const learningSummary = buildLearningSummary(records, new Date(now));
  const lastActivity = buildLastActivity(records);
  const { reviewGroups, reviewSummary } = buildReviewGroups(maps, rawByMap, now);

  const hasMaps = maps.length > 0;
  const hasLearningRecords = Boolean(lastActivity);
  const hasReviewCandidates = reviewSummary.totalCandidateCount > 0;

  return {
    user: { displayName: displayName || "" },
    learningSummary,
    lastActivity,
    reviewGroups,
    reviewSummary,
    emptyState: { hasMaps, hasLearningRecords, hasReviewCandidates },
  };
}

// 便捷包装：从 appData 取数据后调用核心聚合器。UI 层用这个。
export function buildHomeBriefing(appData, options = {}) {
  const records = getLearningRecords(appData);
  const maps = appData?.maps || [];
  const now = options.now || Date.now();
  // 每图候选按优先级降序（getReviewCandidatesForMap 已排序），首页再做分组截断。
  const rawByMap = (mapId) => getReviewCandidatesForMap(appData, mapId, now);
  return buildHomeBriefingViewModel({
    records,
    maps,
    rawByMap,
    now,
    displayName: options.displayName ?? DEV_DISPLAY_NAME,
  });
}
