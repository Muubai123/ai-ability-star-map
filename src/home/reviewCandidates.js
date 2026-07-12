// 首页复习候选（文档 §19-22）。
// 在现有复习引擎（reviewActivity.js）之上补三样首页展示所需的东西：
//   1. 按星图分组 + 每图/全局数量限制
//   2. reasonCodes -> 本地中文文案（不依赖 AI）
//   3. 衍生展示字段：nodePath / daysSincePractice / reasonText
//
// 底层的稳定度/优先级/状态计算全部复用 reviewActivity.js，本文件只做「取用 + 塑形」。

import {
  refreshNodeReviewState,
  calculateCurrentStability,
} from "../review/reviewActivity.js";

// 每张星图最多展示的候选数 / 全局最多展示数（文档 §8.2 / §21）。
export const PER_MAP_LIMIT = 3;
export const GLOBAL_LIMIT = 8;

// reasonCode -> 中文文案（文档 §22，原样落地）。
export const REASON_TEXT = {
  past_suggested_interval: "距离上次练习已经较久",
  recent_unresolved_problem: "上次仍有未解决问题",
  low_stability: "当前掌握稳定度偏低",
  memory_type: "记忆型内容适合短周期重新激活",
  high_weight: "这是当前星图中的重要节点",
  assisted_last_time: "上次仍需要提示",
  multiple_difficulties: "最近多次记录到困难",
};

// 在 rootNode 下定位某节点，返回从根到该节点的标题路径（不含根，符合文档 nodePath 示例）。
function findNodePath(root, nodeId, trail = []) {
  if (!root) return null;
  const next = [...trail, root];
  if (root.id === nodeId) return next;
  for (const child of root.children || []) {
    const found = findNodePath(child, nodeId, next);
    if (found) return found;
  }
  return null;
}

function findNode(root, nodeId) {
  const path = findNodePath(root, nodeId);
  return path ? path.at(-1) : null;
}

function daysBetween(from, now) {
  if (!from) return null;
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now - date.getTime()) / 86400000));
}

// 依据节点元数据推导 reasonCodes（文档 §22 的触发条件）。
function deriveReasonCodes(node, metadata, now) {
  const codes = [];
  const next = metadata.nextSuggestedReviewAt;
  if (next && new Date(next).getTime() <= now) codes.push("past_suggested_interval");
  const stability = calculateCurrentStability(node, now);
  if (stability !== null && stability < 0.5) codes.push("low_stability");
  if (metadata.difficultyCount >= 2) codes.push("multiple_difficulties");
  else if (metadata.lastPerformance === "difficulty" || metadata.lastPerformance === "unresolved") {
    codes.push("recent_unresolved_problem");
  }
  if (metadata.knowledgeType === "memory") codes.push("memory_type");
  if ((Number(node.weight) || 1) >= 3) codes.push("high_weight");
  if (metadata.lastPerformance === "assisted_practice") codes.push("assisted_last_time");
  return codes;
}

function buildReasonText(codes) {
  const parts = codes.map((code) => REASON_TEXT[code]).filter(Boolean);
  if (!parts.length) return "建议重新关注这个节点。";
  return `${parts.slice(0, 2).join("，")}。`;
}

// 把引擎给出的精简候选，补成文档 §20.2 的完整展示对象。
function decorateCandidate(map, raw, now) {
  const node = findNode(map.rootNode, raw.nodeId);
  const metadata = node ? refreshNodeReviewState(node, now) : {};
  const path = node ? findNodePath(map.rootNode, raw.nodeId) : null;
  const nodePath = path ? path.slice(1).map((item) => item.title) : [];
  const reasonCodes = node ? deriveReasonCodes(node, metadata, now) : [];
  return {
    mapId: map.id,
    mapTitle: map.title,
    nodeId: raw.nodeId,
    nodeTitle: raw.title || node?.title || "未命名节点",
    nodePath,
    mastery: Number(node?.mastery) || 0,
    knowledgeType: metadata.knowledgeType || null,
    lastLearnedAt: metadata.lastLearnedAt || null,
    lastPracticedAt: metadata.lastPracticedAt || null,
    daysSincePractice: daysBetween(metadata.lastPracticedAt || metadata.lastLearnedAt, now),
    currentStability: node ? calculateCurrentStability(node, now) : null,
    reviewStatus: raw.reviewStatus,
    reviewPriority: raw.reviewPriority,
    nextSuggestedReviewAt: metadata.nextSuggestedReviewAt || raw.nextSuggestedReviewAt || null,
    reasonCodes,
    reasonText: buildReasonText(reasonCodes),
  };
}

// 单张星图的复习摘要（文档 §20.1）。
export function getMapReviewSummary(map, rawCandidatesForMap, now = Date.now(), limit = PER_MAP_LIMIT) {
  const decorated = rawCandidatesForMap.map((raw) => decorateCandidate(map, raw, now));
  const count = (status) => decorated.filter((item) => item.reviewStatus === status).length;
  return {
    mapId: map.id,
    mapTitle: map.title,
    reviewCandidateCount: decorated.length,
    priorityCount: count("priority"),
    dueCount: count("due"),
    watchCount: count("watch"),
    highestPriority: decorated[0]?.reviewPriority ?? 0,
    latestPracticedAt: decorated
      .map((item) => item.lastPracticedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null,
    candidates: decorated.slice(0, limit),
  };
}

// 汇总所有星图的复习分组，套用每图/全局数量限制。
// maps: appData.maps；rawByMap: (mapId) => 该图按优先级降序的原始候选数组。
export function buildReviewGroups(maps = [], rawByMap, now = Date.now()) {
  const groups = [];
  let displayed = 0;
  for (const map of maps) {
    const raw = rawByMap(map.id) || [];
    if (!raw.length) continue;
    const remaining = Math.max(0, GLOBAL_LIMIT - displayed);
    if (remaining === 0) break;
    const perMap = Math.min(PER_MAP_LIMIT, remaining);
    const summary = getMapReviewSummary(map, raw, now, perMap);
    if (!summary.candidates.length) continue;
    displayed += summary.candidates.length;
    groups.push(summary);
  }
  const totalCandidateCount = maps.reduce((sum, map) => sum + (rawByMap(map.id) || []).length, 0);
  const priorityCount = groups.reduce((sum, group) => sum + group.priorityCount, 0);
  return {
    reviewGroups: groups,
    reviewSummary: {
      totalCandidateCount,
      displayedCandidateCount: displayed,
      priorityCount,
    },
  };
}
