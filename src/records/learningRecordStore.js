import { loadExplorationSessions } from "../exploration/explorationStorage.js";
import { buildLearningRecordViewModel, normalizeLearningRecord, validateLearningRecord } from "./learningRecordNormalizer.js";
import { applyLearningActivityToNode, normalizeLearningEvidence } from "../review/reviewActivity.js";
import { createReviewMetadata } from "../review/reviewMetadata.js";

const REAL_LEARNING_TYPES = new Set(["exploration", "single_review", "global_review_item", "dedicated_review"]);

function findNode(root, nodeId) {
  if (!root) return null;
  if (root.id === nodeId) return root;
  for (const child of root.children || []) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

function isRealLearningRecord(record) {
  return record?.status !== "cancelled" && REAL_LEARNING_TYPES.has(record?.type);
}

export function getLearningRecords(appData) {
  const persisted = (appData?.learningRecords || []).map((record) => buildLearningRecordViewModel(record, appData?.maps || []));
  const sourceIds = new Set(persisted.map((record) => record.sourceSessionId).filter(Boolean));
  const explorations = loadExplorationSessions()
    .filter((session) => session.status === "completed" && !sourceIds.has(session.id))
    .map((session) => normalizeLearningRecord({ ...session, sourceKind: "exploration_session" }, appData?.maps || []));
  return [...persisted, ...explorations].sort((a, b) => new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt));
}

export function getLearningRecordById(appData, id) {
  return getLearningRecords(appData).find((record) => record.id === id) || null;
}

export function getLearningRecordsByNodeId(appData, mapId, nodeId) {
  return getLearningRecords(appData).filter((record) => record.mapId === mapId && record.nodeIds.includes(nodeId));
}

export function getRecentLearningRecords(appData, limit = 5) { return getLearningRecords(appData).slice(0, limit); }

export function getLearningRecordStatsByMap(appData, mapId) {
  const records = getLearningRecords(appData).filter((record) => record.mapId === mapId);
  const latest = records[0];
  const latestChange = records.flatMap((record) => record.masteryChanges.map((change) => ({ ...change, record }))).find((change) => change.accepted !== null && change.accepted !== undefined);
  return { count: records.length, latest, latestChange };
}

export function findOrphanedLearningRecords(appData) { return getLearningRecords(appData).filter((record) => record.isOrphaned); }
export function validateAllLearningRecords(appData) { return (appData?.learningRecords || []).map((record) => validateLearningRecord(record, appData?.maps || [])); }

export function addLearningRecord(appData, record) {
  appData.learningRecords = Array.isArray(appData.learningRecords) ? appData.learningRecords : [];
  const existing = appData.learningRecords.find((item) => item.id === record.id);
  if (existing) return existing;
  appData.learningRecords.unshift(record);
  applyLearningRecordActivities(appData, record);
  touchMapLearningMetadata(appData, record);
  return record;
}

export function applyLearningRecordActivities(appData, record) {
  if (!record?.mapId || record.type === "global_review" || record.status === "cancelled") return [];
  const evidence = normalizeLearningEvidence(record.evidence);
  const changes = new Map((record.masteryChanges || []).filter((change) => change?.nodeId).map((change) => [change.nodeId, change]));
  const activityUpdates = new Map((record.nodeActivityUpdates || []).filter((update) => update?.nodeId).map((update) => [update.nodeId, update]));
  const createdNodeIds = new Set(record.createdNodeIds || []);
  const nodeIds = [...new Set([
    ...(record.nodeIds || []),
    ...(record.affectedNodeIds || []),
    ...changes.keys(),
    ...activityUpdates.keys(),
  ].filter(Boolean))];
  const activityType = record.type === "manual_mastery_adjustment" ? "manual_adjustment" : record.type || "practice";
  return nodeIds.flatMap((nodeId) => {
    const change = changes.get(nodeId);
    const update = activityUpdates.get(nodeId);
    const acceptedMastery = change?.accepted ?? update?.masteryAfter;
    if (createdNodeIds.has(nodeId) && !update && !(Number(acceptedMastery) > 0)) return [];
    return [applyLearningActivityToNode(appData, {
      mapId: record.mapId,
      nodeId,
      activityType: update?.activityType || activityType,
      activityOccurredAt: update?.activityOccurredAt || record.activityOccurredAt || record.endedAt || record.createdAt,
      evidence: update?.evidence || evidence,
      masteryBefore: change?.before ?? update?.masteryBefore,
      masteryAfter: acceptedMastery,
      sourceRecordId: record.id ? `${record.id}:${nodeId}` : "",
    })];
  });
}

export function deleteLearningRecord(appData, recordId) {
  const deleted = (appData.learningRecords || []).find((record) => record.id === recordId);
  appData.learningRecords = (appData.learningRecords || []).filter((record) => record.id !== recordId);
  if (deleted?.mapId) {
    rebuildMapReviewMetadata(appData, deleted.mapId);
    rebuildMapLearningMetadata(appData, deleted.mapId);
  }
}

export function rebuildMapReviewMetadata(appData, mapId) {
  const map = (appData?.maps || []).find((item) => item.id === mapId);
  if (!map?.rootNode) return;
  const reset = (node) => {
    const previous = node.reviewMetadata || {};
    node.reviewMetadata = createReviewMetadata({
      title: node.title,
      description: node.description,
      reviewMetadata: {
        knowledgeType: previous.knowledgeType,
        knowledgeTypeConfidence: previous.knowledgeTypeConfidence,
        knowledgeTypeSource: previous.knowledgeTypeSource,
        baseIntervalDays: previous.baseIntervalDays,
      },
    });
    (node.children || []).forEach(reset);
  };
  reset(map.rootNode);
  (appData.learningRecords || [])
    .filter((record) => record.mapId === mapId)
    .slice()
    .sort((a, b) => new Date(a.activityOccurredAt || a.endedAt || a.createdAt || 0) - new Date(b.activityOccurredAt || b.endedAt || b.createdAt || 0))
    .forEach((record) => applyLearningRecordActivities(appData, record));
}

export function touchMapLearningMetadata(appData, record) {
  const map = (appData?.maps || []).find((item) => item.id === record?.mapId);
  if (!map || !isRealLearningRecord(record)) return;
  const activityAt = record.activityOccurredAt || record.endedAt || record.createdAt;
  const learnedNodeId = record.affectedNodeIds?.[0] || record.nodeIds?.[0] || null;
  const learnedNode = findNode(map.rootNode, learnedNodeId);
  const recentLearnedNodeIds = [...new Set([
    ...((record.affectedNodeIds || record.nodeIds || []).filter(Boolean)),
    ...(map.metadata?.recentLearnedNodeIds || []),
  ])].slice(0, 12);
  map.metadata = {
    ...(map.metadata || {}),
    lastActivityAt: activityAt,
    lastActivityType: record.type || null,
    lastActivityNodeId: learnedNodeId,
    lastLearnedNodeId: learnedNodeId,
    lastLearnedNodeTitle: learnedNode?.title || null,
    lastLearningRecordId: record.id || null,
    recentLearnedNodeIds,
    learningRecordCount: (appData.learningRecords || []).filter((item) => item.mapId === map.id && isRealLearningRecord(item)).length,
  };
}

export function rebuildMapLearningMetadata(appData, mapId) {
  const map = (appData?.maps || []).find((item) => item.id === mapId);
  if (!map) return;
  const records = (appData.learningRecords || []).filter((record) => record.mapId === mapId && isRealLearningRecord(record)).sort((a, b) => new Date(b.activityOccurredAt || b.endedAt || b.createdAt) - new Date(a.activityOccurredAt || a.endedAt || a.createdAt));
  const latest = records[0];
  const latestNodeId = latest?.affectedNodeIds?.[0] || latest?.nodeIds?.[0] || null;
  const latestNode = findNode(map.rootNode, latestNodeId);
  map.metadata = {
    ...(map.metadata || {}),
    learningRecordCount: records.length,
    lastActivityAt: latest?.activityOccurredAt || latest?.endedAt || latest?.createdAt || null,
    lastActivityType: latest?.type || null,
    lastActivityNodeId: latestNodeId,
    lastLearnedNodeId: latestNodeId,
    lastLearnedNodeTitle: latestNode?.title || null,
    lastLearningRecordId: latest?.id || null,
    recentLearnedNodeIds: [...new Set(records.flatMap((record) => record.affectedNodeIds || record.nodeIds || []))].slice(0, 12),
  };
}
