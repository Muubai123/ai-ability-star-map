import { REVIEW_CONFIG, EVIDENCE_TYPES } from "./reviewConfig.js";
import { ensureNodeReviewMetadata } from "./reviewMetadata.js";

const PRACTICE_EVIDENCE = new Set(["exercise", "independent_practice", "assisted_practice", "review_success", "review_partial", "review_failure"]);
const REVIEW_EVIDENCE = new Set(["review_success", "review_partial", "review_failure"]);
const HIGH_QUALITY_EVIDENCE = new Set(["explanation", "transfer"]);

const LEGACY_EVIDENCE_TYPES = {
  self_report: "exposure", practice: "exercise", application: "exercise", explanation: "explanation", independent: "independent_practice", assisted: "assisted_practice", difficulty: "difficulty", unresolved: "unresolved",
};

function iso(value = Date.now()) { const date = new Date(value); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function findNode(root, id) { if (!root) return null; if (root.id === id) return root; for (const child of root.children || []) { const found = findNode(child, id); if (found) return found; } return null; }

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
  const hasEvidence = metadata.lastLearnedAt || metadata.practiceCount || metadata.reviewCount || metadata.independentSuccessCount || metadata.assistedSuccessCount || metadata.difficultyCount;
  if (!hasEvidence) return null;
  let score = 0.22;
  if (metadata.practiceCount) score += Math.min(0.14, metadata.practiceCount * 0.035);
  if (metadata.assistedSuccessCount) score += Math.min(0.14, metadata.assistedSuccessCount * 0.05);
  if (metadata.independentSuccessCount) score += Math.min(0.3, metadata.independentSuccessCount * 0.1);
  if (metadata.reviewCount) score += Math.min(0.12, metadata.reviewCount * 0.03);
  if (["explanation", "transfer"].includes(metadata.lastPerformance)) score += 0.08;
  score += Math.min(0.08, Math.max(0, Number(mastery) || 0) * 0.02);
  score -= Math.min(0.24, metadata.difficultyCount * 0.06);
  return Number(clamp(score, 0.05, 0.95).toFixed(2));
}

export function calculateCurrentStability(node, now = Date.now()) {
  const metadata = ensureNodeReviewMetadata(node);
  if (metadata.stability === null || !metadata.stabilityUpdatedAt) return metadata.stability;
  const ageDays = Math.max(0, (new Date(now) - new Date(metadata.stabilityUpdatedAt)) / 86400000);
  const interval = metadata.baseIntervalDays || REVIEW_CONFIG.baseIntervalDays[metadata.knowledgeType];
  const decay = Math.min(0.7, ageDays / Math.max(1, interval) * 0.18);
  return Number(clamp(metadata.stability - decay, 0, 1).toFixed(2));
}

export function calculateNextSuggestedReviewAt(node, now = Date.now()) {
  const metadata = ensureNodeReviewMetadata(node);
  if (!metadata.lastLearnedAt || Number(node.mastery) <= 0) return null;
  const base = metadata.baseIntervalDays || REVIEW_CONFIG.baseIntervalDays[metadata.knowledgeType];
  const stability = calculateCurrentStability(node, now) ?? 0.2;
  const difficultyFactor = Math.max(0.55, 1 - Math.min(0.3, metadata.difficultyCount * 0.06));
  const intervalDays = Math.max(1, base * (0.55 + stability * 0.75) * difficultyFactor);
  const anchor = new Date(metadata.lastPracticedAt || metadata.lastLearnedAt);
  return new Date(anchor.getTime() + intervalDays * 86400000).toISOString();
}

export function calculateReviewPriority(node, now = Date.now()) {
  const metadata = ensureNodeReviewMetadata(node);
  if ((node.children || []).length || Number(node.mastery) <= 0 || !metadata.lastLearnedAt) return 0;
  const next = calculateNextSuggestedReviewAt(node, now);
  if (!next) return 0;
  const overdueDays = Math.max(0, (new Date(now) - new Date(next)) / 86400000);
  const interval = Math.max(1, metadata.baseIntervalDays || 7);
  const duePressure = clamp((new Date(now) - new Date(next)) / (interval * 86400000) * 0.5 + 0.5, 0, 1);
  const lowStability = 1 - (calculateCurrentStability(node, now) ?? 0);
  const importance = clamp((Number(node.weight) || 1) / 4, 0, 1);
  const difficulty = clamp(metadata.difficultyCount / 4, 0, 1);
  const priority = 0.48 * duePressure + 0.28 * lowStability + 0.16 * importance + 0.08 * difficulty + Math.min(0.1, overdueDays / 30);
  return Number(clamp(priority, 0, 1).toFixed(2));
}

export function calculateReviewStatus(node, now = Date.now()) {
  const metadata = ensureNodeReviewMetadata(node);
  if ((node.children || []).length || Number(node.mastery) <= 0 || !metadata.lastLearnedAt) return "uninitialized";
  const priority = calculateReviewPriority(node, now);
  if (priority >= REVIEW_CONFIG.statusThresholds.priority) return "priority";
  if (priority >= REVIEW_CONFIG.statusThresholds.due) return "due";
  if (priority >= REVIEW_CONFIG.statusThresholds.watch) return "watch";
  return "stable";
}

export function refreshNodeReviewState(node, now = Date.now()) {
  const metadata = ensureNodeReviewMetadata(node);
  metadata.baseIntervalDays = REVIEW_CONFIG.baseIntervalDays[metadata.knowledgeType];
  metadata.stability = calculateStoredStability(metadata, node.mastery);
  if (metadata.stability !== null) metadata.stabilityUpdatedAt ||= iso(now);
  metadata.nextSuggestedReviewAt = calculateNextSuggestedReviewAt(node, now);
  metadata.reviewPriority = calculateReviewPriority(node, now);
  metadata.reviewStatus = calculateReviewStatus(node, now);
  return metadata;
}

export function applyLearningActivityToNode(appData, payload = {}) {
  const map = (appData?.maps || []).find((item) => item.id === payload.mapId);
  if (!map) return { ok: false, error: "map_not_found" };
  const node = findNode(map.rootNode, payload.nodeId);
  if (!node) return { ok: false, error: "node_not_found" };
  const metadata = ensureNodeReviewMetadata(node);
  const sourceRecordId = String(payload.sourceRecordId || "").trim();
  if (sourceRecordId && metadata.appliedActivityIds.includes(sourceRecordId)) return { ok: true, skipped: true, node, metadata };
  const occurredAt = iso(payload.occurredAt);
  const activityType = String(payload.activityType || "practice");
  const evidence = normalizeLearningEvidence(payload.evidence);
  const hasPractice = evidence.some((item) => PRACTICE_EVIDENCE.has(item.type));
  const hasDifficulty = evidence.some((item) => item.type === "difficulty" || item.type === "unresolved");
  const hasIndependent = evidence.some((item) => item.type === "independent_practice");
  const hasAssisted = evidence.some((item) => item.type === "assisted_practice");
  const hasReviewEvidence = evidence.some((item) => REVIEW_EVIDENCE.has(item.type));
  const highQuality = evidence.find((item) => HIGH_QUALITY_EVIDENCE.has(item.type));
  const isLearningActivity = ["exploration", "single_review", "global_review_item", "dedicated_review", "practice", "import"].includes(activityType);
  const isReviewActivity = activityType === "dedicated_review" || hasReviewEvidence;

  if (isLearningActivity) metadata.lastLearnedAt = occurredAt;
  if (hasPractice || isReviewActivity) { metadata.lastPracticedAt = occurredAt; metadata.practiceCount += 1; }
  if (isReviewActivity) { metadata.lastReviewedAt = occurredAt; metadata.reviewCount += 1; metadata.lastReviewMethod = activityType; }
  if (hasIndependent) metadata.independentSuccessCount += 1;
  if (hasAssisted) metadata.assistedSuccessCount += 1;
  if (hasDifficulty) metadata.difficultyCount += 1;
  metadata.lastPerformance = highQuality?.type || (hasIndependent ? "independent_practice" : hasAssisted ? "assisted_practice" : hasDifficulty ? "difficulty" : evidence.at(-1)?.type || metadata.lastPerformance);
  if (Number.isFinite(Number(payload.masteryAfter)) && Number(payload.masteryBefore) !== Number(payload.masteryAfter)) metadata.lastMasteryChangedAt = occurredAt;
  if (sourceRecordId) metadata.appliedActivityIds = [...metadata.appliedActivityIds, sourceRecordId].slice(-100);
  metadata.stabilityUpdatedAt = occurredAt;
  refreshNodeReviewState(node, occurredAt);
  map.metadata = { ...(map.metadata || {}), lastActivityAt: occurredAt, lastActivityType: activityType, lastActivityNodeId: node.id, reviewMetadataVersion: REVIEW_CONFIG.metadataVersion };
  return { ok: true, node, metadata };
}

export function getReviewCandidatesForMap(appData, mapId, now = Date.now()) {
  const map = (appData?.maps || []).find((item) => item.id === mapId);
  if (!map) return [];
  const candidates = [];
  const walk = (node) => { if (!(node.children || []).length) { const metadata = refreshNodeReviewState(node, now); if (metadata.reviewStatus !== "uninitialized") candidates.push({ mapId, nodeId: node.id, title: node.title, reviewStatus: metadata.reviewStatus, reviewPriority: metadata.reviewPriority, nextSuggestedReviewAt: metadata.nextSuggestedReviewAt }); } else (node.children || []).forEach(walk); };
  walk(map.rootNode);
  return candidates.sort((a, b) => b.reviewPriority - a.reviewPriority);
}

export function getReviewCandidatesAcrossMaps(appData, now = Date.now()) {
  return (appData?.maps || []).flatMap((map) => getReviewCandidatesForMap(appData, map.id, now)).sort((a, b) => b.reviewPriority - a.reviewPriority);
}
