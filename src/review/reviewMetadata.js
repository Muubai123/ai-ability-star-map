import { KNOWLEDGE_TYPES, REVIEW_CONFIG } from "./reviewConfig.js";

const KEYWORDS = {
  memory: ["单词", "词汇", "术语", "公式", "符号", "定义记忆", "年代", "名词"],
  problem_solving: ["习题", "题型", "解题", "计算", "证明", "推导", "算法题", "练习"],
  operation: ["操作", "使用", "配置", "安装", "实验", "编程实践", "调试", "流程"],
  output: ["写作", "表达", "口语", "讲解", "演讲", "创作", "设计", "输出"],
  understanding: ["概念", "原理", "机制", "理论", "理解", "关系", "定理"],
};

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toPastIso(value) {
  const iso = toIso(value);
  return iso && new Date(iso).getTime() <= Date.now() ? iso : null;
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeReviewPriority(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return numberInRange(number > 1 ? number / 100 : number, 0, 1, 0);
}

export function inferLegacyNodeKnowledgeType(node) {
  const text = `${node?.title || ""} ${node?.description || ""}`.toLowerCase();
  for (const [type, keywords] of Object.entries(KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) return type;
  }
  return REVIEW_CONFIG.defaultKnowledgeType;
}

export function createReviewMetadata(node = {}, options = {}) {
  const existing = node.reviewMetadata || {};
  const rawType = existing.knowledgeType || node.knowledgeType;
  const knowledgeType = KNOWLEDGE_TYPES.has(rawType) ? rawType : inferLegacyNodeKnowledgeType(node);
  const inferred = !KNOWLEDGE_TYPES.has(rawType);
  return {
    metadataVersion: REVIEW_CONFIG.metadataVersion,
    knowledgeType,
    knowledgeTypeConfidence: numberInRange(existing.knowledgeTypeConfidence ?? node.knowledgeTypeConfidence, 0, 1, inferred ? 0.4 : 0.7),
    knowledgeTypeSource: existing.knowledgeTypeSource || node.knowledgeTypeSource || (options.aiGenerated ? "ai_generated" : inferred ? "migrated_default" : "ai_inferred"),
    lastLearnedAt: toPastIso(existing.lastLearnedAt),
    lastPracticedAt: toPastIso(existing.lastPracticedAt),
    lastReviewedAt: toPastIso(existing.lastReviewedAt),
    lastMasteryChangedAt: toPastIso(existing.lastMasteryChangedAt),
    stability: existing.stability === null || existing.stability === undefined ? null : numberInRange(existing.stability, 0, 1, null),
    stabilityUpdatedAt: toPastIso(existing.stabilityUpdatedAt),
    reviewStatus: ["uninitialized", "stable", "watch", "due", "priority"].includes(existing.reviewStatus) ? existing.reviewStatus : "uninitialized",
    reviewPriority: normalizeReviewPriority(existing.reviewPriority),
    baseIntervalDays: numberInRange(existing.baseIntervalDays, 1, 365, REVIEW_CONFIG.baseIntervalDays[knowledgeType]),
    nextSuggestedReviewAt: toIso(existing.nextSuggestedReviewAt),
    practiceCount: Math.max(0, Math.floor(Number(existing.practiceCount) || 0)),
    reviewCount: Math.max(0, Math.floor(Number(existing.reviewCount) || 0)),
    difficultyCount: Math.max(0, Math.floor(Number(existing.difficultyCount) || 0)),
    independentSuccessCount: Math.max(0, Math.floor(Number(existing.independentSuccessCount) || 0)),
    assistedSuccessCount: Math.max(0, Math.floor(Number(existing.assistedSuccessCount) || 0)),
    lastPerformance: existing.lastPerformance || null,
    lastReviewMethod: existing.lastReviewMethod || null,
    lastReviewDecision: existing.lastReviewDecision || null,
    appliedActivityIds: Array.isArray(existing.appliedActivityIds) ? [...new Set(existing.appliedActivityIds.map(String))].slice(-500) : [],
  };
}

export function ensureNodeReviewMetadata(node, options = {}) {
  if (!node || typeof node !== "object") return null;
  if (node.reviewMetadata?.metadataVersion === REVIEW_CONFIG.metadataVersion) {
    return node.reviewMetadata;
  }
  node.reviewMetadata = createReviewMetadata(node, options);
  delete node.knowledgeType;
  delete node.knowledgeTypeConfidence;
  delete node.knowledgeTypeSource;
  return node.reviewMetadata;
}

export function migrateNodeReviewMetadata(node) {
  if (!node || typeof node !== "object") return node;
  ensureNodeReviewMetadata(node);
  (node.children || []).forEach(migrateNodeReviewMetadata);
  return node;
}

export function getDominantKnowledgeType(node) {
  const children = node?.children || [];
  if (!children.length) return ensureNodeReviewMetadata(node)?.knowledgeType || REVIEW_CONFIG.defaultKnowledgeType;
  const counts = new Map();
  children.forEach((child) => {
    const type = getDominantKnowledgeType(child);
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || REVIEW_CONFIG.defaultKnowledgeType;
}

export function ensureMapReviewMetadata(map) {
  if (!map?.rootNode) return map;
  migrateNodeReviewMetadata(map.rootNode);
  map.metadata = { ...(map.metadata || {}), reviewMetadataVersion: REVIEW_CONFIG.metadataVersion };
  return map;
}
