import { callOpenAICompatibleChat } from "../aiApi.js";
import { extractJsonFromText } from "../utils/jsonUtils.js";
import { normalizeGrowthProposal } from "../growth/growthProposal.js";

const analysisPrompt = `你是能力星图单图复盘助手。根据用户学习总结，优先匹配给出的真实节点索引。第一轮只分析、匹配并提出候选，不得直接修改地图。对每段学习内容给出 contentMatches，matchType 只能是 matched_existing、possible_match、propose_new_node、unmatched。只有现有结构存在明确缺口，且内容值得独立学习或评估时才 propose_new_node；同义表达优先 possible_match 或 matched_existing。当 matchType 为 propose_new_node 时，growthProposal 必须是完整对象（结构见下），其余情况必须为 null。新增节点最多 3 个，复盘新节点 suggestedMastery 最大 2。growthProposal.parentNodeId 与 unmatchedTopics.suggestedParentId 必须来自节点索引，action 默认 create_child。只输出严格 JSON，不要 Markdown：{"reply":"","summary":"","matchedNodes":[{"nodeId":"","nodeTitle":"","nodePath":[],"confidence":0.5,"reason":"","extractedEvidence":[{"type":"exposure|exercise|independent_practice|explanation|difficulty","content":""}]}],"contentMatches":[{"contentId":"","matchType":"matched_existing|possible_match|propose_new_node|unmatched","matchedNodeIds":[],"confidence":0.5,"reason":"","growthProposal":{"proposalId":"","action":"create_child|create_sibling|map_existing|add_note","title":"","description":"","parentNodeId":"","knowledgeType":"memory|understanding|problem_solving|operation|output|mixed","knowledgeTypeConfidence":0.7,"weight":1,"suggestedMastery":0,"masteryReason":"","reason":"","evidence":[],"sourceTypes":["existing_map","conversation","ai_general_knowledge"],"possibleDuplicateNodeIds":[],"confidence":0.7}}],"unmatchedTopics":[{"title":"","suggestedParentId":"","reason":""}],"followUpQuestions":[]}. matchedNodes 中 nodeId 必须来自节点索引。`;

const assessmentPrompt = `你是能力星图复盘评估助手。只基于用户确认的节点和证据提出保守的 0-4 熟练度建议，不得直接修改地图。父节点熟练度由子节点聚合，不能建议直接改父节点。证据不足时保持原等级。0=未接触，1=了解基本含义，2=有基础练习/应用，3=多次独立稳定完成，4=能解释迁移或指导他人。只输出严格 JSON：{"overallSummary":"","nodeAssessments":[{"nodeId":"","nodeTitle":"","masteryBefore":0,"masterySuggested":0,"confidence":0,"evidence":[],"remainingProblems":[],"reason":""}],"newNodeSuggestions":[{"parentId":"","title":"","description":"","initialMastery":0,"reason":""}],"nextSuggestions":[],"recordSummary":""}`;

export function buildNodeIndex(root) {
  const items = [];
  function walk(node, path = []) {
    const nodePath = [...path, node.title];
    items.push({ nodeId: node.id, nodeTitle: node.title, nodePath, mastery: node.mastery, isLeaf: !(node.children || []).length });
    (node.children || []).forEach((child) => walk(child, nodePath));
  }
  if (root) walk(root);
  return items;
}

async function requestJson(messages, options) {
  const rawOutput = await callOpenAICompatibleChat(messages, options);
  try { return { data: JSON.parse(extractJsonFromText(rawOutput)), rawOutput }; }
  catch (error) { throw new Error(`模型返回无法解析：${error.message}\n${rawOutput}`); }
}

export async function analyzeSingleMapReview(map, rawInput, recentRecords, options, knowledgeContext = "") {
  const index = buildNodeIndex(map.rootNode);
  const result = await requestJson([{ role: "system", content: analysisPrompt }, { role: "user", content: `星图：${map.title}\n节点索引：${JSON.stringify(index)}\n最近记录：${JSON.stringify(recentRecords.slice(0, 3))}\n相关知识库：${knowledgeContext || "无"}\n用户总结：${rawInput}` }], options);
  const validIds = new Set(index.map((node) => node.nodeId));
  const matchedNodes = (Array.isArray(result.data.matchedNodes) ? result.data.matchedNodes : []).filter((item) => validIds.has(item?.nodeId)).slice(0, 8).map((item) => ({ ...item, accepted: true, evidence: Array.isArray(item.extractedEvidence) ? item.extractedEvidence : [] }));
  const proposalSource = [
    ...(Array.isArray(result.data.growthProposals) ? result.data.growthProposals : []),
    ...(Array.isArray(result.data.contentMatches) ? result.data.contentMatches.map((item) => item?.matchType === "propose_new_node" ? item.growthProposal : null) : []),
  ].filter(Boolean).slice(0, 3);
  const growthProposals = proposalSource.map((proposal) => ({
    ...normalizeGrowthProposal(proposal, { parentNodeId: proposal.parentNodeId || proposal.suggestedParentId || map.rootNode.id }),
    suggestedMastery: Math.min(2, Math.max(0, Number(proposal.suggestedMastery) || 0)),
  }));
  return { ...result.data, matchedNodes, growthProposals, unmatchedTopics: Array.isArray(result.data.unmatchedTopics) ? result.data.unmatchedTopics : [], followUpQuestions: Array.isArray(result.data.followUpQuestions) ? result.data.followUpQuestions.slice(0, 3) : [], rawOutput: result.rawOutput };
}

export async function assessSingleMapReview(map, review, options) {
  const index = buildNodeIndex(map.rootNode);
  const confirmed = (review.analysis?.matchedNodes || []).filter((item) => item.accepted).map((item) => ({ ...item, node: index.find((node) => node.nodeId === item.nodeId) })).filter((item) => item.node);
  const result = await requestJson([{ role: "system", content: assessmentPrompt }, { role: "user", content: `星图：${map.title}\n用户总结：${review.rawInput}\n已确认映射：${JSON.stringify(confirmed)}\n追问回答：${JSON.stringify(review.followUpAnswers || [])}` }], options);
  const validLeafIds = new Set(index.filter((node) => node.isLeaf).map((node) => node.nodeId));
  const assessments = (Array.isArray(result.data.nodeAssessments) ? result.data.nodeAssessments : []).filter((item) => validLeafIds.has(item?.nodeId) && confirmed.some((match) => match.nodeId === item.nodeId)).map((item) => ({ ...item, masterySuggested: Math.max(0, Math.min(4, Number(item.masterySuggested) || 0)), accepted: true }));
  return { ...result.data, nodeAssessments: assessments, rawOutput: result.rawOutput };
}
