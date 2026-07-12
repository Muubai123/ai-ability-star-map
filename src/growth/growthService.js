import { callOpenAICompatibleChat } from "../aiApi.js";
import { extractJsonFromText } from "../utils/jsonUtils.js";
import { normalizeGrowthResponse } from "./growthProposal.js";

const nodeNamePrompt = `你是能力星图生长助手。用户会描述想在某个节点下补充的内容，请提炼出应该新增哪些子节点，只给出简洁的节点名称（每个不超过 12 字），不要描述、不要解释。优先拆成可长期追踪的知识点，避免与已有子节点重复，给 3-8 个。只输出严格 JSON，不要 Markdown：{"names":["",""]}`;

export async function suggestGrowthNodeNames(context, options) {
  const rawOutput = await callOpenAICompatibleChat([
    { role: "system", content: nodeNamePrompt },
    {
      role: "user",
      content: `父节点：${context.parentTitle}\n已有子节点：${(context.existingChildren || []).join("、") || "无"}\n用户需求：${context.userIntent}\n请列出应新增的子节点名称。`,
    },
  ], options);
  try {
    const parsed = JSON.parse(extractJsonFromText(rawOutput));
    const seen = new Set();
    const names = (Array.isArray(parsed.names) ? parsed.names : [])
      .map((name) => String(name || "").trim().slice(0, 40))
      .filter((name) => name && !seen.has(name) && (seen.add(name), true))
      .slice(0, 8);
    if (!names.length) throw new Error("模型没有返回可用的节点名称。");
    return { value: { names }, rawOutput, parseError: "" };
  } catch (error) {
    return { value: null, rawOutput, parseError: `节点名称无法解析：${error.message}` };
  }
}

const explorationGrowthPrompt = `你是能力星图生长助手。只根据用户提出的结构缺口，为当前分支提出少量、可长期追踪的节点建议。绝不直接修改地图。优先避免与已有子节点、兄弟节点重复。每次给 3-8 个候选；若不值得新建节点，使用 add_note 或 no_change。探索中的 suggestedMastery 默认 0；除非上下文包含用户明确练习证据，最高只能建议 2。没有外部搜索时不得伪造 web 来源。只输出严格 JSON：{"summary":"","recommendation":"propose_nodes|add_note|no_change","proposals":[{"proposalId":"","action":"create_child|create_sibling|map_existing|add_note","title":"","description":"","parentNodeId":"","parentPath":[],"knowledgeType":"memory|understanding|problem_solving|operation|output|mixed","knowledgeTypeConfidence":0.7,"weight":1,"suggestedMastery":0,"masteryReason":"","reason":"","evidence":[],"sourceTypes":["existing_map","knowledge_base","conversation","ai_general_knowledge"],"possibleDuplicateNodeIds":[],"confidence":0.7}]}`;

export async function generateExplorationGrowthProposals(context, options) {
  const rawOutput = await callOpenAICompatibleChat([
    { role: "system", content: explorationGrowthPrompt },
    {
      role: "user",
      content: `当前星图分支上下文：\n${JSON.stringify(context, null, 2)}\n\n请只提出当前分支真正缺少、可独立学习或评估的能力节点。`,
    },
  ], options);
  try {
    const parsed = JSON.parse(extractJsonFromText(rawOutput));
    return {
      value: normalizeGrowthResponse(parsed, {
        parentNodeId: context.node.id,
        parentPath: context.node.path,
      }),
      rawOutput,
      parseError: "",
    };
  } catch (error) {
    return { value: null, rawOutput, parseError: `生长提案无法解析：${error.message}` };
  }
}
