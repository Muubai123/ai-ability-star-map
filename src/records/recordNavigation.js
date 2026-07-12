import { getMapById } from "../appData.js";
import { findNodePath } from "../exploration/explorationUtils.js";
import { getLearningRecordById } from "./learningRecordStore.js";

export function openRecordOnMap(state, recordId, renderApp, preferredNodeId = "") {
  const record = getLearningRecordById(state.appData, recordId);
  const map = getMapById(state.appData, record?.mapId);
  if (!record || !map) return { ok: false, message: "原星图已不存在，无法定位到地图。" };

  const nodeId = preferredNodeId || record.nodeIds.find((id) => findNodePath(map.rootNode, id).length) || "";
  const path = nodeId ? findNodePath(map.rootNode, nodeId) : [map.rootNode];
  const selected = path.at(-1) || map.rootNode;
  const displayNode = selected.children?.length ? selected : path.at(-2) || map.rootNode;
  state.activeMapId = map.id;
  state.appData.activeMapId = map.id;
  state.starMap = map.rootNode;
  state.currentNode = displayNode;
  state.path = findNodePath(map.rootNode, displayNode.id);
  state.selectedNode = selected;
  state.activeNodeId = selected.id;
  state.currentMode = null;
  state.pendingMapFeedback = {
    mapId: map.id,
    recordId: record.id,
    highlightNodeIds: record.nodeIds.filter((id) => findNodePath(map.rootNode, id).length),
    source: "learning_record",
    message: `来自学习记录：${record.summary || record.title}`,
  };
  state.currentPage = "map";
  renderApp();
  return { ok: true };
}
