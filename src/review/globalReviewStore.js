import { getMapById, saveAppData } from "../appData.js";

const activeStatuses = new Set(["draft", "analyzing", "selecting", "active", "paused"]);
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createGlobalReviewQueue(rawInput = "") {
  const timestamp = now();
  return { id: id("review-queue"), type: "global_review", status: rawInput ? "analyzing" : "draft", createdAt: timestamp, updatedAt: timestamp, completedAt: null, rawInput, analysisSummary: "", subjectGroups: [], unmatchedTopics: [], items: [], activeItemId: null, feedbacks: [] };
}

export function getReviewQueueById(data, queueId) { return data.reviewQueues.find((queue) => queue.id === queueId) || null; }
export function getActiveGlobalReviewQueue(data) { return data.reviewQueues.find((queue) => activeStatuses.has(queue.status)) || null; }

export function saveReviewQueue(data, queue) {
  queue.updatedAt = now();
  const index = data.reviewQueues.findIndex((item) => item.id === queue.id);
  if (index === -1) data.reviewQueues.unshift(queue); else data.reviewQueues[index] = queue;
  saveAppData(data);
  return queue;
}

export function setQueueItemStatus(data, queueId, itemId, status) {
  const queue = getReviewQueueById(data, queueId); const item = queue?.items.find((entry) => entry.id === itemId);
  if (!item) return null;
  item.status = status;
  if (status !== "active" && queue.activeItemId === itemId) queue.activeItemId = null;
  return saveReviewQueue(data, queue);
}

export function moveQueueItem(data, queueId, itemId, direction) {
  const queue = getReviewQueueById(data, queueId); if (!queue) return null;
  const priorities = queue.items.filter((item) => item.status === "priority").sort((a, b) => a.order - b.order);
  const index = priorities.findIndex((item) => item.id === itemId); const target = priorities[index + direction];
  if (index < 0 || !target) return queue;
  [priorities[index].order, target.order] = [target.order, priorities[index].order];
  return saveReviewQueue(data, queue);
}

export function getNextQueueItem(queue) {
  return queue.items.find((item) => item.id === queue.activeItemId) || queue.items.filter((item) => item.status === "priority").sort((a, b) => a.order - b.order)[0] || null;
}

export function activateQueueItem(data, queueId, itemId = "") {
  const queue = getReviewQueueById(data, queueId); if (!queue) return null;
  const item = itemId ? queue.items.find((entry) => entry.id === itemId) : getNextQueueItem(queue);
  if (!item || !getMapById(data, item.mapId)) { if (item) item.status = "invalid"; saveReviewQueue(data, queue); return null; }
  queue.items.forEach((entry) => { if (entry.status === "active") entry.status = "priority"; });
  item.status = "active"; queue.activeItemId = item.id; queue.status = "active";
  saveReviewQueue(data, queue); return { queue, item };
}

export function pauseReviewQueue(data, queueId) { const queue = getReviewQueueById(data, queueId); if (!queue) return null; queue.status = "paused"; return saveReviewQueue(data, queue); }
export function resumeReviewQueue(data, queueId) { const queue = getReviewQueueById(data, queueId); if (!queue) return null; queue.status = queue.activeItemId ? "active" : (queue.items.length ? "selecting" : "draft"); return saveReviewQueue(data, queue); }

export function completeReviewQueueItem(data, queueId, itemId, record, feedback) {
  const queue = getReviewQueueById(data, queueId); const item = queue?.items.find((entry) => entry.id === itemId); if (!item) return null;
  item.status = "completed"; item.reviewRecordId = record?.id || null; item.completedAt = now();
  item.reviewDraft = null;
  item.resultSummary = { coveredNodes: record?.nodeIds?.length || 0, masteryUpdates: record?.masteryChanges?.filter((change) => change.accepted !== change.before).length || 0, newNodes: record?.newNodes?.length || 0, recordSummary: record?.summary || "" };
  queue.activeItemId = null; queue.status = "selecting";
  if (feedback) queue.feedbacks = [...(queue.feedbacks || []), feedback];
  return saveReviewQueue(data, queue);
}

export function completeReviewQueue(data, queueId) {
  const queue = getReviewQueueById(data, queueId); if (!queue) return null;
  queue.status = "completed"; queue.completedAt = now(); queue.activeItemId = null;
  const completed = queue.items.filter((item) => item.status === "completed");
  const record = { id: id("global-review"), type: "global_review", mapId: null, mapIds: queue.items.map((item) => item.mapId), createdAt: queue.createdAt, endedAt: queue.completedAt, rawInput: queue.rawInput, summary: queue.analysisSummary, completedMapIds: completed.map((item) => item.mapId), deferredMapIds: queue.items.filter((item) => item.status === "deferred").map((item) => item.mapId), ignoredMapIds: queue.items.filter((item) => item.status === "ignored").map((item) => item.mapId), childRecordIds: completed.map((item) => item.reviewRecordId).filter(Boolean), unmatchedTopics: queue.unmatchedTopics || [], sourceQueueId: queue.id };
  data.learningRecords.unshift(record); saveReviewQueue(data, queue); return { queue, record };
}

export function cancelReviewQueue(data, queueId) { const queue = getReviewQueueById(data, queueId); if (!queue) return null; queue.status = "cancelled"; queue.activeItemId = null; return saveReviewQueue(data, queue); }
