import { callOpenAICompatibleChat } from "../aiApi.js";
import { extractJsonFromText } from "../utils/jsonUtils.js";
import {
  normalizeExplorationPlan,
  normalizeExplorationReview,
  normalizeGoalConfirmation,
  normalizeCompletionChecklist,
  normalizeExplorationAssessment,
  normalizeSuggestedActions,
} from "./explorationUtils.js";
import {
  explorationActivePrompt,
  explorationPlanningPrompt,
  explorationReviewPrompt,
  explorationGoalConfirmationPrompt,
  explorationCompletionChecklistPrompt,
  explorationAssessmentPrompt,
} from "./explorationPrompts.js";

export async function confirmExplorationGoal(session, nodeContext, options) {
  return requestStructuredExplorationJson(explorationGoalConfirmationPrompt, {
    node: nodeContext,
    goalInput: session.goalInput,
    recentLearning: nodeContext.recentExplorations,
  }, options, normalizeGoalConfirmation, "目标确认");
}

export async function generateCompletionChecklist(session, nodeContext, history, options) {
  return requestStructuredExplorationJson(explorationCompletionChecklistPrompt, {
    node: nodeContext,
    refinedGoal: session.refinedGoal || session.goalInput,
    suggestions: session.aiSuggestions,
    durationMs: Date.now() - Number(session.startedAt || Date.now()),
    notes: session.notes.slice(-8),
    questions: session.messages.filter((message) => message.role === "user").slice(-8),
    evidence: session.evidence.slice(-12),
    recentLearning: history,
  }, options, normalizeCompletionChecklist, "完成清单");
}

export async function assessExplorationCompletion(session, nodeContext, history, options) {
  return requestStructuredExplorationJson(explorationAssessmentPrompt, {
    node: nodeContext,
    masteryBefore: session.masteryBefore,
    goalInput: session.goalInput,
    refinedGoal: session.refinedGoal || session.goalInput,
    suggestions: session.aiSuggestions,
    durationMs: Date.now() - Number(session.startedAt || Date.now()),
    checklist: session.completionChecklist,
    completionNote: session.completionNote,
    notes: session.notes.slice(-8),
    questions: session.messages.filter((message) => message.role === "user").slice(-8),
    evidence: session.evidence.slice(-12),
    recentLearning: history,
  }, options, (value) => normalizeExplorationAssessment(value, session.masteryBefore), "证据评估");
}

async function requestStructuredExplorationJson(prompt, context, options, normalize, label) {
  const rawOutput = await callOpenAICompatibleChat([
    { role: "system", content: prompt },
    { role: "user", content: JSON.stringify(context, null, 2) },
  ], options);
  try {
    return { value: normalize(JSON.parse(extractJsonFromText(rawOutput))), rawOutput, parseError: "" };
  } catch (error) {
    return { value: null, rawOutput, parseError: `${label}结果无法解析：${error.message}` };
  }
}

export async function requestExplorationPlan(session, nodeContext, userInput, options) {
  const rawOutput = await callOpenAICompatibleChat(
    [
      { role: "system", content: explorationPlanningPrompt },
      {
        role: "user",
        content: `
当前节点上下文：
${JSON.stringify(nodeContext, null, 2)}

本次规划对话：
${formatMessages(session.messages)}

用户本次输入：
${userInput}
        `.trim(),
      },
    ],
    options
  );

  try {
    const parsed = JSON.parse(extractJsonFromText(rawOutput));
    return {
      reply: String(parsed.reply || "").trim(),
      status: parsed.status === "ready" ? "ready" : "collecting",
      plan: normalizeExplorationPlan(parsed.sessionPlan),
      rawOutput,
      parseError: "",
    };
  } catch (error) {
    return {
      reply: rawOutput,
      status: "collecting",
      plan: session.plan,
      rawOutput,
      parseError: `模型回复未能解析为计划 JSON：${error.message}`,
    };
  }
}

export async function requestExplorationAssistance(
  session,
  nodeContext,
  userInput,
  options
) {
  const rawOutput = await callOpenAICompatibleChat(
    [
      { role: "system", content: explorationActivePrompt },
      {
        role: "user",
        content: `
节点上下文：${JSON.stringify(nodeContext)}
探索计划：${JSON.stringify(session.plan)}
当前任务状态：${JSON.stringify(session.plan.tasks)}
已有笔记：${JSON.stringify(session.notes.slice(-8))}
最近对话：
${formatMessages(session.messages.slice(-10))}

用户：${userInput}
        `.trim(),
      },
    ],
    options
  );

  try {
    const parsed = JSON.parse(extractJsonFromText(rawOutput));
    return {
      reply: String(parsed.reply || rawOutput).trim(),
      suggestedActions: normalizeSuggestedActions(parsed.suggestedActions),
      rawOutput,
      parseError: "",
    };
  } catch (error) {
    return {
      reply: rawOutput,
      suggestedActions: [],
      rawOutput,
      parseError: `模型回复不是标准 JSON，已按普通回复显示：${error.message}`,
    };
  }
}

export async function requestExplorationReview(
  session,
  nodeContext,
  historySummary,
  options
) {
  const rawOutput = await callOpenAICompatibleChat(
    [
      { role: "system", content: explorationReviewPrompt },
      {
        role: "user",
        content: `
节点信息：${JSON.stringify(nodeContext, null, 2)}
探索记录：
${JSON.stringify(
  {
    masteryBefore: session.masteryBefore,
    plan: session.plan,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    notes: session.notes,
    evidence: session.evidence,
    messages: session.messages.slice(-12),
    reflection: session.reflection,
  },
  null,
  2
)}
历史探索摘要：${JSON.stringify(historySummary)}
        `.trim(),
      },
    ],
    options
  );

  try {
    const parsed = JSON.parse(extractJsonFromText(rawOutput));
    return {
      review: normalizeExplorationReview(parsed, session.masteryBefore),
      rawOutput,
      parseError: "",
    };
  } catch (error) {
    return {
      review: null,
      rawOutput,
      parseError: `模型复盘未能解析：${error.message}`,
    };
  }
}

function formatMessages(messages) {
  return (messages || [])
    .filter((message) => message.type !== "generation")
    .map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`)
    .join("\n");
}
