const TYPE_LABELS = {
  exploration: "探索",
  single_review: "单图复盘",
  global_review_item: "全局复盘子项",
  global_review: "全局复盘总结",
  manual_mastery_adjustment: "手动熟练度校正",
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value ?? "").trim();
}

function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function findPath(root, nodeId, trail = []) {
  if (!root) return null;
  const next = [...trail, root];
  if (root.id === nodeId) return next;
  for (const child of root.children || []) {
    const found = findPath(child, nodeId, next);
    if (found) return found;
  }
  return null;
}

function getMap(maps, mapId) {
  return asArray(maps).find((map) => map.id === mapId) || null;
}

function sourceType(record) {
  if (record?.sourceKind === "exploration_session" || record?.plan || record?.review?.masterySuggestion) return "exploration";
  return TYPE_LABELS[record?.type] ? record.type : "single_review";
}

function getNodeIds(record) {
  const ids = [
    ...asArray(record?.nodeIds),
    ...asArray(record?.affectedNodeIds),
    record?.nodeId,
    ...asArray(record?.masteryChanges).map((change) => change?.nodeId),
    ...asArray(record?.nodeActivityUpdates).map((update) => update?.nodeId),
  ].filter(Boolean).map(String);
  return [...new Set(ids)];
}

function buildSnapshots(record, maps, nodeIds) {
  const map = getMap(maps, record?.mapId);
  const supplied = asArray(record?.nodeSnapshots).map((snapshot) => ({
    nodeId: asText(snapshot?.nodeId || snapshot?.id),
    title: asText(snapshot?.title),
    path: asArray(snapshot?.path).map(asText).filter(Boolean),
  })).filter((snapshot) => snapshot.nodeId || snapshot.title);
  const byId = new Map(supplied.filter((item) => item.nodeId).map((item) => [item.nodeId, item]));

  nodeIds.forEach((nodeId) => {
    if (byId.has(nodeId)) return;
    const path = findPath(map?.rootNode, nodeId);
    if (path) byId.set(nodeId, { nodeId, title: path.at(-1).title, path: path.map((node) => node.title) });
  });

  if (!supplied.length && record?.nodeTitle) {
    supplied.push({ nodeId: asText(record.nodeId), title: asText(record.nodeTitle), path: asArray(record.nodePath).map(asText).filter(Boolean) });
  }
  return [...byId.values(), ...supplied.filter((item) => !item.nodeId)];
}

export function normalizeLearningRecord(record, maps = []) {
  const type = sourceType(record);
  const nodeIds = getNodeIds(record);
  const map = getMap(maps, record?.mapId);
  const snapshots = buildSnapshots(record, maps, nodeIds);
  const startedAt = toDate(record?.startedAt);
  const activityOccurredAt = toDate(record?.activityOccurredAt || record?.endedAt || record?.createdAt);
  const endedAt = toDate(record?.endedAt || record?.activityOccurredAt || record?.updatedAt || record?.createdAt);
  const createdAt = toDate(record?.createdAt || record?.endedAt || record?.updatedAt) || new Date(0).toISOString();
  const duration = startedAt && endedAt ? Math.max(0, Math.round((new Date(endedAt) - new Date(startedAt)) / 60000)) : null;
  const explorationReview = record?.review || {};
  const masteryChanges = type === "exploration"
    ? (record?.masteryBefore === null || record?.masteryBefore === undefined ? [] : [{
      nodeId: record?.nodeId,
      before: record?.masteryBefore,
      suggested: explorationReview?.masterySuggestion?.after ?? null,
      accepted: record?.masteryAccepted,
      reason: explorationReview?.masterySuggestion?.reason || "",
    }])
    : asArray(record?.masteryChanges).map((change) => ({
      nodeId: change?.nodeId,
      before: change?.before ?? null,
      suggested: change?.suggested ?? null,
      accepted: change?.accepted ?? null,
      reason: asText(change?.reason),
    }));
  const mapExists = Boolean(map);
  const missingNodes = nodeIds.filter((id) => !findPath(map?.rootNode, id));

  return {
    id: String(record?.id || `unknown-${createdAt}`),
    sourceRecordId: String(record?.id || ""),
    sourceKind: record?.sourceKind || (type === "exploration" ? "exploration_session" : "learning_record"),
    type,
    typeLabel: TYPE_LABELS[type] || "学习记录",
    title: asText(record?.title) || (type === "exploration" ? `探索：${record?.nodeTitle || "未命名节点"}` : TYPE_LABELS[type] || "学习记录"),
    mapId: record?.mapId || null,
    mapTitle: asText(record?.mapTitle) || map?.title || (record?.mapId ? "原星图已不存在" : "跨星图"),
    nodeIds,
    affectedNodeIds: nodeIds,
    nodeActivityUpdates: asArray(record?.nodeActivityUpdates),
    activityOccurredAt,
    nodeSnapshots: snapshots,
    createdAt,
    startedAt,
    endedAt,
    durationMinutes: duration,
    summary: asText(record?.summary || explorationReview?.summary || record?.plan?.goal),
    rawInput: asText(record?.rawInput || record?.reflection || record?.plan?.goal),
    evidence: type === "exploration" ? asArray(explorationReview?.evidence || record?.evidence) : asArray(record?.evidence),
    tasks: type === "exploration" ? asArray(record?.plan?.tasks) : [],
    masteryChanges,
    newNodes: type === "exploration" ? asArray(explorationReview?.mapChanges).filter((change) => change?.type === "add_child") : asArray(record?.newNodes),
    remainingProblems: type === "exploration" ? asArray(explorationReview?.unfinishedTasks) : asArray(record?.remainingProblems),
    nextSuggestions: type === "exploration" ? [explorationReview?.nextSuggestion].filter(Boolean) : asArray(record?.nextSuggestions),
    sourceSessionId: record?.sourceSessionId || (type === "exploration" ? record?.id : null),
    sourceQueueId: record?.sourceQueueId || null,
    sourceQueueItemId: record?.sourceQueueItemId || null,
    childRecordIds: asArray(record?.childRecordIds),
    status: record?.status === "cancelled" ? "cancelled" : type === "exploration" && record?.status !== "completed" ? "partial" : "completed",
    mapExists,
    isOrphaned: (Boolean(record?.mapId) && !mapExists) || missingNodes.length > 0,
    missingNodeIds: missingNodes,
    rawRecord: record,
  };
}

export function buildLearningRecordViewModel(record, maps = []) {
  return normalizeLearningRecord(record, maps);
}

export function repairLearningRecordReferences(record, maps = []) {
  const view = normalizeLearningRecord(record, maps);
  return {
    ...view,
    repair: {
      mapFound: !view.mapId || !view.isOrphaned || Boolean(getMap(maps, view.mapId)),
      missingNodeIds: view.missingNodeIds,
      canOpenOnMap: Boolean(getMap(maps, view.mapId)),
    },
  };
}

export function validateLearningRecord(record, maps = []) {
  const view = normalizeLearningRecord(record, maps);
  return { valid: Boolean(view.id && view.type), issues: view.isOrphaned ? ["关联的星图或部分节点已不存在"] : [], view };
}

// Read-only repair pass for legacy records: it rebuilds view snapshots without changing saved history.
export function repairLearningRecordSnapshots(records, maps = []) {
  return asArray(records).map((record) => repairLearningRecordReferences(record, maps));
}
