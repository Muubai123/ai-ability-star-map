import { findNodeById, findNodePath } from "../exploration/explorationUtils.js";
import { buildKnowledgeContext, findRelevantKnowledge } from "../utils/knowledgeUtils.js";

export function buildGrowthContext(appData, mapId, sourceNodeId, session, userIntent) {
  const map = (appData.maps || []).find((item) => item.id === mapId);
  if (!map) throw new Error("找不到要扩展的星图。");
  const node = findNodeById(map.rootNode, sourceNodeId);
  if (!node) throw new Error("当前节点已不存在，请重新选择节点。");
  const path = findNodePath(map.rootNode, node.id);
  const parent = path.at(-2) || null;
  const siblings = (parent?.children || []).filter((item) => item.id !== node.id);
  const querySummary = {
    title: map.title,
    goal: userIntent,
    currentLevel: node.title,
    purpose: session?.refinedGoal || session?.goalInput || "",
  };
  const knowledgeBases = findRelevantKnowledge(querySummary, [
    ...(session?.messages || []),
    { role: "user", content: userIntent },
  ], { knowledgeBases: appData.knowledgeBases || [], limit: 3 });

  return {
    mapId: map.id,
    mapTitle: map.title,
    node: {
      id: node.id,
      title: node.title,
      description: node.description || "",
      path: path.map((item) => item.title),
      mastery: Number(node.mastery) || 0,
      weight: Number(node.weight) || 1,
      knowledgeType: node.reviewMetadata?.knowledgeType || "mixed",
      children: (node.children || []).map((child) => ({
        id: child.id,
        title: child.title,
        description: child.description || "",
      })),
      parent: parent ? { id: parent.id, title: parent.title } : null,
      siblings: siblings.map((item) => ({ id: item.id, title: item.title, description: item.description || "" })),
    },
    exploration: {
      goal: session?.refinedGoal || session?.goalInput || "",
      messages: (session?.messages || []).slice(-6),
      notes: (session?.notes || []).slice(-6),
    },
    userIntent: String(userIntent || "").trim(),
    knowledgeBaseIds: knowledgeBases.map((entry) => entry.id),
    knowledgeContext: buildKnowledgeContext(knowledgeBases, {
      maxChars: 4200,
      maxDocumentChars: 1100,
    }),
    enableWebSearch: false,
    webSearchResults: [],
  };
}
