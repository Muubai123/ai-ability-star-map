import { getDefaultAiConfig } from "./aiProviders.js";
import { addMap, deleteMap, getActiveMap, getMapById, loadAppData, saveAppData, updateMap } from "./appData.js";
import { createInitialExplorationState } from "./exploration/explorationState.js";
import { createReviewState } from "./review/reviewState.js";
import { getActiveGlobalReviewQueue } from "./review/globalReviewStore.js";
import { loadActiveSessionId, loadAiConfig, loadSavedSessions, saveSessions } from "./storage.js";

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultAiState() {
  return { showApiKey: false, messages: [{ role: "assistant", content: "你想构建哪方面的能力星图？可以告诉我目标、用途和当前基础。" }], summary: null, status: "", error: "", rawOutput: "", generationSteps: [], draft: "", chatScrollTop: 0, stickToBottom: true, restoreFocus: false, isTesting: false, isSending: false, isGenerating: false };
}

function normalizeSession(session) {
  return { id: session?.id || createId("chat"), title: session?.title || "新的能力星图", mapId: session?.mapId || null, map: session?.map || null, ai: { ...createDefaultAiState(), ...(session?.ai || {}) }, createdAt: session?.createdAt || Date.now(), updatedAt: session?.updatedAt || Date.now() };
}

export function resolveSessionMapId(session, maps = []) {
  if (!session) return null;
  if (session.mapId && maps.some((map) => map.id === session.mapId)) return session.mapId;
  const rootNodeId = session.map?.id;
  return maps.find((map) => rootNodeId && map.rootNode?.id === rootNodeId)?.id || null;
}

const appData = loadAppData();
const sessions = loadSavedSessions().map(normalizeSession);
if (!sessions.length) sessions.push(normalizeSession({}));
sessions.forEach((session) => {
  session.mapId = resolveSessionMapId(session, appData.maps);
});
const activeSessionId = sessions.some((session) => session.id === loadActiveSessionId()) ? loadActiveSessionId() : sessions[0].id;
const activeMap = getActiveMap(appData);
const activeReviewQueue = getActiveGlobalReviewQueue(appData);

export const appState = {
  currentPage: "home",
  currentMode: appData.uiState?.currentMode || null,
  appData,
  activeMapId: appData.activeMapId,
  activeReviewQueueId: activeReviewQueue?.id || null,
  activeReviewItemMapId: activeReviewQueue?.items.find((item) => item.id === activeReviewQueue.activeItemId)?.mapId || null,
  activeNodeId: activeMap?.metadata?.lastSelectedNodeId || null,
  sessions,
  activeSessionId,
  starMap: activeMap?.rootNode || null,
  currentNode: activeMap?.rootNode || null,
  path: activeMap?.rootNode ? [activeMap.rootNode] : [],
  selectedNode: activeMap?.rootNode || null,
  transitionState: null, isTransitioning: false, clickSelectTimer: null, configReturnPage: null,
  aiConfig: loadAiConfig(getDefaultAiConfig()), ai: sessions.find((item) => item.id === activeSessionId).ai,
  knowledge: { query: "", subject: "all", selectedId: "", isUploading: false }, exploration: createInitialExplorationState(), review: createReviewState(), pendingMapFeedback: null,
  learningRecordFilters: { mapId: "", nodeId: "", type: "all", dateRange: "all", startDate: "", endDate: "", query: "", onlyMasteryChanges: false, onlyUnresolved: false, page: 1 },
  selectedLearningRecordId: "", expandedGlobalRecordId: "",
  // 星图工作区需要知道从哪个模式进入，才能返回对应入口。
  mapEntryContext: null,
  returnContext: null,
};

export function persistAppState() {
  const persisted = loadAppData();
  appState.appData.sessions = persisted.sessions || appState.appData.sessions;
  appState.appData.learningRecords = persisted.learningRecords || appState.appData.learningRecords;
  appState.appData.activeMapId = appState.activeMapId;
  appState.appData.uiState = { currentView: appState.currentPage, currentMode: appState.currentMode };
  saveAppData(appState.appData);
}

export function setPage(page) { appState.currentPage = page; persistAppState(); }

export function setActiveMap(mapId) {
  const map = getMapById(appState.appData, mapId);
  if (!map) { appState.activeMapId = null; appState.starMap = null; appState.currentNode = null; appState.path = []; appState.selectedNode = null; persistAppState(); return false; }
  appState.activeMapId = map.id; appState.appData.activeMapId = map.id; appState.starMap = map.rootNode; appState.currentNode = map.rootNode; appState.path = [map.rootNode]; appState.selectedNode = map.rootNode; appState.activeNodeId = map.metadata?.lastSelectedNodeId || null; appState.transitionState = null; appState.isTransitioning = false; persistAppState(); return true;
}

export function openMapPage(mapId, { sourceView = "map_library", mode = null } = {}) {
  if (!setActiveMap(mapId)) return false;

  appState.currentMode = mode;
  appState.mapEntryContext = sourceView ? { sourceView, mode } : null;
  appState.currentPage = "map";
  persistAppState();
  return true;
}

export function getActiveSession() { return appState.sessions.find((item) => item.id === appState.activeSessionId) || appState.sessions[0]; }

export function switchSession(sessionId) {
  const session = appState.sessions.find((item) => item.id === sessionId); if (!session) return;
  appState.activeSessionId = session.id; appState.ai = session.ai; saveSessions(appState.sessions, appState.activeSessionId);
}

export function createSession(title = "新的能力星图") { const session = normalizeSession({ id: createId("chat"), title }); appState.sessions.unshift(session); switchSession(session.id); return session; }

export function setStarMap(rootNode, title = "") {
  const map = addMap(appState.appData, rootNode, { title: title || rootNode?.title });
  const session = getActiveSession(); session.mapId = map.id; session.map = map.rootNode; session.title = map.title; session.updatedAt = Date.now();
  setActiveMap(map.id); saveSessions(appState.sessions, appState.activeSessionId); return map;
}

export function deleteMapAndAssociatedAiSession(mapId) {
  const map = getMapById(appState.appData, mapId);
  if (!map) return { deleted: false, removedSessionCount: 0 };

  const relatedSessions = appState.sessions.filter(
    (session) => resolveSessionMapId(session, appState.appData.maps) === mapId
  );
  const relatedIds = new Set(relatedSessions.map((session) => session.id));

  deleteMap(appState.appData, mapId);
  appState.sessions = appState.sessions.filter((session) => !relatedIds.has(session.id));

  if (!appState.sessions.length) {
    appState.sessions.push(normalizeSession({}));
  }

  if (!appState.sessions.some((session) => session.id === appState.activeSessionId)) {
    appState.activeSessionId = appState.sessions[0].id;
  }
  appState.ai = getActiveSession().ai;
  saveSessions(appState.sessions, appState.activeSessionId);

  if (appState.activeMapId === mapId) {
    const nextMap = getActiveMap(appState.appData);
    appState.activeMapId = nextMap?.id || null;
    appState.starMap = nextMap?.rootNode || null;
    appState.currentNode = nextMap?.rootNode || null;
    appState.path = nextMap?.rootNode ? [nextMap.rootNode] : [];
    appState.selectedNode = nextMap?.rootNode || null;
    appState.activeNodeId = nextMap?.metadata?.lastSelectedNodeId || null;
  }

  persistAppState();
  return { deleted: true, removedSessionCount: relatedSessions.length };
}

export function deleteSessionAndAssociatedMap(sessionId) {
  const session = appState.sessions.find((item) => item.id === sessionId);
  if (!session) return { deleted: false, deletedMapId: null, removedSessionCount: 0 };

  const mapId = resolveSessionMapId(session, appState.appData.maps);
  const relatedSessionIds = new Set(
    appState.sessions
      .filter((item) => item.id === sessionId || (mapId && resolveSessionMapId(item, appState.appData.maps) === mapId))
      .map((item) => item.id)
  );

  if (mapId) deleteMap(appState.appData, mapId);
  appState.sessions = appState.sessions.filter((item) => !relatedSessionIds.has(item.id));

  if (!appState.sessions.length) appState.sessions.push(normalizeSession({}));
  if (!appState.sessions.some((item) => item.id === appState.activeSessionId)) {
    appState.activeSessionId = appState.sessions[0].id;
  }
  appState.ai = getActiveSession().ai;
  saveSessions(appState.sessions, appState.activeSessionId);

  if (mapId && appState.activeMapId === mapId) {
    appState.activeMapId = null;
    appState.appData.activeMapId = null;
    appState.starMap = null;
    appState.currentNode = null;
    appState.path = [];
    appState.selectedNode = null;
    appState.activeNodeId = null;
  }

  persistAppState();
  return { deleted: true, deletedMapId: mapId, removedSessionCount: relatedSessionIds.size };
}

export function saveActiveSession() {
  const session = getActiveSession(); session.ai = appState.ai; session.updatedAt = Date.now();
  if (appState.activeMapId && appState.starMap) updateMap(appState.appData, appState.activeMapId, appState.starMap, { metadata: { lastSelectedNodeId: appState.selectedNode?.id || null } });
  saveSessions(appState.sessions, appState.activeSessionId); persistAppState();
}

export function resetStarMap() { appState.activeMapId = null; appState.starMap = null; appState.currentNode = null; appState.path = []; appState.selectedNode = null; persistAppState(); }
