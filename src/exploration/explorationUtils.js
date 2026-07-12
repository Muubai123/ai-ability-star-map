import { getDisplayMastery } from "../utils/mapUtils.js";
import { getSessionsByNodeId } from "./explorationStorage.js";

export function createExplorationId(prefix = "explore") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function findNodeById(root, nodeId) {
  if (!root) return null;
  if (root.id === nodeId) return root;

  for (const child of root.children || []) {
    const found = findNodeById(child, nodeId);
    if (found) return found;
  }

  return null;
}

export function findNodePath(root, nodeId) {
  const path = [];

  function walk(node) {
    path.push(node);
    if (node.id === nodeId) return true;

    for (const child of node.children || []) {
      if (walk(child)) return true;
    }

    path.pop();
    return false;
  }

  return root && walk(root) ? path : [];
}

export function createExplorationSession(state, node) {
  const path = findNodePath(state.starMap, node.id);

  return {
    id: createExplorationId("exploration"),
    mapId: state.activeMapId || "",
    nodeId: node.id,
    nodeTitle: node.title,
    nodePath: path.map((item) => item.title),
    status: "defining_goal",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    endedAt: null,
    masteryBefore: getDisplayMastery(node),
    masteryAccepted: null,
    plan: createEmptyPlan(),
    messages: [],
    notes: [],
    evidence: [],
    suggestedActions: [],
    suggestedMapChanges: [],
    reflection: "",
    review: null,
    acceptedChanges: [],
    goalInput: "",
    refinedGoal: "",
    goalConfirmation: null,
    aiSuggestions: [],
    completionChecklist: [],
    completionNote: "",
    completionSummary: "",
    assessment: null,
  };
}

export function createEmptyPlan() {
  return {
    goal: "",
    estimatedMinutes: null,
    tasks: [],
    completionCriteria: [],
    possiblePrerequisites: [],
  };
}

export function createLocalFallbackPlan(nodeTitle) {
  return {
    goal: `完成一次围绕“${nodeTitle}”的聚焦探索，并留下可复查的掌握证据。`,
    estimatedMinutes: 30,
    tasks: [
      {
        id: createExplorationId("task"),
        title: `用自己的话说明“${nodeTitle}”的核心含义`,
        status: "pending",
        evidenceType: "explanation",
      },
      {
        id: createExplorationId("task"),
        title: "完成一个最小练习或实际应用，并记录结果",
        status: "pending",
        evidenceType: "practice",
      },
    ],
    completionCriteria: ["能够说明核心概念", "至少留下一个练习或应用证据"],
    possiblePrerequisites: [],
  };
}

export function normalizeExplorationPlan(plan) {
  const safePlan = plan && typeof plan === "object" && !Array.isArray(plan)
    ? plan
    : {};
  const allowedEvidence = new Set([
    "self_report",
    "exercise",
    "explanation",
    "practice",
  ]);

  return {
    goal: String(safePlan.goal || "").trim(),
    estimatedMinutes: clampNumber(safePlan.estimatedMinutes, 5, 240, 30),
    tasks: (Array.isArray(safePlan.tasks) ? safePlan.tasks : []).slice(0, 4).map((task) => {
      const safeTask = task && typeof task === "object" && !Array.isArray(task)
        ? task
        : {};

      return {
        id: String(safeTask.id || createExplorationId("task")),
        title: String(safeTask.title || "未命名任务").trim(),
        status: ["pending", "partial", "completed"].includes(safeTask.status)
          ? safeTask.status
          : "pending",
        evidenceType: allowedEvidence.has(safeTask.evidenceType)
          ? safeTask.evidenceType
          : "self_report",
      };
    }),
    completionCriteria: stringArray(safePlan.completionCriteria),
    possiblePrerequisites: stringArray(safePlan.possiblePrerequisites),
  };
}

export function normalizeSuggestedActions(actions = []) {
  const allowedTypes = new Set([
    "add_note",
    "add_evidence",
    "suggest_new_node",
    "suggest_prerequisite",
  ]);

  return (Array.isArray(actions) ? actions : [])
    .filter((action) => allowedTypes.has(action?.type))
    .slice(0, 4)
    .map((action) => ({
      id: action.id || createExplorationId("suggestion"),
      type: action.type,
      content: String(action.content || "").trim(),
      title: String(action.title || "").trim(),
      parentId: String(action.parentId || "").trim(),
      nodeTitle: String(action.nodeTitle || "").trim(),
      evidenceType: String(action.evidenceType || "self_report").trim(),
      accepted: false,
    }));
}

export function normalizeGoalConfirmation(value = {}) {
  const safe = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    reply: String(safe.reply || "").trim(),
    isGoalClear: Boolean(safe.isGoalClear),
    isScopeReasonable: safe.isScopeReasonable !== false,
    refinedGoal: String(safe.refinedGoal || "").trim(),
    suggestions: (Array.isArray(safe.suggestions) ? safe.suggestions : []).slice(0, 4).map((item) => ({
      title: String(item?.title || "").trim(),
      description: String(item?.description || "").trim(),
    })).filter((item) => item.title || item.description),
    followUpQuestion: String(safe.followUpQuestion || "").trim(),
  };
}

export function normalizeCompletionChecklist(value = {}) {
  const safe = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowedCategories = new Set(["understanding", "application", "independence", "explanation", "difficulty", "unresolved"]);
  return {
    summary: String(safe.summary || "").trim(),
    checklist: (Array.isArray(safe.checklist) ? safe.checklist : []).slice(0, 8).map((item, index) => ({
      id: String(item?.id || createExplorationId(`check-${index}`)),
      label: String(item?.label || "").trim(),
      category: allowedCategories.has(item?.category) ? item.category : "understanding",
      defaultChecked: Boolean(item?.defaultChecked),
      supportsMastery: item?.supportsMastery !== false,
      checked: Boolean(item?.checked ?? item?.defaultChecked),
    })).filter((item) => item.label),
    additionalPrompt: String(safe.additionalPrompt || "").trim(),
  };
}

export function createFallbackCompletionChecklist() {
  return normalizeCompletionChecklist({
    summary: "请根据实际完成情况勾选，并补充仍有困难的部分。",
    checklist: [
      { id: "understanding", label: "我理解了本次目标的基本内容", category: "understanding", supportsMastery: true },
      { id: "practice", label: "我完成了练习或实际操作", category: "application", supportsMastery: true },
      { id: "independence", label: "我能独立完成主要步骤", category: "independence", supportsMastery: true },
      { id: "hint", label: "我仍需要提示或参考", category: "difficulty", supportsMastery: false },
      { id: "unresolved", label: "我还有未解决的问题", category: "unresolved", supportsMastery: false },
    ],
  });
}

export function normalizeExplorationAssessment(value = {}, masteryBefore = 0) {
  const safe = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const suggestion = safe.masterySuggestion && typeof safe.masterySuggestion === "object" ? safe.masterySuggestion : {};
  return {
    summary: String(safe.summary || "").trim(),
    evidenceSummary: stringArray(safe.evidenceSummary),
    masterySuggestion: {
      nodeId: String(suggestion.nodeId || "").trim(),
      before: clampNumber(suggestion.before, 0, 4, masteryBefore),
      after: clampNumber(suggestion.after, 0, 4, masteryBefore),
      confidence: clampNumber(suggestion.confidence, 0, 1, 0),
      reason: String(suggestion.reason || "证据不足，建议保持当前等级。").trim(),
    },
    childNodeAssessments: (Array.isArray(safe.childNodeAssessments) ? safe.childNodeAssessments : []).slice(0, 8).map((item) => ({
      nodeId: String(item?.nodeId || "").trim(),
      nodeTitle: String(item?.nodeTitle || "").trim(),
      before: clampNumber(item?.before, 0, 4, 0),
      after: clampNumber(item?.after, 0, 4, 0),
      confidence: clampNumber(item?.confidence, 0, 1, 0),
      reason: String(item?.reason || "").trim(),
      accepted: Boolean(item?.accepted),
    })).filter((item) => item.nodeId),
    remainingProblems: stringArray(safe.remainingProblems),
    newNodeSuggestions: (Array.isArray(safe.newNodeSuggestions) ? safe.newNodeSuggestions : []).slice(0, 4).map((item) => ({
      title: String(item?.title || "").trim(),
      description: String(item?.description || "").trim(),
      parentId: String(item?.parentId || "").trim(),
    })).filter((item) => item.title),
    nextSuggestion: String(safe.nextSuggestion || "").trim(),
  };
}

export function normalizeExplorationReview(review, masteryBefore = 0) {
  const safeReview = review && typeof review === "object" && !Array.isArray(review)
    ? review
    : {};
  const suggestion = safeReview.masterySuggestion
    && typeof safeReview.masterySuggestion === "object"
    && !Array.isArray(safeReview.masterySuggestion)
    ? safeReview.masterySuggestion
    : {};

  return {
    summary: String(safeReview.summary || "").trim(),
    completedTasks: stringArray(safeReview.completedTasks),
    partialTasks: stringArray(safeReview.partialTasks),
    unfinishedTasks: stringArray(safeReview.unfinishedTasks),
    evidence: stringArray(safeReview.evidence),
    masterySuggestion: {
      before: clampNumber(suggestion.before, 0, 4, masteryBefore),
      after: clampNumber(suggestion.after, 0, 4, masteryBefore),
      confidence: clampNumber(suggestion.confidence, 0, 1, 0),
      reason: String(suggestion.reason || "证据不足，建议保持当前等级。").trim(),
    },
    mapChanges: (Array.isArray(safeReview.mapChanges) ? safeReview.mapChanges : [])
      .filter((change) =>
        ["add_child", "add_prerequisite", "rename_node", "add_note"].includes(
          change?.type
        )
      )
      .slice(0, 6)
      .map((change) => ({
        id: change.id || createExplorationId("change"),
        type: change.type,
        parentId: String(change.parentId || "").trim(),
        title: String(change.title || "").trim(),
        description: String(change.description || "").trim(),
        accepted: true,
      })),
    nextSuggestion: String(safeReview.nextSuggestion || "").trim(),
  };
}

export function buildExplorationNodeContext(state, node) {
  const path = findNodePath(state.starMap, node.id);
  const recentSessions = getSessionsByNodeId(node.id, state.activeMapId).slice(0, 3);

  return {
    id: node.id,
    title: node.title,
    description: node.description || "",
    mastery: getDisplayMastery(node),
    weight: node.weight,
    path: path.map((item) => item.title),
    directChildren: (node.children || []).map((child) => child.title),
    recentExplorations: recentSessions.map((session) => ({
      goal: session.plan?.goal || "",
      endedAt: session.endedAt,
      masteryBefore: session.masteryBefore,
      masteryAccepted: session.masteryAccepted,
      summary: session.review?.summary || "",
    })),
  };
}

export function getExplorationDuration(session, now = Date.now()) {
  if (!session?.startedAt) return 0;
  return Math.max(0, Number(session.endedAt || now) - Number(session.startedAt));
}

export function formatExplorationDuration(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);

  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

function stringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
