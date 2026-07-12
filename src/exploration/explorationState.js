import {
  getActiveExplorationSession,
  loadExplorationSessions,
  saveExplorationSession,
} from "./explorationStorage.js";

export function createInitialExplorationState() {
  const currentSession = getActiveExplorationSession();
  if (currentSession?.status === "planning") currentSession.status = "defining_goal";
  if (currentSession?.status === "reviewing") currentSession.status = "completion_check";

  return {
    status: currentSession?.status || "idle",
    selectedNodeId: currentSession?.nodeId || null,
    currentSession,
    history: loadExplorationSessions().filter((session) => session.status === "completed"),
    panelOpen: Boolean(currentSession),
    isRequesting: false,
    error: "",
    notice: "",
    rawOutput: "",
    feedback: null,
  };
}

export function setCurrentExploration(state, session) {
  const saved = saveExplorationSession(session);
  state.currentSession = saved;
  state.status = saved.status;
  state.selectedNodeId = saved.nodeId;
  state.history = loadExplorationSessions().filter(
    (item) => item.status === "completed"
  );
  return saved;
}

export function clearCurrentExploration(state) {
  state.currentSession = null;
  state.status = "idle";
  state.selectedNodeId = null;
  state.isRequesting = false;
  state.rawOutput = "";
}
