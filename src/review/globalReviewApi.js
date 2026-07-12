import { callOpenAICompatibleChat } from "../aiApi.js";
import { extractJsonFromText } from "../utils/jsonUtils.js";
import { buildNodeIndex } from "./reviewApi.js";

const prompt = `你是能力星图全局复盘分流助手。根据用户的一段总体学习总结，从提供的真实星图索引中选择少量相关星图，建立复盘候选。只能引用输入中的真实 mapId，绝不能猜造 mapId。此轮只分流，不能修改地图、熟练度或创建新星图。没有归属的内容放入 unmatchedTopics。只输出严格 JSON：{"summary":"","candidateMaps":[{"mapId":"","mapTitle":"","confidence":0.5,"reason":"","suggestedPriority":1,"matchedTopics":[{"title":"","possibleNodeIds":[],"evidence":[]}],"extractedSummary":"","extractedEvidence":[]}],"unmatchedTopics":[{"title":"","reason":""}]}`;

export function buildGlobalMapIndex(maps, learningRecords = []) {
  return maps.map((map) => {
    const nodes = buildNodeIndex(map.rootNode);
    const prioritized = [...nodes.filter((node) => node.isLeaf), ...nodes.filter((node) => node.nodePath.length <= 2)].filter((node, index, list) => list.findIndex((item) => item.nodeId === node.nodeId) === index).slice(0, 48);
    const recent = learningRecords.filter((record) => record.mapId === map.id).slice(0, 2).map((record) => record.summary || record.rawInput?.slice(0, 120)).filter(Boolean).join("；");
    return { mapId: map.id, title: map.title, description: map.description || "", topLevelNodes: (map.rootNode.children || []).slice(0, 8).map((node) => ({ id: node.id, title: node.title })), searchableNodes: prioritized.map((node) => ({ id: node.nodeId, title: node.nodeTitle, path: node.nodePath, mastery: node.mastery })), recentActivitySummary: recent };
  });
}

export async function analyzeGlobalReview(rawInput, maps, learningRecords, options) {
  const indexes = buildGlobalMapIndex(maps, learningRecords);
  const rawOutput = await callOpenAICompatibleChat([{ role: "system", content: prompt }, { role: "user", content: `日期：${new Date().toLocaleDateString("zh-CN")}\n总体总结：${rawInput}\n星图索引：${JSON.stringify(indexes)}\n最近学习记录摘要：${JSON.stringify(learningRecords.slice(0, 6).map((record) => ({ mapId: record.mapId, summary: record.summary || record.rawInput?.slice(0, 160) })) )}` }], options);
  let parsed; try { parsed = JSON.parse(extractJsonFromText(rawOutput)); } catch (error) { throw new Error(`模型返回无法解析：${error.message}\n${rawOutput}`); }
  const mapIds = new Set(indexes.map((map) => map.mapId));
  return { summary: String(parsed.summary || "").trim(), candidateMaps: (Array.isArray(parsed.candidateMaps) ? parsed.candidateMaps : []).filter((item) => mapIds.has(item?.mapId)).slice(0, 5), unmatchedTopics: Array.isArray(parsed.unmatchedTopics) ? parsed.unmatchedTopics : [], rawOutput };
}
