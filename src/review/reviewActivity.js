import { REVIEW_CONFIG, EVIDENCE_TYPES } from "./reviewConfig.js";
import { ensureNodeReviewMetadata } from "./reviewMetadata.js";

const PRACTICE_EVIDENCE = new Set([
  "exercise",
  "independent_practice",
  "assisted_practice",
  "review_success",
  "review_partial",
  "review_failure",
]);
const REVIEW_EVIDENCE = new Set(["review_success", "review_partial", "review_failure"]);
const HIGH_QUALITY_EVIDENCE = new Set(["explanation", "transfer"]);
const LEARNING_ACTIVITY_TYPES = new Set([
  "exploration",
  "single_review",
  "global_review_item",
  "dedicated_review",
  "practice",
  "import",
]);
const REVIEW_ACTIVITY_TYPES = new Set([
  "single_review",
  "global_review_item",
  "dedicated_review",
]);
const ELIGIBLE_REVIEW_STATUSES = new Set(["watch", "due", "priority"]);
const STATUS_RANK = { priority: 3, due: 2, watch: 1, stable: 0, uninitialized: -1 };

const LEGACY_EVIDENCE_TYPES = {
  self_report: "exposure",
  practice: "exercise",
  application: "exercise",
  explanation: "explanation",
  independent: "independent_practice",
  assisted: "assisted_practice",
  difficulty: "difficulty",
  unresolved: "unresolved",
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validActivityIso(value, now = Date.now()) {
  const timestamp = toTimestamp(value);
  if (timestamp === null || timestamp > Number(now)) return null;
  return new Date(timestamp).toISOString();
}

function findNode(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function getBaseActivity(metadata, now) {
  const fields = [
    ["lastReviewedAt", metadata.lastReviewedAt],
    ["lastPracticedAt", metadata.lastPracticedAt],
    ["lastLearnedAt", metadata.lastLearnedAt],
  ];
  for (const [field, value] of fields) {
    const date = validActivityIso(value, now);
    if (date) return { field, date };
  }
  return null;
}

function hasAnyActivityDate(metadata) {
  return Boolean(metadata.lastReviewedAt || metadata.lastPracticedAt || metadata.lastLearnedAt);
}

function deriveReasonCodes(node, metadata, state) {
  if (!ELIGIBLE_REVIEW_STATUSES.has(state.reviewStatus)) return [];
  const codes = [];
  if (state.daysSinceBaseActivity >= state.effectiveIntervalDays) codes.push("past_suggested_interval");
  else if (metadata.lastPracticedAt === null && metadata.lastReviewedAt === null) codes.push("no_recent_practice");
  if (metadata.lastPerformance === "unresolved") codes.push("recent_unresolved_problem");
  else if (metadata.lastPerformance === "review_failure") codes.push("recent_failure");
  if (state.currentStability !== null && state.currentStability < 0.5) codes.push("low_stability");
  if (metadata.difficultyCount >= 2) codes.push("multiple_difficulties");
  if (metadata.knowledgeType === "memory") codes.push("memory_type");
  if ((Number(node.weight) || 1) >= 3) codes.push("high_weight");
  if (metadata.lastPerformance === "assisted_practice") codes.push("assisted_last_time");
  if (metadata.assistedSuccessCount > metadata.independentSuccessCount) codes.push("weak_independence_evidence");
  return [...new Set(codes)];
}

export function normalizeLearningEvidence(evidence) {
  const entries = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  return entries.map((item) => {
    const source = typeof item === "string" ? { content: item } : (item || {});
    const rawType = String(source.type || source.evidenceType || "exposure").trim();
    const type = EVIDENCE_TYPES.has(rawType) ? rawType : (LEGACY_EVIDENCE_TYPES[rawType] || "exposure");
    const content = String(source.content || source.text || source.title || "").trim();
    return { type, content };
  }).filter((item) => item.content || item.type !== "exposure");
}

export function calculateStoredStability(metadata, mastery = 0) {
  const hasEvidence = metadata.lastLearnedAt
    || metadata.practiceCount
    || metadata.reviewCount
    || metadata.independentSuccessCount
    || metadata.assistedSuccessCount
    || metadata.difficultyCount;
  if (!hasEvidence) return null;
  let score = 0.22;
  if (metadata.practiceCount) score += Math.min(0.14, metadata.practiceCount * 0.035);
  if (metadata.assistedSuccessCount) score += Math.min(0.14, metadata.assistedSuccessCount * 0.05);
  if (metadata.independentSuccessCount) score += Math.min(0.3, metadata.independentSuccessCount * 0.1);
  if (metadata.reviewCount) score += Math.min(0.12, metadata.reviewCount * 0.03);
  if (["explanation", "transfer"].includes(metadata.lastPerformance)) score += 0.08;
  score += Math.min(0.08, Math.max(0, Number(mastery) || 0) * 0.02);
  score -= Math.min(0.24, metadata.difficultyCount * 0.06);
  if (["unresolved", "review_failure"].includes(metadata.lastPerformance)) score -= 0.08;
  return Number(clamp(score, 0.05, 0.95).toFixed(2));
}

export function calculateCurrentStability(node, now = Date.now()) {
  const metadata = ensureNodeReviewMetadata(node);
  if (metadata.stability === null || metadata.stability === undefined) return null;
  const updatedAt = validActivityIso(metadata.stabilityUpdatedAt, now);
  if (!updatedAt) return Number(clamp(Number(metadata.stability) || 0, 0, 1).toFixed(2));
  const ageDays = Math.max(0, (Number(now) - new Date(updatedAt).getTime()) / 86400000);
  const interval = metadata.baseIntervalDays || REVIEW_CONFIG.baseIntervalDays[metadata.knowledgeType];
  const decay = Math.min(0.7, ageDays / Math.max(1, interval) * 0.18);
  return Number(clamp(metadata.stability - decay, 0, 1).toFixed(2));
}

function calculateEffectiveInterval(metadata, currentStability) {
  const base = REVIEW_CONFIG.baseIntervalDays[metadata.knowledgeType]
    || REVIEW_CONFIG.baseIntervalDays[REVIEW_CONFIG.defaultKnowledgeType];
  const stabilityFactor = currentStability === null ? 0.8 : 0.55 + currentStability * 0.75;
  const difficultyFactor = Math.max(0.58, 1 - Math.min(0.3, metadata.difficultyCount * 0.06));
  const unresolvedFactor = ["unresolved", "review_failure"].includes(metadata.lastPerformance) ? 0.78 : 1;
  return Number(Math.max(1, base * stabilityFactor * difficultyFactor * unresolvedFactor).toFixed(2));
}

export function calculateReviewState(node, now = Date.now()) {
  const metadata = ensureNodeReviewMetadata(node);
  const isLeaf = !(node?.children || []).length;
  const independentlyReviewable = node?.independentlyReviewable === true;
  const base = getBaseActivity(metadata, now);
  const currentStability = calculateCurrentStability(node, now);
  const baseIntervalDays = REVIEW_CONFIG.baseIntervalDays[metadata.knowledgeType]
    || REVIEW_CONFIG.baseIntervalDays[REVIEW_CONFIG.defaultKnowledgeType];
  const effectiveIntervalDays = calculateEffectiveInterval(metadata, currentStability);
  const empty = {
    reviewStatus: "uninitialized",
    reviewPriority: 0,
    baseActivityField: base?.field || null,
    baseActivityDate: base?.date || null,
    daysSinceBaseActivity: base ? Math.floor((Number(now) - new Date(base.date).getTime()) / 86400000) : null,
    baseIntervalDays,
    effectiveIntervalDays,
    currentStability,
    nextSuggestedReviewAt: null,
    reasonCodes: [],
    exclusionReason: null,
  };

  if (!isLeaf && !independentlyReviewable) return { ...empty, exclusionReason: "non_leaf_node" };
  if (Number(node?.mastery) <= 0) return { ...empty, exclusionReason: "mastery_zero" };
  if (!base) {
    return {
      ...empty,
      exclusionReason: hasAnyActivityDate(metadata)
        ? "invalid_or_future_activity_date"
        : "no_reliable_learning_activity",
    };
  }

  const days = empty.daysSinceBaseActivity;
  const elapsedRatio = days / Math.max(1, effectiveIntervalDays);
  const timePressure = clamp((elapsedRatio - 0.55) / 1.1, 0, 1);
  const stabilityPressure = currentStability === null ? 0.12 : 1 - currentStability;
  const importance = clamp((Number(node.weight) || 1) / 4, 0, 1);
  const masteryPressure = clamp((4 - (Number(node.mastery) || 0)) / 4, 0, 1);
  const difficultyPressure = clamp(metadata.difficultyCount / 4, 0, 1);
  const unresolvedPressure = ["unresolved", "review_failure"].includes(metadata.lastPerformance) ? 1 : 0;
  const assistancePressure = metadata.assistedSuccessCount > metadata.independentSuccessCount ? 1 : 0;
  const successRelief = clamp(metadata.independentSuccessCount / 5, 0, 1) * 0.06;
  const priority = clamp(
    0.52 * timePressure
      + 0.16 * stabilityPressure
      + 0.1 * importance
      + 0.05 * masteryPressure
      + 0.07 * difficultyPressure
      + 0.08 * unresolvedPressure
      + 0.04 * assistancePressure
      - successRelief,
    0,
    1,
  );
  const reviewPriority = Number(priority.toFixed(2));
  let reviewStatus = "stable";
  if (reviewPriority >= REVIEW_CONFIG.statusThresholds.priority) reviewStatus = "priority";
  else if (reviewPriority >= REVIEW_CONFIG.statusThresholds.due) reviewStatus = "due";
  else if (reviewPriority >= REVIEW_CONFIG.statusThresholds.watch) reviewStatus = "watch";

  const nextSuggestedReviewAt = new Date(
    new Date(base.date).getTime() + effectiveIntervalDays * 86400000,
  ).toISOString();
  const state = {
    ...empty,
    reviewStatus,
    reviewPriority,
    nextSuggestedReviewAt,
    exclusionReason: ELIGIBLE_REVIEW_STATUSES.has(reviewStatus) ? null : "currently_stable",
  };
  state.reasonCodes = deriveReasonCodes(node, metadata, state);
  return state;
}

export function calculateNextSuggestedReviewAt(node, now = Date.now()) {
  return calculateReviewState(node, now).nextSuggestedReviewAt;
}

export function calculateReviewPriority(node, now = Date.now()) {
  return calculateReviewState(node, now).reviewPriority;
}

export function calculateReviewStatus(node, now = Date.now()) {
  return calculateReviewState(node, now).reviewStatus;
}

export function refreshNodeReviewState(node, now = Date.now()) {
  const metadata = ensureNodeReviewMetadata(node);
  metadata.baseIntervalDays = REVIEW_CONFIG.baseIntervalDays[metadata.knowledgeType]
    || REVIEW_CONFIG.baseIntervalDays[REVIEW_CONFIG.defaultKnowledgeType];
  const state = calculateReviewState(node, now);
  metadata.nextSuggestedReviewAt = state.nextSuggestedReviewAt;
  metadata.reviewPriority = state.reviewPriority;
  metadata.reviewStatus = state.reviewStatus;
  return metadata;
}

export function applyLearningActivityToNode(appData, payload = {}) {
  if (payload.activityType === "global_review") {
    return { ok: true, skipped: true, reason: "summary_record" };
  }
  const map = (appData?.maps || []).find((item) => item.id === payload.mapId);
  if (!map) return { ok: false, error: "map_not_found" };
  const node = findNode(map.rootNode, payload.nodeId);
  if (!node) return { ok: false, error: "node_not_found" };
  const metadata = ensureNodeReviewMetadata(node);
  const sourceRecordId = String(payload.sourceRecordId || "").trim();
  if (sourceRecordId && metadata.appliedActivityIds.includes(sourceRecordId)) {
    return { ok: true, skipped: true, node, metadata };
  }
  const occurredAt = validActivityIso(payload.activityOccurredAt || payload.occurredAt, Date.now());
  if (!occurredAt) return { ok: false, error: "invalid_activity_date", node, metadata };

  const activityType = String(payload.activityType || "practice");
  const evidence = normalizeLearningEvidence(payload.evidence);
  const hasPractice = evidence.some((item) => PRACTICE_EVIDENCE.has(item.type));
  const hasDifficulty = evidence.some((item) => item.type === "difficulty" || item.type === "unresolved");
  const hasIndependent = evidence.some((item) => item.type === "independent_practice");
  const hasAssisted = evidence.some((item) => item.type === "assisted_practice");
  const hasReviewEvidence = evidence.some((item) => REVIEW_EVIDENCE.has(item.type));
  const highQuality = evidence.find((item) => HIGH_QUALITY_EVIDENCE.has(item.type));
  const isLearningActivity = LEARNING_ACTIVITY_TYPES.has(activityType);
  const isReviewActivity = REVIEW_ACTIVITY_TYPES.has(activityType) || hasReviewEvidence;
  const isManualAdjustment = activityType === "manual_adjustment";

  if (!isLearningActivity && !isManualAdjustment) {
    return { ok: true, skipped: true, reason: "non_learning_activity", node, metadata };
  }

  if (isLearningActivity) metadata.lastLearnedAt = occurredAt;
  if (hasPractice || isReviewActivity) {
    metadata.lastPracticedAt = occurredAt;
    metadata.practiceCount += 1;
  }
  if (isReviewActivity) {
    metadata.lastReviewedAt = occurredAt;
    metadata.reviewCount += 1;
    metadata.lastReviewMethod = activityType;
  }
  if (hasIndependent) metadata.independentSuccessCount += 1;
  if (hasAssisted) metadata.assistedSuccessCount += 1;
  if (hasDifficulty) metadata.difficultyCount += 1;
  metadata.lastPerformance = highQuality?.type
    || (hasIndependent
      ? "independent_practice"
      : hasAssisted
        ? "assisted_practice"
        : evidence.some((item) => item.type === "unresolved")
          ? "unresolved"
          : evidence.some((item) => item.type === "review_failure")
            ? "review_failure"
            : hasDifficulty
              ? "difficulty"
              : evidence.at(-1)?.type || metadata.lastPerformance);

  if (Number.isFinite(Number(payload.masteryAfter))
    && Number(payload.masteryBefore) !== Number(payload.masteryAfter)) {
    metadata.lastMasteryChangedAt = occurredAt;
  }
  if (sourceRecordId) {
    metadata.appliedActivityIds = [...new Set([...metadata.appliedActivityIds, sourceRecordId])].slice(-500);
  }

  if (isLearningActivity) {
    metadata.stability = calculateStoredStability(metadata, node.mastery);
    metadata.stabilityUpdatedAt = occurredAt;
    refreshNodeReviewState(node, new Date(occurredAt).getTime());
    map.metadata = {
      ...(map.metadata || {}),
      lastActivityAt: occurredAt,
      lastActivityType: activityType,
      lastActivityNodeId: node.id,
      reviewMetadataVersion: REVIEW_CONFIG.metadataVersion,
    };
  } else {
    refreshNodeReviewState(node, new Date(occurredAt).getTime());
  }
  return { ok: true, node, metadata };
}

function compareCandidates(a, b) {
  return (STATUS_RANK[b.reviewStatus] || 0) - (STATUS_RANK[a.reviewStatus] || 0)
    || b.reviewPriority - a.reviewPriority
    || Number(b.reasonCodes.includes("recent_unresolved_problem")) - Number(a.reasonCodes.includes("recent_unresolved_problem"))
    || b.weight - a.weight
    || b.daysSinceBaseActivity - a.daysSinceBaseActivity
    || String(a.nodeId).localeCompare(String(b.nodeId));
}

export function getReviewCandidateDebugInfo(appData, mapId, nodeId, now = Date.now()) {
  const map = (appData?.maps || []).find((item) => item.id === mapId);
  if (!map) return { mapId, nodeId, exclusionReason: "map_not_found" };
  const node = findNode(map.rootNode, nodeId);
  if (!node) return { mapId, nodeId, exclusionReason: "node_not_found" };
  const state = calculateReviewState(node, now);
  return {
    mapId,
    nodeId,
    nodeTitle: node.title,
    ...state,
  };
}

export function getReviewCandidatesForMap(appData, mapId, now = Date.now()) {
  const map = (appData?.maps || []).find((item) => item.id === mapId);
  if (!map) return [];
  const candidates = [];
  const seen = new Set();
  const walk = (node) => {
    const state = calculateReviewState(node, now);
    if (ELIGIBLE_REVIEW_STATUSES.has(state.reviewStatus) && !seen.has(node.id)) {
      seen.add(node.id);
      candidates.push({
        mapId,
        nodeId: node.id,
        title: node.title,
        weight: Number(node.weight) || 1,
        knowledgeType: ensureNodeReviewMetadata(node).knowledgeType,
        ...state,
      });
    }
    (node.children || []).forEach(walk);
  };
  walk(map.rootNode);
  return candidates.sort(compareCandidates);
}

export function getReviewCandidatesAcrossMaps(appData, now = Date.now()) {
  return (appData?.maps || [])
    .flatMap((map) => getReviewCandidatesForMap(appData, map.id, now))
    .sort(compareCandidates);
}
