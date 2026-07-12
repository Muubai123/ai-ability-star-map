import { validateAndNormalizeMap } from "./utils/jsonUtils.js";
import { getDefaultAiConfig, normalizeAiConfig } from "./aiProviders.js";

export const STORAGE_KEYS = {
  map: "aiAbilityStarMap.currentMap",
  sessions: "aiAbilityStarMap.sessions",
  activeSessionId: "aiAbilityStarMap.activeSessionId",
  config: "aiAbilityStarMap.aiConfig",
};

export function loadSavedMap() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.map);

    if (!saved) return null;

    return validateAndNormalizeMap(JSON.parse(saved));
  } catch (error) {
    console.warn("Failed to load saved star map:", error);
    return null;
  }
}

export function saveMap(map) {
  if (!map) {
    clearSavedMap();
    return;
  }

  localStorage.setItem(STORAGE_KEYS.map, JSON.stringify(map));
}

export function clearSavedMap() {
  localStorage.removeItem(STORAGE_KEYS.map);
}

export function loadSavedSessions() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.sessions);

    if (!saved) return [];

    const sessions = JSON.parse(saved);

    if (!Array.isArray(sessions)) return [];

    return sessions
      .map((session) => {
        let map = null;

        if (session?.map) {
          try {
            map = validateAndNormalizeMap(session.map);
          } catch (error) {
            console.warn("Failed to load session map:", error);
          }
        }

        return {
          ...session,
          map,
        };
      })
      .filter((session) => session.id);
  } catch (error) {
    console.warn("Failed to load saved sessions:", error);
    return [];
  }
}

export function saveSessions(sessions, activeSessionId) {
  localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));

  if (activeSessionId) {
    localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
  }
}

export function loadActiveSessionId() {
  return localStorage.getItem(STORAGE_KEYS.activeSessionId) || "";
}

export function loadAiConfig(defaultConfig = getDefaultAiConfig()) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.config) || "{}");

    return normalizeAiConfig({
      ...defaultConfig,
      ...saved,
    });
  } catch (error) {
    console.warn("Failed to load AI config:", error);
    return normalizeAiConfig(defaultConfig);
  }
}

export function saveAiConfig(config) {
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(normalizeAiConfig(config)));
}
