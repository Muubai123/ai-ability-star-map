import { loadExplorationSessions } from "../exploration/explorationStorage.js";
import { buildLearningRecordViewModel, normalizeLearningRecord, validateLearningRecord } from "./learningRecordNormalizer.js";
import { applyLearningActivityToNode, normalizeLearningEvidence } from "../review/reviewActivity.js";

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
  if (!record?.mapId) return [];
  const evidence = normalizeLearningEvidence(record.evidence);
  const changes = new Map((record.masteryChanges || []).filter((change) => change?.nodeId).map((change) => [change.nodeId, change]));
  const nodeIds = [...new Set([...(record.nodeIds || []), ...changes.keys()].filter(Boolean))];
  const activityType = record.type === "manual_mastery_adjustment" ? "manual_adjustment" : record.type || "practice";
  return nodeIds.map((nodeId) => {
    const change = changes.get(nodeId);
    return applyLearningActivityToNode(appData, {
      mapId: record.mapId,
      nodeId,
      activityType,
      occurredAt: record.endedAt || record.createdAt,
      evidence,
      masteryBefore: change?.before,
      masteryAfter: change?.accepted,
      sourceRecordId: record.id ? `${record.id}:${nodeId}` : "",
    });
  });
}

export function deleteLearningRecord(appData, recordId) {
  const deleted = (appData.learningRecords || []).find((record) => record.id === recordId);
  appData.learningRecords = (appData.learningRecords || []).filter((record) => record.id !== recordId);
  if (deleted?.mapId) rebuildMapLearningMetadata(appData, deleted.mapId);
}

export function touchMapLearningMetadata(appData, record) {
  const map = (appData?.maps || []).find((item) => item.id === record?.mapId);
  if (!map) return;
  map.metadata = {
    ...(map.metadata || {}),
    lastActivityAt: record.endedAt || record.createdAt || new Date().toISOString(),
    lastActivityType: record.type || null,
    lastActivityNodeId: record.nodeIds?.[0] || null,
    learningRecordCount: (appData.learningRecords || []).filter((item) => item.mapId === map.id).length,
  };
}

export function rebuildMapLearningMetadata(appData, mapId) {
  const map = (appData?.maps || []).find((item) => item.id === mapId);
  if (!map) return;
  const records = (appData.learningRecords || []).filter((record) => record.mapId === mapId).sort((a, b) => new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt));
  const latest = records[0];
  map.metadata = {
    ...(map.metadata || {}),
    learningRecordCount: records.length,
    lastActivityAt: latest?.endedAt || latest?.createdAt || map.metadata?.lastActivityAt || null,
    lastActivityType: latest?.type || null,
    lastActivityNodeId: latest?.nodeIds?.[0] || null,
  };
}
