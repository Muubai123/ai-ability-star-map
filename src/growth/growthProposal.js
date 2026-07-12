import { KNOWLEDGE_TYPES } from "../review/reviewConfig.js";

export const GROWTH_ACTIONS = new Set([
  "create_child",
  "create_sibling",
  "map_existing",
  "add_note",
]);

export const KNOWLEDGE_TYPE_LABELS = {
  memory: "记忆型",
  understanding: "理解型",
  problem_solving: "解题型",
  operation: "操作型",
  output: "输出型",
  mixed: "混合型",
};

export function createGrowthProposalId(prefix = "proposal") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

export function normalizeGrowthProposal(value = {}, defaults = {}) {
  const safe = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const action = GROWTH_ACTIONS.has(safe.action) ? safe.action : "create_child";
  const sourceTypes = Array.isArray(safe.sourceTypes)
    ? safe.sourceTypes.map(String).filter(Boolean).slice(0, 8)
    : [];
  const knowledgeType = KNOWLEDGE_TYPES.has(safe.knowledgeType)
    ? safe.knowledgeType
    : "mixed";

  return {
    proposalId: String(safe.proposalId || defaults.proposalId || createGrowthProposalId()).trim(),
    action,
    title: String(safe.title || "").trim().slice(0, 80),
    description: String(safe.description || "").trim().slice(0, 500),
    parentNodeId: String(safe.parentNodeId || defaults.parentNodeId || "").trim(),
    parentPath: Array.isArray(safe.parentPath)
      ? safe.parentPath.map(String).filter(Boolean).slice(-10)
      : (defaults.parentPath || []),
    mappedNodeId: String(safe.mappedNodeId || "").trim(),
    knowledgeType,
    knowledgeTypeConfidence: clampNumber(safe.knowledgeTypeConfidence, 0, 1, 0.5),
    weight: clampNumber(safe.weight, 0.5, 4, 1),
    suggestedMastery: clampNumber(safe.suggestedMastery, 0, 4, 0),
    applySuggestedMastery: Boolean(safe.applySuggestedMastery),
    masteryReason: String(safe.masteryReason || "").trim().slice(0, 400),
    reason: String(safe.reason || "").trim().slice(0, 500),
    evidence: Array.isArray(safe.evidence)
      ? safe.evidence.map((item) => String(item?.content || item || "").trim()).filter(Boolean).slice(0, 8)
      : [],
    sourceTypes,
    possibleDuplicateNodeIds: Array.isArray(safe.possibleDuplicateNodeIds)
      ? [...new Set(safe.possibleDuplicateNodeIds.map(String).filter(Boolean))].slice(0, 8)
      : [],
    confidence: clampNumber(safe.confidence, 0, 1, 0.5),
    status: ["pending", "accepted", "edited", "rejected"].includes(safe.status)
      ? safe.status
      : "pending",
    createdBy: safe.createdBy === "user" ? "user" : "ai_proposal",
  };
}

export function normalizeGrowthResponse(value = {}, defaults = {}) {
  const safe = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const proposals = (Array.isArray(safe.proposals) ? safe.proposals : [])
    .slice(0, 8)
    .map((proposal) => normalizeGrowthProposal(proposal, defaults))
    .filter((proposal) => proposal.title || proposal.action === "add_note");

  return {
    summary: String(safe.summary || "").trim().slice(0, 800),
    recommendation: ["propose_nodes", "add_note", "no_change"].includes(safe.recommendation)
      ? safe.recommendation
      : (proposals.length ? "propose_nodes" : "no_change"),
    proposals,
  };
}

export function makeManualGrowthProposal(defaults = {}) {
  return normalizeGrowthProposal({
    proposalId: createGrowthProposalId("manual"),
    action: "create_child",
    parentNodeId: defaults.parentNodeId,
    parentPath: defaults.parentPath,
    knowledgeType: defaults.knowledgeType || "mixed",
    weight: 1,
    suggestedMastery: 0,
    sourceTypes: ["user"],
    status: "edited",
    createdBy: "user",
  }, defaults);
}

export function validateGrowthProposal(proposal, options = {}) {
  const normalized = normalizeGrowthProposal(proposal, options);
  const errors = [];
  if (!normalized.parentNodeId && normalized.action !== "map_existing") errors.push("请选择写入位置。");
  if (["create_child", "create_sibling"].includes(normalized.action) && !normalized.title) {
    errors.push("新增节点需要名称。");
  }
  if (normalized.action === "map_existing" && !normalized.mappedNodeId) {
    errors.push("请选择要映射的已有节点。");
  }
  return { proposal: normalized, valid: !errors.length, errors };
}
