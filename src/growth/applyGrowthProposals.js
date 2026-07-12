import { getMapMetadata, getMapById, saveAppData } from "../appData.js";
import { createReviewMetadata } from "../review/reviewMetadata.js";
import { findExactDuplicateNodes, findPossibleDuplicateNodes, collectNodes } from "./duplicateNodeDetector.js";
import { createGrowthProposalId, normalizeGrowthProposal, validateGrowthProposal } from "./growthProposal.js";

function findNode(root, nodeId) {
  return collectNodes(root).find((item) => item.node.id === nodeId)?.node || null;
}

function findParent(root, nodeId) {
  return collectNodes(root).find((item) => item.node.children?.some((child) => child.id === nodeId))?.node || null;
}

function createNodeId(root, title) {
  const existing = new Set(collectNodes(root).map((item) => item.node.id));
  const base = String(title || "node").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "node";
  let id = `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  while (existing.has(id)) id = `${base}-${Math.random().toString(36).slice(2, 9)}`;
  return id;
}

export function applyGrowthProposals(appData, input = {}) {
  const map = getMapById(appData, input.mapId);
  if (!map) return { success: false, errors: ["找不到目标星图。"], createdNodeIds: [], mappedNodeIds: [], noteResults: [], skippedProposalIds: [] };
  const sourceRecordId = String(input.sourceRecordId || "").trim();
  const proposals = (input.proposals || []).map((item) => normalizeGrowthProposal(item));
  if (!proposals.some((proposal) => ["accepted", "edited", "rejected"].includes(proposal.status))) {
    return { success: true, createdNodeIds: [], mappedNodeIds: [], noteResults: [], skippedProposalIds: [], growthRecordId: null, errors: [] };
  }
  const previous = (appData.growthRecords || []).find((record) => sourceRecordId && record.sourceRecordId === sourceRecordId);
  if (previous) return { success: true, idempotent: true, createdNodeIds: previous.createdNodeIds || [], mappedNodeIds: previous.mappedNodeIds || [], noteResults: previous.noteResults || [], skippedProposalIds: previous.rejectedProposalIds || [], growthRecordId: previous.id, errors: [] };

  const originalRoot = map.rootNode;
  const draftRoot = structuredClone(originalRoot);
  const createdNodeIds = [];
  const mappedNodeIds = [];
  const noteResults = [];
  const skippedProposalIds = [];
  const errors = [];
  const applied = [];

  for (const rawProposal of proposals) {
    if (!["accepted", "edited"].includes(rawProposal.status)) {
      if (rawProposal.status === "rejected") skippedProposalIds.push(rawProposal.proposalId);
      continue;
    }
    const check = validateGrowthProposal(rawProposal);
    const proposal = check.proposal;
    if (!check.valid) { errors.push(...check.errors.map((error) => `${proposal.title || "未命名提案"}：${error}`)); continue; }

    if (proposal.action === "map_existing") {
      if (!findNode(draftRoot, proposal.mappedNodeId)) { errors.push(`映射目标不存在：${proposal.title || proposal.mappedNodeId}`); continue; }
      mappedNodeIds.push(proposal.mappedNodeId); applied.push(proposal); continue;
    }
    if (proposal.action === "add_note") {
      const parent = findNode(draftRoot, proposal.parentNodeId || input.sourceNodeId);
      if (!parent) { errors.push("备注目标节点不存在。"); continue; }
      parent.growthNotes = Array.isArray(parent.growthNotes) ? parent.growthNotes : [];
      parent.growthNotes.push({ id: createGrowthProposalId("note"), content: proposal.description || proposal.title, createdAt: new Date().toISOString(), source: "growth" });
      noteResults.push({ proposalId: proposal.proposalId, nodeId: parent.id }); applied.push(proposal); continue;
    }

    const targetParentId = proposal.action === "create_sibling"
      ? findParent(draftRoot, proposal.parentNodeId || input.sourceNodeId)?.id
      : proposal.parentNodeId;
    const parent = findNode(draftRoot, targetParentId);
    if (!parent) { errors.push(`新增节点的父节点不存在：${proposal.title}`); continue; }
    const exact = findExactDuplicateNodes(draftRoot, parent.id, proposal.title);
    if (exact.length) { errors.push(`“${proposal.title}”与当前父节点下已有节点重名。`); continue; }
    const node = {
      id: createNodeId(draftRoot, proposal.title),
      title: proposal.title,
      description: proposal.description,
      mastery: proposal.applySuggestedMastery ? Math.min(2, proposal.suggestedMastery) : 0,
      weight: proposal.weight,
      children: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reviewMetadata: createReviewMetadata({
        title: proposal.title,
        description: proposal.description,
        reviewMetadata: {
          knowledgeType: proposal.knowledgeType,
          knowledgeTypeConfidence: proposal.knowledgeTypeConfidence,
          knowledgeTypeSource: proposal.createdBy === "user" ? "user" : "ai_inferred",
        },
      }, { aiGenerated: proposal.createdBy !== "user" }),
      growthMetadata: {
        createdBy: proposal.createdBy,
        triggerType: input.triggerType || "user_manual",
        sourceNodeId: input.sourceNodeId || null,
        sourceRecordId: sourceRecordId || null,
        sourceSessionId: input.sourceSessionId || null,
        knowledgeBaseIds: Array.isArray(input.knowledgeBaseIds) ? input.knowledgeBaseIds : [],
        sourceTypes: proposal.sourceTypes,
        sourceUrls: [],
        proposalReason: proposal.reason,
        createdAt: new Date().toISOString(),
      },
    };
    parent.children = Array.isArray(parent.children) ? parent.children : [];
    parent.children.push(node);
    createdNodeIds.push(node.id);
    applied.push({ ...proposal, createdNodeId: node.id, possibleDuplicates: findPossibleDuplicateNodes(originalRoot, proposal.title) });
  }

  if (errors.length) return { success: false, createdNodeIds: [], mappedNodeIds: [], noteResults: [], skippedProposalIds, errors };
  const growthRecord = {
    id: createGrowthProposalId("growth"),
    mapId: map.id,
    triggerType: input.triggerType || "user_manual",
    sourceNodeId: input.sourceNodeId || null,
    sourceRecordId: sourceRecordId || null,
    sourceSessionId: input.sourceSessionId || null,
    proposalSnapshot: proposals,
    createdNodeIds,
    mappedNodeIds: [...new Set(mappedNodeIds)],
    noteResults,
    rejectedProposalIds: skippedProposalIds,
    createdAt: new Date().toISOString(),
  };
  const previousRoot = map.rootNode;
  const previousMetadata = map.metadata;
  const previousRecords = appData.growthRecords || [];
  try {
    map.rootNode = draftRoot;
    map.updatedAt = new Date().toISOString();
    map.metadata = getMapMetadata(draftRoot, previousMetadata);
    appData.growthRecords = [growthRecord, ...previousRecords];
    saveAppData(appData);
  } catch (error) {
    map.rootNode = previousRoot;
    map.metadata = previousMetadata;
    appData.growthRecords = previousRecords;
    return { success: false, createdNodeIds: [], mappedNodeIds: [], noteResults: [], skippedProposalIds, errors: [`保存生长结果失败：${error.message}`] };
  }
  return { success: true, createdNodeIds, mappedNodeIds: [...new Set(mappedNodeIds)], noteResults, skippedProposalIds, growthRecordId: growthRecord.id, errors };
}
