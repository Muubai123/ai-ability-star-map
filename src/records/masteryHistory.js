import { getLearningRecordsByNodeId } from "./learningRecordStore.js";

export function getMasteryHistoryByNodeId(appData, mapId, nodeId) {
  return getLearningRecordsByNodeId(appData, mapId, nodeId).flatMap((record) => record.masteryChanges
    .filter((change) => change.nodeId === nodeId)
    .map((change) => ({ ...change, recordId: record.id, type: record.type, typeLabel: record.typeLabel, date: record.endedAt || record.createdAt, summary: record.summary, applied: change.accepted !== null && change.accepted !== undefined && change.accepted !== change.before }))
  ).sort((a, b) => new Date(b.date) - new Date(a.date));
}
