import { calculateCurrentStability } from "../review/reviewActivity.js";

export const PER_MAP_LIMIT = 3;
export const GLOBAL_LIMIT = 8;

const STATUS_RANK = { priority: 3, due: 2, watch: 1 };
const ELIGIBLE_STATUSES = new Set(Object.keys(STATUS_RANK));

export const REASON_TEXT = {
  past_suggested_interval: "距离上次练习已经较久",
  recent_unresolved_problem: "上次仍有未解决问题",
  low_stability: "当前掌握稳定度偏低",
  memory_type: "记忆型内容适合短周期重新激活",
  high_weight: "这是当前星图中的重要节点",
  assisted_last_time: "上次仍需要提示",
  multiple_difficulties: "最近多次记录到困难",
  no_recent_practice: "目前只有接触记录，尚缺少练习",
  recent_failure: "最近一次练习还不够稳定",
  weak_independence_evidence: "目前独立完成的证据较少",
};

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

function validPastIso(value, now) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp > Number(now)) return null;
  return new Date(timestamp).toISOString();
}

function daysBetween(from, now) {
  const date = validPastIso(from, now);
  if (!date) return null;
  return Math.floor((Number(now) - new Date(date).getTime()) / 86400000);
}

function buildReasonText(codes) {
  const parts = codes.map((code) => REASON_TEXT[code]).filter(Boolean);
  return parts.length ? `${parts.slice(0, 2).join("；")}。` : "";
}

function compareCandidates(a, b) {
  return (STATUS_RANK[b.reviewStatus] || 0) - (STATUS_RANK[a.reviewStatus] || 0)
    || (Number(b.reviewPriority) || 0) - (Number(a.reviewPriority) || 0)
    || Number((b.reasonCodes || []).includes("recent_unresolved_problem")) - Number((a.reasonCodes || []).includes("recent_unresolved_problem"))
    || (Number(b.weight) || 1) - (Number(a.weight) || 1)
    || (Number(b.daysSinceBaseActivity) || 0) - (Number(a.daysSinceBaseActivity) || 0)
    || String(a.nodeId).localeCompare(String(b.nodeId));
}

function decorateCandidate(map, raw, now) {
  const node = findNode(map.rootNode, raw.nodeId);
  if (!node || raw.mapId !== map.id || !ELIGIBLE_STATUSES.has(raw.reviewStatus)) return null;
  const metadata = node.reviewMetadata || {};
  const path = findNodePath(map.rootNode, raw.nodeId);
  const reasonCodes = Array.isArray(raw.reasonCodes) ? raw.reasonCodes : [];
  const baseActivityDate = validPastIso(raw.baseActivityDate, now);
  return {
    mapId: map.id,
    mapTitle: map.title,
    nodeId: raw.nodeId,
    nodeTitle: raw.title || node.title || "未命名节点",
    nodePath: path ? path.slice(1).map((item) => item.title) : [],
    mastery: Number(node.mastery) || 0,
    weight: Number(node.weight) || 1,
    knowledgeType: raw.knowledgeType || metadata.knowledgeType || null,
    lastLearnedAt: validPastIso(metadata.lastLearnedAt, now),
    lastPracticedAt: validPastIso(metadata.lastPracticedAt, now),
    lastReviewedAt: validPastIso(metadata.lastReviewedAt, now),
    baseActivityDate,
    baseActivityField: raw.baseActivityField || null,
    daysSinceBaseActivity: raw.daysSinceBaseActivity ?? daysBetween(baseActivityDate, now),
    daysSincePractice: raw.daysSinceBaseActivity ?? daysBetween(baseActivityDate, now),
    baseIntervalDays: raw.baseIntervalDays ?? metadata.baseIntervalDays ?? null,
    effectiveIntervalDays: raw.effectiveIntervalDays ?? null,
    currentStability: raw.currentStability ?? calculateCurrentStability(node, now),
    reviewStatus: raw.reviewStatus,
    reviewPriority: Number(raw.reviewPriority) || 0,
    nextSuggestedReviewAt: validPastIso(raw.nextSuggestedReviewAt, Number.MAX_SAFE_INTEGER) || null,
    reasonCodes,
    reasonText: buildReasonText(reasonCodes),
  };
}

export function getMapReviewSummary(map, rawCandidatesForMap, now = Date.now(), limit = PER_MAP_LIMIT, displayedRaw = null) {
  const all = rawCandidatesForMap
    .map((raw) => decorateCandidate(map, raw, now))
    .filter(Boolean)
    .sort(compareCandidates);
  const displayed = (displayedRaw || rawCandidatesForMap)
    .map((raw) => decorateCandidate(map, raw, now))
    .filter(Boolean)
    .sort(compareCandidates)
    .slice(0, limit);
  const count = (status) => all.filter((item) => item.reviewStatus === status).length;
  return {
    mapId: map.id,
    mapTitle: map.title,
    candidateCount: all.length,
    totalCandidates: all.length,
    reviewCandidateCount: all.length,
    displayedCandidateCount: displayed.length,
    priorityCount: count("priority"),
    dueCount: count("due"),
    watchCount: count("watch"),
    highestPriority: all[0]?.reviewPriority ?? 0,
    latestPracticedAt: all
      .map((item) => item.lastPracticedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null,
    displayedCandidates: displayed,
    candidates: displayed,
  };
}

export function buildReviewGroups(maps = [], rawByMap, now = Date.now()) {
  const cache = new Map();
  const mapById = new Map(maps.map((map) => [map.id, map]));
  maps.forEach((map) => {
    const seen = new Set();
    const raw = (rawByMap(map.id) || []).filter((candidate) => {
      const key = `${candidate?.mapId}:${candidate?.nodeId}`;
      if (candidate?.mapId !== map.id || !candidate?.nodeId || seen.has(key) || !ELIGIBLE_STATUSES.has(candidate.reviewStatus)) return false;
      if (!findNode(map.rootNode, candidate.nodeId)) return false;
      seen.add(key);
      return true;
    }).sort(compareCandidates);
    cache.set(map.id, raw);
  });

  const all = [...cache.values()].flat().sort(compareCandidates);
  const selected = [];
  const perMapCount = new Map();
  const take = (candidate) => {
    if (selected.length >= GLOBAL_LIMIT) return;
    const used = perMapCount.get(candidate.mapId) || 0;
    if (used >= PER_MAP_LIMIT) return;
    selected.push(candidate);
    perMapCount.set(candidate.mapId, used + 1);
  };
  all.filter((item) => item.reviewStatus !== "watch").forEach(take);
  if (selected.length < GLOBAL_LIMIT) all.filter((item) => item.reviewStatus === "watch").forEach(take);

  const reviewGroups = maps.flatMap((map) => {
    if (!mapById.has(map.id)) return [];
    const displayed = selected.filter((candidate) => candidate.mapId === map.id);
    if (!displayed.length) return [];
    return [getMapReviewSummary(map, cache.get(map.id) || [], now, PER_MAP_LIMIT, displayed)];
  });
  const count = (status) => all.filter((item) => item.reviewStatus === status).length;
  return {
    reviewGroups,
    reviewSummary: {
      totalCandidateCount: all.length,
      displayedCandidateCount: selected.length,
      priorityCount: count("priority"),
      dueCount: count("due"),
      watchCount: count("watch"),
    },
  };
}
