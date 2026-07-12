import { loadAppData, saveAppData } from "../appData.js";

const STORAGE_KEYS = {
  sessions: "aiAbilityStarMap.explorationSessions",
  activeId: "aiAbilityStarMap.activeExplorationId",
};

const ACTIVE_STATUSES = new Set([
  "planning",
  "defining_goal",
  "goal_confirmation",
  "active",
  "reviewing",
  "completion_check",
  "assessment",
]);

function normalizeLegacySession(session) {
  if (session?.mapId) return session;
  return { ...session, mapId: session?.mapSessionId || null, legacy: !session?.mapSessionId };
}

export function loadExplorationSessions() {
  try {
    const appData = loadAppData();
    const value = Array.isArray(appData.sessions) && appData.sessions.length
      ? appData.sessions
      : JSON.parse(localStorage.getItem(STORAGE_KEYS.sessions) || "[]");

    return Array.isArray(value)
      ? value.filter((session) => session?.id).map((session) => {
        const normalized = normalizeLegacySession(session);
        if (normalized.mapId && !appData.maps.some((map) => map.id === normalized.mapId)) {
          const rootMatch = appData.maps.find((map) => map.rootNode?.id === normalized.mapId);
          if (rootMatch) normalized.mapId = rootMatch.id;
          else normalized.legacy = true;
        }
        if (!normalized.mapId && appData.maps.length === 1) normalized.mapId = appData.maps[0].id;
        return normalized;
      })
      : [];
  } catch (error) {
    console.warn("Failed to load exploration sessions:", error);
    return [];
  }
}

export function getSessionsByNodeId(nodeId, mapId = "") {
  return loadExplorationSessions()
    .filter(
      (session) =>
        session.nodeId === nodeId &&
        (!mapId || session.mapId === mapId)
    )
    .sort((first, second) => Number(second.endedAt || 0) - Number(first.endedAt || 0));
}

export function getActiveExplorationSession() {
  const sessions = loadExplorationSessions();
  const activeId = localStorage.getItem(STORAGE_KEYS.activeId) || "";
  return (
    sessions.find(
      (session) => session.id === activeId && ACTIVE_STATUSES.has(session.status)
    ) || sessions.find((session) => ACTIVE_STATUSES.has(session.status)) || null
  );
}

export function saveExplorationSession(session) {
  const sessions = loadExplorationSessions();
  const index = sessions.findIndex((item) => item.id === session.id);
  const normalized = {
    ...normalizeLegacySession(session),
    updatedAt: Date.now(),
  };

  if (index === -1) {
    sessions.unshift(normalized);
  } else {
    sessions[index] = normalized;
  }

  try {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
    const appData = loadAppData();
    appData.sessions = sessions;
    saveAppData(appData);

    if (ACTIVE_STATUSES.has(normalized.status)) {
      localStorage.setItem(STORAGE_KEYS.activeId, normalized.id);
    } else if (localStorage.getItem(STORAGE_KEYS.activeId) === normalized.id) {
      localStorage.removeItem(STORAGE_KEYS.activeId);
    }
  } catch (error) {
    throw new Error(`探索记录保存失败：${error.message}`);
  }

  return normalized;
}

export function deleteExplorationSession(sessionId) {
  const sessions = loadExplorationSessions().filter((session) => session.id !== sessionId);

  try {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
    const appData = loadAppData();
    appData.sessions = sessions;
    saveAppData(appData);

    if (localStorage.getItem(STORAGE_KEYS.activeId) === sessionId) {
      localStorage.removeItem(STORAGE_KEYS.activeId);
    }
  } catch (error) {
    throw new Error(`探索记录删除失败：${error.message}`);
  }
}
