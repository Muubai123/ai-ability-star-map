import { getDisplayMastery } from "./utils/mapUtils.js";
import { validateAndNormalizeMap } from "./utils/jsonUtils.js";
import { applyLearningActivityToNode } from "./review/reviewActivity.js";

export const APP_DATA_KEY = "aiAbilityStarMap.appData";
const LEGACY_KEYS = ["aiAbilityStarMap.currentMap", "aiAbilityStarMap.sessions"];

function mapId(prefix = "map") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

function walk(node, stats) {
  stats.totalNodes += 1;
  const children = node.children || [];
  if (!children.length) {
    stats.leafNodeCount += 1;
    if (getDisplayMastery(node) > 0) stats.touchedLeaves += 1;
  }
  stats.masteryTotal += getDisplayMastery(node);
  children.forEach((child) => walk(child, stats));
}

export function getMapMetadata(rootNode, previous = {}) {
  const stats = { totalNodes: 0, leafNodeCount: 0, touchedLeaves: 0, masteryTotal: 0 };
  walk(rootNode, stats);
  return {
    totalNodes: stats.totalNodes,
    leafNodeCount: stats.leafNodeCount,
    masteryAverage: stats.totalNodes ? Number((stats.masteryTotal / stats.totalNodes).toFixed(2)) : 0,
    coverage: stats.leafNodeCount ? Number((stats.touchedLeaves / stats.leafNodeCount).toFixed(2)) : 0,
    lastActivityAt: previous.lastActivityAt || new Date().toISOString(),
    lastSelectedNodeId: previous.lastSelectedNodeId || null,
    lastActivityType: previous.lastActivityType || null,
    lastActivityNodeId: previous.lastActivityNodeId || null,
    learningRecordCount: Number(previous.learningRecordCount) || 0,
    reviewMetadataVersion: Number(previous.reviewMetadataVersion) || 1,
  };
}

export function makeMap(rootNode, details = {}) {
  const normalizedRoot = validateAndNormalizeMap(rootNode);
  const now = new Date().toISOString();
  return {
    id: details.id || mapId(),
    title: String(details.title || normalizedRoot.title || "我的第一张星图").trim(),
    description: String(details.description || "").trim(),
    createdAt: details.createdAt || now,
    updatedAt: details.updatedAt || now,
    rootNode: normalizedRoot,
    metadata: getMapMetadata(normalizedRoot, details.metadata),
  };
}

export function createEmptyAppData() {
  return {
    schemaVersion: 3,
    maps: [],
    activeMapId: null,
    sessions: [],
    knowledgeBases: [],
    reviewQueues: [],
    reviewDrafts: {},
    growthRecords: [],
    learningRecords: [],
    uiState: { currentView: "home", currentMode: null },
  };
}

function backupLegacyData() {
  const payload = {};
  LEGACY_KEYS.forEach((key) => {
    const value = localStorage.getItem(key);
    if (value) payload[key] = value;
  });
  if (Object.keys(payload).length) {
    localStorage.setItem(`abilityStarMap_legacy_backup_${Date.now()}`, JSON.stringify(payload));
  }
}

function migrateLegacyMapData() {
  const next = createEmptyAppData();
  const seenRoots = new Set();
  const candidates = [];
  const currentMap = safeParse(localStorage.getItem("aiAbilityStarMap.currentMap"));
  if (currentMap) candidates.push({ map: currentMap });
  const sessions = safeParse(localStorage.getItem("aiAbilityStarMap.sessions"));
  if (Array.isArray(sessions)) {
    sessions.forEach((session) => {
      if (session?.map) candidates.push({ map: session.map, session });
    });
  }

  candidates.forEach(({ map, session }) => {
    try {
      const root = validateAndNormalizeMap(map);
      const fingerprint = JSON.stringify(root);
      if (seenRoots.has(fingerprint)) return;
      seenRoots.add(fingerprint);
      next.maps.push(makeMap(root, {
        id: session?.id || undefined,
        title: session?.title || root.title,
        createdAt: session?.createdAt ? new Date(session.createdAt).toISOString() : undefined,
        updatedAt: session?.updatedAt ? new Date(session.updatedAt).toISOString() : undefined,
      }));
    } catch (error) {
      console.warn("Skipped an invalid legacy star map during migration:", error);
    }
  });

  next.activeMapId = next.maps[0]?.id || null;
  return next;
}

function hydrateReviewMetadataFromHistory(data) {
  const applyRecord = (record, activityType = record?.type) => {
    if (!record?.id || !record?.mapId) return;
    const changes = new Map((record.masteryChanges || []).filter((item) => item?.nodeId).map((item) => [item.nodeId, item]));
    const nodeIds = [...new Set([...(record.nodeIds || []), record.nodeId, ...changes.keys()].filter(Boolean))];
    nodeIds.forEach((nodeId) => {
      const change = changes.get(nodeId);
      applyLearningActivityToNode(data, {
        mapId: record.mapId,
        nodeId,
        activityType: activityType === "manual_mastery_adjustment" ? "manual_adjustment" : activityType,
        occurredAt: record.endedAt || record.createdAt,
        evidence: record.evidence || [],
        masteryBefore: change?.before ?? record.masteryBefore,
        masteryAfter: change?.accepted ?? record.masteryAccepted,
        sourceRecordId: `${record.id}:${nodeId}`,
      });
    });
  };
  const byOccurredAt = (first, second) => new Date(first.endedAt || first.createdAt || 0) - new Date(second.endedAt || second.createdAt || 0);
  const records = data.learningRecords || [];
  records.slice().sort(byOccurredAt).forEach((record) => applyRecord(record));
  const recordedSessionIds = new Set(records.map((record) => record.sourceSessionId).filter(Boolean));
  (data.sessions || []).filter((session) => session.status === "completed" && !recordedSessionIds.has(session.id)).slice().sort(byOccurredAt).forEach((session) => applyRecord({
    ...session,
    nodeIds: [session.nodeId],
    evidence: session.evidence || [],
    masteryChanges: session.masteryBefore === undefined ? [] : [{ nodeId: session.nodeId, before: session.masteryBefore, accepted: session.masteryAccepted }],
  }, "exploration"));
}

export function loadAppData() {
  const stored = safeParse(localStorage.getItem(APP_DATA_KEY));
  if (stored?.schemaVersion >= 2 && Array.isArray(stored.maps)) {
    if (stored.schemaVersion < 3) {
      try { localStorage.setItem(`${APP_DATA_KEY}.backup-v${stored.schemaVersion}-${Date.now()}`, JSON.stringify(stored)); }
      catch (error) { console.warn("Unable to back up app data before review metadata migration:", error); }
    }
    const data = { ...createEmptyAppData(), ...stored };
    data.maps = stored.maps.flatMap((map) => {
      try {
        return map?.rootNode ? [makeMap(map.rootNode, map)] : [];
      } catch (error) {
        console.warn("Skipped an invalid star map from app data:", error);
        return [];
      }
    });
    data.knowledgeBases = Array.isArray(stored.knowledgeBases)
      ? stored.knowledgeBases.filter((item) => item?.id && item?.content)
      : [];
    data.growthRecords = Array.isArray(stored.growthRecords)
      ? stored.growthRecords.filter((item) => item?.id && item?.mapId)
      : [];
    data.schemaVersion = 3;
    hydrateReviewMetadataFromHistory(data);
    if (!data.maps.some((map) => map.id === data.activeMapId)) data.activeMapId = null;
    try { localStorage.setItem(APP_DATA_KEY, JSON.stringify(data)); } catch (error) { console.warn("Unable to persist review metadata migration:", error); }
    return data;
  }

  const hasLegacy = LEGACY_KEYS.some((key) => localStorage.getItem(key));
  if (!hasLegacy) return createEmptyAppData();

  backupLegacyData();
  const migrated = migrateLegacyMapData();
  try {
    localStorage.setItem(APP_DATA_KEY, JSON.stringify(migrated));
    console.info(`Migrated ${migrated.maps.length} legacy star map(s) to schema v3.`);
  } catch (error) {
    console.error("Unable to save migrated star map data; legacy data was preserved.", error);
  }
  return migrated;
}

export function saveAppData(data) {
  localStorage.setItem(APP_DATA_KEY, JSON.stringify(data));
}

export function getMapById(data, id) {
  return data.maps.find((map) => map.id === id) || null;
}

export function getActiveMap(data) {
  return getMapById(data, data.activeMapId);
}

export function addMap(data, rootNode, details = {}) {
  const map = makeMap(rootNode, details);
  data.maps.unshift(map);
  data.activeMapId = map.id;
  saveAppData(data);
  return map;
}

export function updateMap(data, mapId, rootNode, updates = {}) {
  const map = getMapById(data, mapId);
  if (!map) return null;
  const normalizedRoot = validateAndNormalizeMap(rootNode);
  Object.assign(map, updates, {
    rootNode: normalizedRoot,
    updatedAt: new Date().toISOString(),
    metadata: getMapMetadata(normalizedRoot, {
      ...map.metadata,
      ...updates.metadata,
      lastActivityAt: new Date().toISOString(),
    }),
  });
  saveAppData(data);
  return map;
}

export function deleteMap(data, mapId) {
  data.maps = data.maps.filter((map) => map.id !== mapId);
  if (data.activeMapId === mapId) data.activeMapId = null;
  saveAppData(data);
}

export function addKnowledgeBase(data, knowledgeBase) {
  data.knowledgeBases = Array.isArray(data.knowledgeBases) ? data.knowledgeBases : [];
  data.knowledgeBases.unshift(knowledgeBase);
  saveAppData(data);
  return knowledgeBase;
}

export function deleteKnowledgeBase(data, knowledgeBaseId) {
  data.knowledgeBases = (data.knowledgeBases || []).filter((item) => item.id !== knowledgeBaseId);
  saveAppData(data);
}

export function duplicateMap(data, mapId) {
  const source = getMapById(data, mapId);
  if (!source) return null;
  return addMap(data, structuredClone(source.rootNode), {
    title: `${source.title} 副本`,
    description: source.description,
  });
}
